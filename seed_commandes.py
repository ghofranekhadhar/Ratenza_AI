"""
seed_commandes.py
-----------------
Crée 3 commandes de test réalistes pour ghofrane.khadarr@gmail.com
dans la collection retenza_ai.commandes.

Dates cohérentes avec le 13 juillet 2026 (date du test).

Statuts testés :
  - CMD-2026-001 : livre (livrée le 8 juillet)
  - CMD-2026-002 : en_livraison (expédiée le 11 juillet, arrivée prévue le 16)
  - CMD-2026-003 : en_preparation (commandée aujourd'hui, expédition prévue le 15)
"""

import os
from pymongo import MongoClient
from datetime import datetime, timezone

MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME   = "retenza_ai"

client = MongoClient(MONGO_URI)
db = client[DB_NAME]

# Supprimer les éventuelles commandes de test précédentes pour ce client
deleted = db.commandes.delete_many({
    "client_email": "ghofrane.khadarr@gmail.com",
    "commerce_id": {"$in": ["boutique_tunis", "commerce_local_1"]}
})
print(f"[seed] {deleted.deleted_count} commande(s) de test précédente(s) supprimée(s).")

# --- Commande 1 : LIVRÉE (historique) ---
cmd1_tunis = {
    "commerce_id":             "boutique_tunis",
    "client_email":            "ghofrane.khadarr@gmail.com",
    "numero_commande":         "CMD-2026-001",
    "statut":                  "livre",
    "date_commande":           datetime(2026, 7, 1, 10, 0, tzinfo=timezone.utc),
    "date_expedition":         datetime(2026, 7, 3, 14, 0, tzinfo=timezone.utc),
    "date_livraison_estimee":  datetime(2026, 7, 8, 18, 0, tzinfo=timezone.utc),
    "date_livraison_reelle":   datetime(2026, 7, 8, 11, 30, tzinfo=timezone.utc),
    "numero_suivi":            "TN202600010",
    "transporteur":            "Tunisie Post",
    "produits":                ["Robe d'été florale", "Ceinture dorée"],
    "montant_total":           74.90,
    "adresse_livraison":       "12 Rue Ibn Khaldoun, Tunis 1001"
}

# --- Commande 2 : EN LIVRAISON (commande active principale) ---
cmd2_tunis = {
    "commerce_id":             "boutique_tunis",
    "client_email":            "ghofrane.khadarr@gmail.com",
    "numero_commande":         "CMD-2026-002",
    "statut":                  "en_livraison",
    "date_commande":           datetime(2026, 7, 9, 9, 15, tzinfo=timezone.utc),
    "date_expedition":         datetime(2026, 7, 11, 8, 0, tzinfo=timezone.utc),
    "date_livraison_estimee":  datetime(2026, 7, 16, 18, 0, tzinfo=timezone.utc),
    "numero_suivi":            "TN202600021",
    "transporteur":            "Aramex Tunisia",
    "produits":                ["Sac à main cuir beige", "Foulard en soie"],
    "montant_total":           129.00,
    "adresse_livraison":       "12 Rue Ibn Khaldoun, Tunis 1001"
}

# --- Commande 3 : EN PRÉPARATION (très récente, commandée aujourd'hui) ---
cmd3_tunis = {
    "commerce_id":             "boutique_tunis",
    "client_email":            "ghofrane.khadarr@gmail.com",
    "numero_commande":         "CMD-2026-003",
    "statut":                  "en_preparation",
    "date_commande":           datetime(2026, 7, 13, 7, 45, tzinfo=timezone.utc),
    "date_expedition":         None,  # pas encore expédiée
    "date_livraison_estimee":  datetime(2026, 7, 18, 18, 0, tzinfo=timezone.utc),
    "numero_suivi":            None,  # numéro de suivi pas encore attribué
    "transporteur":            "Aramex Tunisia",
    "produits":                ["Sandales plateformes blanches (T38)"],
    "montant_total":           49.90,
    "adresse_livraison":       "12 Rue Ibn Khaldoun, Tunis 1001"
}

# Dupliquer pour commerce_local_1 (fallback local dans Streamlit)
cmd1_local = dict(cmd1_tunis, commerce_id="commerce_local_1")
cmd2_local = dict(cmd2_tunis, commerce_id="commerce_local_1")
cmd3_local = dict(cmd3_tunis, commerce_id="commerce_local_1")

result = db.commandes.insert_many([
    cmd1_tunis, cmd2_tunis, cmd3_tunis,
    cmd1_local, cmd2_local, cmd3_local
])
print(f"[seed] {len(result.inserted_ids)} commande(s) de test créée(s) avec succès (pour boutique_tunis et commerce_local_1).")

# Afficher un résumé
print("\n=== COMMANDES CRÉÉES ===")
for doc in db.commandes.find({"client_email": "ghofrane.khadarr@gmail.com", "commerce_id": "boutique_tunis"}):
    print(f"  • {doc['numero_commande']} | statut: {doc['statut']} | montant: {doc['montant_total']} DT")
    print(f"    Produits: {', '.join(doc['produits'])}")
    if doc.get('numero_suivi'):
        print(f"    Suivi: {doc['numero_suivi']} via {doc['transporteur']}")
    else:
        print(f"    Suivi: pas encore attribué")
    print()

client.close()
print("[seed] Terminé.")
