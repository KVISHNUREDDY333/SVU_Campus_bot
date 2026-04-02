from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from ..core import database
from ..models.user import User
from .auth import get_current_user
from ..services import notification_service, rag_service


router = APIRouter()

class CalendarEvent(BaseModel):
    title: str
    from_date: str  # ISO datetime: YYYY-MM-DDTHH:mm
    to_date: str    # ISO datetime: YYYY-MM-DDTHH:mm
    type: str  # Exam, Holiday, Event
    location: Optional[str] = ""
    description: Optional[str] = ""

class CalendarResponse(CalendarEvent):
    id: str

@router.get("/calendar", response_model=List[CalendarResponse])
async def get_calendar(
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    if database.calendar_db is None:
        return []
    
    cursor = database.calendar_db.find().sort("from_date", 1).skip(skip).limit(limit)
    results = []
    for e in cursor:
        e["id"] = str(e["_id"])
        if "from_date" not in e:
            e["from_date"] = e.get("date", "")
        if "to_date" not in e:
            e["to_date"] = e.get("date", "")
        results.append(CalendarResponse(**e))
    return results

@router.get("/admin/calendar", response_model=List[CalendarResponse])
async def get_admin_calendar(current_user: User = Depends(get_current_user)):
    if database.calendar_db is None:
        return []
        
    cursor = database.calendar_db.find().sort("from_date", 1)
    results = []
    for e in cursor:
        e["id"] = str(e["_id"])
        if "from_date" not in e:
            e["from_date"] = e.get("date", "")
        if "to_date" not in e:
            e["to_date"] = e.get("date", "")
        results.append(CalendarResponse(**e))
    return results

@router.post("/admin/calendar", response_model=CalendarResponse)
async def add_calendar_event(event: CalendarEvent, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    event_dict = event.model_dump()
    res = database.calendar_db.insert_one(event_dict)
    event_dict["id"] = str(res.inserted_id)
    
    # Trigger RAG ingestion
    await rag_service.ingest_calendar_event(
        event_id=event_dict["id"],
        title=event.title,
        from_date=event.from_date,
        to_date=event.to_date,
        event_type=event.type,
        location=event.location,
        description=event.description
    )

    # Restore notification
    await notification_service.create_notification(
        title="Calendar Update",
        message=f"New {event.type} '{event.title}' added to the calendar.",
        notification_type="common"
    )

    return CalendarResponse(**event_dict)

@router.put("/admin/calendar/{event_id}", response_model=CalendarResponse)
async def update_calendar_event(event_id: str, event: CalendarEvent, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        from bson import ObjectId
        event_dict = event.model_dump()
        result = database.calendar_db.update_one(
            {"_id": ObjectId(event_id)},
            {"$set": event_dict}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
        
        # Trigger RAG ingestion (update)
        await rag_service.ingest_calendar_event(
            event_id=event_id,
            title=event.title,
            from_date=event.from_date,
            to_date=event.to_date,
            event_type=event.type,
            location=event.location,
            description=event.description
        )
        
        # Restore notification
        await notification_service.create_notification(
            title="Calendar Update",
            message=f"Academic event '{event.title}' has been updated.",
            notification_type="common"
        )
        
        event_dict["id"] = event_id
        return CalendarResponse(**event_dict)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid Event ID: {str(e)}")

@router.delete("/admin/calendar/{event_id}")
async def delete_calendar_event(event_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    try:
        from bson import ObjectId
        result = database.calendar_db.delete_one({"_id": ObjectId(event_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="Event not found")
            
        # Remove from RAG
        await rag_service.remove_calendar_event(event_id)
            
        # Restore notification
        await notification_service.create_notification(
            title="Calendar Update",
            message=f"An event has been removed from the academic calendar.",
            notification_type="common"
        )
            
        return {"status": "success", "message": "Event deleted"}
    except:
        raise HTTPException(status_code=400, detail="Invalid Event ID")
