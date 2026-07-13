import os
import sys
sys.path.insert(0, '.')
import chatbot_config as config
from pymongo import MongoClient

def migrate():
    print("Migration des anciennes conversations vers le nouveau schema session_id...")
    client = MongoClient(config.MONGO_URI)
    db = client[config.DB_NAME]
    
    # Trouver toutes les conversations qui n'ont pas de session_id
    cursor = db.chatbot_conversations.find({"session_id": {"$exists": False}})
    count = 0
    for conv in cursor:
        title = "Ancienne conversation"
        if "messages" in conv and len(conv["messages"]) > 0:
            first_user_msg = next((m for m in conv["messages"] if m["role"] == "user"), None)
            if first_user_msg:
                words = first_user_msg["text"].split()
                if len(words) > 5:
                    title = " ".join(words[:5]) + "..."
                else:
                    title = " ".join(words)
        
        db.chatbot_conversations.update_one(
            {"_id": conv["_id"]},
            {"$set": {
                "session_id": "default",
                "title": title,
                "updated_at": conv.get("messages", [{}])[-1].get("timestamp", "") if conv.get("messages") else ""
            }}
        )
        count += 1
    
    print(f"Migration terminee : {count} documents mis a jour.")

if __name__ == "__main__":
    migrate()
