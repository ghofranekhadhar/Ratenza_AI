import argparse
import sys
import os
from datetime import datetime
import pandas as pd
from tabulate import tabulate

from config import DEFAULT_WR, DEFAULT_WF, DEFAULT_WM, LOG_LEVEL
from database import load_clients, load_transactions, save_rfm_results, get_mongo_client, save_return_rate
from rfm import calculate_raw_rfm, normalize_rfm, calculate_frequency_delta, calculate_return_rate
from gmm import segment_with_gmm
from xgboost_churn import predict_churn_risk
import logging

# Configuration de la journalisation (Logging)
logging.basicConfig(level=getattr(logging, LOG_LEVEL, logging.INFO),
                    format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger("Ratenza_Phase1")

def print_banner():
    banner = """
=================================================================
             ReTENZA AI ENGINE — CONFIGURATION PHASE 1
        (Connexion MongoDB locale & Analyse Comportementale RFM)
=================================================================
"""
    print(banner)

def run_rfm_pipeline(commerce_id: str):
    print_banner()
    
    # 1. Tester la connexion MongoDB
    try:
        get_mongo_client()
    except Exception as e:
        logger.error(f"Impossible de démarrer l'analyse : {e}")
        sys.exit(1)
        
    # 2. Chargement des données
    logger.info(f"Chargement des données pour le commerce : {commerce_id}")
    
    clients_df = load_clients(commerce_id)
    transactions_df = load_transactions(commerce_id)
    
    if clients_df.empty:
        logger.error(f"Aucun client trouvé dans MongoDB pour le commerce '{commerce_id}'.")
        return
        
    if transactions_df.empty:
        logger.error(f"Aucune transaction trouvée dans MongoDB pour le commerce '{commerce_id}'.")
        return
        
    logger.info(f"Données chargées avec succès :")
    logger.info(f" - {len(clients_df)} clients trouvés.")
    logger.info(f" - {len(transactions_df)} transactions trouvées.")
    
    # 3. Calcul des valeurs RFM brutes
    logger.info("Calcul des métriques RFM brutes (Récence, Fréquence, Montant)...")
    # Date de référence pour le calcul de la récence (dernière transaction dans la DB ou aujourd'hui)
    max_tx_date = transactions_df["date_transaction"].max()
    logger.info(f"Date de la transaction la plus récente (Date de référence) : {max_tx_date}")
    
    # Joindre les transactions avec l'email du client pour pouvoir grouper par email unique
    tx_with_email = transactions_df.merge(clients_df[["id", "email"]], left_on="client_id", right_on="id", how="left")
    tx_with_email["email"] = tx_with_email["email"].fillna(tx_with_email["client_id"])
    
    rfm_raw = calculate_raw_rfm(tx_with_email, ref_date=max_tx_date)

    # 3.5 Calcul de la variation de fréquence d'achat (Δ < -25% → baisse détectée)
    logger.info("Calcul de la variation de fréquence d'achat (signal baisse précoce)...")
    delta_df = calculate_frequency_delta(tx_with_email, ref_date=max_tx_date)
    # Fusionner le delta dans rfm_raw (jointure sur client_id)
    if not delta_df.empty:
        rfm_raw = rfm_raw.merge(
            delta_df[["client_id", "freq_recente", "freq_historique",
                       "delta_frequence", "baisse_frequence_detectee", "date_calcul_delta"]],
            on="client_id",
            how="left"
        )
        # Valeurs par défaut pour les clients sans historique suffisant
        rfm_raw["delta_frequence"] = rfm_raw["delta_frequence"].fillna(0.0)
        rfm_raw["baisse_frequence_detectee"] = rfm_raw["baisse_frequence_detectee"].fillna(False)
        rfm_raw["freq_recente"] = rfm_raw["freq_recente"].fillna(0)
        rfm_raw["freq_historique"] = rfm_raw["freq_historique"].fillna(0.0)
    
    # 4. Normalisation et calcul du score global Sa
    logger.info("Normalisation des métriques et calcul du score global comportemental Sa...")
    rfm_normalized = normalize_rfm(rfm_raw, wr=DEFAULT_WR, wf=DEFAULT_WF, wm=DEFAULT_WM)
    
    # 4.5 Application de la segmentation GMM
    logger.info("Application de la segmentation probabiliste GMM (Gaussian Mixture Model)...")
    rfm_normalized = segment_with_gmm(rfm_normalized, n_components=4)

    # 4.6 Prédiction du risque d'attrition (Churn) avec XGBoost
    logger.info("Prédiction du risque de churn (attrition) avec XGBoost...")
    rfm_normalized = predict_churn_risk(rfm_normalized)
    
    # 5. Fusionner les résultats avec les détails des clients (nom et email)
    # Dédoublonner les clients par email pour avoir une seule ligne par personne physique
    clients_unique = clients_df.drop_duplicates(subset=["email"]).copy()
    
    cols_to_merge = ["nom", "email", "id"]
    if "date_naissance" in clients_df.columns:
        cols_to_merge.append("date_naissance")
        
    results_df = rfm_normalized.merge(clients_unique[cols_to_merge], left_on="client_id", right_on="email", how="left")
    results_df = results_df.rename(columns={"id": "client_db_id"})
    
    # Remplacer les valeurs manquantes
    results_df["nom"] = results_df["nom"].fillna(results_df["client_id"])
    results_df["email"] = results_df["email"].fillna(results_df["client_id"])
    results_df["client_db_id"] = results_df["client_db_id"].fillna(results_df["client_id"])
    
    # 5.5 Calcul du score d'influence IA et génération des codes de parrainage
    logger.info("Calcul du score d'influence IA et génération des codes de parrainage...")
    # Influence = Sa * 0.7 + (1 - Churn) * 0.3
    results_df["influence_score"] = (results_df["score_global_sa"] * 0.7 + (1.0 - results_df["churn_score"]) * 0.3) * 100
    results_df["influence_score"] = results_df["influence_score"].round().astype(int)

    def make_ref_code(row):
        nom = str(row["nom"]).split(" ")[0]
        nom_clean = "".join(c for c in nom if c.isalnum()).upper()
        if not nom_clean:
            nom_clean = "CL"
        email_clean = str(row["email"]).split("@")[0]
        email_clean = "".join(c for c in email_clean if c.isalnum()).upper()
        suffix = email_clean[-4:] if len(email_clean) >= 4 else email_clean.zfill(4)
        return f"REF-{nom_clean}-{suffix}"

    results_df["referral_code"] = results_df.apply(make_ref_code, axis=1)

    # Trier par score Sa décroissant (les clients les plus fidèles / VIP en premier)
    results_df = results_df.sort_values(by="score_global_sa", ascending=False)
    
    # 6. Afficher les statistiques globales
    print("\n" + "=" * 80)
    print("                      STATISTIQUES GLOBALES RFM")
    print("=" * 80)
    print(f"Nombre de clients analysés    : {len(results_df)}")
    print(f"Récence moyenne (jours)       : {results_df['recency'].mean():.1f} jours")
    print(f"Fréquence moyenne             : {results_df['frequency'].mean():.1f} transactions")
    print(f"Panier moyen global (M)       : {results_df['monetary'].mean():.2f} DT")
    print(f"Montant total dépensé global  : {results_df['monetary_total'].sum():.2f} DT")
    print(f"Score global Sa moyen         : {results_df['score_global_sa'].mean():.4f}")
    print("-" * 80)
    print(f"Poids appliqués - Récence (Wr): {DEFAULT_WR} | Fréquence (Wf): {DEFAULT_WF} | Montant (Wm): {DEFAULT_WM}")
    print("=" * 80 + "\n")
    
    # 7. Afficher le top 10 des clients avec un tableau propre
    print("TOP 10 CLIENTS (Triés par Score RFM Global Sa)")
    # Sélectionner les colonnes pour un affichage propre
    churn_cols_available = "churn_score" in results_df.columns and "churn_risk_label" in results_df.columns
    display_cols = [
        "nom", "email", "recency", "frequency", "monetary",
        "score_global_sa", "segment_gmm", "probability_gmm"
    ]
    if churn_cols_available:
        display_cols += ["churn_score", "churn_risk_label"]

    top_10 = results_df[display_cols].head(10).copy()
    
    # Renommer les colonnes pour la présentation en français
    col_rename = [
        "Nom", "Email", "Récence (J)", "Fréquence", "Montant (DT)",
        "Score Global Sa", "Segment GMM", "Confiance (%)"
    ]
    if churn_cols_available:
        col_rename += ["Score Churn", "Risque Churn"]
    top_10.columns = col_rename
    
    # Format de la probabilité en pourcentage
    top_10["Confiance (%)"] = (top_10["Confiance (%)"] * 100).apply(lambda x: f"{x:.1f}%")
    if churn_cols_available:
        top_10["Score Churn"] = (top_10["Score Churn"] * 100).apply(lambda x: f"{x:.1f}%")
    
    print(tabulate(top_10, headers="keys", tablefmt="pretty", showindex=False))
    
    # 8. Sauvegarder les résultats dans MongoDB
    logger.info("Sauvegarde des résultats RFM dans la base de données...")
    # Nettoyage des colonnes temporaires de jointure avant sauvegarde
    if "id" in results_df.columns:
        results_df = results_df.drop(columns=["id"])
        
    save_rfm_results(commerce_id, results_df)

    # 8.5 Calculer et sauvegarder le Taux de Retour Client (Tr)
    logger.info("Calcul du Taux de Retour Client (Tr) sur 30 jours...")
    kpis_retour = calculate_return_rate(tx_with_email, ref_date=max_tx_date)
    save_return_rate(commerce_id, kpis_retour)
    
    logger.info("Analyse RFM terminée avec succès !")

def main():
    parser = argparse.ArgumentParser(
        description="Retenza AI : Pipeline RFM Simplifié",
        formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument(
        "--commerce-id", type=str, default="commerce_local_1",
        help="Identifiant du commerce à analyser (par défaut: commerce_local_1)"
    )
    
    args = parser.parse_args()
    run_rfm_pipeline(args.commerce_id)

if __name__ == "__main__":
    main()
