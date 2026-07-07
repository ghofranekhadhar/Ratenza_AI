"""
xgboost_churn.py — Retenza AI : Prédiction de l'Attrition Client (Churn Prediction)
======================================================================================

Ce module implémente un modèle XGBoost pour prédire la probabilité d'attrition
(churn) de chaque client à partir de ses métriques RFM et de son score de fidélité.

⚠️  NOTE IMPORTANTE SUR LES LABELS :
    En l'absence de données historiques réelles sur les départs de clients, ce modèle
    utilise une approche de "pseudo-labélisation" basée sur des règles métier RFM.
    Les règles sont :
      - Un client est considéré "à risque de churn" (label=1) si :
          * Sa récence est supérieure au 70e percentile de la distribution (inactif longtemps)
          * ET son score global Sa est inférieur à la médiane (faible fidélité)
      - Sinon, le client est considéré "fidèle" (label=0).
    Ces seuils sont DYNAMIQUES : calculés sur les données réelles de chaque exécution.
    Cette approche est standard en marketing analytique (semi-supervisé).

Architecture :
    1. Feature Engineering    → Sélection et préparation des variables
    2. Génération Pseudo-Labels → Règles métier RFM avec seuils dynamiques
    3. Entraînement XGBoost   → XGBClassifier avec validation train/test
    4. Évaluation Complète    → Accuracy, Precision, Recall, F1, ROC-AUC, Matrice de confusion
    5. Sauvegarde             → models/xgboost_churn.pkl (via joblib)
    6. Prédiction Production  → predict_churn_risk(rfm_df)
"""

import os
import logging
import numpy as np
import pandas as pd
import joblib
from xgboost import XGBClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import (
    accuracy_score, precision_score, recall_score,
    f1_score, roc_auc_score, confusion_matrix
)

logger = logging.getLogger(__name__)

# Répertoire de sauvegarde du modèle
MODEL_DIR  = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "xgboost_churn.pkl")

# Features utilisées pour l'entraînement et la prédiction
FEATURE_COLUMNS = [
    "recency",
    "frequency",
    "monetary",
    "monetary_total",
    "recency_score",
    "frequency_score",
    "monetary_score",
    "score_global_sa"
]


# ==============================================================================
# 1. GÉNÉRATION DES PSEUDO-LABELS (SEUILS DYNAMIQUES)
# ==============================================================================

def generate_churn_labels(rfm_df: pd.DataFrame) -> pd.Series:
    """
    Génère des pseudo-labels de churn basés sur une approche probabiliste RFM.

    La probabilité de base de churn d'un client est définie par :
        P(churn) = (1 - recency_score) * (1 - 0.5 * score_global_sa)
    
    Les labels 0/1 sont ensuite échantillonnés via une loi de Bernoulli.
    Cela garantit que :
      - Les clients très récents (recency_score proche de 1) ont une probabilité
        proche de 0 et auront TOUJOURS un label 0 (pas de churn).
      - Les clients inactifs et peu fidèles ont une probabilité élevée d'être 1.
      - Les clients intermédiaires ont des probabilités lissées.

    Returns:
        pd.Series avec les labels 0/1 pour chaque client.
    """
    # Calcul de la probabilité théorique de churn
    p_churn = (1.0 - rfm_df["recency_score"]) * (1.0 - 0.5 * rfm_df["score_global_sa"])

    # Échantillonnage probabiliste (Loi de Bernoulli)
    np.random.seed(42)
    labels = (np.random.rand(len(rfm_df)) < p_churn).astype(int)

    n_churn   = labels.sum()
    n_fidele  = len(labels) - n_churn
    pct_churn = (n_churn / len(labels)) * 100
    logger.info(f"[XGBoost] Distribution pseudo-labels probabilistes : {n_churn} churn ({pct_churn:.1f}%) | {n_fidele} fidèles")

    return pd.Series(labels, index=rfm_df.index)


# ==============================================================================
# 2. ENTRAÎNEMENT DU MODÈLE
# ==============================================================================

def train_churn_model(rfm_df: pd.DataFrame) -> XGBClassifier:
    """
    Entraîne un modèle XGBoost de prédiction de churn sur les données RFM.

    Étapes :
      1. Génération des pseudo-labels (seuils dynamiques)
      2. Sélection des features
      3. Division train/test (80/20 stratifié)
      4. Entraînement XGBClassifier avec scale_pos_weight (équilibre des classes)
      5. Évaluation complète (Accuracy, Precision, Recall, F1, ROC-AUC, confusion matrix)
      6. Sauvegarde du modèle

    Returns:
        Le modèle XGBClassifier entraîné.
    """
    logger.info("[XGBoost] ═══════════════════════════════════════════")
    logger.info("[XGBoost] Démarrage de l'entraînement du modèle Churn")
    logger.info("[XGBoost] ═══════════════════════════════════════════")

    # Vérifier que toutes les features sont disponibles
    missing = [c for c in FEATURE_COLUMNS if c not in rfm_df.columns]
    if missing:
        raise ValueError(f"[XGBoost] Colonnes manquantes dans rfm_df : {missing}")

    # Générer les pseudo-labels
    y = generate_churn_labels(rfm_df)
    X = rfm_df[FEATURE_COLUMNS].copy()

    # Vérification : assez de classes pour entraîner
    if y.nunique() < 2:
        logger.warning("[XGBoost] Une seule classe détectée après pseudo-labélisation. Modèle non entraînable.")
        return None

    # Division stratifiée train/test (80% / 20%)
    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    logger.info(f"[XGBoost] Division des données : {len(X_train)} entraînement | {len(X_test)} test")

    # Calcul du scale_pos_weight pour équilibrer les classes déséquilibrées
    n_neg   = (y_train == 0).sum()
    n_pos   = (y_train == 1).sum()
    spw     = n_neg / n_pos if n_pos > 0 else 1
    logger.info(f"[XGBoost] Classes train → Fidèles: {n_neg} | Churn: {n_pos} | scale_pos_weight: {spw:.2f}")

    # Entraîner le modèle XGBoost
    model = XGBClassifier(
        n_estimators      = 150,
        max_depth         = 4,
        learning_rate     = 0.1,
        subsample         = 0.8,
        colsample_bytree  = 0.8,
        scale_pos_weight  = spw,
        use_label_encoder = False,
        eval_metric       = "logloss",
        random_state      = 42,
        verbosity         = 0
    )
    model.fit(X_train, y_train)

    # ─── ÉVALUATION COMPLÈTE DU MODÈLE ──────────────────────────────────────

    y_pred       = model.predict(X_test)
    y_pred_proba = model.predict_proba(X_test)[:, 1]

    acc       = accuracy_score(y_test, y_pred)
    precision = precision_score(y_test, y_pred, zero_division=0)
    recall    = recall_score(y_test, y_pred, zero_division=0)
    f1        = f1_score(y_test, y_pred, zero_division=0)
    roc_auc   = roc_auc_score(y_test, y_pred_proba) if y_test.nunique() > 1 else 0.0
    cm        = confusion_matrix(y_test, y_pred)

    print("\n" + "=" * 60)
    print("    EVALUATION DU MODELE XGBOOST -- CHURN PREDICTION")
    print("=" * 60)
    print(f"  Accuracy  : {acc:.4f}  ({acc*100:.2f}%)")
    print(f"  Precision : {precision:.4f}")
    print(f"  Recall    : {recall:.4f}")
    print(f"  F1-Score  : {f1:.4f}")
    print(f"  ROC-AUC   : {roc_auc:.4f}")
    print("-" * 60)
    print("  Matrice de Confusion :")
    print("    +------------------------------------------+")
    print("    | Reel\\Predit   | Fidele      | Churn      |")
    print("    +------------------------------------------+")
    if cm.shape == (2, 2):
        print(f"    | Fidele  (0)   |   {cm[0,0]:5d}      |   {cm[0,1]:5d}    |")
        print(f"    | Churn   (1)   |   {cm[1,0]:5d}      |   {cm[1,1]:5d}    |")
    print("    +------------------------------------------+")

    # Importance des features
    importances = model.feature_importances_
    feat_imp = sorted(zip(FEATURE_COLUMNS, importances), key=lambda x: x[1], reverse=True)
    print("-" * 60)
    print("  Importance des Features :")
    for feat, imp in feat_imp:
        bar = "#" * int(imp * 30)
        print(f"    {feat:<22} {bar} {imp:.4f}")
    print("=" * 60 + "\n")

    # ─── SAUVEGARDE DU MODÈLE ───────────────────────────────────────────────
    os.makedirs(MODEL_DIR, exist_ok=True)
    joblib.dump(model, MODEL_PATH)
    logger.info(f"[XGBoost] Modèle sauvegardé dans : {MODEL_PATH}")

    return model


# ==============================================================================
# 3. PRÉDICTION EN PRODUCTION
# ==============================================================================

def predict_churn_risk(rfm_df: pd.DataFrame) -> pd.DataFrame:
    """
    Prédit le score de risque de churn pour chaque client.

    Si le modèle n'existe pas encore, il est entraîné à la volée.

    Ajoute les colonnes :
      - churn_score      : Probabilité de churn [0.0 → 1.0]
      - churn_risk_label : Niveau de risque textuel (Faible / Moyen / Élevé / Critique)

    Returns:
        DataFrame enrichi avec churn_score et churn_risk_label.
    """
    if rfm_df.empty:
        logger.warning("[XGBoost] DataFrame vide — prédiction churn ignorée.")
        return rfm_df

    df = rfm_df.copy()

    # Charger ou entraîner le modèle
    if os.path.exists(MODEL_PATH):
        logger.info(f"[XGBoost] Chargement du modèle existant depuis : {MODEL_PATH}")
        model = joblib.load(MODEL_PATH)
    else:
        logger.info("[XGBoost] Aucun modèle trouvé. Entraînement en cours...")
        model = train_churn_model(df)
        if model is None:
            # Fallback si entraînement impossible (données insuffisantes)
            df["churn_score"]      = 0.0
            df["churn_risk_label"] = "Indéterminé"
            return df

    # Vérifier que les features sont disponibles
    missing = [c for c in FEATURE_COLUMNS if c not in df.columns]
    if missing:
        logger.error(f"[XGBoost] Features manquantes pour la prédiction : {missing}")
        df["churn_score"]      = 0.0
        df["churn_risk_label"] = "Indéterminé"
        return df

    # Prédire les probabilités de churn
    X = df[FEATURE_COLUMNS]
    churn_probas = model.predict_proba(X)[:, 1]

    df["churn_score"] = np.round(churn_probas, 4)

    # Assigner un label de risque selon le score (seuils business)
    def get_risk_label(score):
        if score < 0.30:
            return "Faible"
        elif score < 0.55:
            return "Moyen"
        elif score < 0.75:
            return "Élevé"
        else:
            return "Critique"

    df["churn_risk_label"] = df["churn_score"].apply(get_risk_label)

    # Statistiques de sortie
    risk_counts = df["churn_risk_label"].value_counts()
    logger.info("[XGBoost] Scores Churn calculés :")
    for label, count in risk_counts.items():
        logger.info(f"  {label:<12}: {count} clients")

    return df


# ==============================================================================
# 4. POINT D'ENTRÉE — ENTRAÎNEMENT FORCÉ (optionnel)
# ==============================================================================

def force_retrain(rfm_df: pd.DataFrame) -> XGBClassifier:
    """
    Force le ré-entraînement du modèle (utile après mise à jour des données).
    """
    if os.path.exists(MODEL_PATH):
        os.remove(MODEL_PATH)
        logger.info("[XGBoost] Ancien modèle supprimé. Re-entraînement en cours...")
    return train_churn_model(rfm_df)


# ==============================================================================
# 5. TEST RAPIDE (exécution directe du fichier)
# ==============================================================================

if __name__ == "__main__":
    """
    Test standalone : Entraîne le modèle sur les données MongoDB réelles.
    Usage : python xgboost_churn.py
    """
    import sys
    sys.path.insert(0, os.path.dirname(__file__))

    logging.basicConfig(
        level=logging.INFO,
        format="[%(asctime)s] %(levelname)s - %(message)s"
    )

    from database import load_clients, load_transactions, get_mongo_client
    from rfm import calculate_raw_rfm, normalize_rfm
    from config import DEFAULT_WR, DEFAULT_WF, DEFAULT_WM

    COMMERCE_TEST = "commerce_local_1"
    logger.info(f"[TEST] Chargement des données pour : {COMMERCE_TEST}")

    clients_df      = load_clients(COMMERCE_TEST)
    transactions_df = load_transactions(COMMERCE_TEST)

    tx_with_email = transactions_df.merge(
        clients_df[["id", "email"]], left_on="client_id", right_on="id", how="left"
    )
    tx_with_email["email"] = tx_with_email["email"].fillna(tx_with_email["client_id"])

    max_tx_date  = transactions_df["date_transaction"].max()
    rfm_raw      = calculate_raw_rfm(tx_with_email, ref_date=max_tx_date)
    rfm_norm     = normalize_rfm(rfm_raw, wr=DEFAULT_WR, wf=DEFAULT_WF, wm=DEFAULT_WM)

    logger.info(f"[TEST] {len(rfm_norm)} clients chargés. Lancement de l'entraînement...")
    train_churn_model(rfm_norm)

    logger.info("[TEST] Prédiction sur l'ensemble des clients...")
    result = predict_churn_risk(rfm_norm)
    print("\nTop 10 clients avec les scores churn les plus élevés :")
    print(result[["client_id", "churn_score", "churn_risk_label"]].sort_values("churn_score", ascending=False).head(10).to_string(index=False))
