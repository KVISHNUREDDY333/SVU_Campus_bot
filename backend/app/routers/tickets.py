from datetime import datetime
from typing import List, Optional

from bson import ObjectId
from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from ..core import database
from ..models.user import User
from ..services import notification_service
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
async def create_ticket(
    ticket: TicketCreate, current_user: User = Depends(get_current_user)
):
    if database.tickets_db is None:
        raise HTTPException(status_code=503, detail="Database Unavailable")

    new_ticket = {
        "subject": ticket.subject,
        "description": ticket.description,
        "category": ticket.category,
        "status": "open",
        "created_by": current_user.username,
        "created_at": datetime.utcnow(),
        "resolution": None,
    }

    result = database.tickets_db.insert_one(new_ticket)

    return TicketResponse(id=str(result.inserted_id), **new_ticket)

@router.get("/tickets/my", response_model=List[TicketResponse])
async def get_my_tickets(
    skip: int = 0, limit: int = 20, current_user: User = Depends(get_current_user)
):
    if database.tickets_db is None:
        return []

    cursor = (
        database.tickets_db.find({"created_by": current_user.username})
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )
    return [TicketResponse(id=str(t["_id"]), **t) for t in cursor]

@router.get("/admin/tickets", response_model=List[TicketResponse])
async def get_all_tickets(
    skip: int = 0, limit: int = 50, current_user: User = Depends(get_current_user)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    if database.tickets_db is None:
        return []

    cursor = database.tickets_db.find().sort("created_at", -1).skip(skip).limit(limit)
    return [TicketResponse(id=str(t["_id"]), **t) for t in cursor]

class TicketUpdate(BaseModel):
    status: str
    resolution: Optional[str] = None
    save_as_faq: bool = False

@router.put("/admin/tickets/{ticket_id}")
async def resolve_ticket(
    ticket_id: str, update: TicketUpdate, current_user: User = Depends(get_current_user)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    try:
        ticket = database.tickets_db.find_one({"_id": ObjectId(ticket_id)})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")

        database.tickets_db.update_one(
            {"_id": ObjectId(ticket_id)},
            {"$set": {"status": update.status, "resolution": update.resolution}},
        )

        if update.save_as_faq and update.resolution:
            try:
                from ..services.rag_service import ingest_faq

                faq_id = str(ObjectId())
                await ingest_faq(
                    question=ticket["subject"],
                    answer=update.resolution,
                    source="ticket_resolution",
                    faq_id=faq_id,
                )
                                                     
                if database.svu_vectors_db is not None:
                    database.svu_vectors_db.update_one(
                        (
                            {"metadata.faq_id": faq_id}
                            if not ObjectId.is_valid(faq_id)
                            else {"_id": ObjectId(faq_id)}
                        ),
                        {
                            "$set": {
                                "type": "faq",
                                "category": ticket.get("category", "General"),
                                "created_at": datetime.utcnow(),
                            }
                        },
                    )
            except Exception as e:
                print(f"Error saving ticket as FAQ to svu_vectors: {e}")

        owner = ticket.get("created_by")
        if owner:
            await notification_service.create_notification(
                title=f"Ticket {update.status.capitalize()}",
                message=f"Your ticket '{ticket.get('subject')[:30]}...' is now '{update.status}'.",
                user_id=owner,
                notification_type="personal",
            )

        return {"status": "success"}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid ID: {str(e)}")

@router.delete("/tickets/{ticket_id}")
async def delete_ticket(ticket_id: str, current_user: User = Depends(get_current_user)):
    if database.tickets_db is None:
        raise HTTPException(status_code=503, detail="Database Unavailable")

    try:
        if not ObjectId.is_valid(ticket_id):
            raise HTTPException(status_code=400, detail="Invalid Ticket ID")

        ticket = database.tickets_db.find_one({"_id": ObjectId(ticket_id)})
        if not ticket:
            raise HTTPException(status_code=404, detail="Ticket not found")

        if current_user.role != "admin":
            raise HTTPException(
                status_code=403, detail="Only admins can delete tickets"
            )

        database.tickets_db.delete_one({"_id": ObjectId(ticket_id)})
        return {"status": "success", "message": "Ticket deleted successfully"}
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Delete Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@router.delete("/admin/tickets/delete/closed")
async def delete_all_closed_tickets(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    if database.tickets_db is None:
        raise HTTPException(status_code=503, detail="Database Unavailable")

    try:
        result = database.tickets_db.delete_many({"status": "closed"})
        return {
            "status": "success",
            "message": f"Deleted {result.deleted_count} closed tickets",
        }
    except Exception as e:
        print(f"Bulk Delete Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
