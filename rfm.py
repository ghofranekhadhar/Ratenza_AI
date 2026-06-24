from datetime import datetime
import pandas as pd
import numpy as np
from config import DEFAULT_WR, DEFAULT_WF, DEFAULT_WM
import logging

logger = logging.getLogger(__name__)

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
