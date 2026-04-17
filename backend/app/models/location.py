from datetime import datetime
from typing import Optional

from pydantic import BaseModel, Field


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
