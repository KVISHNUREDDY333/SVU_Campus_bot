from fastapi import APIRouter, Depends, HTTPException
from typing import List, Optional
from pydantic import BaseModel
from datetime import datetime
from bson import ObjectId
from ..core import database
from ..models.user import User
from .auth import get_current_user

router = APIRouter()

class TicketCreate(BaseModel):
    subject: str
    description: str
    category: Optional[str] = "General"

class TicketResponse(BaseModel):
    id: str
    subject: str
    description: str
    category: str
    status: str
    created_by: str
    created_at: datetime
    resolution: Optional[str] = None

@router.post("/tickets", response_model=TicketResponse)
async def create_ticket(ticket: TicketCreate, current_user: User = Depends(get_current_user)):
    if database.tickets_db is None:
        raise HTTPException(status_code=503, detail="Database Unavailable")
        
    new_ticket = {
        "subject": ticket.subject,
        "description": ticket.description,
        "category": ticket.category,
        "status": "open",
        "created_by": current_user.username,
        "created_at": datetime.utcnow(),
        "resolution": None
    }
    
    result = database.tickets_db.insert_one(new_ticket)
    
    return TicketResponse(
        id=str(result.inserted_id),
        **new_ticket
    )

@router.get("/tickets/my", response_model=List[TicketResponse])
async def get_my_tickets(current_user: User = Depends(get_current_user)):
    if database.tickets_db is None: return []
    
    cursor = database.tickets_db.find({"created_by": current_user.username}).sort("created_at", -1)
    return [TicketResponse(id=str(t["_id"]), **t) for t in cursor]

# Admin: Get All Tickets
@router.get("/admin/tickets", response_model=List[TicketResponse])
async def get_all_tickets(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    if database.tickets_db is None: return []
    
    cursor = database.tickets_db.find().sort("created_at", -1)
    return [TicketResponse(id=str(t["_id"]), **t) for t in cursor]

class TicketUpdate(BaseModel):
    status: str
    resolution: Optional[str] = None

@router.put("/admin/tickets/{ticket_id}")
async def resolve_ticket(ticket_id: str, update: TicketUpdate, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    try:
        database.tickets_db.update_one(
            {"_id": ObjectId(ticket_id)},
            {"$set": {"status": update.status, "resolution": update.resolution}}
        )
        return {"status": "success"}
    except:
        raise HTTPException(status_code=400, detail="Invalid ID")
