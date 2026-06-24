import os
from pathlib import Path
from dotenv import load_dotenv

# Charger les variables d'environnement depuis le fichier .env
load_dotenv()

# Configuration de la base de données
MONGODB_URI = os.getenv("MONGODB_URI", "mongodb://localhost:27017/")
DB_NAME = os.getenv("DB_NAME", "retenza_ai")

# Poids par défaut pour l'indice comportemental RFM (la somme doit être égale à 1.0)
DEFAULT_WR = 0.35  # Poids pour la Récence
DEFAULT_WF = 0.35  # Poids pour la Fréquence
DEFAULT_WM = 0.30  # Poids pour le Montant

# Niveau de log
LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO")
