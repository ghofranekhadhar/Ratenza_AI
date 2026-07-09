import streamlit as st
from pymongo import MongoClient
from datetime import datetime
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import chatbot_config as config
import chatbot_classifier as classifier

# Configuration de la page Streamlit
st.set_page_config(
    page_title="Retenza AI — Chatbot SAV Prédictif",
    page_icon="🤖",
    layout="centered"
)

# Style CSS Premium personnalisé (assorti au thème Retenza)
st.markdown("""
    <style>
        /* Couleurs et polices (Theme Neutre & Professionnel) */
        :root {
            --primary: #2563eb;
            --bg-light: #ffffff;
            --border: #e5e5e5;
        }
        .main {
            background-color: #ffffff;
            font-family: 'Inter', 'Segoe UI', system-ui, sans-serif;
        }
        
        /* Bouton principal (ex: Connexion) - Bleu Royal */
        .stButton>button {
            background-color: #2563eb;
            color: white;
            border-radius: 8px;
            font-weight: 500;
            border: none;
            transition: all 0.2s;
            width: 100%;
            box-shadow: 0 1px 2px rgba(0,0,0,0.05);
        }
        .stButton>button:hover {
            background-color: #1d4ed8;
            color: white;
            box-shadow: 0 4px 6px rgba(0,0,0,0.1);
        }

        /* Bandeaux d'indicateurs (Moderation adoucie) */
        .indicator-band {
            padding: 12px;
            border-radius: 8px;
            text-align: center;
            font-weight: 500;
            margin-bottom: 20px;
            font-size: 0.95rem;
        }
        .indicator-green {
            background-color: #f0fdf4;
            color: #166534;
            border: 1px solid #bbf7d0;
        }
        .indicator-yellow, .indicator-orange {
            background-color: #fffbeb;
            color: #854d0e;
            border: 1px solid #fde047;
        }
        .indicator-red {
            background-color: #fef2f2;
            color: #991b1b;
            border: 1px solid #fca5a5;
        }        /* ====== SIDEBAR (Style ChatGPT Clair) ====== */
        [data-testid="stSidebar"] {
            background-color: #f9f9f9 !important;
        }
        [data-testid="stSidebar"] h1, [data-testid="stSidebar"] h2, [data-testid="stSidebar"] h3, [data-testid="stSidebar"] p {
            color: #0d0d0d !important;
            font-size: 0.9rem !important;
        }
        [data-testid="stSidebar"] hr {
            border-color: #e5e5e5 !important;
        }
        [data-testid="stSidebar"] .stButton > button {
            background: transparent !important;
            border: none !important;
            border-radius: 8px !important;
            text-align: left !important;
            justify-content: flex-start !important;
            align-items: center !important;
            padding: 8px 12px !important;
            margin-bottom: 2px !important;
            font-weight: 500 !important;
            color: #0d0d0d !important;
            box-shadow: none !important;
            display: inline-flex !important;
            width: 100% !important;
        }
        /* Aligner le contenu interne (icône + texte) à gauche */
        [data-testid="stSidebar"] .stButton > button > div,
        [data-testid="stSidebar"] .stButton > button span,
        [data-testid="stSidebar"] .stButton > button p {
            justify-content: flex-start !important;
            text-align: left !important;
            align-items: center !important;
            display: inline-flex !important;
        }
        [data-testid="stSidebar"] .stButton > button:hover {
            background-color: #ececec !important;
        }
        /* Bouton "Nouvelle conversation" specifique */
        [data-testid="stSidebar"] .stButton:first-of-type > button {
            margin-bottom: 15px !important;
        }
        
        /* ====== ZONE DE CHAT (Style ChatGPT Clair) ====== */
        .stChatMessage {
            padding: 1rem 0;
            background-color: transparent !important;
            border: none !important;
            box-shadow: none !important;
        }
        
        /* Message Utilisateur (Bulle grise clair à droite) */
        .stChatMessage:has(div:contains("👤")) {
            display: flex;
            flex-direction: row-reverse;
            padding-right: 1rem;
        }
        /* Masquer l'avatar par defaut de Streamlit pour l'utilisateur */
        .stChatMessage:has(div:contains("👤")) [data-testid="chatAvatarIcon-user"] {
            display: none !important;
        }
        .stChatMessage:has(div:contains("👤")) .stMarkdown {
            background-color: #f4f4f4;
            color: #0d0d0d;
            padding: 12px 20px;
            border-radius: 20px;
            display: inline-block;
            max-width: 75%;
            text-align: left;
        }

        /* Message Assistant (Texte simple à gauche avec logo) */
        .stChatMessage:has(div:contains("🤖")) {
            display: flex;
            padding-left: 1rem;
        }
        .stChatMessage:has(div:contains("🤖")) .stMarkdown {
            color: #0d0d0d;
            max-width: 85%;
            line-height: 1.6;
        }
        
        /* Message Alerte Système */
        .stChatMessage:has(div:contains("🚨")) {
            background-color: #fef2f2 !important;
            border: 1px solid #fca5a5 !important;
            border-radius: 8px;
            color: #991b1b;
            padding: 10px;
        }

        /* ====== INPUT (Barre de recherche) ====== */
        .stChatInputContainer {
            border-radius: 1.5rem !important;
            background-color: #f4f4f4 !important;
            border: 1px solid transparent !important;
            box-shadow: none !important;
            padding-left: 1rem !important;
        }
        .stChatInputContainer:focus-within {
            background-color: #f4f4f4 !important;
            border-color: #e5e5e5 !important;
        }
        
        /* ====== HEADER FIXE (Style ChatGPT) ====== */
        [data-testid="stHeader"] {
            background-color: #ffffff !important;
            border-bottom: 1px solid #e5e5e5 !important;
        }
        /* Compense la hauteur du header fixe natif */
        .block-container {
            padding-top: 3.5rem !important;
            padding-bottom: 2rem !important;
        }

        /* ====== SIDEBAR PROFILE POPOVER (Style ChatGPT) ====== */
        [data-testid="stSidebarUserContent"] {
            padding-bottom: 80px !important;
        }
        
        /* Cible uniquement le popover de profil (dernier élément du bloc vertical) */
        [data-testid="stSidebar"] [data-testid="stVerticalBlock"] > div:last-child {
            position: absolute !important;
            bottom: 20px !important;
            left: 10px !important;
            right: 10px !important;
            width: calc(100% - 20px) !important;
            z-index: 1000 !important;
        }
        
        [data-testid="stSidebar"] [data-testid="stVerticalBlock"] > div:last-child [data-testid="stPopover"] > button {
            background-color: transparent !important;
            border: none !important;
            color: #0d0d0d !important;
            padding: 8px 12px !important;
            border-radius: 8px !important;
            width: 100% !important;
            text-align: left !important;
            justify-content: flex-start !important;
            display: flex !important;
            align-items: center !important;
            box-shadow: none !important;
            gap: 12px !important;
            font-size: 0.9rem !important;
            font-weight: 600 !important;
        }
        [data-testid="stSidebar"] [data-testid="stVerticalBlock"] > div:last-child [data-testid="stPopover"] > button:hover {
            background-color: #ececec !important;
        }
        
        /* Contenu du popover */
        div[data-testid="stPopoverBody"] {
            border: 1px solid #e5e5e5 !important;
            border-radius: 8px !important;
            box-shadow: 0 4px 12px rgba(0,0,0,0.08) !important;
            padding: 12px !important;
            background-color: #ffffff !important;
        }
        
        
        div[data-testid="stPopoverBody"] p {
            color: #4b5563 !important;
            font-size: 0.85rem !important;
            margin-bottom: 8px !important;
        }
        div[data-testid="stPopoverBody"] .stButton > button {
            background-color: transparent !important;
            border: 1px solid #e5e5e5 !important;
            color: #b91c1c !important;
            font-weight: 500 !important;
            border-radius: 6px !important;
            text-align: center !important;
            padding: 6px 12px !important;
            width: 100% !important;
        }
        div[data-testid="stPopoverBody"] .stButton > button:hover {
            background-color: #fef2f2 !important;
            border-color: #fca5a5 !important;
        }
        
        /* Style du champ de recherche de la sidebar */
        [data-testid="stSidebar"] [data-testid="stTextInput"] {
            margin-top: 5px !important;
            margin-bottom: 5px !important;
        }
        [data-testid="stSidebar"] [data-testid="stTextInput"] input {
            background-color: #ffffff !important;
            border: 1px solid #e2e8f0 !important;
            border-radius: 8px !important;
            padding: 8px 12px 8px 36px !important; /* Espace pour l'icône loupe à gauche */
            font-size: 0.85rem !important;
            color: #0f172a !important;
            box-shadow: none !important;
            /* Loupe SVG intégrée en arrière-plan */
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E") !important;
            background-repeat: no-repeat !important;
            background-position: 12px center !important;
        }
        [data-testid="stSidebar"] [data-testid="stTextInput"] input::placeholder {
            color: #94a3b8 !important;
        }
        [data-testid="stSidebar"] [data-testid="stTextInput"] input:focus {
            border-color: #cbd5e1 !important;
            /* Changement de couleur de la loupe au focus */
            background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='16' height='16' viewBox='0 0 24 24' fill='none' stroke='%2364748b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Ccircle cx='11' cy='11' r='8'%3E%3C/circle%3E%3Cline x1='21' y1='21' x2='16.65' y2='16.65'%3E%3C/line%3E%3C/svg%3E") !important;
        }
        
        /* ====== CARTE CLICABLE DE RECHERCHE DANS SIDEBAR ====== */
        .search-card-container {
            position: relative !important;
            margin-bottom: 6px !important;
            width: 100% !important;
        }
        /* Rendre le bouton streamlit invisible au-dessus de la carte */
        .search-card-container .stButton {
            position: absolute !important;
            top: 0 !important;
            left: 0 !important;
            width: 100% !important;
            height: 100% !important;
            margin: 0 !important;
            padding: 0 !important;
            z-index: 10 !important;
        }
        .search-card-container .stButton > button {
            background: transparent !important;
            border: none !important;
            width: 100% !important;
            height: 100% !important;
            opacity: 0 !important; /* Totalement transparent */
            padding: 0 !important;
            margin: 0 !important;
            box-shadow: none !important;
            cursor: pointer !important;
        }
        /* Style de la carte HTML */
        .chat-card-html {
            pointer-events: none !important; /* Laisse passer le clic pour le bouton du dessus */
            display: flex !important;
            align-items: flex-start !important;
            gap: 12px !important;
            padding: 8px 12px !important;
            background-color: transparent !important;
            border-radius: 8px !important;
            transition: background-color 0.2s ease !important;
            width: 100% !important;
            box-sizing: border-box !important;
        }
        .search-card-container:hover .chat-card-html {
            background-color: #ececec !important; /* Hover gris ChatGPT */
        }
        .chat-card-icon {
            font-size: 1.1rem !important;
            color: #4b5563 !important;
            margin-top: 2px !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            width: 18px !important;
            height: 18px !important;
        }
        .chat-card-body {
            display: flex !important;
            flex-direction: column !important;
            gap: 2px !important;
            width: calc(100% - 30px) !important;
        }
        .chat-card-title {
            font-size: 0.85rem !important;
            font-weight: 500 !important;
            color: #0f172a !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            width: 100% !important;
            text-align: left !important;
        }
        .chat-card-snippet {
            font-size: 0.72rem !important;
            color: #64748b !important;
            line-height: 1.3 !important;
            text-align: left !important;
            width: 100% !important;
            display: -webkit-box !important;
            -webkit-line-clamp: 2 !important; /* Limite à 2 lignes maximum */
            -webkit-box-orient: vertical !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            word-break: break-word !important;
        }
        .chat-card-snippet strong {
            color: #0f172a !important;
            font-weight: 600 !important;
            background-color: rgba(254, 240, 138, 0.4) !important;
            padding: 0 2px !important;
            border-radius: 2px !important;
        }

        /* ====== LIGNE DE CONVERSATION AVEC ICONE EPINGLE ====== */
        .conv-row-wrapper {
            position: relative !important;
            margin-bottom: 2px !important;
            width: 100% !important;
            border-radius: 8px !important;
        }
        .conv-row-html {
            display: flex !important;
            align-items: center !important;
            justify-content: space-between !important;
            padding: 8px 10px !important;
            border-radius: 8px !important;
            background-color: transparent !important;
            transition: background-color 0.15s ease !important;
            pointer-events: none !important;
        }
        .conv-row-wrapper:hover .conv-row-html {
            background-color: #ececec !important;
        }
        .conv-row-left {
            display: flex !important;
            align-items: center !important;
            gap: 8px !important;
            flex: 1 !important;
            min-width: 0 !important;
        }
        .conv-row-title {
            font-size: 0.83rem !important;
            font-weight: 500 !important;
            color: #0f172a !important;
            white-space: nowrap !important;
            overflow: hidden !important;
            text-overflow: ellipsis !important;
            flex: 1 !important;
        }
        /* Icône épingle : grise par défaut, visible au hover ou si épinglée */
        .conv-pin-icon {
            opacity: 0 !important;
            transition: opacity 0.15s ease, color 0.15s ease !important;
            font-size: 0.85rem !important;
            color: #9ca3af !important;
            flex-shrink: 0 !important;
            line-height: 1 !important;
        }
        .conv-row-wrapper:hover .conv-pin-icon {
            opacity: 1 !important;
        }
        .conv-pin-icon.pinned {
            opacity: 1 !important;
            color: #ea580c !important;  /* Orange = épinglé */
        }
        /* Bouton navigation transparent (toute la largeur) */
        .conv-row-wrapper .stButton:nth-of-type(1) > button {
            position: absolute !important;
            inset: 0 !important;
            width: 100% !important;
            height: 100% !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            opacity: 0 !important;
            cursor: pointer !important;
            padding: 0 !important;
            z-index: 2 !important;
        }
        /* Bouton épingle transparent (zone droite 36px) */
        .conv-row-wrapper .stButton:nth-of-type(2) > button {
            position: absolute !important;
            top: 0 !important;
            right: 0 !important;
            width: 36px !important;
            height: 100% !important;
            background: transparent !important;
            border: none !important;
            box-shadow: none !important;
            opacity: 0 !important;
            cursor: pointer !important;
            padding: 0 !important;
            z-index: 3 !important;
        }

        /* ====== EMPTY STATE (Nouvelle Conversation) ====== */
        .empty-state-container {
            display: flex;
            flex-direction: column;
            align-items: center;
            justify-content: center;
            height: 60vh;
            text-align: center;
            animation: fadeIn 0.5s ease-in-out;
        }
        .empty-state-title {
            font-size: 1.8rem;
            color: #0d0d0d;
            font-weight: 500;
            margin-bottom: 2.5rem;
        }
        .empty-state-pills {
            display: flex;
            gap: 12px;
            flex-wrap: wrap;
            justify-content: center;
        }
        .empty-state-pill {
            border: 1px solid #e5e5e5;
            border-radius: 20px;
            padding: 8px 16px;
            color: #4b5563;
            font-size: 0.9rem;
            background-color: transparent;
            display: flex;
            align-items: center;
            gap: 8px;
        }
        @keyframes fadeIn {
            from { opacity: 0; transform: translateY(10px); }
            to { opacity: 1; transform: translateY(0); }
        }
    </style>
""", unsafe_allow_html=True)

# Connexion MongoDB réutilisable
@st.cache_resource
def get_db_client():
    try:
        return MongoClient(config.MONGO_URI)
    except Exception as e:
        st.error(f"Erreur de connexion à la base de données: {e}")
        return None

db_client = get_db_client()

def get_commerces():
    """Récupère les commerces depuis MongoDB ou renvoie une liste de secours."""
    if db_client:
        try:
            db = db_client[config.DB_NAME]
            commerces = list(db['commerces'].find({}, {"id": 1, "nom": 1}))
            if commerces:
                return {c["id"]: c["nom"] for c in commerces}
        except Exception as e:
            print(f"Erreur get_commerces: {e}")
    # Fallback local
    return {
        "commerce_local_1": "Boutique Tunis",
        "commerce_local_2": "Boutique Sousse"
    }

commerces_map = get_commerces()

def send_block_email(client_name, client_email, commerce_name, offending_messages, block_reason):
    """Envoie un e-mail d'alerte au commerçant."""
    # S'assurer qu'on a au moins une adresse de destination
    to_email = config.MERCHANT_NOTIFICATION_EMAIL or config.SMTP_USER
    if not to_email:
        print("[SMTP SIMULATION] Aucun utilisateur ou email de destination configure. Simulation dans la console.")
        return
        
    try:
        msg = MIMEMultipart()
        msg['From'] = config.EMAIL_FROM
        msg['To'] = to_email
        msg['Subject'] = f"🚨 ALERTE SAV : Client Suspendu — {client_name}"
        
        body = f"""Bonjour,

Le client suivant a été suspendu automatiquement de la plateforme après avoir reçu {config.MAX_WARNINGS}/{config.MAX_WARNINGS} avertissements pour comportement inapproprié.

DÉTAILS DU COMPTE :
- Nom : {client_name}
- Email : {client_email}
- Boutique : {commerce_name}
- Date du blocage : {datetime.now().strftime('%d/%m/%Y à %H:%M:%S')}
- Raison du blocage : {block_reason}

MESSAGES AYANT DÉCLENCHÉ LES AVERTISSEMENTS :
"""
        for i, m in enumerate(offending_messages, 1):
            body += f"\nAvertissement {i} ({m.get('category')}, Gravité: {m.get('severity')}) :\n\"{m.get('text')}\" (le {m.get('timestamp')})\n"
            
        body += "\nVous pouvez consulter l'historique complet des messages et débloquer ce client directement depuis votre tableau de bord d'administration Retenza."
        
        msg.attach(MIMEText(body, 'plain'))
        
        # Envoi SMTP
        if config.SMTP_USER:
            server = smtplib.SMTP(config.SMTP_HOST, config.SMTP_PORT)
            if config.SMTP_SECURE:
                server = smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT)
            else:
                server.starttls()
            server.login(config.SMTP_USER, config.SMTP_PASS)
            server.sendmail(config.SMTP_USER, to_email, msg.as_string())
            server.quit()
            print(f"[SMTP SENT] Alerte envoyee a <{to_email}>")
        else:
            # Simulation en console
            print("\n--- [SIMULATION ALERTE SMTP] ---")
            print(f"Destinataire : {to_email}")
            print(f"Objet        : {msg['Subject']}")
            print(f"Contenu      :\n{body}")
            print("--------------------------------\n")
    except Exception as e:
        print(f"[SMTP ERROR] Echec de l'envoi du mail d'alerte : {e}")

# =====================================================================
# GESTION DES SESSIONS CLIENTS (DANS MONGODB)
# =====================================================================
def get_client_status(email, commerce_id, client_name="Client"):
    """Récupère ou initialise l'état de blocage et warnings d'un client."""
    if not db_client:
        return {"email": email, "warnings": 0, "is_blocked": False}
        
    db = db_client[config.DB_NAME]
    status = db.chatbot_status.find_one({"email": email.lower(), "commerce_id": commerce_id})
    
    if not status:
        status = {
            "email": email.lower(),
            "nom": client_name,
            "commerce_id": commerce_id,
            "warnings": 0,
            "is_blocked": False,
            "blocked_at": None,
            "block_reason": None,
            "warnings_history": []
        }
        db.chatbot_status.insert_one(status)
    return status

def update_client_status(status):
    """Met à jour l'état de blocage d'un client en DB."""
    if db_client:
        db = db_client[config.DB_NAME]
        db.chatbot_status.replace_one(
            {"email": status["email"], "commerce_id": status["commerce_id"]},
            status
        )

def get_message_snippet(messages, search_query):
    """Génère un extrait du message contenant le terme de recherche avec surbrillance HTML."""
    if not search_query:
        return ""
    import html
    search_query_lower = search_query.lower()
    for msg in messages:
        text = msg.get("text", "")
        idx = text.lower().find(search_query_lower)
        if idx != -1:
            start = max(0, idx - 30)
            end = min(len(text), idx + len(search_query) + 50)
            snippet = text[start:end]
            
            prefix = "... " if start > 0 else ""
            suffix = " ..." if end < len(text) else ""
            
            full_snippet = prefix + snippet + suffix
            
            matched_word = text[idx : idx + len(search_query)]
            
            safe_snippet = html.escape(full_snippet)
            safe_matched_word = html.escape(matched_word)
            
            # Entoure d'une balise strong (surchargée en CSS avec fond jaune)
            highlighted = safe_snippet.replace(
                safe_matched_word, 
                f"<strong>{safe_matched_word}</strong>"
            )
            return highlighted
    return ""

def get_all_sessions(email, commerce_id, search_query=None):
    """Récupère la liste de toutes les sessions triées par date décroissante."""
    if not db_client:
        return []
    db = db_client[config.DB_NAME]
    
    query = {"email": email.lower(), "commerce_id": commerce_id}
    if search_query:
        query["$or"] = [
            {"title": {"$regex": search_query, "$options": "i"}},
            {"messages.text": {"$regex": search_query, "$options": "i"}}
        ]
        
    projection = {"session_id": 1, "title": 1, "updated_at": 1, "is_pinned": 1}
    if search_query:
        projection["messages"] = 1
        
    cursor = db.chatbot_conversations.find(query, projection).sort("updated_at", -1)
    
    sessions = []
    for doc in cursor:
        snippet = ""
        if search_query and "messages" in doc:
            snippet = get_message_snippet(doc["messages"], search_query)
            
        sessions.append({
            "session_id": doc.get("session_id", "default"),
            "title": doc.get("title", "Nouvelle conversation"),
            "updated_at": doc.get("updated_at", ""),
            "is_pinned": doc.get("is_pinned", False),
            "snippet": snippet
        })
    return sessions

def toggle_pin_session(email, commerce_id, session_id):
    """Active ou désactive l'épinglage d'une conversation."""
    if not db_client:
        return
    db = db_client[config.DB_NAME]
    conv = db.chatbot_conversations.find_one({
        "email": email.lower(),
        "commerce_id": commerce_id,
        "session_id": session_id
    })
    if conv:
        new_pinned = not conv.get("is_pinned", False)
        db.chatbot_conversations.update_one(
            {"email": email.lower(), "commerce_id": commerce_id, "session_id": session_id},
            {"$set": {"is_pinned": new_pinned}}
        )

def update_session_title(email, commerce_id, session_id, new_title):
    """Met à jour le titre d'une session de conversation."""
    if not db_client:
        return
    db = db_client[config.DB_NAME]
    db.chatbot_conversations.update_one(
        {"email": email.lower(), "commerce_id": commerce_id, "session_id": session_id},
        {"$set": {"title": new_title}}
    )

def delete_session(email, commerce_id, session_id):
    """Supprime une session de conversation de la base de données."""
    if not db_client:
        return
    db = db_client[config.DB_NAME]
    db.chatbot_conversations.delete_one({
        "email": email.lower(),
        "commerce_id": commerce_id,
        "session_id": session_id
    })

def get_conversation(email, commerce_id, session_id):
    """Récupère l'historique de conversation d'une session spécifique."""
    if not db_client:
        return []
    db = db_client[config.DB_NAME]
    conv = db.chatbot_conversations.find_one({
        "email": email.lower(), 
        "commerce_id": commerce_id,
        "session_id": session_id
    })
    return conv["messages"] if conv else []

def save_message_to_conversation(email, commerce_id, session_id, role, text, category=None, severity=None):
    """Ajoute un message à l'historique de conversation."""
    if not db_client:
        return
    db = db_client[config.DB_NAME]
    
    timestamp = datetime.now().isoformat()
    message_doc = {
        "role": role,
        "text": text,
        "timestamp": timestamp,
    }
    if category:
        message_doc["category"] = category
    if severity:
        message_doc["severity"] = severity
        
    # Mettre à jour le titre si c'est le premier message de l'utilisateur
    update_data = {"$push": {"messages": message_doc}, "$set": {"updated_at": timestamp}}
    
    if role == "user":
        conv = db.chatbot_conversations.find_one({"email": email.lower(), "commerce_id": commerce_id, "session_id": session_id})
        if not conv or not conv.get("messages"):
            # Premier message -> générer le titre
            words = text.split()
            if len(words) > 5:
                title = " ".join(words[:5]) + "..."
            else:
                title = " ".join(words)
            update_data["$set"]["title"] = title

    db.chatbot_conversations.update_one(
        {"email": email.lower(), "commerce_id": commerce_id, "session_id": session_id},
        update_data,
        upsert=True
    )

# =====================================================================
# ÉCRANS DE L'INTERFACE STREAMLIT
# =====================================================================

# 1. Écran de connexion (Login)
if "logged_in" not in st.session_state:
    st.session_state.logged_in = False

if not st.session_state.logged_in:
    st.image("https://images.unsplash.com/photo-1531747118685-ca8fa6e08806?auto=format&fit=crop&w=800&q=80", width=120)
    st.title("🤖 Chatbot Assistant SAV")
    st.write("Bienvenue sur le portail d'assistance client. Veuillez vous identifier pour démarrer la discussion.")
    
    commerce_opt = list(commerces_map.keys())
    commerce_labels = [commerces_map[k] for k in commerce_opt]
    selected_commerce_label = st.selectbox("Sélectionnez votre boutique :", commerce_labels)
    selected_commerce_id = commerce_opt[commerce_labels.index(selected_commerce_label)]
    
    email_input = st.text_input("Votre adresse email :").strip()
    
    if st.button("Se connecter"):
        if not email_input:
            st.error("Veuillez saisir votre adresse email.")
        else:
            # Vérifier si l'email existe dans la collection clients
            db = db_client[config.DB_NAME] if db_client else None
            client_record = None
            if db is not None:
                client_record = db.clients.find_one({
                    "email": {"$regex": f"^{email_input}$", "$options": "i"},
                    "commerce_id": selected_commerce_id
                })
                
            if not client_record:
                # Tenter de chercher dans analyses_ia par email
                if db is not None:
                    client_record = db.analyses_ia.find_one({
                        "email": {"$regex": f"^{email_input}$", "$options": "i"},
                        "commerce_id": selected_commerce_id
                    })
            
            if not client_record:
                st.error("Adresse email non enregistrée pour cette boutique.")
            else:
                client_name = client_record.get("nom", "Client")
                
                # Charger le statut de blocage
                status = get_client_status(email_input, selected_commerce_id, client_name)
                
                if status["is_blocked"]:
                    st.session_state.is_blocked = True
                    st.session_state.block_reason = status.get("block_reason", "Comportement inapproprié")
                    st.session_state.logged_in = True
                    st.session_state.email = email_input
                    st.session_state.commerce_id = selected_commerce_id
                    st.session_state.client_name = client_name
                    st.rerun()
                else:
                    st.session_state.logged_in = True
                    st.session_state.email = email_input
                    st.session_state.commerce_id = selected_commerce_id
                    st.session_state.client_name = client_name
                    st.session_state.is_blocked = False
                    st.rerun()

# 2. Écran de Blocage / Suspension
elif st.session_state.get("is_blocked", False):
    st.title("🚨 Accès Suspendu")
    st.markdown(f"""
        <div class="indicator-band indicator-red">
            {config.STATUS_INDICATORS[3]}
        </div>
    """, unsafe_allow_html=True)
    
    st.error(config.BLOCK_MESSAGE)
    st.write(f"**Raison de la suspension :** {st.session_state.get('block_reason', 'Comportements agressifs répétés')}")
    st.info("Si vous pensez qu'il s'agit d'une erreur, veuillez contacter directement le service client du magasin.")
    
    if st.button("Déconnexion"):
        for key in list(st.session_state.keys()):
            del st.session_state[key]
        st.rerun()

# 3. Écran du Chat actif
else:
    # Récupérer l'état frais en DB
    status = get_client_status(st.session_state.email, st.session_state.commerce_id, st.session_state.client_name)
    
    # Sécurité supplémentaire au cas où le commerçant bloque ou débloque en arrière-plan
    if status["is_blocked"]:
        st.session_state.is_blocked = True
        st.session_state.block_reason = status.get("block_reason", "Comportement inapproprié")
        st.rerun()
        
    # Injection dynamique du titre dans le header natif Streamlit (qui est fixe d'origine)
    st.markdown(f"""
        <style>
            [data-testid="stHeader"]::before {{
                content: "Chatbot Retenza  \u25bc";
                font-size: 1.1rem;
                color: #0d0d0d;
                font-weight: 600;
                display: flex;
                align-items: center;
                padding-left: 3rem;
                height: 100%;
                white-space: nowrap !important;
            }}
        </style>
    """, unsafe_allow_html=True)
    
    if st.session_state.get("api_fallback_active", False):
        st.warning("⚠️ Connexion à l'IA temporairement ralentie. Mode de secours local actif.")

    import uuid
    
    # Initialiser session_id
    if "session_id" not in st.session_state:
        st.session_state.session_id = "default"

    # ==========================
    # BARRE LATÉRALE (SIDEBAR)
    # ==========================
    with st.sidebar:
        # Logo ou espace vide en haut
        st.write("")
        
        # Bouton "Nouveau chat" avec icône native professionnelle (Style ChatGPT compose)
        if st.button("Nouveau chat", icon=":material/edit:", use_container_width=True):
            st.session_state.session_id = str(uuid.uuid4())
            st.rerun()
            
        # Champ de recherche (Style ChatGPT)
        search_query = st.text_input(
            "Rechercher dans les chats",
            placeholder="Rechercher dans les chats",
            label_visibility="collapsed",
            key="chat_search_query"
        ).strip().lower()
        
        st.write("")
        
        # Récupérer toutes les sessions existantes filtrées en profondeur par le terme recherché
        all_sessions = get_all_sessions(
            st.session_state.email, 
            st.session_state.commerce_id, 
            search_query=search_query if search_query else None
        )
        
        # Option d'épinglage supprimée d'ici car intégrée dans le menu des 3 points (comme ChatGPT)
            
        # Si recherche active, on affiche les résultats formatés avec extraits de texte
        if search_query:
            if all_sessions:
                for s in all_sessions:
                    # Récupération et formatage de l'extrait
                    snippet = s.get("snippet", "")
                    if not snippet:
                        snippet = "Correspondance trouvée dans le titre de la discussion"
                        
                    is_active = (s["session_id"] == st.session_state.session_id)
                    title_prefix = "● " if is_active else ""
                    
                    st.markdown(f"""
                        <div class="search-card-container">
                            <div class="chat-card-html">
                                <span class="chat-card-icon">💬</span>
                                <div class="chat-card-body">
                                    <div class="chat-card-title">{title_prefix}{s['title']}</div>
                                    <div class="chat-card-snippet">{snippet}</div>
                                </div>
                            </div>
                        </div>
                    """, unsafe_allow_html=True)
                    
                    # Bouton invisible superposé pour capter le clic sur la carte HTML
                    if st.button("", key=f"search_btn_{s['session_id']}", use_container_width=True):
                        st.session_state.session_id = s["session_id"]
                        # Sauvegarder le terme de recherche pour scroller jusqu'au message
                        st.session_state.highlight_query = search_query
                        st.rerun()
            else:
                st.caption("Aucun résultat trouvé")
        else:
            pinned_sessions = [s for s in all_sessions if s.get("is_pinned", False)]
            recent_sessions = [s for s in all_sessions if not s.get("is_pinned", False)]

            def render_conv_row(s, is_pinned_item):
                is_active = (s["session_id"] == st.session_state.session_id)
                lbl = ("● " if is_active else "") + s["title"]
                nav_icon = ":material/push_pin:" if is_pinned_item else ":material/chat_bubble_outline:"

                # Bouton navigation principal
                if st.button(lbl, icon=nav_icon, key=f"nav_{s['session_id']}", use_container_width=True):
                    st.session_state.session_id = s["session_id"]
                    st.rerun()

                # Bouton pin — label 📌 uniquement
                # → Identifiable par JS via le texte '📌', caché et rewired comme icône au survol
                if st.button("📌", key=f"pin_{s['session_id']}"):
                    toggle_pin_session(
                        st.session_state.email,
                        st.session_state.commerce_id,
                        s["session_id"]
                    )
                    st.rerun()

            # 1. Section épinglés
            if pinned_sessions:
                st.markdown("**Épinglés**")
                for s in pinned_sessions:
                    render_conv_row(s, is_pinned_item=True)
                st.write("")

            # 2. Section récents
            if recent_sessions:
                st.markdown("**Récents**")
                for s in recent_sessions:
                    render_conv_row(s, is_pinned_item=False)
            else:
                st.markdown("**Récents**")
                st.caption("Aucune conversation")
                
        # === JS pour icône épingle au survol de chaque conversation ===
        st.markdown("""
        <style>
        .sidebar-pin-icon {
            position: absolute;
            right: 8px;
            top: 50%;
            transform: translateY(-50%);
            font-size: 0.85rem;
            cursor: pointer;
            opacity: 0;
            transition: opacity 0.15s ease;
            z-index: 50;
            user-select: none;
            line-height: 1;
            padding: 4px;
            border-radius: 4px;
        }
        .sidebar-pin-icon.always-visible { opacity: 1 !important; color: #ea580c !important; }
        .sidebar-pin-icon:hover { background-color: rgba(0,0,0,0.06); }
        </style>
        <script>
        (function() {
            function setupPinIcons() {
                var sidebar = document.querySelector('[data-testid="stSidebar"]');
                if (!sidebar) return;

                var allBtns = sidebar.querySelectorAll('button');
                allBtns.forEach(function(btn) {
                    // Identifier les boutons PIN : texte exactement égal à '📌'
                    var rawText = (btn.textContent || btn.innerText || '').trim();
                    if (rawText !== '📌') return;

                    // Trouver le conteneur element-container de ce bouton PIN et le cacher
                    var pinContainer = btn.closest('[data-testid="element-container"]') || btn.closest('.element-container') || btn.parentElement;
                    if (pinContainer) {
                        pinContainer.style.setProperty('display', 'none', 'important');
                        pinContainer.style.setProperty('height', '0', 'important');
                        pinContainer.style.setProperty('overflow', 'hidden', 'important');
                        pinContainer.style.setProperty('margin', '0', 'important');
                        pinContainer.style.setProperty('padding', '0', 'important');
                    }

                    // Trouver le conteneur nav PRÉCÉDENT (sibling)
                    var navContainer = pinContainer.previousElementSibling;
                    if (!navContainer) return;
                    var navBtn = navContainer.querySelector('button');
                    if (!navBtn) return;

                    // Éviter doublons
                    if (navContainer.querySelector('.sidebar-pin-icon')) return;

                    // Déterminer si épinglé (nav btn a l'icône push_pin material)
                    var isPinned = navBtn.querySelector('[data-testid*="push_pin"]') !== null
                                || navBtn.innerHTML.includes('push_pin');

                    // Créer l'icône épingle flottante (SVG premium Lucide-style)
                    navContainer.style.position = 'relative';
                    var icon = document.createElement('span');
                    icon.className = 'sidebar-pin-icon' + (isPinned ? ' always-visible' : '');
                    
                    // SVG Pin
                    var pinSvg = isPinned 
                        ? '<svg viewBox="0 0 24 24" width="14" height="14" stroke="#ea580c" stroke-width="2" fill="#ea580c" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M12 17v5M9 8h6M5 12h14M15 8V3H9v5M19 12l-4-4M5 12l4-4"/></svg>'
                        : '<svg viewBox="0 0 24 24" width="14" height="14" stroke="#9ca3af" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round" style="display:block;"><path d="M12 17v5M9 8h6M5 12h14M15 8V3H9v5M19 12l-4-4M5 12l4-4"/></svg>';
                    
                    icon.innerHTML = pinSvg;
                    icon.title = isPinned ? 'Désépingler' : 'Épingler';
                    navContainer.appendChild(icon);

                    navContainer.addEventListener('mouseenter', function() {
                        if (!icon.classList.contains('always-visible')) {
                            icon.style.opacity = '1';
                        }
                    });
                    navContainer.addEventListener('mouseleave', function() {
                        if (!icon.classList.contains('always-visible')) {
                            icon.style.opacity = '0';
                        }
                    });

                    icon.addEventListener('click', function(e) {
                        e.stopPropagation();
                        e.preventDefault();
                        btn.click();
                    });
                });
            }

            setTimeout(setupPinIcons, 400);
            setTimeout(setupPinIcons, 1200);
            setInterval(setupPinIcons, 3500);
        })();
        </script>
        """, unsafe_allow_html=True)

        # Récupération et formitage des infos du profil
        client_name = st.session_state.get("client_name", "Client")
        initials = "".join([part[0].upper() for part in client_name.split()[:2]]) if client_name else "GH"
        client_short = client_name.split()[0].lower() if client_name else "gho"
        client_email = st.session_state.get("email", "")
        
        # Injecter dynamiquement l'avatar initiales en CSS pour le bouton popover profil UNIQUEMENT
        st.markdown(f"""
            <style>
                /* Cible uniquement le dernier popover de la sidebar (profil), pas les ··· de sessions */
                [data-testid="stSidebar"] [data-testid="stVerticalBlock"] > div:last-child div[data-testid="stPopover"] > button::before {{
                    content: "{initials}";
                    width: 32px;
                    height: 32px;
                    background-color: #ea580c !important;
                    color: #ffffff !important;
                    font-weight: 600;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 50%;
                    font-size: 0.85rem;
                    flex-shrink: 0;
                }}
            </style>
        """, unsafe_allow_html=True)
        
        # Popover qui s'affiche sous forme de bouton profil
        warnings_count = status.get("warnings", 0)
        max_w = config.MAX_WARNINGS
        with st.popover(f"{client_short} ", use_container_width=True):
            # Définir couleur et badge selon avertissements
            if warnings_count == 0:
                warn_color = "#16a34a"
                warn_bg = "#f0fdf4"
                warn_icon = "✅"
                warn_text = f"Aucun avertissement"
            elif warnings_count < max_w:
                warn_color = "#d97706"
                warn_bg = "#fffbeb"
                warn_icon = "⚠️"
                warn_text = f"Avertissement {warnings_count}/{max_w}"
            else:
                warn_color = "#dc2626"
                warn_bg = "#fef2f2"
                warn_icon = "🚫"
                warn_text = f"Accès limité {warnings_count}/{max_w}"
            
            initials_display = "".join([p[0].upper() for p in client_name.split()[:2]])
            
            st.markdown(f"""
                <div style="padding:4px 0 8px 0;">
                    <!-- Avatar + Nom -->
                    <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px;">
                        <div style="width:44px;height:44px;background:#ea580c;color:#fff;
                                    border-radius:50%;display:flex;align-items:center;
                                    justify-content:center;font-weight:700;font-size:1rem;
                                    flex-shrink:0;">
                            {initials_display}
                        </div>
                        <div>
                            <div style="font-weight:700;color:#0d0d0d;font-size:0.95rem;line-height:1.2;">
                                {client_name}
                            </div>
                            <div style="color:#6b7280;font-size:0.75rem;margin-top:2px;">
                                Client connecté
                            </div>
                        </div>
                    </div>
                    <!-- Email -->
                    <div style="background:#f4f4f4;border-radius:8px;padding:8px 12px;margin-bottom:10px;">
                        <div style="font-size:0.7rem;color:#9ca3af;font-weight:600;
                                    text-transform:uppercase;letter-spacing:0.05em;margin-bottom:3px;">
                            Email
                        </div>
                        <div style="font-size:0.82rem;color:#374151;word-break:break-all;">
                            {client_email}
                        </div>
                    </div>
                    <!-- Badge avertissements -->
                    <div style="background:{warn_bg};border-radius:8px;padding:8px 12px;
                                display:flex;align-items:center;gap:8px;">
                        <span style="font-size:0.85rem;">{warn_icon}</span>
                        <span style="font-size:0.82rem;color:{warn_color};font-weight:600;">
                            {warn_text}
                        </span>
                    </div>
                </div>
            """, unsafe_allow_html=True)
            
            if st.button("🚪 Se déconnecter", use_container_width=True):
                for key in list(st.session_state.keys()):
                    del st.session_state[key]
                st.rerun()

    # ==========================
    # ZONE DE CHAT PRINCIPALE
    # ==========================
    # Récupérer l'historique complet de la session courante
    messages = get_conversation(st.session_state.email, st.session_state.commerce_id, st.session_state.session_id)
    
    # Rendre l'historique dans des bulles natives
    if not messages:
        # Écran de démarrage (Empty State style ChatGPT)
        st.markdown("""
            <div class="empty-state-container">
                <div class="empty-state-title">Qu'est-ce qui vous intéresse aujourd'hui ?</div>
                <div class="empty-state-pills">
                    <div class="empty-state-pill">📦 Suivre ma commande</div>
                    <div class="empty-state-pill">🔄 Faire un retour</div>
                    <div class="empty-state-pill">❓ Poser une question</div>
                </div>
            </div>
        """, unsafe_allow_html=True)
    else:
        highlight_query = st.session_state.get("highlight_query", "")
        target_idx = -1  # Index du message cible pour le scroll

        for i, msg in enumerate(messages):
            role = msg.get("role")
            text = msg.get("text", "")
            category = msg.get("category", "")
            
            # Déterminer si ce message contient le terme recherché
            is_target = (highlight_query and highlight_query.lower() in text.lower() and target_idx == -1)
            if is_target:
                target_idx = i
                # Ancre HTML pour pouvoir scroller jusqu'ici via JS
                st.markdown(f'<div id="msg-highlight-target"></div>', unsafe_allow_html=True)
            
            # Déterminer l'avatar/nom en fonction du rôle
            avatar = "👤" if role == "user" else "🤖"
            if category in ["IMPOLI", "INSULTE", "MENACE", "HAINE"]:
                avatar = "🚨"
                
            with st.chat_message(role, avatar=avatar):
                st.write(text)

        # Si un terme de surbrillance est actif, injecter le JS de scroll + animation
        if highlight_query and target_idx >= 0:
            st.markdown("""
                <style>
                @keyframes highlightPulse {
                    0%   { box-shadow: 0 0 0 0 rgba(250, 204, 21, 0.7); background-color: rgba(254, 240, 138, 0.4); }
                    50%  { box-shadow: 0 0 0 8px rgba(250, 204, 21, 0); background-color: rgba(254, 240, 138, 0.15); }
                    100% { box-shadow: none; background-color: transparent; }
                }
                #msg-highlight-target + div [data-testid="stChatMessage"] {
                    animation: highlightPulse 2s ease 0.3s both;
                    border-radius: 12px;
                }
                </style>
                <script>
                (function() {
                    function scrollToHighlight() {
                        var target = document.getElementById('msg-highlight-target');
                        if (target) {
                            target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                        }
                    }
                    setTimeout(scrollToHighlight, 300);
                })();
                </script>
            """, unsafe_allow_html=True)
            # Effacer le terme de surbrillance après l'avoir utilisé
            st.session_state.highlight_query = ""

    # Formulaire de saisie natif (sticky en bas)
    user_input = st.chat_input("Tapez votre question ici...")
        
    if user_input and user_input.strip():
        # Afficher le message utilisateur immédiatement
        with st.chat_message("user", avatar="👤"):
            st.write(user_input)
        try:
            # 1. Enregistrer le message de l'utilisateur en base
            save_message_to_conversation(
                st.session_state.email,
                st.session_state.commerce_id,
                st.session_state.session_id,
                "user",
                user_input
            )
            
            # 2. Classifier le message avec Gemini (détection de ton et gravité)
            classification = classifier.classify_message(user_input)
            if classification.get("is_fallback", False):
                st.session_state.api_fallback_active = True
            else:
                st.session_state.api_fallback_active = False
            
            is_inappropriate = classification.get("is_inappropriate", False)
            category = classification.get("category", "NORMAL")
            severity = classification.get("severity", "LOW")
            reason = classification.get("reason", "")
            
            # Mettre à jour la classification du message en DB
            db = db_client[config.DB_NAME] if db_client else None
            if db is not None:
                # Récupérer la conversation actuelle
                conv = db.chatbot_conversations.find_one({"email": st.session_state.email.lower(), "commerce_id": st.session_state.commerce_id, "session_id": st.session_state.session_id})
                if conv and conv.get("messages"):
                    # Mettre à jour le dernier message inséré
                    last_idx = len(conv["messages"]) - 1
                    db.chatbot_conversations.update_one(
                        {"email": st.session_state.email.lower(), "commerce_id": st.session_state.commerce_id, "session_id": st.session_state.session_id},
                        {"$set": {
                            f"messages.{last_idx}.category": category,
                            f"messages.{last_idx}.severity": severity
                        }}
                    )

            if is_inappropriate:
                # Incrémenter les warnings du client
                status["warnings"] += 1
                infraction_doc = {
                    "timestamp": datetime.now().isoformat(),
                    "text": user_input,
                    "category": category,
                    "severity": severity
                }
                status["warnings_history"].append(infraction_doc)
                
                # Vérifier si on atteint la limite de blocage (strike 3)
                if status["warnings"] >= config.MAX_WARNINGS:
                    status["is_blocked"] = True
                    status["blocked_at"] = datetime.now().isoformat()
                    status["block_reason"] = f"Avertissements répétés ({category} : {reason})"
                    
                    # Enregistrer le message de blocage final dans l'historique
                    save_message_to_conversation(
                        st.session_state.email,
                        st.session_state.commerce_id,
                        st.session_state.session_id,
                        "assistant",
                        config.BLOCK_MESSAGE,
                        category=category,
                        severity=severity
                    )
                    
                    # Mettre à jour en DB immédiatement
                    update_client_status(status)
                    
                    # Envoyer l'alerte SMTP au commerçant
                    send_block_email(
                        st.session_state.client_name,
                        st.session_state.email,
                        commerces_map[st.session_state.commerce_id],
                        status["warnings_history"],
                        status["block_reason"]
                    )
                    
                    # Rediriger vers l'écran de suspension
                    st.session_state.is_blocked = True
                    st.session_state.block_reason = status["block_reason"]
                    st.rerun()
                else:
                    # Enregistrer le message d'avertissement système dans la conversation
                    sys_reply = config.WARNING_MESSAGE_1 if status["warnings"] == 1 else config.WARNING_MESSAGE_2
                    save_message_to_conversation(
                        st.session_state.email,
                        st.session_state.commerce_id,
                        st.session_state.session_id,
                        "assistant",
                        sys_reply,
                        category=category, # Pour le colorer en rouge d'alerte dans le chat
                        severity=severity
                    )
                    update_client_status(status)
                    st.rerun()
            else:
                # Réponse standard de Gemini avec empathie
                with st.chat_message("assistant", avatar="🤖"):
                    with st.spinner("L'assistant réfléchit..."):
                        # Récupérer l'historique complet pour nourrir la réponse
                        history = get_conversation(st.session_state.email, st.session_state.commerce_id, st.session_state.session_id)
                    bot_reply, is_fallback = classifier.generate_chatbot_response(
                        st.session_state.client_name,
                        st.session_state.email,
                        commerces_map[st.session_state.commerce_id],
                        history,
                        user_input,
                        commerce_id=st.session_state.commerce_id
                    )
                    if is_fallback:
                        st.session_state.api_fallback_active = True
                    
                # Enregistrer la réponse de l'assistant en DB
                save_message_to_conversation(
                    st.session_state.email,
                    st.session_state.commerce_id,
                    st.session_state.session_id,
                    "assistant",
                    bot_reply
                )
                st.rerun()
        except Exception as ex:
            print(f"[FATAL ERROR] Exception in chat form submission: {ex}")
            st.warning("⚠️ Un incident technique temporaire est survenu. Veuillez reformuler votre message.")
