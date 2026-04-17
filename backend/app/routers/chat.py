import logging
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException

from ..core import database
from ..models.chat import ChatRequest, FeedbackRequest
from ..models.user import User
from ..services.moderation import ModerationService
from ..services.rag_service import generate_response
from .auth import get_current_user

router = APIRouter(prefix="/chat", tags=["Chat"])
logger = logging.getLogger("uvicorn")


@router.post("")
async def chat_endpoint(
    request: ChatRequest, current_user: User = Depends(get_current_user)
):
    try:
        # Check content restrictions
        if not await ModerationService.check_content(request.message):
            return {
                "status": "success",
                "response": ModerationService.get_rejection_message(),
            }

        start_time = datetime.now()
        current_time_str = start_time.strftime("%A, %b %d, %Y at %I:%M %p")

        response_text = await generate_response(
            message=request.message,
            session_id=request.session_id,
            user_role=current_user.role,
            current_time=current_time_str,
            language=request.language,
        )

        if database.analytics_db is not None:
            database.analytics_db.insert_one(
                {
                    "timestamp": datetime.utcnow(),
                    "role": current_user.role,
                    "user_id": str(current_user.username),
                    "topic": "general",
                    "question": request.message,
                    "response": response_text,
                    "length": len(request.message),
                    "sentiment": "Neutral",  # Default to Neutral
                    "rating": 0,
                    "latency_ms": int(
                        (datetime.now() - start_time).total_seconds() * 1000
                    ),
                }
            )

        return {"status": "success", "response": response_text}
    except Exception as e:
        logger.error(f"Chat Error: {e}")
        return {"status": "error", "error": f"Processing error: {str(e)}"}


@router.post("/feedback")
async def chat_feedback(
    req: FeedbackRequest, current_user: User = Depends(get_current_user)
):
    try:
        if database.analytics_db is not None:
            sentiment = "Neutral"
            if req.rating == 1:
                sentiment = "Positive"
            elif req.rating == -1:
                sentiment = "Negative"

            res = database.analytics_db.find_one_and_update(
                {
                    "user_id": str(current_user.username),
                    "question": req.message,
                    "response": req.response,
                },
                {
                    "$set": {
                        "sentiment": sentiment,
                        "rating": req.rating,
                        "comment": req.comment,
                        "feedback_timestamp": datetime.utcnow(),
                    }
                },
                sort=[("timestamp", -1)],  # Target newest if multiple identical
            )

            if not res:

                database.analytics_db.insert_one(
                    {
                        "timestamp": datetime.utcnow(),
                        "role": current_user.role,
                        "user_id": str(current_user.username),
                        "question": req.message,
                        "response": req.response,
                        "sentiment": sentiment,
                        "rating": req.rating,
                        "comment": req.comment,
                        "is_direct_feedback": True,
                    }
                )

        return {"status": "success", "message": "Feedback processed"}

    except Exception as e:
        logger.error(f"Feedback Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to save feedback")
