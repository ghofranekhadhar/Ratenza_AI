from datetime import datetime, timedelta
import pandas as pd
import numpy as np
from config import DEFAULT_WR, DEFAULT_WF, DEFAULT_WM
import logging

logger = logging.getLogger(__name__)


def calculate_frequency_delta(transactions_df: pd.DataFrame, ref_date: datetime = None) -> pd.DataFrame:
    """
    Calcule la variation de fréquence d'achat (Δ) pour chaque client.

    Méthode :
        - Période récente    : 30 derniers jours avant ref_date.
        - Période historique : les 90 jours précédant la période récente (J-121 à J-31).
        - Δ = (freq_recente - freq_historique) / freq_historique
        - Si Δ < -0.25 (baisse > 25%) → baisse_frequence_detectee = True.

    Règle anti-chevauchement avec GMM/Churn (appliquée en aval dans le moteur) :
        Le flag 'baisse_frequence_detectee' est uniquement utilisé pour déclencher
        une campagne si aucune règle GMM/Churn plus prioritaire ne s'applique déjà.
        Cette fonction calcule UNIQUEMENT le signal ; la décision de campagne est
        prise dans rfmController.js.

    Args:
        transactions_df : DataFrame des transactions avec colonnes 'client_id'/'email',
                          'date_transaction', et optionnellement 'montant'.
        ref_date        : Date de référence (par défaut : aujourd'hui).

    Returns:
        DataFrame avec colonnes :
            - client_id             : identifiant du client
            - freq_recente          : nombre de transactions dans les 30 derniers jours
            - freq_historique       : nombre de transactions moyen/mois dans les 90 jours précédents
            - delta_frequence       : Δ (float, ex: -0.35 pour -35%)
            - baisse_frequence_detectee : True si Δ < -0.25
            - date_calcul_delta     : date du calcul (ISO string)
    """
    if ref_date is None:
        ref_date = datetime.now()

    if transactions_df.empty:
        logger.warning("[FreqDelta] DataFrame des transactions vide — calcul delta ignoré.")
        return pd.DataFrame(columns=[
            "client_id", "freq_recente", "freq_historique",
            "delta_frequence", "baisse_frequence_detectee", "date_calcul_delta"
        ])

    tx_df = transactions_df.copy()
    tx_df["date_transaction"] = pd.to_datetime(tx_df["date_transaction"]).dt.tz_localize(None)
    ref_date = pd.to_datetime(ref_date).tz_localize(None)

    # Bornes de la fenêtre temporelle
    recent_start    = ref_date - timedelta(days=30)     # J-30 → J (période récente)
    historic_start  = ref_date - timedelta(days=120)    # J-120 → J-31 (3 mois précédents)
    historic_end    = ref_date - timedelta(days=31)

    # Grouper par email ou client_id
    group_col = "email" if "email" in tx_df.columns else "client_id"

    records = []
    date_calcul = ref_date.isoformat()

    for client_id, group in tx_df.groupby(group_col):
        dates = group["date_transaction"]

        # Fréquence récente : comptage brut sur 30 jours
        freq_recente = int(dates[
            (dates >= recent_start) & (dates <= ref_date)
        ].count())

        # Fréquence historique : comptage sur 90 jours divisé par 3 pour ramener au mois
        count_historique = int(dates[
            (dates >= historic_start) & (dates <= historic_end)
        ].count())
        # Ramenée en fréquence mensuelle moyenne (diviser par 3 mois)
        freq_historique = round(count_historique / 3.0, 4)

        # Calcul du Δ (éviter la division par zéro)
        if freq_historique > 0:
            delta = round((freq_recente - freq_historique) / freq_historique, 4)
        elif freq_recente == 0:
            # Pas d'activité du tout sur les 4 derniers mois → neutre
            delta = 0.0
        else:
            # Nouveau client sans historique → pas de signal de baisse
            delta = 0.0

        baisse_detectee = bool(delta < -0.25)

        records.append({
            "client_id": client_id,
            "freq_recente": freq_recente,
            "freq_historique": freq_historique,
            "delta_frequence": delta,
            "baisse_frequence_detectee": baisse_detectee,
            "date_calcul_delta": date_calcul
        })

        if baisse_detectee:
            logger.info(
                f"[FreqDelta] ⚠️  Baisse détectée — {client_id} : "
                f"Δ={delta*100:.1f}% (récent={freq_recente}, historique≈{freq_historique:.1f}/mois)"
            )

    df_delta = pd.DataFrame(records)
    n_baisse = df_delta["baisse_frequence_detectee"].sum()
    logger.info(
        f"[FreqDelta] Calcul terminé : {len(df_delta)} clients analysés, "
        f"{n_baisse} avec baisse de fréquence détectée (Δ < -25%)."
    )
    return df_delta

def calculate_raw_rfm(transactions_df: pd.DataFrame, ref_date: datetime = None) -> pd.DataFrame:
    """
    Calcule les valeurs RFM brutes pour chaque client.
    - Récence (R) : Nombre de jours écoulés depuis la dernière transaction jusqu'à ref_date.
    - Fréquence (F) : Nombre total de transactions effectuées par le client.
    - Montant (M) : Panier moyen (montant moyen des transactions).
    - Montant Total (M_total) : Somme cumulée de toutes les transactions (utile comme métrique secondaire).
    """
    if ref_date is None:
        ref_date = datetime.now()
        
    if transactions_df.empty:
        logger.warning("Le DataFrame des transactions est vide. Calcul RFM impossible.")
        return pd.DataFrame(columns=["client_id", "recency", "frequency", "monetary", "monetary_total"])

    # Copie locale et normalisation des dates
    tx_df = transactions_df.copy()
    tx_df["date_transaction"] = pd.to_datetime(tx_df["date_transaction"]).dt.tz_localize(None)
    ref_date = pd.to_datetime(ref_date).tz_localize(None)

    # Groupement par email (si disponible pour fusionner les doublons) ou par client_id
    group_col = "email" if "email" in tx_df.columns else "client_id"
    grouped = tx_df.groupby(group_col)
    
    rfm_records = []
    for key, group in grouped:
        last_tx_date = group["date_transaction"].max()
        recency_days = (ref_date - last_tx_date).days
        # Borner la récence à 0 minimum
        recency_days = max(0, recency_days)
        
        frequency = len(group)
        monetary_avg = group["montant"].mean()
        monetary_total = group["montant"].sum()
        
        rfm_records.append({
            "client_id": key,
            "recency": recency_days,
            "frequency": frequency,
            "monetary": round(monetary_avg, 2),
            "monetary_total": round(monetary_total, 2)
        })
        
    return pd.DataFrame(rfm_records)

def normalize_rfm(rfm_df: pd.DataFrame, wr: float = DEFAULT_WR, wf: float = DEFAULT_WF, wm: float = DEFAULT_WM) -> pd.DataFrame:
    """
    Normalise les métriques brutes R, F, M dans l'intervalle [0, 1].
    - Pour la Récence : Inversion effectuée (1.0 = très récent, 0.0 = inactif depuis longtemps).
    - Calcul de l'indice de fidélité global Sa = wr * R_score + wf * F_score + wm * M_score
    """
    if rfm_df.empty:
        return rfm_df

    df = rfm_df.copy()
    
    # 1. Normalisation de la Récence (Inversée car moins de jours = meilleur score)
    r_min = df["recency"].min()
    r_max = df["recency"].max()
    if r_max == r_min:
        df["recency_score"] = 1.0
    else:
        r_norm = (df["recency"] - r_min) / (r_max - r_min)
        df["recency_score"] = 1.0 - r_norm

    # 2. Normalisation de la Fréquence (Plus c'est fréquent, meilleur est le score)
    f_min = df["frequency"].min()
    f_max = df["frequency"].max()
    if f_max == f_min:
        df["frequency_score"] = 1.0
    else:
        df["frequency_score"] = (df["frequency"] - f_min) / (f_max - f_min)

    # 3. Normalisation du Montant (Plus le panier moyen est élevé, meilleur est le score)
    m_min = df["monetary"].min()
    m_max = df["monetary"].max()
    if m_max == m_min:
        df["monetary_score"] = 1.0
    else:
        df["monetary_score"] = (df["monetary"] - m_min) / (m_max - m_min)

    # Assurer que toutes les valeurs normalisées soient strictement bornées dans [0.0, 1.0]
    df["recency_score"] = df["recency_score"].clip(0.0, 1.0)
    df["frequency_score"] = df["frequency_score"].clip(0.0, 1.0)
    df["monetary_score"] = df["monetary_score"].clip(0.0, 1.0)

    # Calcul du score comportemental global (Sa)
    df["score_global_sa"] = (
        wr * df["recency_score"] +
        wf * df["frequency_score"] +
        wm * df["monetary_score"]
    )
    
    # Arrondir pour un affichage propre
    df["score_global_sa"] = df["score_global_sa"].round(4)
    df["recency_score"] = df["recency_score"].round(4)
    df["frequency_score"] = df["frequency_score"].round(4)
    df["monetary_score"] = df["monetary_score"].round(4)
    
    return df


def calculate_return_rate(transactions_df: pd.DataFrame, ref_date: datetime = None) -> dict:
    """
    Calcule le Taux de Retour Client (Tr) sur les 30 derniers jours.

    Méthode :
        - Période active : 30 derniers jours (J-30 à J).
        - Clients actifs : clients ayant fait au moins 1 achat sur cette période.
        - Clients revenus : clients ayant fait au moins 2 achats sur cette période.
        - Tr = (clients_revenus / clients_actifs) * 100

    Args:
        transactions_df : DataFrame des transactions.
        ref_date        : Date de référence (par défaut : aujourd'hui).

    Returns:
        dict contenant les métriques calculées.
    """
    if ref_date is None:
        ref_date = datetime.now()

    if transactions_df.empty:
        logger.warning("[ReturnRate] DataFrame vide. Taux de retour = 0%.")
        return {
            "taux_retour_30j": 0.0,
            "clients_actifs_30j": 0,
            "clients_revenus_30j": 0,
            "date_calcul": ref_date.isoformat()
        }

    tx_df = transactions_df.copy()
    tx_df["date_transaction"] = pd.to_datetime(tx_df["date_transaction"]).dt.tz_localize(None)
    ref_date = pd.to_datetime(ref_date).tz_localize(None)

    # Fenêtre des 30 derniers jours
    recent_start = ref_date - timedelta(days=30)

    # Filtrer les transactions sur les 30 derniers jours
    tx_30j = tx_df[(tx_df["date_transaction"] >= recent_start) & (tx_df["date_transaction"] <= ref_date)]

    if tx_30j.empty:
        logger.info("[ReturnRate] Aucune transaction sur les 30 derniers jours. Taux de retour = 0%.")
        return {
            "taux_retour_30j": 0.0,
            "clients_actifs_30j": 0,
            "clients_revenus_30j": 0,
            "date_calcul": ref_date.isoformat()
        }

    # Grouper par client pour compter ses transactions sur 30j
    group_col = "email" if "email" in tx_30j.columns else "client_id"
    counts = tx_30j.groupby(group_col).size()

    clients_actifs = len(counts)
    clients_revenus = int((counts >= 2).sum())

    tr = round((clients_revenus / clients_actifs) * 100.0, 2) if clients_actifs > 0 else 0.0

    logger.info(
        f"[ReturnRate] Calcul Taux de Retour : {clients_revenus} revenus / {clients_actifs} actifs sur 30j "
        f"-> Tr = {tr}%"
    )

    return {
        "taux_retour_30j": tr,
        "clients_actifs_30j": clients_actifs,
        "clients_revenus_30j": clients_revenus,
        "date_calcul": ref_date.isoformat()
    }

