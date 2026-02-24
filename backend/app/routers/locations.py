from fastapi import APIRouter, Depends, HTTPException
from typing import List
from ..core import database
from ..models.location import LocationResponse
from ..models.user import User
from .auth import get_current_user
from datetime import datetime

router = APIRouter(
    prefix="/locations",
    tags=["locations"]
)

@router.get("/", response_model=List[LocationResponse])
async def get_all_locations(current_user: User = Depends(get_current_user)):
    """
    Public endpoint to fetch all university locations.
    Accessible to all authenticated users (students and admins).
    """
    if database.locations_db is None:
        return []
    
    cursor = database.locations_db.find().sort("name", 1)
    results = []
    for loc in cursor:
        results.append(LocationResponse(
            id=str(loc["_id"]),
            name=loc["name"],
            category=loc["category"],
            description=loc.get("description"),
            created_at=loc.get("created_at", datetime.utcnow())
        ))
    return results
