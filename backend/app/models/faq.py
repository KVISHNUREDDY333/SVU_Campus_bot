from pydantic import BaseModel
from datetime import datetime
from typing import Optional

class FAQModel(BaseModel):
    question: str
    answer: str
    category: str = "General"

class FAQResponse(FAQModel):
    id: str
    created_at: datetime

class Notification(BaseModel):
    id: int
    title: str
    message: str
    timestamp: datetime
    read: bool = False
