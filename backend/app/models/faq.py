from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

class FAQRequest(BaseModel):
    question: str
    answer: str
    category: str = "General"

class FAQModel(BaseModel):
    question: str
    answer: str
    category: str = "General"
    keywords: List[str] = []
    source_type: List[str] = ["manual"]                                
    source_urls: List[str] = []
    verified: bool = False
    verification_status: str = (
        "PENDING"                                                       
    )
    verification_source: str = "https://svuniversity.edu.in/"
    last_verified: Optional[datetime] = None
    confidence_score: float = 0.0

class FAQResponse(FAQModel):
    id: str
    created_at: datetime
    source_urls: List[str] = []
    verified: bool = False

class SuggestedFAQModel(BaseModel):
    question: str
    answer: str
    category: str = "General"
    suggested_by: str
    timestamp: datetime = datetime.utcnow()

class SuggestedFAQResponse(SuggestedFAQModel):
    id: str
