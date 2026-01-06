import asyncio
import os
import sys

# Add project root
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.services.rag_service import setup_rag_chain, generate_response
from backend.app.core import database

async def test_rag():
    print("Connecting DB...")
    database.get_db_client()
    
    print("Setting up RAG...")
    setup_rag_chain()
    
    print("Invoking RAG...")
    try:
        response = await generate_response(
            message="What courses does SVU offer?",
            session_id="test_session",
            user_role="student",
            incognito=False,
            current_time="Tuesday 12:00 PM"
        )
        print(f"Response: {response}")
    except Exception as e:
        print(f"RAG Error: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    asyncio.run(test_rag())
