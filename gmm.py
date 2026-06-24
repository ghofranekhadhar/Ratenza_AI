import pandas as pd
import numpy as np
from sklearn.mixture import GaussianMixture

def segment_with_gmm(rfm_df: pd.DataFrame, n_components: int = 4) -> pd.DataFrame:
    """
    Applique le modèle Gaussian Mixture Model (GMM) pour segmenter les clients en composantes (VIP, Régulier, etc.).
    """
    if rfm_df.empty or len(rfm_df) < n_components:
        # Fallback de sécurité
        rfm_df["segment_gmm"] = "regular"
        rfm_df["probability_gmm"] = 1.0
        rfm_df["probabilities_gmm"] = [{"vip": 0.0, "regular": 1.0, "at_risk": 0.0, "lost": 0.0}] * len(rfm_df)
        return rfm_df
        
    df = rfm_df.copy()
    
    # Utilisation des scores normalisés (R, F, M) pour le clustering
    features = ["recency_score", "frequency_score", "monetary_score"]
    X = df[features].values
    
    # Entraîner le GMM
    gmm = GaussianMixture(n_components=n_components, random_state=42)
    gmm.fit(X)
    
    # Prédire les probabilités d'appartenance
    probas = gmm.predict_proba(X)
    predicted_clusters = probas.argmax(axis=1)
    max_probas = probas.max(axis=1)
    
    # Mapper les clusters aux segments (VIP, Régulier, À risque, Perdu)
    # Les centres des clusters (gmm.means_) ont 3 dimensions : (recency_score, frequency_score, monetary_score)
    # Plus la somme des centres est élevée, meilleur est le segment.
    cluster_scores = gmm.means_.sum(axis=1)
    sorted_indices = np.argsort(cluster_scores)[::-1]
    
    # Mappage (index GMM -> nom du segment technique)
    labels = ["vip", "regular", "at_risk", "lost"]
    cluster_mapping = {}
    for rank, cluster_idx in enumerate(sorted_indices):
        label_idx = min(rank, len(labels) - 1)
        cluster_mapping[cluster_idx] = labels[label_idx]
        
    # Appliquer le mappage pour chaque client
    segment_labels = [cluster_mapping[c] for c in predicted_clusters]
    
    # Construire le dictionnaire détaillé
    detailed_probas = []
    for i in range(len(df)):
        client_probs = {}
        for cluster_idx in range(n_components):
            key = cluster_mapping[cluster_idx]
            client_probs[key] = round(float(probas[i, cluster_idx]), 4)
        detailed_probas.append(client_probs)
        
    df["segment_gmm"] = segment_labels
    df["probability_gmm"] = max_probas.round(4)
    df["probabilities_gmm"] = detailed_probas
    
    return df
