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
        /* Couleurs et polices */
        :root {
            --primary: #ca8a04;
            --bg-dark: #0f172a;
            --border: #e2e8f0;
        }
        .main {
            background-color: #f8fafc;
            font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .stButton>button {
            background: linear-gradient(135deg, #eab308, #ca8a04);
            color: white;
            border-radius: 8px;
            font-weight: 600;
            border: none;
            transition: all 0.2s;
            width: 100%;
        }
        .stButton>button:hover {
            opacity: 0.9;
            transform: translateY(-1px);
            color: white;
        }
        .indicator-band {
            padding: 10px;
            border-radius: 8px;
            text-align: center;
            font-weight: bold;
            margin-bottom: 20px;
            font-size: 0.95rem;
            box-shadow: 0 2px 4px rgba(0,0,0,0.05);
        }
        .indicator-green {
            background-color: #dcfce7;
            color: #15803d;
            border: 1px solid #bbf7d0;
        }
        .indicator-yellow {
            background-color: #fef9c3;
            color: #a16207;
            border: 1px solid #fef08a;
        }
        .indicator-orange {
            background-color: #ffedd5;
            color: #c2410c;
            border: 1px solid #fed7aa;
        }
        .indicator-red {
            background-color: #fee2e2;
            color: #b91c1c;
            border: 1px solid #fecaca;
        }
        /* Style des messages */
        .chat-bubble {
            padding: 12px 16px;
            border-radius: 12px;
            margin-bottom: 12px;
            max-width: 80%;
            line-height: 1.5;
            font-size: 0.92rem;
            display: inline-block;
        }
        .bubble-user {
            background-color: #e2e8f0;
            color: #1e293b;
            float: right;
            border-bottom-right-radius: 2px;
        }
        .bubble-assistant {
            background: linear-gradient(135deg, #fef08a, #fef9c3);
            color: #713f12;
            border: 1px solid #fef08a;
            float: left;
            border-bottom-left-radius: 2px;
        }
        .bubble-system {
            background-color: #fee2e2;
            color: #b91c1c;
            border: 1px solid #fecaca;
            float: left;
            font-weight: bold;
            border-bottom-left-radius: 2px;
        }
        .clear-float {
            clear: both;
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

def get_conversation(email, commerce_id):
    """Récupère l'historique de conversation."""
    if not db_client:
        return []
    db = db_client[config.DB_NAME]
    conv = db.chatbot_conversations.find_one({"email": email.lower(), "commerce_id": commerce_id})
    return conv["messages"] if conv else []

def save_message_to_conversation(email, commerce_id, role, text, category=None, severity=None):
    """Ajoute un message à l'historique de conversation."""
    if not db_client:
        return
    db = db_client[config.DB_NAME]
    message_doc = {
        "role": role,
        "text": text,
        "timestamp": datetime.now().isoformat(),
    }
    if category:
        message_doc["category"] = category
    if severity:
        message_doc["severity"] = severity
        
    db.chatbot_conversations.update_one(
        {"email": email.lower(), "commerce_id": commerce_id},
        {"$push": {"messages": message_doc}},
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
        
    warnings_count = status.get("warnings", 0)
    
    # Bandeau indicateur d'état dynamique
    band_class = "indicator-green"
    if warnings_count == 1:
        band_class = "indicator-yellow"
    elif warnings_count == 2:
        band_class = "indicator-orange"
        
    st.markdown(f"""
        <div class="indicator-band {band_class}">
            {config.STATUS_INDICATORS.get(warnings_count, "🟢 Assistance disponible")}
        </div>
    """, unsafe_allow_html=True)
    
    st.title(f"🤖 Chatbot SAV — {commerces_map[st.session_state.commerce_id]}")
    st.write(f"Client(e) connecté(e) : **{st.session_state.client_name}** (`{st.session_state.email}`)")
    
    if st.session_state.get("api_fallback_active", False):
        st.warning("⚠️ Connexion à l'IA temporairement ralentie. Mode de secours local actif.")

    # Affichage des avertissements dans l'interface en cas de warning actif
    if warnings_count == 1:
        st.warning(config.WARNING_MESSAGE_1)
    elif warnings_count == 2:
        st.warning(config.WARNING_MESSAGE_2)

    # Récupérer l'historique complet de la base de données
    messages = get_conversation(st.session_state.email, st.session_state.commerce_id)
    
    # Rendre l'historique dans des bulles personnalisées
    st.write("---")
    chat_container = st.container()
    with chat_container:
        if not messages:
            st.info("Aucun message. Envoyez une demande pour démarrer l'assistance virtuelle.")
        else:
            for msg in messages:
                role = msg.get("role")
                text = msg.get("text")
                category = msg.get("category", "")
                
                # Style de bulle selon le rôle
                if role == "user":
                    bubble_class = "bubble-user"
                elif category in ["IMPOLI", "INSULTE", "MENACE", "HAINE"]:
                    bubble_class = "bubble-system"
                else:
                    bubble_class = "bubble-assistant"
                    
                st.markdown(f"""
                    <div class="chat-bubble {bubble_class}">
                        {text}
                    </div>
                    <div class="clear-float"></div>
                """, unsafe_allow_html=True)
    st.write("---")

    # Formulaire de saisie d'un nouveau message
    with st.form(key="chat_form", clear_on_submit=True):
        user_input = st.text_input("Votre message :", placeholder="Tapez votre question ici...")
        submit_btn = st.form_submit_button("Envoyer")
        
    if submit_btn and user_input.strip():
        try:
            # 1. Enregistrer le message de l'utilisateur en base
            save_message_to_conversation(
                st.session_state.email,
                st.session_state.commerce_id,
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
                conv = db.chatbot_conversations.find_one({"email": st.session_state.email.lower(), "commerce_id": st.session_state.commerce_id})
                if conv and conv.get("messages"):
                    # Mettre à jour le dernier message inséré
                    last_idx = len(conv["messages"]) - 1
                    db.chatbot_conversations.update_one(
                        {"email": st.session_state.email.lower(), "commerce_id": st.session_state.commerce_id},
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
                        "assistant",
                        sys_reply,
                        category=category, # Pour le colorer en rouge d'alerte dans le chat
                        severity=severity
                    )
                    update_client_status(status)
                    st.rerun()
            else:
                # Réponse standard de Gemini avec empathie
                with st.spinner("L'assistant réfléchit..."):
                    # Récupérer l'historique complet pour nourrir la réponse
                    history = get_conversation(st.session_state.email, st.session_state.commerce_id)
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
                    "assistant",
                    bot_reply
                )
                st.rerun()
        except Exception as ex:
            print(f"[FATAL ERROR] Exception in chat form submission: {ex}")
            st.warning("⚠️ Un incident technique temporaire est survenu. Veuillez reformuler votre message.")
            
    # Bouton Déconnexion
    if st.button("Déconnexion"):
        for key in list(st.session_state.keys()):
            del st.session_state[key]
        st.rerun()
