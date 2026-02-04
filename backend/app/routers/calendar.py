from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from ..core import database
from ..models.user import User
from .auth import get_current_user

router = APIRouter()

class CalendarEvent(BaseModel):
    title: str
    date: str  # YYYY-MM-DD
    type: str  # Exam, Holiday, Event
    description: Optional[str] = ""

class CalendarResponse(CalendarEvent):
    id: str

@router.get("/calendar", response_model=List[CalendarResponse])
async def get_calendar(current_user: User = Depends(get_current_user)):
    if database.calendar_db is None:
        return []
    
    cursor = database.calendar_db.find().sort("date", 1)
    results = []
    for e in cursor:
        e["id"] = str(e["_id"])
        results.append(CalendarResponse(**e))
    return results

@router.post("/admin/calendar", response_model=CalendarEvent)
async def add_calendar_event(event: CalendarEvent, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    database.calendar_db.insert_one(event.dict())
    
    # Send Global Notification
    from .admin import _add_notification
    await _add_notification(
        "New Calendar Event", 
        f"A new event has been added: {event.title} on {event.date}",
        recipient_username=None
    )
    return event

@router.delete("/admin/calendar/{event_id}")
async def delete_calendar_event(event_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        from bson import ObjectId
        result = database.calendar_db.delete_one({"_id": ObjectId(event_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
        return {"status": "success", "message": "Event deleted"}
    except:
        raise HTTPException(status_code=400, detail="Invalid Event ID")
