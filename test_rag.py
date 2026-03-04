import asyncio
from backend.main import setup_rag_chain
from backend.app.services.rag_service import generate_response
from backend.app.core import database
from backend.app.core.config import Config
from pymongo import MongoClient
import os
from dotenv import load_dotenv
from datetime import datetime

load_dotenv("c:/SVU_Campus_bot/.env")
MONGO_URI = os.getenv("MONGODB_URI")
database.mongo_client = MongoClient(MONGO_URI)

# init RAG
setup_rag_chain()

async def test_rag():
    print("Testing RAG...")
    response = await generate_response(
        message="What are the library timings?",
        session_id="test_session_123",
        user_role="student",
        current_time=datetime.now().strftime("%A, %b %d, %Y at %I:%M %p"),
        language="English"
    )
    print("\n--- RAG Response ---")
    print(response)
    print("--------------------")

asyncio.run(test_rag())
