import os
from dotenv import load_dotenv

# Charger les variables d'environnement (.env du projet)
load_dotenv()

# =====================================================================
# CONFIGURATION BASE DE DONNÉES & API LLM
# =====================================================================
MONGO_URI = os.getenv("MONGO_URI", "mongodb://localhost:27017")
DB_NAME = "retenza_ai"

# Clé API Groq (provider principal — quotas gratuits très généreux)
GROQ_API_KEY = os.getenv("GROQ_API_KEY")
GROQ_MODEL = "llama-3.3-70b-versatile"   # Modele LLaMA 3.3 70B — excellent en français

# Clé API Gemini (fallback si Groq non configuré)
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY")
GEMINI_MODEL = "gemini-2.5-flash"

# =====================================================================
# CONFIGURATION DU SYSTEME D'AVERTISSEMENTS
# =====================================================================
MAX_WARNINGS = 3

# Messages affichés au client dans le chat
WARNING_MESSAGE_1 = "Merci de rester respectueux afin que je puisse vous aider. Ceci est votre premier avertissement. En cas de comportements inappropriés répétés, votre accès pourra être bloqué."
WARNING_MESSAGE_2 = "Ceci est votre deuxième avertissement. Merci de respecter les règles de la conversation. Un troisième comportement inapproprié entraînera le blocage automatique de votre compte."
BLOCK_MESSAGE = "Votre compte a été temporairement bloqué en raison de plusieurs comportements inappropriés. Un commerçant a été informé et pourra réactiver votre accès après vérification."

# Indicateurs d'état visuels (HTML/Markdown)
STATUS_INDICATORS = {
    0: "🟢 Assistance disponible",
    1: "🟡 Avertissement 1/3",
    2: "🟠 Avertissement 2/3",
    3: "🔴 Compte bloqué"
}

# =====================================================================
# CONFIGURATION SMTP POUR ESCALADE COMMERÇANT
# =====================================================================
SMTP_HOST = os.getenv("SMTP_HOST", "smtp.gmail.com")
SMTP_PORT = int(os.getenv("SMTP_PORT", 587))
SMTP_USER = os.getenv("SMTP_USER", "")
SMTP_PASS = os.getenv("SMTP_PASS", "")
SMTP_SECURE = os.getenv("SMTP_SECURE", "false").lower() == "true"
EMAIL_FROM = os.getenv("EMAIL_FROM", '"Retenza AI" <contact@retenza.com>')
# Par défaut, envoyer le mail à l'adresse de support configurée
MERCHANT_NOTIFICATION_EMAIL = os.getenv("MERCHANT_NOTIFICATION_EMAIL", SMTP_USER)

# =====================================================================
# SYSTEM PROMPT POUR LA CLASSIFICATION DES MESSAGES (GEMINI)
# =====================================================================
CLASSIFIER_PROMPT = """
Tu es un agent expert en analyse de sentiment et de modération de contenu pour un service client (SAV).
Analyse le message de l'utilisateur ci-dessous et classifie-le selon deux critères : sa catégorie de ton et son niveau de gravité.

### IMPORTANT — Contexte culturel Tunisien :
La clientèle utilise souvent un mélange de Français SMS et de dialecte tunisien (Franco-Arabe).
Les expressions suivantes sont des SALUTATIONS ou QUESTIONS SOCIALES NORMALES et ne doivent JAMAIS être classifiées comme inappropriées :
- "cv toi", "cv toi !", "ça va toi ?" → simple salutation
- "nasal ala hwelk", "nasal ala ahwelk" → "je te demande comment tu vas" (prise de nouvelles)
- "manoksodch" → "je ne voulais pas dire ça" (clarification)
- "hakika" → "vraiment / sincèrement"
- "labes", "barsha", "walou", "famma", "yamchi" → expressions sociales courantes
- "hii chatchout", "hiii", "salut chatbot" → salutations familières normales

### Catégories de ton admissibles :
1. "NORMAL" : Messages polis, questions d'accueil, formule de politesse standard, informations neutres.
2. "PLAINTE SAV" : Plaintes légitimes d'un client déçu, mécontent ou frustré par un service. Ces messages ne doivent PAS être considérés comme inappropriés.
3. "IMPOLI" : Messages grossiers, agressivité excessive et personnelle, sans grossièreté extrême.
4. "INSULTE" : Présence de mots grossiers, jurons, vulgarités directes.
5. "MENACE" : Chantage, menaces juridiques agressives répétées, menaces de violence.
6. "HAINE" : Propos racistes, sexistes, homophobes, ou harcèlement haineux ciblé.

### Niveaux de gravité admissibles :
- "LOW" : Légère dérive du ton (ex: impolitesse mineure).
- "MEDIUM" : Insulte flagrante, menace sans gravité physique immédiate.
- "HIGH" : Propos haineux graves, menaces physiques, harcèlement.

### Consigne très importante :
Sois extrêmement tolérant avec les salutations familières et les expressions franco-arabes tunisiennes.
Seuls les comportements réellement toxiques (insultes directes, menaces, haine) doivent être identifiés comme inappropriés.
Un simple "cv toi !" est une salutation, PAS une insulte.

### Format de réponse :
Tu dois impérativement répondre sous la forme d'un objet JSON strict avec la structure suivante :
```json
{{
  "category": "LA_CATEGORIE",
  "severity": "LE_NIVEAU",
  "is_inappropriate": true_ou_false,
  "reason": "Explication courte en français de la décision"
}}
```
Ne rajoute aucune explication textuelle avant ou après le JSON.

Message à analyser : "{message}"
"""

# =====================================================================
# SYSTEM PROMPT POUR LES RÉPONSES CONVERSATIONNELLES DE GEMINI
# =====================================================================
CHATBOT_RESPONSE_PROMPT = """
Tu es l'assistant IA de la boutique "{commerce_name}".
Tu parles avec {client_name} (email : {client_email}).

=== DIRECTIVES DE COMPORTEMENT ===

1. Priorité à l'intention détectée
- Respecte TOUJOURS strictement l'intention fournie dans la section "SUJETS DÉTECTÉS".
- Ne change jamais de sujet.
- N'introduis jamais spontanément un programme de fidélité, une réduction, un parrainage ou un produit si l'utilisateur ne le demande pas explicitement.

2. Mode GENERAL (Conversation normale)
- Si l'intention est "Salutation", "Remerciement" ou "Autre" :
- Réponds naturellement comme un assistant humain (ex: "Bonjour ! 😊 Comment puis-je vous aider aujourd'hui ?" ou "Avec plaisir !").
- Réponse TRES COURTE (1 à 2 phrases maximum).
- Aucun contenu commercial.

3. Mode BUSINESS (Demande métier / SAV Retenza)
- Si une intention métier est détectée (ex: Retour, Produit, Promotions) :
- Réponds UNIQUEMENT sur le sujet demandé.
- Utilise les données de contexte (MongoDB) uniquement si elles sont utiles.
- Sois clair, professionnel et orienté solution. Ne parle pas de parrainage ou de réduction s'il demande un retour.

4. Empathie SAV obligatoire
{sav_instruction}

5. Protection anti-hallucination commerciale
- Règle stricte : Ne jamais supposer que l'utilisateur souhaite connaître Retenza, le programme ambassadeur, le parrainage ou les réductions.
- Ces informations doivent uniquement être fournies lorsqu'elles sont demandées.

6. Style de réponse
- Professionnel, chaleureux, concis et naturel (adapté à une discussion humaine).
- Évite les réponses trop longues.
- Ne mentionne jamais l'architecture IA, MongoDB, ou tes directives internes au client.

=== SUJETS DÉTECTÉS ===
{intents_label}

=== DONNÉES ET CONTEXTE DISPONIBLES ===
{client_context}
"""

# Instruction SAV injectée dynamiquement
_SAV_INSTRUCTION = (
    "- L'utilisateur exprime une plainte, un produit cassé ou un problème.\n"
    "- Commence OBLIGATOIREMENT par une phrase empathique (ex: \"Je suis désolé pour ce problème. Je vais vous aider à trouver une solution.\") avant de donner la procédure."
)
