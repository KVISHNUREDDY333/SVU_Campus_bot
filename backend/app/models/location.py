from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime

class LocationModel(BaseModel):
    name: str
    category: str
    description: Optional[str] = None
    created_at: datetime = Field(default_factory=datetime.utcnow)

class LocationResponse(LocationModel):
    id: str

class LocationUpdate(BaseModel):
    name: Optional[str] = None
    category: Optional[str] = None
    description: Optional[str] = None
