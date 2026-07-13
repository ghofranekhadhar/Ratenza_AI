import chatbot_config as config
from pymongo import MongoClient

email = 'ghofrane.khadarr@gmail.com'

client = MongoClient(config.MONGO_URI)
db = client[config.DB_NAME]

avant = db.chatbot_status.find_one({"email": email.lower()})
if not avant:
    print("Compte non trouve en base.")
    exit()

print(f"AVANT  -> warnings={avant.get('warnings')}, is_blocked={avant.get('is_blocked')}, reason={avant.get('block_reason')}")

result = db.chatbot_status.update_one(
    {"email": email.lower()},
    {"$set": {
        "warnings": 0,
        "is_blocked": False,
        "blocked_at": None,
        "block_reason": None,
        "warnings_history": []
    }}
)

apres = db.chatbot_status.find_one({"email": email.lower()})
print(f"APRES  -> warnings={apres.get('warnings')}, is_blocked={apres.get('is_blocked')}")
print(f"Documents modifies : {result.modified_count}")
if result.modified_count == 1:
    print("✅ Compte débloqué avec succès.")
else:
    print("⚠️ Aucune modification effectuée.")
