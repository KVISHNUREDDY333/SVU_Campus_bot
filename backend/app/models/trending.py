from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field

class TrendingQueryModel(BaseModel):
    text: str
    subtext: str
    icon: str                                                         
    response: Optional[str] = None
    link: Optional[str] = None
    order: int = 0
    created_at: datetime = Field(default_factory=datetime.utcnow)

class TrendingQueryResponse(TrendingQueryModel):
    id: str

class TrendingQueryUpdate(BaseModel):
    text: Optional[str] = None
    subtext: Optional[str] = None
    icon: Optional[str] = None
    response: Optional[str] = None
    link: Optional[str] = None
    order: Optional[int] = None
