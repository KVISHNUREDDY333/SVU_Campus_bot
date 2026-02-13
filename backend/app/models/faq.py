from pydantic import BaseModel
from datetime import datetime
from typing import Optional, List


class FAQRequest(BaseModel):
    question: str
    answer: str
    category: str = "General"

class FAQModel(BaseModel):
    question: str
    answer: str
    category: str = "General"
    keywords: List[str] = []
    source_type: List[str] = ["manual"] # ["pdf", "website", "manual"]
    source_urls: List[str] = []
    verified: bool = False
    verification_status: str = "PENDING" # VERIFIED, PARTIALLY_VERIFIED, NOT_VERIFIED, PENDING
    verification_source: str = "https://svuniversity.edu.in/"
    last_verified: Optional[datetime] = None
    confidence_score: float = 0.0

class FAQResponse(FAQModel):
    id: str
    created_at: datetime
    # Inherits new fields automatically

class SuggestedFAQModel(BaseModel):
    question: str
    answer: str
    category: str = "General"
    suggested_by: str
    timestamp: datetime = datetime.utcnow()

class SuggestedFAQResponse(SuggestedFAQModel):
    id: str

class Notification(BaseModel):
    id: int
    title: str
    message: str
    timestamp: datetime
    read: bool = False
    recipient_username: Optional[str] = None
    recipient_role: Optional[str] = None
