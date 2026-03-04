from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv("c:/SVU_Campus_bot/.env")
MONGO_URI = os.getenv("MONGODB_URI")
client = MongoClient(MONGO_URI)
db = client["svu_chatbot"]

print("Documents in 'documents' collection:", db.documents.count_documents({}))
print("Vectors in 'svu_vectors' collection:", db.svu_vectors.count_documents({}))
