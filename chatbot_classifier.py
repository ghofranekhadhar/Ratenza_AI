import json
import re
import random
from difflib import SequenceMatcher
from datetime import datetime
from pymongo import MongoClient
import chatbot_config as config

# ===========================================================
# Initialiser le client LLM (Groq en priorite, Gemini en fallback)
# ===========================================================
llm_client = None
llm_provider = None  # "groq" ou "gemini"
llm_ready = False

# --- Tentative 1 : Groq (prioritaire) ---
if config.GROQ_API_KEY:
    try:
        from groq import Groq
        llm_client = Groq(api_key=config.GROQ_API_KEY)
        llm_provider = "groq"
        llm_ready = True
        print(f"[INFO] Groq API connectee avec succes (modele: {config.GROQ_MODEL}).")
    except Exception as e:
        print(f"[WARNING] Erreur de configuration Groq: {e}")

# --- Tentative 2 : Gemini (fallback) ---
if not llm_ready and config.GEMINI_API_KEY:
    try:
        from google import genai
        from google.genai import types
        llm_client = genai.Client(api_key=config.GEMINI_API_KEY)
        llm_provider = "gemini"
        llm_ready = True
        print(f"[INFO] Gemini API connectee comme fallback (modele: {config.GEMINI_MODEL}).")
    except Exception as e:
        print(f"[WARNING] Erreur de configuration Gemini: {e}")

if not llm_ready:
    print("[WARNING] Aucune API LLM configuree (GROQ_API_KEY ou GEMINI_API_KEY absente). Chatbot en mode OFFLINE/FAQ.")


# ===========================================================
# Fonctions utilitaires LLM (abstraction Groq / Gemini)
# ===========================================================
def _llm_generate_text(prompt, temperature=0.1):
    """
    Envoie un prompt simple au LLM et retourne la reponse texte brute.
    Fonctionne avec Groq (chat.completions) ou Gemini (generate_content).
    """
    if llm_provider == "groq":
        response = llm_client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=[{"role": "user", "content": prompt}],
            temperature=temperature,
            max_tokens=512
        )
        return response.choices[0].message.content.strip()
    elif llm_provider == "gemini":
        from google.genai import types
        response = llm_client.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=prompt,
            config=types.GenerateContentConfig(temperature=temperature)
        )
        return response.text.strip()
    else:
        raise RuntimeError("Aucun provider LLM disponible")


def _llm_chat(system_instruction, messages, temperature=0.8):
    """
    Envoie une conversation multi-tour au LLM et retourne la reponse texte.
    messages = liste de dicts {"role": "user"|"assistant", "text": "..."}
    """
    if llm_provider == "groq":
        groq_messages = [{"role": "system", "content": system_instruction}]
        for m in messages:
            role = m["role"] if m["role"] in ["user", "assistant"] else "assistant"
            groq_messages.append({"role": role, "content": m["text"]})
        response = llm_client.chat.completions.create(
            model=config.GROQ_MODEL,
            messages=groq_messages,
            temperature=temperature,
            max_tokens=1024
        )
        return response.choices[0].message.content.strip()
    elif llm_provider == "gemini":
        from google.genai import types
        contents = [
            types.Content(
                role=m["role"] if m["role"] != "assistant" else "model",
                parts=[types.Part.from_text(text=m["text"])]
            )
            for m in messages
        ]
        response = llm_client.models.generate_content(
            model=config.GEMINI_MODEL,
            contents=contents,
            config=types.GenerateContentConfig(
                system_instruction=system_instruction,
                temperature=temperature
            )
        )
        return response.text.strip()
    else:
        raise RuntimeError("Aucun provider LLM disponible")


import unicodedata

def normalize_text(text):
    """
    Normalise le texte pour la détection :
    - Mise en minuscules
    - Suppression des accents
    - Remplacement des abréviations courantes et fautes légères
    """
    # Minuscules et suppression d'accents
    text = unicodedata.normalize('NFD', text.lower())
    text = ''.join(c for c in text if unicodedata.category(c) != 'Mn')
    text = re.sub(r"[^\w\s%'-]", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    
    # Expressions multi-mots avant les remplacements mot a mot.
    phrase_replacements = {
        r"\bchnou+a\s+a?hwel+k\b": "comment tu vas",
        r"\bkif\s+halek\b": "comment tu vas",
        r"\bkifech\s+halek\b": "comment tu vas",
        r"\bca\s+roule\b": "ca roule",
        r"\bcette\s*platforme\b": "cette plateforme",
        r"\bcette\s*plateforme\b": "cette plateforme",
        r"\btt\s+va\b": "tout va",
        r"\bt\s+va\b": "tout va",
        r"\bj\s*'?ai\s+pas\s+recu\b": "pas recu",
        r"\bma\s+pas\s+recu\b": "pas recu",
        r"\bprobleme\s+avec\b": "probleme avec",
    }
    for pattern, repl in phrase_replacements.items():
        text = re.sub(pattern, repl, text)
    
    # Remplacements courants
    replacements = {
        r"\bbjr\b": "bonjour",
        r"\bslt\b": "salut",
        r"\bcv\b": "ca va",
        r"\bsava\b": "ca va",
        r"\bca vas\b": "ca va",
        r"\bkoi\b": "quoi",
        r"\bqupi\b": "quoi",
        r"\bplatforme\b": "plateforme",
        r"\bplateform\b": "plateforme",
        r"\bhelo+\b": "hello",
        r"\bhi+\b": "hello",
        r"\bhii+\b": "hello",
        r"\btt\b": "tout",
        r"\bj veux\b": "je veux",
        r"\bveu\b": "veux",
        r"\bfair\b": "faire",
        r"\bcomen\b": "comment",
        r"\breduc\b": "reduction",
        r"\bmercii+\b": "merci",
        r"\bthx\b": "merci",
        r"\bbcp\b": "beaucoup",
        r"\bproblem\b": "probleme",
        r"\bui\b": "oui",
        r"\bsvp\b": "s'il vous plait",
        r"\bstp\b": "s'il te plait",
        # Dialecte Tunisien Franco-Arabe
        r"\bchnowa\b": "quoi",
        r"\bchnoua\b": "quoi",
        r"\bchneya\b": "quoi",
        r"\bkifech\b": "comment",
        r"\bnheb\b": "je veux",
        r"\bnakhou\b": "avoir",
        r"\bnraja3\b": "retourner",
        r"\bmouch behi\b": "pas bon",
        r"\bkhayeb\b": "pas bon",
        r"\bma3andich satisfaction\b": "insatisfait",
        r"\bhwelk\b": "comment tu vas",
        r"\bahwelk\b": "comment tu vas",
        r"\bnasal\b": "je demande",
        r"\bmanoksodch\b": "je ne voulais pas dire",
        r"\bhakika\b": "vraiment",
        r"\bbarakallah\b": "merci",
        r"\byaaser\b": "facile",
        r"\bmazelt\b": "encore",
        r"\bwalou\b": "rien",
        r"\bchkoun\b": "qui",
        r"\bwaqtech\b": "quand",
        r"\bfamma\b": "il y a",
        r"\bbarsha\b": "beaucoup",
        r"\bbi3eed\b": "loin",
        r"\bkarba\b": "proche",
        r"\bma3andich\b": "je n'ai pas",
        r"\bama\b": "mais",
        r"\byamchi\b": "ca marche",
    }
    for pattern, repl in replacements.items():
        text = re.sub(pattern, repl, text)
    
    text = re.sub(r"\s+", " ", text).strip()
    return text


# =====================================================================
# CLASSIFICATION : CONVERSATION GÉNÉRALE vs DEMANDE MÉTIER
# =====================================================================

# Mots-clés signaux d'une demande métier - si présents, on est TOUJOURS en mode BUSINESS
_BUSINESS_SIGNALS = [
    # SAV / retours / remboursements
    "retour", "retourner", "renvoyer", "rembourse", "remboursement", "rembourser",
    "casse", "defectueux", "abime", "brise", "endommage", "ne marche pas",
    "ne fonctionne pas", "marche pas", "fonctionne pas", "pas bon", "probleme",
    "insatisfait", "decu", "mecontent", "scandaleux", "inacceptable", "souci",
    "reclamation", "plainte", "sav",
    # Commandes / livraisons
    "commande", "livraison", "colis", "paquet", "pacquet", "expedie", "livre",
    "tracking", "suivi", "recu", "retard", "arrive",
    "ou est", "quand arrive", "delai", "plateforme",
    # Programme Retenza / fidélité
    "retenza", "parrainage", "parrain", "filleul", "inviter", "invitation",
    "reduction", "promo", "promotion", "offre", "20%", "-20", "gagner",
    "ambassadeur", "fidelite", "programme", "code ami",
    # Produits
    "produit", "article", "catalogue", "acheter", "achat", "disponible",
    "soin", "creme", "parfum", "hydratant",
]

_BUSINESS_SIGNAL_PHRASES = [
    "ne marche pas", "ne fonctionne pas", "marche pas", "fonctionne pas",
    "pas bon", "ou est", "quand arrive", "code ami", "j'ai un probleme",
    "probleme avec", "pas recu", "pas arrive", "colis pas", "paquet pas",
    "quoi faire toi", "tu est pourquoi", "tu es pourquoi", "tu es la pourquoi",
]

_GENERAL_INTENTS = {"Salutation", "Remerciement", "Autre", "Aide generale"}
_BUSINESS_INTENTS = {
    "Plainte SAV", "Retour", "Remboursement", "Parrainage", "Ambassadeur",
    "Retenza", "Livraison", "Commande", "Promotions", "Produits", "Assistance"
}

# Patterns regex pour les messages de type purement conversationnel/social
_SOCIAL_PATTERNS = [
    # Salutations courtes (avec ou sans extension de lettres)
    r"^(sal+ut+|bonjour+|bonsoir+|hello+|hi+|hey+|hola+|ola+|coucou+|salam+)(\s+(chatbot|chatchout|bot|assistant))?\s*[!?.:,]*$",
    # Abréviations SMS de salutation
    r"^(bjr+|slt+|bsr+|cc+)\s*[!?.:,]*$",
    # Etats, humeurs courtes
    r"^(ca\s+va|cv|sava|labes|la\s+bes|bien|bof|bien\s+merci|tres\s+bien)\s*[!?.:,]*$",
    r"^(tout\s+va\s+bien|ca\s+roule|nickel|impeccable|parfait|cool+|super+|top+|bonne\s+journee)\s*[!?.:,]*$",
    # Remerciements purs
    r"^(merci+|thx+|ok+|oui+|non+|d'accord)\s*(beaucoup|bcp|bien|tellement)?\s*[!?.:,]*$",
    # Combinaisons sociales courtes (cv sava, slt cv, etc.)
    r"^(slt|bjr|cc|hi|salam)\s+(cv|sava|labes|bien|ca\s+va)\s*[?!.]*$",
    r"^(cv|sava|labes)\s*[?,!.]*$",
    # Répétitions de "ca va" après normalisation (cv sava → ca va ca va)
    r"^(ca\s+va\s*){1,3}[?!.]*$",
    # 'cv toi' = 'ca va toi' = salutation (après normalisation cv -> ca va)
    r"^(ca\s+va)\s+(toi|vous|twa)\s*[?!.]*$",
    # 'ca va toi' direct
    r"^(ca\s+va\s+toi|ca\s+va\s+vous)\s*[?!.]*$",
    # Expressions dialectales purement sociales (post-normalisation)
    r"^(chnoua\s+ahwelk|labes|ahlen|mrhaba+|yaa\s+weldi)\s*[!?.:,]*$",
    # Demandes tunisiennes de nouvelles (post-normalisation)
    r"^(comment\s+tu\s+vas|je\s+demande\s+comment\s+tu\s+vas)\s*[?!.]*$",
    r"^(quoi\s+)?comment\s+tu\s+vas\s*[?!.]*$",
    r"^(vraiment|je\s+ne\s+voulais\s+pas\s+dire.*)$",
]

def _collapse_repeated_letters(token):
    """Ramene les repetitions excessives a 2 lettres pour la comparaison floue."""
    return re.sub(r"([a-z])\1{2,}", r"\1\1", token)


def _similar(a, b):
    return SequenceMatcher(None, a, b).ratio()


def _has_business_signal(msg_normalized):
    for phrase in _BUSINESS_SIGNAL_PHRASES:
        if phrase in msg_normalized:
            return phrase
    if contains_word(msg_normalized, _BUSINESS_SIGNALS):
        for signal in _BUSINESS_SIGNALS:
            if contains_word(msg_normalized, [signal]):
                return signal
    return None


def _looks_like_social_message(msg_normalized):
    """
    Detecte les petits messages sociaux mal ecrits sans enumerer tous les cas.
    Combine normalisation, similarite floue et absence de signal metier.
    """
    compact = re.sub(r"\s+", " ", msg_normalized).strip()
    words = [_collapse_repeated_letters(w) for w in compact.split() if w]
    if not words:
        return True
    if len(words) > 6:
        return False

    if "comment tu vas" in compact or "ca va" in compact or "ca roule" in compact:
        return True

    social_targets = [
        "hello", "bonjour", "bonsoir", "salut", "salam", "coucou", "hey",
        "merci", "labes", "ok", "top", "cool", "super", "parfait",
    ]
    bot_mentions = {"chatbot", "chatchout", "bot", "assistant"}
    filler = {"ca", "va", "toi", "vous", "comment", "tu", "vas", "beaucoup", "bien"}
    meaningful = [w for w in words if w not in bot_mentions]
    if not meaningful:
        return True

    social_hits = 0
    for word in meaningful:
        if word in filler or any(_similar(word, target) >= 0.72 for target in social_targets):
            social_hits += 1

    return social_hits >= max(1, len(meaningful) - 1)


def _llm_route_message_type(raw_message):
    """
    Routage semantique avant toute donnee MongoDB.
    En cas d'incertitude, on privilegie GENERAL pour eviter la pollution metier.
    """
    if not llm_ready or not llm_client:
        return None

    safe_message = raw_message.replace('"', '\\"')
    prompt = f"""
Tu es un routeur d'intention pour un assistant SAV.
Decide si le message est une conversation generale ou une demande metier explicite.

Categories possibles :
- GENERAL : salutation, remerciement, small talk, question generale, demande d'aide vague, message ambigu.
- BUSINESS : demande claire liee au SAV, commande, livraison, retour, remboursement, produit, Retenza, reduction, parrainage, ambassadeur.

Regle critique : si le message est mal ecrit, familier, franco-tunisien, ou ambigu mais ne demande pas clairement un sujet metier, choisis GENERAL.
Ne choisis BUSINESS que si le besoin metier est explicite.

Reponds uniquement en JSON strict :
{{"type":"GENERAL ou BUSINESS","intent":"Salutation, Remerciement, Aide generale, Autre, Plainte SAV, Retour, Remboursement, Parrainage, Ambassadeur, Retenza, Livraison, Commande, Promotions ou Produits","reason":"raison courte"}}

Message : "{safe_message}"
"""
    try:
        raw = _llm_generate_text(prompt, temperature=0.0)
        result = _clean_json_response(raw)
        routed_type = str(result.get("type", "GENERAL")).upper().strip()
        intent = str(result.get("intent", "Autre")).strip()
        reason = str(result.get("reason", "Routage LLM")).strip()
        if routed_type not in ["GENERAL", "BUSINESS"]:
            routed_type = "GENERAL"
        if routed_type == "GENERAL" and intent not in _GENERAL_INTENTS:
            intent = "Autre"
        if routed_type == "BUSINESS" and intent not in _BUSINESS_INTENTS:
            routed_type = "GENERAL"
            intent = "Autre"
        return {"type": routed_type, "intent": intent, "reason": reason}
    except Exception as e:
        print(f"[API_ERROR] Routage semantique indisponible ({llm_provider}) : {e}.")
        return None

def _legacy_classify_message_type(raw_message):
    """
    Classe le message en 'GENERAL' (conversation sociale) ou 'BUSINESS' (demande metier).

    Retourne un tuple (type, raison) :
    - ('GENERAL', raison) : salutation, remerciement, phrase courte sociale
    - ('BUSINESS', raison) : SAV, commande, retour, parrainage, produits...

    Règles (ordre de priorité) :
    1. Si un signal métier est détecté → toujours BUSINESS.
    2. Si message normalisé match un pattern social pur → GENERAL.
    3. Si message très court (<= 3 mots) et sans signal métier → GENERAL.
    4. Sinon → BUSINESS (par défaut sécurisé).
    """
    msg_normalized = normalize_text(raw_message)
    msg_words = msg_normalized.split()

    # --- RÈGLE 1 : Priorité absolue aux signaux métier ---
    for signal in _BUSINESS_SIGNALS:
        if signal in msg_normalized:
            return ("BUSINESS", f"Signal metier detecte : '{signal}'")

    # --- RÈGLE 2 : Match avec un pattern social pur ---
    for pattern in _SOCIAL_PATTERNS:
        if re.fullmatch(pattern, msg_normalized.strip()):
            return ("GENERAL", f"Pattern social detecte : '{pattern[:40]}...'")

    # --- RÈGLE 3 : Message très court sans signal métier ---
    # Sauf s'il contient des mots ambigus qui nécessitent analyse
    ambiguous_words = ["aide", "help", "assistance", "question", "qui", "pourquoi", "comment", "parler", "raconte"]
    if len(msg_words) <= 3 and not any(w in msg_normalized for w in ambiguous_words):
        return ("GENERAL", f"Message court ({len(msg_words)} mot(s)) sans signal metier")

    # --- RÈGLE 4 : UNKNOWN (Inconnu / Ambigu) → Analyse sémantique Gemini ---
    return ("UNKNOWN", "Message ambigu ou nouveau, necessite une analyse semantique")

def classify_message_type(raw_message, conversation_history=None):
    """
    Route le message avant toute logique metier :
    GENERAL pour conversation, small talk, aide vague ou ambiguite.
    BUSINESS uniquement si un besoin SAV/Retenza est explicite.
    """
    msg_normalized = normalize_text(raw_message)
    msg_words = msg_normalized.split()

    # Relance contextuelle ("en 1 phrase", "j'ai pas compris", etc.) → toujours BUSINESS
    if conversation_history and _is_contextual_followup(raw_message, []):
        return ("BUSINESS", "Relance contextuelle sur le sujet en cours")

    if _is_delivery_delay_complaint(raw_message):
        return ("BUSINESS", "Plainte livraison / colis non recu detectee")

    business_signal = _has_business_signal(msg_normalized)
    if business_signal:
        return ("BUSINESS", f"Signal metier detecte : '{business_signal}'")

    for pattern in _SOCIAL_PATTERNS:
        if re.fullmatch(pattern, msg_normalized.strip()):
            return ("GENERAL", f"Pattern social detecte : '{pattern[:40]}...'")

    if _looks_like_social_message(msg_normalized):
        return ("GENERAL", "Message social court detecte par similarite")

    if len(msg_words) <= 4:
        return ("GENERAL", f"Message court ({len(msg_words)} mot(s)) sans signal metier")

    routed = _llm_route_message_type(raw_message)
    if routed:
        return (routed["type"], f"Routage semantique : {routed['reason']}")

    return ("UNKNOWN", "Message ambigu ou nouveau, sans signal metier explicite")


def _clean_json_response(raw_text):
    """
    Nettoie et extrait le bloc JSON de la reponse brute de l'IA.
    """
    try:
        return json.loads(raw_text.strip())
    except json.JSONDecodeError:
        pass

    # Extraire un bloc ```json ... ```
    match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", raw_text, re.DOTALL)
    if match:
        try:
            return json.loads(match.group(1).strip())
        except json.JSONDecodeError:
            pass

    # Dernier recours : trouver le 1er '{' et dernier '}'
    start = raw_text.find('{')
    end = raw_text.rfind('}')
    if start != -1 and end != -1:
        try:
            return json.loads(raw_text[start:end + 1].strip())
        except json.JSONDecodeError:
            pass

    raise ValueError(f"Impossible de parser la reponse JSON: {raw_text[:200]}")


def _offline_fallback_classify(message):
    """
    Classification locale simple de secours (pas de connexion API requise).
    Utilise une liste de mots-cles pour detecter les messages inappropries.
    """
    msg_lower = message.lower()

    insults = [
        "connard", "salope", "merde", "putain", "fdp", "encule", "con ",
        "idiot", "imbecile", "abruti", "debile", "va te faire", "nul", "incompetent"
    ]
    threats = [
        "te tuer", "te frapper", "te retrouver", "niquer", "bruler",
        "detruire", "attaquer", "je vais te"
    ]
    hate = [
        "raciste", "sale arabe", "sale noir", "sale juif", "pd ", "pede",
        "gouine", "feuj", "bougnoule"
    ]

    for word in hate:
        if word in msg_lower:
            return {"category": "HAINE", "severity": "HIGH", "is_inappropriate": True,
                    "reason": "Propos haineux detectes (moderation locale)", "is_fallback": True}

    for word in threats:
        if word in msg_lower:
            return {"category": "MENACE", "severity": "HIGH", "is_inappropriate": True,
                    "reason": "Menace detectee (moderation locale)", "is_fallback": True}

    for word in insults:
        if word in msg_lower:
            return {"category": "INSULTE", "severity": "MEDIUM", "is_inappropriate": True,
                    "reason": "Insulte detectee (moderation locale)", "is_fallback": True}

    # Message en MAJUSCULES = agressivite
    if len(message) > 15 and message.upper() == message and any(c.isalpha() for c in message):
        return {"category": "IMPOLI", "severity": "LOW", "is_inappropriate": True,
                "reason": "Utilisation excessive de majuscules (agressivite detectable)", "is_fallback": True}

    return {"category": "NORMAL", "severity": "LOW", "is_inappropriate": False,
            "reason": "Valide par moderation locale", "is_fallback": True}


def classify_message(message):
    """
    Classifie un message client en appelant le LLM (Groq ou Gemini).
    Retourne un dict : {category, severity, is_inappropriate, reason, is_fallback}
    Categories : NORMAL | PLAINTE SAV | IMPOLI | INSULTE | MENACE | HAINE
    Severity   : LOW | MEDIUM | HIGH
    """
    if not message.strip():
        return {"category": "NORMAL", "severity": "LOW", "is_inappropriate": False, "reason": "Message vide", "is_fallback": False}

    if not llm_ready or not llm_client:
        return _offline_fallback_classify(message)

    try:
        formatted_prompt = config.CLASSIFIER_PROMPT.format(
            message=message.replace('"', '\\"')
        )

        raw_text = _llm_generate_text(formatted_prompt, temperature=0.1)
        result = _clean_json_response(raw_text)

        # Validation et normalisation
        required_keys = ["category", "severity", "is_inappropriate", "reason"]
        if all(k in result for k in required_keys):
            cat = str(result["category"]).upper().strip()
            valid_categories = ["NORMAL", "PLAINTE SAV", "IMPOLI", "INSULTE", "MENACE", "HAINE"]

            if cat not in valid_categories:
                result["category"] = "NORMAL"
                result["is_inappropriate"] = False
            else:
                result["category"] = cat

            # Securite : forcer is_inappropriate selon la categorie
            if result["category"] in ["NORMAL", "PLAINTE SAV"]:
                result["is_inappropriate"] = False
            else:
                result["is_inappropriate"] = True

            result["is_fallback"] = False
            return result
        else:
            raise ValueError("Champs manquants dans la reponse JSON du LLM")

    except Exception as e:
        print(f"[ERROR] LLM classify_message ({llm_provider}): {e}. Fallback local actif.")
        return _offline_fallback_classify(message)


def get_client_context_info(email, commerce_id=None):
    """
    Recupere en direct depuis MongoDB toutes les informations de fidelite,
    RFM, segmentation, parrainages et transactions du client.
    """
    try:
        client = MongoClient(config.MONGO_URI, serverSelectionTimeoutMS=1500)
        db = client[config.DB_NAME]

        # 1. Trouver le client dans analyses_ia (RFM & IA metrics)
        query = {"email": {"$regex": f"^{email}$", "$options": "i"}}
        if commerce_id:
            query["commerce_id"] = commerce_id
        ia_doc = db.analyses_ia.find_one(query)

        # Fallback sans commerce_id si non trouve
        if not ia_doc and commerce_id:
            ia_doc = db.analyses_ia.find_one({"email": {"$regex": f"^{email}$", "$options": "i"}})

        # 2. Recuperer l'historique de ses parrainages
        referred_list = []
        completed_count = 0
        sponsor_doc = None

        effective_email = email.lower()
        if ia_doc and ia_doc.get("email"):
            effective_email = ia_doc.get("email").lower()

        # Filleuls parraines
        parrain_query = {"parrain_email": {"$regex": f"^{effective_email}$", "$options": "i"}}
        if commerce_id:
            parrain_query["commerce_id"] = commerce_id
        referred_list = list(db.parrainages.find(parrain_query))
        completed_count = sum(1 for r in referred_list if r.get("status") == "completed")

        # Qui a parraine ce client (son parrain)
        filleul_query = {"filleul_email": {"$regex": f"^{effective_email}$", "$options": "i"}}
        if commerce_id:
            filleul_query["commerce_id"] = commerce_id
        sponsor_doc = db.parrainages.find_one(filleul_query)

        # 3. Recuperer les dernieres transactions
        recent_txs = []
        # Trouver d'abord son client_id de transaction
        client_query = {"email": {"$regex": f"^{effective_email}$", "$options": "i"}}
        if commerce_id:
            client_query["commerce_id"] = commerce_id
        client_doc = db.clients.find_one(client_query)
        if not client_doc and ia_doc:
            client_doc = db.clients.find_one({"email": {"$regex": f"^{effective_email}$", "$options": "i"}})

        if client_doc:
            tx_query = {"client_id": client_doc.get("id")}
            if commerce_id:
                tx_query["commerce_id"] = commerce_id
            tx_cursor = db.transactions.find(tx_query).sort("date_transaction", -1).limit(3)
            recent_txs = list(tx_cursor)

        # Formater les informations sous forme de contexte pour l'IA
        context = "\n### DONNEES COMPTE CLIENT EN DIRECT DE MONGODB (retenza_ai) :\n"
        if ia_doc:
            context += f"- Score d'influence Retenza : {ia_doc.get('influence_score', 'Non calcule')}/100\n"
            context += f"- Score de fidelite global (Sa) : {ia_doc.get('score_global_sa', 0) * 100:.1f}/100\n"
            context += f"- Code de parrainage personnel : {ia_doc.get('referral_code', 'Aucun')}\n"
            context += f"- Risque de depart (Churn) : {ia_doc.get('churn_risk_label', 'Inconnu')} (Score: {ia_doc.get('churn_score', 0) * 100:.1f}%)\n"
            context += f"- Segment client (GMM) : {ia_doc.get('gmm_cluster', 'Inconnu')}\n"
            context += f"- Est Ambassadeur : {'Oui' if ia_doc.get('influence_score', 0) >= 80 else 'Non'}\n"

        context += f"- Nombre de parrainages completes (valides) : {completed_count}\n"
        if referred_list:
            context += "- Filleuls parrainés :\n"
            for ref in referred_list:
                status_label = "Valide" if ref.get("status") == "completed" else "En attente"
                context += f"  * {ref.get('filleul_nom')} ({ref.get('filleul_email')}) - Statut: {status_label}\n"

        if sponsor_doc:
            context += f"- Parrain du client : {sponsor_doc.get('parrain_nom')} ({sponsor_doc.get('parrain_email')})\n"
        else:
            context += "- Parrain du client : Aucun parrain\n"

        if recent_txs:
            context += "- Dernieres transactions (achats) :\n"
            for tx in recent_txs:
                dt = tx.get("date_transaction")
                if isinstance(dt, datetime):
                    dt_str = dt.strftime('%d/%m/%Y')
                elif isinstance(dt, str):
                    dt_str = dt[:10]
                else:
                    dt_str = "Inconnue"
                context += f"  * Date: {dt_str}, Montant: {tx.get('montant')} DT, Type: {tx.get('type_achat', 'Achat')}\n"

        context += "--------------------------------------------------\n"
        return context

    except Exception as e:
        print(f"[WARNING] get_client_context_info failed: {e}")
        return ""

def contains_word(text, word_list):
    """
    Recherche robuste de mots entiers dans un texte pour eviter les faux positifs de sous-chaines (ex: 'cher' dans 'cherche').
    Gere les limites de mots avec des frontieres regex.
    """
    text_lower = text.lower()
    for word in word_list:
        pattern = r"(?i)(?:\b|[_\-\s]|^)" + re.escape(word) + r"(?:\b|[_\-\s]|$)"
        if re.search(pattern, text_lower):
            return True
    return False


def _detect_intents(message):
    """
    Identifie precisement les sujets abordes dans le message de l'utilisateur.
    L'ordre est important pour eviter que les mots-cles generaux ne masquent les requetes precises.
    """
    detected = []
    
    # 1. Retour / Remboursement (prioritaire sur "Produits" pour eviter les faux positifs sur "retourner un article")
    if contains_word(message, ["retour", "retourner", "renvoyer", "rembourse", "remboursement", "rembourser"]):
        detected.append("retour")
        
    # 2. Parrainage (prioritaire sur "Retenza" general car plus specifique)
    if contains_word(message, ["parrain", "parrainage", "filleul", "filleuls", "inviter", "invitation", "ami", "amis", "partager", "code parrainage", "code de parrainage", "code perso"]):
        detected.append("parrainage")
        
    # 3. Retenza / Fidélité
    if contains_word(message, ["retenza", "concept", "fidelite", "fidélité", "programme", "-20%", "20%", "20 %", "gagner", "ambassadeur", "influence", "segment"]):
        if "retenza" not in detected:
            detected.append("retenza")
            
    # 4. Commande / Livraison
    if contains_word(message, ["livraison", "colis", "recu", "reçu", "commande", "arrive", "arrivé", "delai", "délai", "expedition", "expédition", "suivi", "tracking", "ou est", "où est", "statut"]):
        detected.append("commande")
        
    # 5. Produits specifiques
    if contains_word(message, ["anti-acne", "anti-acné", "acne", "acné", "bouton", "boutons", "imperfection", "imperfections"]):
        detected.append("produit_acne")
    if contains_word(message, ["peau grasse", "grasse", "brillance", "sebum", "sébum"]):
        detected.append("produit_peau_grasse")
    if contains_word(message, ["peau seche", "peau sèche", "seche", "sèche", "hydratant", "hydrater", "hydratation", "nourrir"]):
        detected.append("produit_peau_seche")
        
    # Produits generaux (seulement s'il n'y a pas de categorie de produit plus precise et pas de retour)
    if not any(p in detected for p in ["produit_acne", "produit_peau_grasse", "produit_peau_seche"]):
        if contains_word(message, ["produit", "produits", "article", "articles", "disponible", "disponibles", "catalogue", "gamme", "gammes", "vend", "vendez", "acheter", "achat", "soin", "soins", "creme", "crème", "parfum", "parfums"]):
            if "retour" not in detected:
                detected.append("produits_generaux")
                
    # 6. Horaires
    if contains_word(message, ["horaire", "horaires", "ouvert", "ouverte", "ferme", "fermée", "heure", "heures", "quand"]):
        detected.append("horaires")
        
    # 7. Contact humain
    if contains_word(message, ["contact", "humain", "conseiller", "conseillère", "parler", "téléphone", "telephone", "appeler", "support", "email"]):
        detected.append("contact")
        
    # 8. Prix
    if contains_word(message, ["prix", "cout", "coût", "tarif", "tarifs", "combien", "cher", "gratuit"]):
        detected.append("prix")
        
    # 9. Promotions
    if contains_word(message, ["promo", "promotions", "promotion", "reduction", "réduction", "reductions", "réductions", "solde", "soldes", "offre", "offres", "rabais", "discount", "code promo"]):
        detected.append("promotions")
        
    # 10. Salutations
    if contains_word(message, ["bonjour", "salut", "hello", "hi", "bonsoir", "salam", "coucou", "hola"]):
        detected.append("salutation")
        
    # 11. Remerciements
    if contains_word(message, ["merci", "super", "parfait", "nickel", "top", "génial", "genial", "merci beaucoup"]):
        detected.append("remerciement")
        
    return detected


def _is_example_request(message):
    """Detecte si l'utilisateur demande explicitement un exemple."""
    msg_lower = normalize_text(message)
    return any(w in msg_lower for w in ["exemple", "illustration", "concret", "concretement", "par exemple", "donne un exemple"])


def _detect_response_format(message):
    """
    Detecte les contraintes de format demandees par l'utilisateur.
    Retourne : one_sentence | simple | why | example | detail | not_understood | None
    """
    msg_lower = normalize_text(message)
    if any(p in msg_lower for p in ["1 phrase", "une phrase", "en phrase", "en 1 phrase", "en bref", "resume", "resumer", "bref", "en une phrase"]):
        return "one_sentence"
    if any(p in msg_lower for p in ["simple", "simplifie", "plus simple", "facile", "yaaser"]):
        return "simple"
    if any(p in msg_lower for p in ["pas compris", "j'ai pas compris", "je n'ai pas compris", "pas clair", "comprends pas", "j'ai pas capt"]):
        return "not_understood"
    if "pourquoi" in msg_lower or msg_lower.startswith("c pourquoi") or msg_lower.startswith("pk"):
        return "why"
    if _is_example_request(message):
        return "example"
    if any(p in msg_lower for p in ["encore", "explique encore", "plus detail", "plus de detail", "developpe", "developper", "explique plus"]):
        return "detail"
    return None


def _is_contextual_followup(message, detected_intents):
    """
    Detecte une relance courte qui depend du sujet precedent :
    "plus detail", "explique encore", "j'ai pas compris", "en 1 phrase", etc.
    """
    msg_lower = normalize_text(message)

    # Nouvelle question metier explicite : ce n'est pas une relance sur le sujet precedent
    if _has_business_signal(msg_lower):
        return False
    raw_intents = _detect_raw_intents(message)
    if any(i not in _GENERAL_INTENTS for i in raw_intents):
        return False

    if _detect_response_format(message):
        return True

    followups = [
        "pourquoi", "comment", "explique", "explication", "explications",
        "developper", "developpe", "reformule", "reformuler", "encore", "plus",
        "detail", "details", "detaille", "detailler",
        "tt les chose", "toutes les choses", "tout les choses", "tous les choses",
        "c quoi", "c'est quoi", "c koi", "koi c", "quoi c",
    ]
    words = msg_lower.split()
    if detected_intents:
        return False
    if len(words) <= 8 and any(f in msg_lower for f in followups):
        return True
    # Questions ultra-courtes sur le sujet en cours ("c pourquoi 20%", "donne un exemple")
    if len(words) <= 5 and any(f in msg_lower for f in followups + ["exemple", "20%", "20 %"]):
        return True
    return False


def _followup_response_mode(message):
    fmt = _detect_response_format(message)
    if fmt:
        return fmt
    if _is_example_request(message):
        return "example"
    return "detail"


def _get_last_assistant_intent(conversation_history):
    """
    Determine le sujet du dernier message de l'assistant dans l'historique de la conversation.
    """
    if not conversation_history:
        return None
    for msg in reversed(conversation_history):
        role = msg.get("role")
        if role in ["assistant", "model"]:
            text = normalize_text(msg.get("text", ""))
            if any(w in text for w in ["retour", "rembourse"]):
                return "retour"
            if any(w in text for w in ["retenza", "ambassadeur", "score"]):
                return "retenza"
            if any(w in text for w in ["parrain", "filleul", "inviter", "invitation", "ami"]):
                return "parrainage"
            if any(w in text for w in ["commande", "colis", "livraison"]):
                return "commande"
            if any(w in text for w in ["gel nettoyant", "nettoyant", "salicylique", "niacinamide", "serum"]):
                return "produit_acne"
            if any(w in text for w in ["acne", "acné", "imperfection"]):
                return "produit_acne"
            if any(w in text for w in ["peau grasse", "sebum", "sébum"]):
                return "produit_peau_grasse"
            if any(w in text for w in ["peau seche", "peau sèche", "hydratant"]):
                return "produit_peau_seche"
            if any(w in text for w in ["produit", "catalogue", "gamme"]):
                return "produits_generaux"
            if any(w in text for w in ["horaire", "ouvert"]):
                return "horaires"
            if any(w in text for w in ["contact", "conseiller", "telephone"]):
                return "contact"
            if any(w in text for w in ["prix", "tarif", "combien"]):
                return "prix"
            if any(w in text for w in ["promo", "reduction", "solde"]):
                return "promotions"
    return None


def _get_intent_response(intent, client_name, client_email, commerce_name, mode="direct"):
    """
    Retourne la reponse specifique (directe ou approfondie/exemple) associee a une intention.
    """
    intent_aliases = {
        "Retour": "retour",
        "Remboursement": "retour",
        "Parrainage": "parrainage",
        "Retenza": "retenza",
        "Livraison": "commande",
        "Commande": "commande",
        "Produits": "produits_generaux",
        "Promotions": "promotions",
    }
    intent = intent_aliases.get(intent, intent)

    responses = {
        "Assistance": {
            "direct": f"{commerce_name} est une boutique en ligne, et cette plateforme sert a vous accompagner rapidement : expliquer les produits, suivre une commande, traiter un retour ou remboursement, et clarifier le programme de fidelite Retenza. Dites-moi ce que vous voulez comprendre en premier.",
            "example": f"Par exemple, vous pouvez me demander : 'quels produits conseillez-vous pour peau seche ?', 'ou est ma commande ?', ou 'comment fonctionne Retenza ?'."
        },
        "retour": {
            "direct": f"Pour retourner un article chez {commerce_name}, vous disposez d'un delai de 14 jours a compter de la reception de votre colis. L'article doit etre inutilise, non ouvert et retourne dans son emballage d'origine pour obtenir un remboursement complet.",
            "example": "Par exemple, si vous avez achete un parfum qui ne vous convient pas, vous pouvez le renvoyer scelle. Une fois receptionne et controle par notre SAV, nous recreditons votre compte sous 5 a 7 jours ouvres."
        },
        "parrainage": {
            "direct": f"Le programme de parrainage Retenza vous permet d'inviter vos amis en partageant votre code personnel (le votre est **REF-GHOFRANE-DARR**). A chaque fois qu'un proche effectue son premier achat avec votre code, le parrainage est valide. Des 5 parrainages reussis, vous obtenez une reduction de -20% sur la boutique.",
            "example": f"Voici un exemple de message d'invitation : 'Salut ! Je te recommande Boutique Tunis. En utilisant mon code de parrainage **REF-GHOFRANE-DARR** pour ta premiere commande, tu auras des remises exclusives et ca m'aidera a debloquer mes avantages !'"
        },
        "retenza": {
            "direct": f"Retenza est une plateforme intelligente de fidelisation client utilisee par {commerce_name}. Grâce a des analyses d'IA (segmentation GMM et scoring de fidelite), elle recompense nos clients les plus fideles en leur attribuant le statut d'Ambassadeur. Ce statut ouvre l'acces a un systeme de parrainage menant a une remise de -20% apres 5 parrainages.",
            "example": f"Imaginez : vous achetez regulierement chez {commerce_name}, vous devenez Ambassadeur, vous invitez 5 amis avec votre code personnel, et chacun fait un premier achat — vous debloquez alors -20% sur votre prochaine commande.",
            "simple": f"Retenza recompense les clients fideles de {commerce_name} : plus vous achetez, plus vous gagnez en avantages, jusqu'a devenir Ambassadeur et obtenir -20% via le parrainage.",
            "one_sentence": f"Retenza recompense les clients fideles de {commerce_name} avec le statut Ambassadeur et une remise de -20% apres 5 parrainages reussis.",
            "why": "La remise de -20% recompense les clients qui apportent 5 nouveaux acheteurs via le parrainage : c'est notre facon de vous remercier pour votre fidelite et votre influence.",
            "not_understood": f"En bref : vous achetez chez {commerce_name}, puis vous devenez Ambassadeur, puis vous parrainez 5 amis, et vous gagnez -20%. C'est gratuit et automatique !",
            "detail": f"Retenza calcule deux scores : votre fidelite (achats reguliers) et votre influence (capacite a recommander la boutique). Score d'influence >= 80 = statut Ambassadeur. Vous recevez un code personnel a partager ; chaque ami qui achete compte. A 5 parrainages valides, -20% sur un achat."
        },
        "commande": {
            "direct": f"Nos delais de livraison sont de 3 a 5 jours ouvres chez {commerce_name}. Vous pouvez suivre l'acheminement de votre colis avec le lien recu par e-mail. Si vous constatez un retard anormal, transmettez-moi votre numero de commande pour que je verifie en direct.",
            "example": "Par exemple, pour une commande validee le lundi matin, notre atelier la prepare le jour meme, l'expedie le mardi, et vous la recevez chez vous ou en point relais entre le jeudi et le samedi.",
            "delivery_delay": f"Je comprends votre inquietude, {client_name}. Nos delais habituels sont de 3 a 5 jours ouvres, donc apres 10 jours votre colis est en retard. Pouvez-vous me transmettre votre numero de commande ? Je lance une verification immediate et je vous tiens informe(e) sous 24h.",
            "why": "Les delais de 3 a 5 jours correspondent au temps de preparation, d'expedition et de livraison par notre transporteur en Tunisie.",
            "not_understood": f"Commande pas encore arrivee ? Delai normal = 3 a 5 jours. Au-dela, c'est un retard : envoyez-moi votre numero de commande et je verifie tout de suite.",
            "one_sentence": f"Les commandes {commerce_name} arrivent en 3 a 5 jours ouvres ; si ca depasse, donnez-moi votre numero de commande pour que je verifie."
        },
        "produit_acne": {
            "direct": "Pour eliminer les imperfections et lutter contre l'acne, nous vous conseillons notre Gel Nettoyant Purifiant a l'Acide Salicylique combine avec notre Serum Anti-imperfections au Niacinamide.",
            "example": "Par exemple, appliquez le Gel Nettoyant matin et soir pour reguler l'exces de sebum, puis appliquez 2 gouttes de Serum au Niacinamide le soir pour resserrer les pores et estomper les marques."
        },
        "produit_peau_grasse": {
            "direct": "Pour reguler l'exces de sebum des peaux grasses, nous proposons notre Gel Nettoyant Equilibrant et notre Fluide Hydratant Matifiant, qui elimine les brillances tout en maintenant l'hydratation.",
            "example": "Par exemple, appliquez le Fluide Matifiant le matin sur peau propre. Sa texture legere penetre instantanement, matifie la zone T pour toute la journee et sert d'excellente base de maquillage."
        },
        "produit_peau_seche": {
            "direct": "Pour hydrater et nourrir en profondeur les peaux seches, nous vous recommandons notre Creme Riche Hydratante a l'Acide Hyaluronique et notre Huile Seche Apaisante.",
            "example": "Par exemple, appliquez la Creme Riche matin et soir sur le visage. Le soir, ajoutez 2 gouttes d'Huile Apaisante pour reparer la barriere cutanee durant votre sommeil."
        },
        "produits_generaux": {
            "direct": f"Chez {commerce_name}, nous proposons des soins du visage et du corps adaptes a chaque type de peau, ainsi qu'une selection de parfums raffines. Quel est votre type de peau ou votre besoin actuel pour que je vous conseille ?",
            "example": "Par exemple, nous disposons de cremes hydratantes, de serums cibles (Vitamine C, Rétinol), et de coffrets cadeaux prets a offrir."
        },
        "horaires": {
            "direct": f"La boutique {commerce_name} vous accueille du lundi au samedi, de 9h00 a 19h00 sans interruption. Nous sommes fermes le dimanche.",
            "example": "Par exemple, vous pouvez venir durant votre pause dejeuner, nos conseillers sont disponibles de 12h a 14h pour vous accompagner."
        },
        "contact": {
            "direct": f"Vous pouvez contacter le support client de {commerce_name} par telephone au +216 71 000 000 (du lundi au samedi, 9h-18h) ou par e-mail a l'adresse support@retenza.com.",
            "example": "Par exemple, pour modifier d'urgence l'adresse de livraison d'un colis deja expedie, l'appel telephonique direct est la methode la plus efficace."
        },
        "prix": {
            "direct": "Nos soins nettoyants debutent a partir de 15 DT, nos cremes hydratantes varient entre 25 et 45 DT, et nos serums concentres se situent entre 50 et 80 DT.",
            "example": "Par exemple, notre produit phare, la Creme Hydratante a l'Acide Hyaluronique, est proposee au prix de 39 DT."
        },
        "promotions": {
            "direct": f"Nous proposons regulierement des ventes privees et des offres promotionnelles chez {commerce_name}. De plus, le parrainage Retenza vous permet de gagner une remise permanente de -20%.",
            "example": "Par exemple, lors de nos soldes de saison, vous beneficiez de reductions immediates allant jusqu'a -50% sur une selection d'articles."
        },
        "salutation": {
            "direct": f"Bonjour {client_name} ! Je suis votre assistant virtuel pour Boutique Tunis. Comment puis-je vous accompagner aujourd'hui ?",
            "example": "Je suis a votre disposition pour vous orienter sur nos produits, suivre vos colis, ou vous expliquer le programme de fidelite Retenza."
        },
        "remerciement": {
            "direct": f"Je vous en prie, {client_name} ! C'est un plaisir de pouvoir vous guider.",
            "example": "N'hesitez pas si vous avez besoin d'autre chose. Bonne journee !"
        },
        "Plainte SAV": {
            "direct": f"Je suis sincerement desole(e) pour ce probleme, {client_name}, et je comprends votre frustration. Pourriez-vous me decrire precisement ce qui s'est passe (produit endommage, commande incomplete, retard...) afin que je trouve une solution immediate ?",
            "example": "Par exemple, si votre colis est arrive endommage, envoyez-moi une photo et votre numero de commande : nous procedons au remplacement ou au remboursement sous 48h.",
            "not_understood": f"Pas de souci ! Decrivez-moi simplement le probleme (colis pas recu, produit casse, mauvaise reference...) et je m'en occupe personnellement.",
            "one_sentence": f"Je suis desole(e) pour ce desagrement — decrivez-moi le probleme et je le regle avec vous immediatement."
        }
    }
    
    intent_data = responses.get(intent, responses["produits_generaux"])
    return intent_data.get(mode, intent_data.get("direct", intent_data.get("example", "")))


def _is_delivery_delay_complaint(message):
    """Detecte un colis/commande non recu ou en retard (ex: 10 jours sans livraison)."""
    msg = normalize_text(message)
    delay_patterns = [
        r"\d+\s+jours?",
        r"pas\s+recu",
        r"pas\s+arrive",
        r"toujours\s+pas",
        r"encore\s+pas",
        r"pas\s+encore",
        r"pas\s+encore\s+recu",
        r"deja\s+\d+",
    ]
    delivery_words = ["colis", "paquet", "pacquet", "commande", "livraison", "livre", "recu", "arrive", "envoi", "expedition"]
    has_delay = any(re.search(p, msg) for p in delay_patterns)
    has_delivery = any(w in msg for w in delivery_words) or "pas recu" in msg
    # "10 jours" + "pas recu" suffit meme sans le mot paquet/colis
    if has_delay and ("pas recu" in msg or "pas arrive" in msg):
        return True
    return has_delay and has_delivery


def _resolve_response_mode(user_message, intent, default_mode="direct"):
    """Choisit le mode de reponse adapte au message et a l'intention."""
    fmt = _detect_response_format(user_message)
    if fmt:
        return fmt
    if intent in ("commande", "Commande", "Livraison") and _is_delivery_delay_complaint(user_message):
        return "delivery_delay"
    return default_mode


_INTENT_KEY_MAP = {
    "Retenza": "retenza", "Commande": "commande", "Livraison": "commande",
    "Parrainage": "parrainage", "Retour": "retour", "Plainte SAV": "Plainte SAV",
    "Remboursement": "retour", "Produits": "produits_generaux", "Promotions": "promotions",
    "Ambassadeur": "retenza", "Assistance": "Assistance",
}


def _canonical_to_intent_key(intent):
    return _INTENT_KEY_MAP.get(intent, intent.lower())


def _pick_varied_followup_mode(user_message, intent_key, conversation_history):
    """Evite de repeter la meme reponse FAQ sur des relances successives."""
    requested = _resolve_response_mode(user_message, intent_key, _followup_response_mode(user_message))
    if not conversation_history:
        return requested

    last_assistant = ""
    for msg in reversed(conversation_history):
        if msg.get("role") in ["assistant", "model"]:
            last_assistant = normalize_text(msg.get("text", ""))
            break

    if requested == "detail" and "score d'influence" in last_assistant:
        return "example"
    if requested == "example" and "imaginez" in last_assistant:
        return "simple"
    if requested == "direct" and intent_key == "retenza" and "retenza" in last_assistant:
        return "simple"
    return requested


def _get_offline_response(client_name, client_email, commerce_name, conversation_history, user_message):
    """
    Simule une reponse SAV naturelle et contextuelle a partir de la FAQ locale.
    Supporte les questions multiples (multi-intent) et conserve le contexte de conversation.
    """
    contextual_intents = _get_contextual_followup_intents(conversation_history, user_message)
    if contextual_intents:
        intent_key = _canonical_to_intent_key(contextual_intents[0])
        mode = _pick_varied_followup_mode(user_message, intent_key, conversation_history)
        return _get_intent_response(intent_key, client_name, client_email, commerce_name, mode=mode)

    msg_type, _ = classify_message_type(user_message, conversation_history)
    if msg_type == "GENERAL" or (msg_type == "UNKNOWN" and not _has_business_signal(normalize_text(user_message))):
        return _get_general_conversation_response(
            client_name,
            commerce_name,
            _infer_general_intent(user_message),
            user_message
        )

    detected = detect_all_intents(user_message, conversation_history)
    if "Plainte SAV" in detected:
        detected = ["Plainte SAV"] + [i for i in detected if i not in ("Plainte SAV", "Commande", "Livraison")]

    is_asking_example = _is_contextual_followup(user_message, [])

    if not detected or (is_asking_example and len(detected) <= 1 and detected[0] in _GENERAL_INTENTS):
        last_intent = _get_last_assistant_intent(conversation_history)
        if last_intent:
            mode = _pick_varied_followup_mode(user_message, last_intent, conversation_history)
            return _get_intent_response(last_intent, client_name, client_email, commerce_name, mode=mode)
        if is_asking_example:
            return "Je serais ravi de vous donner un exemple. Pouvez-vous me preciser sur quel sujet (produits, parrainage Retenza, retours) ?"

    if not detected or detected == ["Autre"]:
        return random.choice([
            f"Je peux vous renseigner sur plusieurs sujets : suivi de commande, retours, nos produits, votre programme de fidelite Retenza ou vos avantages Ambassadeur. Que desirez-vous savoir ?",
            f"Je suis a votre disposition pour repondre a vos questions sur {commerce_name} (livraisons, soins, remboursements, ou votre statut Retenza). Dites-moi ce dont vous avez besoin.",
            f"Pour {commerce_name}, je peux vous renseigner sur nos produits, vos commandes, les retours, ou votre programme de fidelite. Qu'est-ce qui vous interesse ?"
        ])

    parts = []
    for i, intent in enumerate(detected):
        intent_key = _canonical_to_intent_key(intent)
        default = "direct" if not is_asking_example else _followup_response_mode(user_message)
        mode = _resolve_response_mode(user_message, intent_key, default)
        resp = _get_intent_response(intent_key, client_name, client_email, commerce_name, mode=mode)

        if i == 0:
            parts.append(resp)
        elif i == 1:
            parts.append(f"Concernant votre demande sur {intent.replace('_', ' ')} : " + resp)
        else:
            parts.append("Enfin, pour ce qui est de votre derniere question : " + resp)

    return "\n\n".join(parts)



# ---------------------------------------------------------------------------
# CATALOGUE PRODUITS — donnees statiques injectables dans le contexte
# ---------------------------------------------------------------------------
_PRODUCT_CATALOG = (
    "Peau acneique / grasse : Gel Nettoyant Purifiant Acide Salicylique, Serum Niacinamide 10%, Creme Matifiante.\n"
    "Peau seche / deshydratee : Creme Riche Hydratante Acide Hyaluronique, Huile Nourrissante Argan, Baume Reparateur.\n"
    "Peau sensible : Creme Apaisante Calendula, Eau Micellaire Douce, SPF 50+ sans parfum.\n"
    "Soin anti-age : Serum Retinol 0.5%, Contour des Yeux Peptides, Creme Nuit Regenerante.\n"
    "Parfums / Beaute : Eau de parfum orientale Oud Santal, Baume Corps Karité."
)


def _detect_raw_intents(message):
    """
    Analyse de mots-cles pure sans aucun historique ni contexte.
    Utilise pour identifier les intentions brutes du message actuel ou de l'historique.
    """
    # Normalisation du message (accents, abréviations, etc.)
    msg = normalize_text(message)
    detected = []

    # 1. Plainte SAV (Priorité absolue pour éviter que ça ne tombe dans Produits)
    sav_keywords = [
        "casse", "defectueux", "abime", "endommage", "brise",
        "ne fonctionne pas", "ne marche pas", "marche pas", "fonctionne pas", "pas bon",
        "mauvaise qualite", "mauvais produit",
        "decu", "decevant", "mecontent",
        "pas satisfait", "insatisfait",
        "honteux", "scandaleux", "inacceptable",
    ]
    sav_patterns = [
        r"je\s+suis\s+(tres\s+|vraiment\s+|tellement\s+)?(decu|mecontent|insatisfait)",
        r"(le|ce|mon)\s+produit\s+(est\s+)?(casse|defectueux|abime|brise|endommage)",
        r"produit.{0,20}(casse|defectueux|ne\s+fonctionne|ne\s+marche|pas\s+bon)",
        r"(ma|la|mon)\s+commande.{0,30}(probleme|mauvais|incorrect|erreur)",
        r"j'ai un probleme avec (ma commande|mon produit|mon article|mon achat)",
        r"probleme\s+avec\s+(ma|mon|la|le)\s+(commande|produit|colis|article|achat|paquet)",
        r"j'ai un probleme",
        r"probleme\s+avec",
    ]
    has_sav = contains_word(msg, sav_keywords) or any(re.search(p, msg) for p in sav_patterns)
    if has_sav:
        detected.append("Plainte SAV")

    # 2. Assistance / Services de l'assistant (Aide, présentation)
    assistance_keywords = [
        "aide", "help", "assistance", "qui es-tu", "qui es tu", "que fais-tu", "que fais tu",
        "tu fais quoi", "ton role", "ton rôle", "a quoi sers-tu", "a quoi sers tu",
        "tu sers a quoi", "comment tu m'aides", "comment tu m'aider", "qu'est-ce que tu peux faire",
        "qu'est ce que tu peux faire", "services", "fonctionnalites", "fonctionnalités"
    ]
    role_question = any(p in msg for p in ["quoi faire toi", "tu est pourquoi", "tu es pourquoi", "tu es la pourquoi"])
    if contains_word(msg, assistance_keywords) or role_question or "tu fais quoi" in msg or "qui es-tu" in msg or "que fais-tu" in msg:
        detected.append("Assistance")

    if "plateforme" in msg and "Assistance" not in detected:
        detected.append("Assistance")

    # 3. Retour / Remboursement
    if contains_word(msg, ["retour", "retourner", "renvoyer"]):
        detected.append("Retour")
    if contains_word(msg, ["rembourse", "remboursement", "rembourser"]):
        detected.append("Remboursement")

    # 4. Parrainage / Ambassadeur
    parrainage_roots = ["parrain", "filleul", "filleuls", "inviter", "invitation", "partager", "code parrainage", "code ami", "ami"]
    if any(re.search(r"(?i)(^|\s|[^a-z])" + re.escape(w), msg) for w in parrainage_roots):
        detected.append("Parrainage")
    elif re.search(r"combien.{0,25}(parrain|filleul|parrainag)", msg):
        detected.append("Parrainage")
    
    if contains_word(msg, ["ambassadeur", "statut ambassadeur", "devenir ambassadeur"]):
        detected.append("Ambassadeur")

    # 5. Retenza / Fidelite (reductions, concept global)
    if contains_word(msg, ["retenza", "concept", "fidelite", "fid\u00e9lit\u00e9",
                                "programme", "-20%", "20%", "20 %", "gagner"]):
        detected.append("Retenza")

    # 6. Commande / Livraison
    if contains_word(msg, ["livraison", "colis", "paquet", "pacquet", "arrive", "arriv\u00e9", "delai",
                               "d\u00e9lai", "expedition", "exp\u00e9dition", "tracking",
                               "livre", "livr\u00e9", "recu", "re\u00e7u", "envoi", "envoy\u00e9", "retard"]):
        detected.append("Livraison")
    if contains_word(msg, ["commande", "suivi", "statut", "ou est", "o\u00f9 est"]) or "pas recu" in msg:
        detected.append("Commande")
    if _is_delivery_delay_complaint(message) and "Plainte SAV" not in detected:
        if "Commande" not in detected:
            detected.append("Commande")
        if "Livraison" not in detected:
            detected.append("Livraison")

    # 7. Promotions
    if contains_word(msg, ["promo", "promotion", "promotions", "reduction",
                               "r\u00e9duction", "solde", "soldes", "offre", "offres",
                               "rabais", "discount", "code promo"]):
        detected.append("Promotions")

    # 8. Produits — uniquement si pas de plainte SAV
    product_keywords = [
        "produit", "produits", "article", "articles", "disponible",
        "catalogue", "gamme", "gammes", "vend", "vendez",
        "acheter", "achat", "soin", "soins", "creme", "cr\u00e8me",
        "parfum", "parfums", "peau", "skin", "skincare", "gel", "nettoyant", "serum", "niacinamide", "salicylique", "acne", "acn\u00e9", "bouton",
        "imperfection", "grasse", "sebum", "s\u00e9bum", "seche", "s\u00e8che", "hydratant"
    ]
    explicit_product_keywords = [
        "produit", "produits", "catalogue", "gamme", "gammes",
        "soin", "soins", "creme", "cr\u00e8me", "parfum", "parfums",
        "peau", "skin", "skincare", "gel", "nettoyant", "serum", "niacinamide", "salicylique", "acne", "acn\u00e9", "bouton",
        "imperfection", "grasse", "sebum", "s\u00e9bum", "seche", "s\u00e8che", "hydratant"
    ]
    has_return_or_refund = any(i in detected for i in ["Retour", "Remboursement"])
    if (
        not has_sav
        and contains_word(msg, product_keywords)
        and (not has_return_or_refund or contains_word(msg, explicit_product_keywords))
    ):
        detected.append("Produits")

    # 9. Salutation
    if contains_word(msg, ["bonjour", "salut", "hello", "hi", "salam",
                               "bonsoir", "coucou", "hola", "ca va", "quoi de neuf", "ca roule"]):
        detected.append("Salutation")

    # 10. Remerciement / Approbation
    if contains_word(msg, ["merci", "super", "parfait", "nickel", "top", "genial", 
                               "ok", "d'accord", "oui", "non"]):
        detected.append("Remerciement")

    return detected


def _get_last_user_intent(conversation_history, current_message):
    """
    Parcourt l'historique a l'envers pour trouver la derniere question de l'utilisateur
    qui n'est pas le message en cours de traitement, et en extrait les intentions.
    """
    if not conversation_history:
        return None
    for msg in reversed(conversation_history):
        if msg.get("role") == "user":
            text = msg.get("text", "").strip()
            # Ignorer le message actuel
            if text.lower() == current_message.lower().strip():
                continue
            prev_intents = _detect_raw_intents(text)
            # Retourne les intentions du premier message utilisateur significatif trouve
            if prev_intents and "Autre" not in prev_intents:
                return prev_intents
    return None


def _canonicalize_intent(intent):
    aliases = {
        "retour": "Retour",
        "parrainage": "Parrainage",
        "retenza": "Retenza",
        "commande": "Commande",
        "produit_acne": "Produits",
        "produit_peau_grasse": "Produits",
        "produit_peau_seche": "Produits",
        "produits_generaux": "Produits",
        "promotions": "Promotions",
        "contact": "Assistance",
        "horaires": "Assistance",
        "prix": "Produits",
        "salutation": "Salutation",
        "remerciement": "Remerciement",
    }
    return aliases.get(intent, intent)


def _get_contextual_followup_intents(conversation_history, current_message):
    """
    Retourne le sujet precedent quand le message actuel est une relance courte.
    Evite que "plus detail", "explique encore" ou "j'ai pas compris" redeviennent des salutations.
    """
    if not _is_contextual_followup(current_message, []):
        return []

    last_assistant_intent = _get_last_assistant_intent(conversation_history)
    if last_assistant_intent in ["produit_acne", "produit_peau_grasse", "produit_peau_seche"]:
        return [_canonicalize_intent(last_assistant_intent)]

    last_user_intents = _get_last_user_intent(conversation_history, current_message)
    if last_user_intents:
        return [_canonicalize_intent(intent) for intent in last_user_intents]

    if last_assistant_intent:
        return [_canonicalize_intent(last_assistant_intent)]

    return []


def _infer_general_intent(message):
    msg_n = normalize_text(message)
    if _detect_response_format(message):
        return "Autre"
    if any(w in msg_n for w in ["comment tu vas", "ca va", "ca roule", "tout va", "tout va bien", "labes"]):
        return "Salutation"
    if any(w in msg_n for w in ["merci", "thx", "top", "super", "parfait", "nickel", "ok", "d'accord"]):
        return "Remerciement"
    if any(w in msg_n for w in ["aide", "help", "assistance", "question", "qui", "quoi", "comment", "parler", "raconte"]):
        return "Aide generale"
    return "Salutation"


def _build_format_instruction(user_message):
    """Genere une consigne de format a injecter dans le prompt LLM."""
    fmt = _detect_response_format(user_message)
    instructions = {
        "one_sentence": "L'utilisateur demande UNE SEULE PHRASE. Reponds en exactement 1 phrase courte, sans liste ni paragraphe.",
        "simple": "L'utilisateur veut une explication SIMPLE et courte (2-3 phrases max, vocabulaire facile).",
        "why": "L'utilisateur demande POURQUOI. Explique la raison/logique derriere le sujet en cours, pas une repetition de la definition.",
        "example": "L'utilisateur demande un EXEMPLE CONCRET. Donne un scenario reel et pratique lie au sujet discute.",
        "not_understood": "L'utilisateur N'A PAS COMPRIS. Reformule differemment, plus simplement, avec une analogie ou un resume en etapes.",
        "detail": "L'utilisateur veut PLUS DE DETAILS. Developpe le sujet en cours avec des informations supplementaires, sans repeter mot pour mot la reponse precedente.",
    }
    return instructions.get(fmt, "")


def _is_pure_social_intents(intents):
    """True si les intentions sont uniquement conversationnelles (pas de sujet metier)."""
    if not intents:
        return True
    return all(i in _GENERAL_INTENTS for i in intents)


def detect_all_intents(message, conversation_history):
    """
    Identifie toutes les intentions presentes dans le message de l'utilisateur.
    Commence par classifier le message en GENERAL vs BUSINESS.
    - GENERAL → retourne ['Salutation'] ou ['Remerciement'] directement.
    - BUSINESS → passe par les règles locales NLP + fallback Gemini si nécessaire.
    """
    # --- COUCHE 0 : Intentions metier explicites dans le message actuel ---
    explicit_intents = _detect_raw_intents(message)
    explicit_business = [i for i in explicit_intents if i not in _GENERAL_INTENTS]
    if explicit_business:
        if "Plainte SAV" in explicit_business:
            explicit_business = ["Plainte SAV"] + [
                i for i in explicit_business if i not in ("Plainte SAV", "Commande", "Livraison")
            ]
        return explicit_business

    # --- COUCHE 1 : Relances contextuelles ---
    contextual_intents = _get_contextual_followup_intents(conversation_history, message)
    if contextual_intents:
        print(f"[CLASSIFY] Relance contextuelle -> {contextual_intents}")
        return contextual_intents

    # --- COUCHE 2 : Classification Conversation vs Business ---
    msg_type, msg_reason = classify_message_type(message, conversation_history)
    print(f"[CLASSIFY] {msg_type} - {msg_reason}")

    if msg_type == "GENERAL":
        return [_infer_general_intent(message)]

    if msg_type == "UNKNOWN" and not _has_business_signal(normalize_text(message)):
        routed = _llm_route_message_type(message)
        if routed and routed["type"] == "BUSINESS":
            return [routed["intent"]]
        return ["Autre"]

    # --- COUCHE 3 : NLP Local (pour les messages BUSINESS) ---
    detected = _detect_raw_intents(message)

    # Si aucune intention directe n'a ete detectee
    if not detected:
        # Verifier s'il s'agit d'une question de relance ou de precision (contexte)
        if _is_contextual_followup(message, []):
            last_user_intents = _get_last_user_intent(conversation_history, message)
            if last_user_intents:
                detected = last_user_intents

    # --- COUCHE 4 : Fallback LLM (comprehension semantique avancee) ---
    if not detected and llm_ready and llm_client:
        try:
            prompt = (
                f"Analyse le message utilisateur suivant et détermine son intention principale "
                f"parmi cette liste EXACTE : [Plainte SAV, Assistance, Retour, Remboursement, "
                f"Parrainage, Ambassadeur, Retenza, Livraison, Commande, Promotions, Produits, "
                f"Salutation, Remerciement, Autre].\n\n"
                f"Message : '{message}'\n\n"
                f"Réponds UNIQUEMENT par le nom de l'intention."
            )
            llm_intent = _llm_generate_text(prompt, temperature=0.0)
            llm_intent = llm_intent.split('\n')[0].strip()

            valid_intents = [
                "Plainte SAV", "Assistance", "Retour", "Remboursement", "Parrainage",
                "Ambassadeur", "Retenza", "Livraison", "Commande", "Promotions",
                "Produits", "Salutation", "Remerciement", "Autre"
            ]
            for v in valid_intents:
                if v.lower() in llm_intent.lower() and v != "Autre":
                    detected = [v]
                    print(f"[INFO] LLM Fallback ({llm_provider}) a détecté l'intention : {v}")
                    break
        except Exception as e:
            error_str = str(e)
            if "429" in error_str or "quota" in error_str.lower() or "rate_limit" in error_str.lower():
                print(f"[API_ERROR] Quota LLM dépassé lors du fallback d'intention. Utilisation du fallback local ('Autre').")
            elif "timeout" in error_str.lower():
                print(f"[API_ERROR] Timeout de l'API LLM lors du fallback d'intention. Utilisation du fallback local ('Autre').")
            else:
                print(f"[API_ERROR] Erreur inattendue de l'API LLM (Fallback Intent) : {e}. Utilisation du fallback local ('Autre').")

    # Toujours fallback sur "Autre" si aucune intention n'est resolue
    if not detected:
        detected = ["Autre"]

    # Dédoublonner en conservant l'ordre
    seen = set()
    unique = []
    for i in detected:
        if i not in seen:
            seen.add(i)
            unique.append(i)
    return unique


def detect_primary_intent(message, conversation_history):
    """Alias pour compatibilite ascendante (retourne le premier intent detecte)."""
    return detect_all_intents(message, conversation_history)[0]


def get_aggregated_context(intents, full_context):
    """
    Construit un contexte MongoDB structure et cible pour toutes les intentions.
    Evite de polluer Gemini avec des donnees hors-sujet.
    """
    lines = full_context.splitlines() if full_context else []

    def extract_lines(*keywords):
        return [
            line.strip() for line in lines
            if any(kw.lower() in line.lower() for kw in keywords)
        ]

    sections = []

    for intent in intents:
        if intent == "Assistance":
            block = "[Services de l'Assistant]\n"
            block += (
                "Tu es l'assistant de Boutique Tunis. Tu peux :\n"
                "- Conseiller sur les produits de soin en fonction des types de peaux.\n"
                "- Informer sur les statuts de livraison et la politique de retour/remboursement.\n"
                "- Expliquer le programme de fidelisation intelligent Retenza.\n"
                "- Presenter les avantages du statut Ambassadeur et le programme de parrainage.\n"
                "CONSIGNE : Presente tes services de facon accueillante, chaleureuse et concise.\n"
            )
            sections.append(block)

        elif intent == "Ambassadeur":
            relevant = extract_lines("ambassadeur", "influence", "score_global_sa", "fidelite")
            block = "[Statut Ambassadeur (MongoDB)]\n"
            if relevant:
                block += "\n".join(relevant) + "\n"
            else:
                block += "Aucune donnee ambassadeur calculee.\n"
            block += (
                "CONSIGNE : Explique precisement ce qu'est le statut Ambassadeur chez Retenza (un client fidele avec un score d'influence >= 80) "
                "et mentionne le statut actuel du client en t'appuyant uniquement sur les donnees ci-dessus.\n"
            )
            sections.append(block)

        elif intent == "Parrainage":
            relevant = extract_lines("parrainage", "filleul", "parrain", "referral_code", "code de parrainage", "completes")
            block = "[Programme de Parrainage (MongoDB)]\n"
            if relevant:
                block += "\n".join(relevant) + "\n"
            else:
                block += "Aucun parrainage actif trouve.\n"
            block += (
                "CONSIGNE : Explique le fonctionnement du parrainage (partager son code personnel pour parrainer 5 proches afin de gagner -20%). "
                "Fournis le code de parrainage du client s'il est present dans les donnees. S'il n'a pas de parrainages completes, indique-le.\n"
            )
            sections.append(block)

        elif intent == "Retenza":
            relevant = extract_lines("influence", "fidelite", "score", "segment", "ambassadeur", "churn")
            block = "[Fidelite Retenza (MongoDB)]\n"
            if relevant:
                block += "\n".join(relevant) + "\n"
            block += (
                "CONSIGNE : Explique comment gagner la reduction de -20% (programme Retenza / parrainage). "
                "Parle de la technologie (analyses d'IA, score de fidelite global, segmentation, XGBoost pour churn) de facon simple et rassurante.\n"
            )
            sections.append(block)

        elif intent in ("Plainte SAV", "Retour", "Remboursement"):
            relevant = extract_lines("transaction", "achat", "commande", "date", "montant")
            block = "[Donnees SAV / Retour / Remboursement (MongoDB)]\n"
            block += "Politique de retour : sous 14 jours, produit non ouvert. Remboursement integral sous 5-7 jours ouvres.\n"
            if relevant:
                block += "Dernieres transactions :\n" + "\n".join(relevant[:3]) + "\n"
            sections.append(block)

        elif intent in ("Commande", "Livraison"):
            relevant = extract_lines("transaction", "achat", "date", "montant")
            block = "[Donnees Commande / Livraison (MongoDB)]\n"
            block += "Délai standard : 3 a 5 jours ouvres.\n"
            if relevant:
                block += "Dernieres transactions connues :\n" + "\n".join(relevant[:3]) + "\n"
            sections.append(block)

        elif intent == "Produits":
            block = "[Catalogue Produits]\n" + _PRODUCT_CATALOG + "\n"
            sections.append(block)

        elif intent == "Autre":
            # Ne rien injecter de spécifique pour éviter les hallucinations commerciales
            sections.append("(Aucune donnee specifique requise pour ce message general. Reponds naturellement selon la consigne.)")

    if not sections:
        return "(Aucune donnee specifique requise pour cette question.)"

    return "\n".join(sections)


def get_intent_focused_data(intention, full_context):
    """Alias pour compatibilite ascendante."""
    return get_aggregated_context([intention], full_context)


def _get_general_conversation_response(client_name, commerce_name, intent, user_message):
    """
    Reponse courte et naturelle pour les messages conversationnels.
    Aucun contexte MongoDB, aucune mention spontanee de Retenza/parrainage/reduction.
    """
    if intent == "Remerciement":
        return random.choice([
            "Avec plaisir ! Comment puis-je vous aider d'autre ?",
            "Je vous en prie ! Je reste disponible si besoin.",
            "Avec plaisir, merci a vous !"
        ])

    if intent == "Aide generale":
        return (
            f"Bien sur, je peux vous aider. Dites-moi simplement ce dont vous avez besoin "
            f"concernant {commerce_name}."
        )

    msg_n = normalize_text(user_message)
    if any(w in msg_n for w in ["comment tu vas", "ca va", "ca roule", "tout va", "labes"]):
        return random.choice([
            "Tres bien, merci ! Et vous, tout va bien ? Comment puis-je vous aider ?",
            "Je vais tres bien, merci ! De quoi avez-vous besoin aujourd'hui ?",
            f"Ca va super, merci {client_name} ! Que puis-je faire pour vous ?"
        ])

    if any(w in msg_n for w in ["hello", "salut", "coucou", "hey", "salam", "bonjour", "bonsoir"]):
        return random.choice([
            f"Bonjour {client_name} ! Ravie de vous retrouver. Comment puis-je vous aider ?",
            f"Salut {client_name} ! Content de vous parler. Qu'est-ce que je peux faire pour vous ?",
            "Hello ! Comment puis-je vous accompagner aujourd'hui ?"
        ])

    return random.choice([
        f"Bonjour {client_name} ! Comment puis-je vous aider aujourd'hui ?",
        "Bonjour ! De quoi avez-vous besoin ?",
        f"Bonjour ! Je suis la pour vous aider chez {commerce_name}."
    ])


def validate_and_sanitize_response(response_text, intents, is_followup=False):
    """
    Verifie la coherence de la reponse generee par le LLM vis-a-vis des intentions.
    Ne corrige que les vraies deviations : salutation PURE qui parle de SAV/Retenza.
    """
    text_lower = response_text.lower()
    business_intents = [i for i in intents if i not in _GENERAL_INTENTS]

    # Relance ou intention metier : ne jamais ecraser la reponse par une salutation generique
    if is_followup or business_intents:
        if "Plainte SAV" in intents or "Commande" in intents or "Livraison" in intents:
            empathie_keywords = ["desole", "excuse", "navre", "pardon", "regrette", "incident", "embete", "comprends", "inquiet"]
            if not any(w in text_lower for w in empathie_keywords):
                return "Je comprends votre inquietude et je suis desole(e) pour ce desagrement. " + response_text
        return response_text

    # Salutation / remerciement PURS uniquement : eviter la pollution metier non demandee
    if _is_pure_social_intents(intents):
        business_words = ["parrainage", "remboursement", "colis", "filleul", "ambassadeur", "retenza", "xgboost"]
        if any(w in text_lower for w in business_words):
            if "Remerciement" in intents:
                return "Je vous en prie ! N'hesitez pas si vous avez besoin d'autre chose."
            if "Salutation" in intents:
                return response_text.split(".")[0].split("!")[0] + " !" if len(response_text) > 200 else response_text
            return response_text

    if "Plainte SAV" in intents:
        empathie_keywords = ["desole", "excuse", "navre", "pardon", "regrette", "incident", "embete"]
        if not any(w in text_lower for w in empathie_keywords):
            return "Je suis sincerement desole(e) pour ce desagrement. " + response_text

    return response_text


def generate_chatbot_response(client_name, client_email, commerce_name, conversation_history, user_message, commerce_id=None):
    """
    Genere une reponse conversationnelle via le LLM (Groq ou Gemini) ou FAQ locale si hors-ligne/erreur.
    Filtre l'historique pour ne pas polluer l'IA en cas de changement de sujet.
    Valide et trace chaque requete avec des logs de debogage.
    """
    initial_contextual_intents = _get_contextual_followup_intents(conversation_history, user_message)
    is_followup = _is_contextual_followup(user_message, []) or bool(initial_contextual_intents)
    is_delivery_issue = _is_delivery_delay_complaint(user_message)

    initial_msg_type, initial_reason = classify_message_type(user_message, conversation_history)
    is_pure_social = (
        initial_msg_type == "GENERAL"
        and not initial_contextual_intents
        and not is_delivery_issue
        and not _has_business_signal(normalize_text(user_message))
    )

    # Mode OFFLINE : reponses locales uniquement
    if not llm_ready or not llm_client:
        if is_pure_social:
            general_intent = _infer_general_intent(user_message)
            return _get_general_conversation_response(
                client_name, commerce_name, general_intent, user_message
            ), True
        return _get_offline_response(
            client_name, client_email, commerce_name, conversation_history, user_message
        ), True

    # Mode ONLINE : LLM avec historique complet
    try:
        msg_type, msg_reason = classify_message_type(user_message, conversation_history)
        intents = detect_all_intents(user_message, conversation_history)
        intents_label = ", ".join(intents)
        has_business_intent = any(i not in _GENERAL_INTENTS for i in intents)
        has_contextual_business_intent = bool(initial_contextual_intents) or has_business_intent

        if is_pure_social and not has_contextual_business_intent:
            msg_type = "GENERAL"
        elif initial_contextual_intents or is_delivery_issue or has_business_intent:
            msg_type = "BUSINESS"
            if initial_contextual_intents:
                print(f"[CLASSIFY] Relance contextuelle -> BUSINESS : {intents_label}")

        if msg_type == "UNKNOWN":
            if _is_pure_social_intents(intents):
                msg_type = "GENERAL"
                print(f"[CLASSIFY] UNKNOWN resolu en GENERAL : {intents_label}")
            else:
                msg_type = "BUSINESS"
                print(f"[CLASSIFY] UNKNOWN resolu en BUSINESS : {intents_label}")

        # 4. Récupération contexte MongoDB (UNIQUEMENT si BUSINESS)
        if msg_type == "GENERAL":
            full_context = ""
            client_context = "(Message conversationnel — aucune donnee metier requise)"
            print(f"[CLASSIFY] Bypass MongoDB : message final de type GENERAL")
        else:
            full_context = get_client_context_info(client_email, commerce_id)
            if not full_context or not full_context.strip():
                full_context = "Aucune donnee enregistree pour ce client."
            client_context = get_aggregated_context(intents, full_context)

        # 5. Construire le prompt systeme
        sav_instruction = config._SAV_INSTRUCTION if "Plainte SAV" in intents else ""
        format_instruction = _build_format_instruction(user_message)
        if is_followup and not format_instruction:
            format_instruction = (
                "C'est une RELANCE sur le sujet en cours dans l'historique. "
                "Lis l'historique, comprends ce qui a deja ete dit, et reponds differemment "
                "(exemple concret, simplification, pourquoi, une phrase, etc.). "
                "Ne repete JAMAIS mot pour mot une reponse precedente. "
                "Ne recommence JAMAIS par une salutation."
            )
        system_instruction = config.CHATBOT_RESPONSE_PROMPT.format(
            client_name=client_name,
            client_email=client_email,
            commerce_name=commerce_name,
            intents_label=intents_label,
            sav_instruction=sav_instruction,
            format_instruction=format_instruction or "(Aucune contrainte de format particuliere.)",
            client_context=client_context
        )

        # 6. Historique conversationnel (toujours les 8 derniers messages pour le contexte)
        cleaned_contents = []
        recent_history = conversation_history[-8:] if conversation_history else []
        for msg in recent_history:
            text = msg.get("text", "").strip()
            if not text:
                continue
            # Ignorer le message utilisateur en cours s'il est deja dans l'historique
            if msg.get("role") == "user" and text.lower().strip() == user_message.lower().strip():
                continue
            role = "user" if msg.get("role") == "user" else "assistant"
            if not cleaned_contents:
                if role == "user":
                    cleaned_contents.append({"role": role, "text": text})
            else:
                last_msg = cleaned_contents[-1]
                if last_msg["role"] == role:
                    last_msg["text"] += "\n" + text
                else:
                    cleaned_contents.append({"role": role, "text": text})

        # Ajouter le message actuel de l'utilisateur
        if cleaned_contents and cleaned_contents[-1]["role"] == "user":
            cleaned_contents[-1]["text"] += "\n" + user_message
        else:
            cleaned_contents.append({"role": "user", "text": user_message})

        # 7. Generer via le LLM (Groq ou Gemini)
        raw_reply = _llm_chat(system_instruction, cleaned_contents, temperature=0.80)

        # 8. Valider et assainir la reponse avant de l'afficher
        validated_reply = validate_and_sanitize_response(raw_reply, intents, is_followup=is_followup)
        if is_followup and has_contextual_business_intent:
            reply_start = normalize_text(validated_reply[:120])
            if any(reply_start.startswith(w) for w in ["bonjour", "bienvenue", "salut", "hello"]):
                validated_reply = _get_offline_response(
                    client_name,
                    client_email,
                    commerce_name,
                    conversation_history,
                    user_message
                )

        # 9. Logs de debogage complets en console
        try:
            print("\n" + "="*80)
            print(f"=== [LOG DEBOGAGE RETENZA SAV CHATBOT — Provider: {llm_provider}] ===")
            print(f"MESSAGE UTILISATEUR  : '{user_message}'")
            print(f"INTENTIONS DETECTEES : {intents} (Followup: {is_followup})")
            print(f"DONNEES MONGODB      :\n{client_context.strip()}")
            print(f"PROMPT SYSTEME FINAL :\n{system_instruction.strip()}")
            print(f"REPONSE BRUTE LLM    :\n{raw_reply}")
            print(f"REPONSE VALIDE/FILTRE :\n{validated_reply}")
            print("="*80 + "\n")
        except Exception:
            # Ignorer les erreurs d'encodage de la console Windows (ex: emojis)
            pass

        return validated_reply, False

    except Exception as e:
        error_str = str(e)
        if "429" in error_str or "quota" in error_str.lower() or "rate_limit" in error_str.lower():
            print(f"[API_ERROR] Quota LLM ({llm_provider}) dépassé. Bascule automatique sur la FAQ locale de secours.")
        elif "timeout" in error_str.lower() or "deadline" in error_str.lower():
            print(f"[API_ERROR] Timeout de connexion au LLM ({llm_provider}). Bascule automatique sur la FAQ locale de secours.")
        else:
            print(f"[API_ERROR] Erreur inattendue du LLM ({llm_provider}) : {e}. Bascule automatique sur la FAQ locale de secours.")
            
        return _get_offline_response(client_name, client_email, commerce_name, conversation_history, user_message), True
