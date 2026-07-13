"""
chatbot_orders.py
-----------------
Module de récupération et de formatage des commandes client depuis MongoDB.

Filtrage STRICT par email + commerce_id pour garantir l'isolation des données
entre boutiques et entre clients.

Approche multi-commandes :
  - 1 commande active (en_preparation / en_livraison) → détail complet
  - Plusieurs commandes actives → liste + invitation à préciser
  - Commandes livrées → historique seulement
"""

from datetime import datetime, timezone
from pymongo import MongoClient
import chatbot_config as config

# Statuts considérés comme "en cours" (commande pas encore reçue)
ACTIVE_STATUSES = {"en_preparation", "expedie", "en_livraison"}
TERMINAL_STATUSES = {"livre", "retourne", "annule"}

STATUS_LABELS = {
    "en_preparation": "En préparation 📦",
    "expedie":        "Expédiée 🚚",
    "en_livraison":   "En cours de livraison 🛵",
    "livre":          "Livrée ✅",
    "retourne":       "Retournée 🔄",
    "annule":         "Annulée ❌",
}


def get_orders_by_email(email: str, commerce_id: str) -> list:
    """
    Récupère toutes les commandes d'un client pour une boutique donnée.

    Filtrage STRICT par email ET commerce_id — aucun client ne peut voir
    les commandes d'un autre client ou d'une autre boutique.

    Retourne une liste triée du plus récent au plus ancien.
    """
    try:
        mongo_client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=1500)
        db = mongo_client[config.DB_NAME]

        query = {
            "client_email": {"$regex": f"^{email.strip()}$", "$options": "i"},
            "commerce_id": commerce_id.strip()
        }
        cursor = db.commandes.find(query).sort("date_commande", -1)
        orders = list(cursor)
        mongo_client.close()
        return orders
    except Exception as e:
        print(f"[chatbot_orders] Erreur MongoDB get_orders_by_email : {e}")
        return []


def get_order_by_number(numero_commande: str, commerce_id: str) -> dict | None:
    """
    Récupère une commande précise par son numéro, toujours filtrée par commerce_id.
    """
    try:
        mongo_client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=1500)
        db = mongo_client[config.DB_NAME]

        order = db.commandes.find_one({
            "numero_commande": numero_commande.strip(),
            "commerce_id": commerce_id.strip()
        })
        mongo_client.close()
        return order
    except Exception as e:
        print(f"[chatbot_orders] Erreur MongoDB get_order_by_number : {e}")
        return None


def _days_remaining(date_livraison_estimee) -> str:
    """Calcule le nombre de jours restants avant la livraison estimée."""
    try:
        if isinstance(date_livraison_estimee, str):
            date_livraison_estimee = datetime.fromisoformat(
                date_livraison_estimee.replace("Z", "+00:00")
            )
        now = datetime.now(timezone.utc)
        if date_livraison_estimee.tzinfo is None:
            date_livraison_estimee = date_livraison_estimee.replace(tzinfo=timezone.utc)
        delta = (date_livraison_estimee.date() - now.date()).days
        if delta < 0:
            return "en retard"
        elif delta == 0:
            return "aujourd'hui"
        elif delta == 1:
            return "demain"
        else:
            return f"dans {delta} jour(s)"
    except Exception:
        return "inconnue"


def _format_date(dt) -> str:
    """Formate une date ISO/datetime en format lisible."""
    try:
        if isinstance(dt, str):
            dt = datetime.fromisoformat(dt.replace("Z", "+00:00"))
        return dt.strftime("%d/%m/%Y")
    except Exception:
        return "Date inconnue"


def _format_single_order(order: dict) -> str:
    """Génère le texte de détail pour une seule commande."""
    statut = order.get("statut", "inconnu")
    statut_label = STATUS_LABELS.get(statut, statut)

    lines = [
        f"  • Numéro commande : **{order.get('numero_commande', 'N/A')}**",
        f"  • Statut actuel   : {statut_label}",
        f"  • Date commande   : {_format_date(order.get('date_commande'))}",
    ]

    if order.get("date_expedition"):
        lines.append(f"  • Date expédition : {_format_date(order.get('date_expedition'))}")

    if statut in ACTIVE_STATUSES and order.get("date_livraison_estimee"):
        remaining = _days_remaining(order.get("date_livraison_estimee"))
        lines.append(
            f"  • Livraison estimée : {_format_date(order.get('date_livraison_estimee'))} "
            f"({remaining})"
        )

    if order.get("numero_suivi"):
        transporteur = order.get("transporteur", "transporteur")
        lines.append(f"  • Numéro de suivi : {order.get('numero_suivi')} ({transporteur})")

    produits = order.get("produits", [])
    if produits:
        lines.append(f"  • Article(s) : {', '.join(produits)}")

    if order.get("montant_total"):
        lines.append(f"  • Montant total : {order.get('montant_total'):.2f} DT")

    return "\n".join(lines)


def format_order_context(orders: list) -> str:
    """
    Formate toutes les commandes pour injection dans le prompt LLM.

    Logique :
    - Aucune commande → message clair
    - 1 commande active → détail complet
    - Plusieurs actives → liste avec numéros, invitation à préciser
    - Uniquement livrées → historique
    """
    if not orders:
        return (
            "\n### COMMANDES DU CLIENT (MongoDB — retenza_ai.commandes) :\n"
            "  ⚠️ Aucune commande trouvée pour ce client dans cette boutique.\n"
            "  Ne pas donner de délai générique. Informer clairement qu'aucune commande n'est enregistrée.\n"
            "--------------------------------------------------\n"
        )

    active_orders = [o for o in orders if o.get("statut") in ACTIVE_STATUSES]
    done_orders = [o for o in orders if o.get("statut") in TERMINAL_STATUSES]

    context = "\n### COMMANDES DU CLIENT (MongoDB — retenza_ai.commandes) :\n"

    if not active_orders and done_orders:
        # Toutes les commandes sont livrées
        context += "  ℹ️ Aucune commande active en ce moment. Historique :\n"
        for order in done_orders:
            context += _format_single_order(order) + "\n"
    elif len(active_orders) == 1:
        # 1 seule commande active → répondre directement
        context += "  📦 Commande en cours (utilise ces données RÉELLES pour répondre) :\n"
        context += _format_single_order(active_orders[0]) + "\n"
        if done_orders:
            context += f"  + {len(done_orders)} commande(s) précédente(s) déjà livrée(s).\n"
    else:
        # Plusieurs commandes actives → lister et demander de préciser
        context += (
            f"  ⚠️ Ce client a {len(active_orders)} commandes actives en cours. "
            "Demande-lui de préciser le numéro de commande ou liste-les toutes :\n"
        )
        for order in active_orders:
            statut_label = STATUS_LABELS.get(order.get("statut", ""), order.get("statut", ""))
            context += (
                f"  • {order.get('numero_commande')} — {statut_label} — "
                f"commandé le {_format_date(order.get('date_commande'))}\n"
            )
        if done_orders:
            context += f"  + {len(done_orders)} commande(s) précédente(s) déjà livrée(s).\n"

    context += (
        "\n  ⚡ INSTRUCTION LLM : Utilise CES données réelles pour répondre. "
        "NE DIS PAS 'je n'ai pas accès à la base de données'. "
        "NE donne PAS de délai générique (3-5 jours). "
        "Calcule et cite les vraies dates et le vrai statut.\n"
    )
    context += "--------------------------------------------------\n"
    return context
