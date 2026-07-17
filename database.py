import os
from datetime import datetime
import pandas as pd
from pymongo import MongoClient
from config import MONGODB_URI, DB_NAME
import logging

# Configuration basique du logger
logging.basicConfig(level=logging.INFO, format='[%(asctime)s] %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

_mongo_client = None

def get_mongo_client():
    """Gère et retourne une instance unique du client MongoDB."""
    global _mongo_client
    if _mongo_client is None:
        try:
            logger.info(f"Tentative de connexion à MongoDB ({MONGODB_URI})...")
            _mongo_client = MongoClient(MONGODB_URI, serverSelectionTimeoutMS=2000)
            # Tester la connexion
            _mongo_client.admin.command('ping')
            logger.info("Connexion établie avec succès avec MongoDB.")
        except Exception as e:
            logger.error(f"Échec de la connexion à MongoDB : {e}")
            _mongo_client = None
            raise ConnectionError(f"Impossible de se connecter à MongoDB: {e}")
    return _mongo_client

def load_clients(commerce_id: str) -> pd.DataFrame:
    """Charge les clients associés à un commerce depuis la collection 'clients'."""
    client = get_mongo_client()
    try:
        db = client[DB_NAME]
        cursor = db.clients.find({"commerce_id": commerce_id})
        df = pd.DataFrame(list(cursor))
        if not df.empty:
            df["_id"] = df["_id"].astype(str)
            # S'assurer d'avoir un champ 'id' homogène
            if "id" not in df.columns:
                df["id"] = df["_id"]
            else:
                df["id"] = df["id"].fillna(df["_id"])
        return df
    except Exception as e:
        logger.error(f"Erreur lors du chargement des clients depuis MongoDB : {e}")
        raise e

def load_transactions(commerce_id: str) -> pd.DataFrame:
    """Charge les transactions associées à un commerce depuis la collection 'transactions'."""
    client = get_mongo_client()
    try:
        db = client[DB_NAME]
        cursor = db.transactions.find({"commerce_id": commerce_id})
        df = pd.DataFrame(list(cursor))
        if not df.empty:
            if "_id" in df.columns:
                df["_id"] = df["_id"].astype(str)
            # Conversion de la date de transaction en objet datetime
            df["date_transaction"] = pd.to_datetime(df["date_transaction"])
        return df
    except Exception as e:
        logger.error(f"Erreur lors du chargement des transactions depuis MongoDB : {e}")
        raise e

def save_rfm_results(commerce_id: str, rfm_df: pd.DataFrame):
    """Sauvegarde les résultats du calcul RFM dans la collection 'analyses_ia'."""
    if rfm_df.empty:
        logger.warning("Aucun résultat RFM à sauvegarder.")
        return
        
    client = get_mongo_client()
    try:
        db = client[DB_NAME]
        
        # Conversion du DataFrame en dictionnaire pour insertion MongoDB
        records = rfm_df.to_dict(orient="records")
        now_str = datetime.utcnow().isoformat() + "Z"
        
        for record in records:
            record["commerce_id"] = commerce_id
            record["date_analyse"] = now_str
            
        # Nettoyage des anciennes analyses RFM pour ce commerce
        db.analyses_ia.delete_many({"commerce_id": commerce_id})
        
        # Insertion des nouveaux résultats
        db.analyses_ia.insert_many(records)
        logger.info(f"Sauvegarde MongoDB : {len(records)} documents insérés dans 'analyses_ia'.")
    except Exception as e:
        logger.error(f"Erreur lors de la sauvegarde des résultats RFM : {e}")
        raise e


def save_return_rate(commerce_id: str, kpis: dict):
    """Sauvegarde ou met à jour le Taux de Retour Client dans la collection 'kpis_boutiques'."""
    client = get_mongo_client()
    try:
        db = client[DB_NAME]
        
        doc = {
            "commerce_id": commerce_id,
            "taux_retour_30j": kpis["taux_retour_30j"],
            "clients_actifs_30j": kpis["clients_actifs_30j"],
            "clients_revenus_30j": kpis["clients_revenus_30j"],
            "date_calcul": kpis["date_calcul"]
        }
        
        # Upsert sur la clé unique commerce_id
        db.kpis_boutiques.update_one(
            {"commerce_id": commerce_id},
            {"$set": doc},
            upsert=True
        )
        logger.info(f"Sauvegarde MongoDB : Taux de retour mis à jour pour '{commerce_id}' ({kpis['taux_retour_30j']}%).")
    except Exception as e:
        logger.error(f"Erreur lors de la sauvegarde du taux de retour : {e}")
        raise e