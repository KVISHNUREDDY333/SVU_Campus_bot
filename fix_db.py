from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv("c:/SVU_Campus_bot/.env")

MONGO_URI = os.getenv("MONGODB_URI", "mongodb+srv://vishnukamasani3_db_user:Et7GaiM2SVidS6DH@cluster0.vfi8dom.mongodb.net/?appName=Cluster0")
client = MongoClient(MONGO_URI)
db = client["svu_chatbot"]

print("Finding users without username...")
invalid_users = list(db.users.find({"username": {"$in": [None, ""]}}))
print(f"Found {len(invalid_users)} invalid users")

for u in invalid_users:
    print(u)
    
print("Deleting them...")
res = db.users.delete_many({"username": {"$in": [None, ""]}})
print(f"Deleted {res.deleted_count} documents.")

# Also check for documents where username field does not exist
print("Finding users with missing username field...")
missing_field_users = list(db.users.find({"username": {"$exists": False}}))
print(f"Found {len(missing_field_users)} users missing username field")

for u in missing_field_users:
    print(u)
    
print("Deleting them...")
res = db.users.delete_many({"username": {"$exists": False}})
print(f"Deleted {res.deleted_count} documents.")

print("Trying to create index manually...")
try:
    db.users.create_index("username", unique=True)
    print("Index created successfully!")
except Exception as e:
    print(f"Error: {e}")
