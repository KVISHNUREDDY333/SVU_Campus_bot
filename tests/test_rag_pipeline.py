import sys
import os
import asyncio
import logging

# Add project root to sys.path
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(project_root)

# Mock environment variables if needed (though they should be loaded by config)
# os.environ["GROQ_API_KEY"] = "..." 

from backend.app.services.rag_service import setup_rag_chain, generate_response, get_session_history
from backend.app.core.database import get_db_client, close_db_client

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("test_rag")

async def test_rag_pipeline():
    logger.info("Starting RAG Pipeline Test...")
    
    # 1. Initialize DB
    get_db_client()
    
    # 2. Setup RAG
    setup_rag_chain()
    
    session_id = "test_user_session_123"
    
    # 3. Test Conversation Flow
    questions = [
        "What are the library timings?",
        "Is it open on Sundays?",
        "Tell me about the CSE department.",
        "Who is the HOD?",
        "What did I ask you first?" # Test memory
    ]
    
    for i, q in enumerate(questions):
        logger.info(f"\n--- Turn {i+1}: User: {q} ---")
        try:
            response = await generate_response(
                message=q,
                session_id=session_id,
                user_role="student",
                current_time="Wednesday, 10:00 AM"
            )
            logger.info(f"Bot: {response[:100]}...") # Log first 100 chars
        except Exception as e:
            logger.error(f"Error in turn {i+1}: {e}")
            
    # 4. Check History Retention
    history = get_session_history(session_id)
    messages = history.messages
    logger.info(f"\nTotal Messages in History: {len(messages)}")
    if len(messages) >= len(questions) * 2:
        logger.info("PASS: History retained correctly.")
    else:
        logger.warning(f"FAIL: History count mismatch. Expected >={len(questions)*2}, Got {len(messages)}")

    close_db_client()

if __name__ == "__main__":
    asyncio.run(test_rag_pipeline())
