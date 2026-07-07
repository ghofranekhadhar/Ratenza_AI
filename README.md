# Retenza AI — Phase 1 : Connexion MongoDB & Analyse Comportementale RFM

Ce répertoire contient la **première phase** simplifiée de la plateforme de fidélisation client **Retenza AI**. Ce module est conçu pour être entièrement indépendant, robuste et facile à présenter à votre encadrant de stage.

Il se concentre sur deux aspects clés :
1. **La connexion directe et la lecture des données** depuis votre base de données MongoDB (sans mock data dans le code).
2. **Le calcul et la normalisation de l'analyse RFM** (Récence, Fréquence, Montant) pour générer l'indice de fidélité comportemental global ($S_a$).

---

## 🛠️ Concepts Mathématiques et Méthodologie RFM

L'analyse RFM permet de segmenter les clients selon leur comportement d'achat récent et récurrent :

1. **Récence ($R$)** : Nombre de jours écoulés entre la dernière transaction du client et la date de référence (la transaction la plus récente enregistrée dans le système).
   * *Normalisation inversée (Min-Max)* : Un nombre de jours faible correspond à un score élevé.
   * $$R_{score} = 1.0 - \frac{R - R_{min}}{R_{max} - R_{min}}$$

2. **Fréquence ($F$)** : Nombre total de transactions effectuées par le client.
   * *Normalisation standard (Min-Max)* :
   * $$F_{score} = \frac{F - F_{min}}{F_{max} - F_{min}}$$

3. **Montant ($M$)** : Montant moyen dépensé par transaction (panier moyen).
   * *Normalisation standard (Min-Max)* :
   * $$M_{score} = \frac{M - M_{min}}{M_{max} - M_{min}}$$

4. **Score Global Comportemental ($S_a$)** :
   * Somme pondérée des trois scores normalisés :
   * $$S_a = w_r \cdot R_{score} + w_f \cdot F_{score} + w_m \cdot M_{score}$$
   * Les poids par défaut configurés dans `config.py` sont :
     * $w_r = 0.35$ (Récence)
     * $w_f = 0.35$ (Fréquence)
     * $w_m = 0.30$ (Montant)
     * (Leur somme est bien égale à $1.0$).

---

## 📂 Structure des Fichiers

* `.env` : Contient l'URI de connexion MongoDB locale et le nom de la base de données.
* `requirements.txt` : Liste des dépendances minimales de cette première phase.
* `config.py` : Fichier central de configuration (poids RFM et constantes de connexion).
* `database.py` : Connexion sécurisée à MongoDB et fonctions de chargement (`clients`, `transactions`) et d'écriture (`analyses_rfm`).
* `rfm.py` : Algorithme pur de calcul et de normalisation RFM.
* `main.py` : Point d'entrée principal qui exécute le pipeline, affiche les statistiques et le tableau résumé dans la console, et persiste les résultats dans MongoDB.

---

## 🚀 Guide de Démarrage Rapide

### 1. Prérequis
Assurez-vous que votre serveur MongoDB local est démarré et contient les collections `clients` et `transactions` dans la base `retenza_ai`.

### 2. Installation
Ouvrez votre terminal dans ce répertoire (`Ratenza_Phase1`) et exécutez les commandes suivantes :

```bash
# 1. Créer un environnement virtuel
python -m venv venv

# 2. Activer l'environnement virtuel
# Sur Windows :
venv\Scripts\activate
# Sur macOS/Linux :
source venv/bin/activate

# 3. Installer les dépendances
pip install -r requirements.txt
```

### 3. Exécution de l'Analyse RFM
Pour lancer l'analyse RFM sur le commerce par défaut (`commerce_local_1`), exécutez simplement :

```bash
python main.py
```

Pour exécuter sur un autre identifiant de commerce :
```bash
python main.py --commerce-id votre_commerce_id
```

---

## 📊 Exemple de Résultat Attendue dans la Console

Lorsque vous lancez `python main.py`, le script affiche :
1. Un statut de connexion à MongoDB.
2. Le nombre de documents trouvés.
3. Les statistiques globales (panier moyen global, montant total dépensé, récence moyenne).
4. Un tableau propre et lisible présentant le **Top 10** des clients classés par leur score global $S_a$.
5. Une confirmation de sauvegarde dans la collection `analyses_rfm` de MongoDB.
