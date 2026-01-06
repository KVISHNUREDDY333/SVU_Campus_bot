from fastapi import APIRouter, Depends, HTTPException
from ..models.chat import ChatRequest
from ..models.user import User
from ..services.rag_service import generate_response
from .auth import get_current_user
from ..core import database
import logging
from datetime import datetime

router = APIRouter()
logger = logging.getLogger("uvicorn")

@router.post("/chat")
async def chat_endpoint(request: ChatRequest, current_user: User = Depends(get_current_user)):
    try:
        current_time_str = datetime.now().strftime("%A, %b %d, %Y at %I:%M %p")
        
        response_text = await generate_response(
            message=request.message,
            session_id=request.session_id,
            user_role=current_user.role,
            incognito=request.incognito,
            current_time=current_time_str,
            language=request.language
        )
        
        # Analytics Logging
        if not request.incognito and database.analytics_db is not None:
             # Simple sentiment heuristic
             pos_words = ['thank', 'good', 'great', 'wow', 'help', 'awesome', 'best']
             neg_words = ['bad', 'wrong', 'error', 'fail', 'stupid', 'hate', 'useless', 'no']
             
             sentiment = "Neutral"
             msg_lower = request.message.lower()
             if any(w in msg_lower for w in neg_words): sentiment = "Negative"
             elif any(w in msg_lower for w in pos_words): sentiment = "Positive"

             database.analytics_db.insert_one({
                "timestamp": datetime.utcnow(),
                "role": current_user.role,
                "user_id": str(current_user.username),
                "topic": "general",
                "question": request.message,
                "response": response_text,
                "length": len(request.message),
                "sentiment": sentiment
            })
             
        return {"status": "success", "response": response_text}
    except Exception as e:
        logger.error(f"Chat Error: {e}")
        return {"status": "error", "error": "Processing error"}
