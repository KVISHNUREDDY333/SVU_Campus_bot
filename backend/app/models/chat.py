from typing import Optional

from pydantic import BaseModel

class ChatRequest(BaseModel):
    message: str
    session_id: str

    language: Optional[str] = "en"

class FeedbackRequest(BaseModel):
    message: str
    response: str
    rating: int                         
    comment: Optional[str] = None
