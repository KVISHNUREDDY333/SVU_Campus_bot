import asyncio
from backend.main import setup_rag_chain
from backend.app.services.rag_service import vector_db, _search_keywords_directly
from backend.app.core import database
from backend.app.core.config import Config
from pymongo import MongoClient
import os
from dotenv import load_dotenv

load_dotenv("c:/SVU_Campus_bot/.env")
MONGO_URI = os.getenv("MONGODB_URI")
database.mongo_client = MongoClient(MONGO_URI)
database.svu_vectors_db = database.mongo_client[Config.DB_NAME][Config.COLLECTION_NAME]

import backend.app.services.rag_service as rag_service

rag_service.setup_rag_chain()

def test_retrieval():
    query = "who is the vc"
    print(f"\n--- Testing Query: '{query}' ---")
    
    print("\n--- 1. Testing Raw Vector Similarity Scores ---")
    if rag_service.vector_db:
        results = rag_service.vector_db.similarity_search_with_score(query, k=5)
        for i, (doc, score) in enumerate(results):
            content = doc.page_content.replace('\n', ' ')[:100]
            print(f"[{i+1}] Score: {score:.4f} | Content: {content}...")
    else:
        print("Vector DB not initialized.")
        
    print("\n--- 2. Testing Keyword Search Regex ---")
    keyword_results = _search_keywords_directly(query)
    print(f"Keyword Search Output:\n{keyword_results}")

test_retrieval()
