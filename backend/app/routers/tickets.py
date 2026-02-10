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
    
    # Notify All Admins
    from .admin import _add_notification
    await _add_notification(
        "New Support Ticket", 
        f"A new ticket has been raised: {new_ticket['subject']}",
        recipient_role="admin"
    )
    
    return TicketResponse(
        id=str(result.inserted_id),
        **new_ticket
    )

@router.get("/tickets/my", response_model=List[TicketResponse])
async def get_my_tickets(
    skip: int = 0,
    limit: int = 20,
    current_user: User = Depends(get_current_user)
):
    if database.tickets_db is None: return []
    
    cursor = database.tickets_db.find({"created_by": current_user.username}).sort("created_at", -1).skip(skip).limit(limit)
    return [TicketResponse(id=str(t["_id"]), **t) for t in cursor]

# Admin: Get All Tickets
@router.get("/admin/tickets", response_model=List[TicketResponse])
async def get_all_tickets(
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    if database.tickets_db is None: return []
    
    cursor = database.tickets_db.find().sort("created_at", -1).skip(skip).limit(limit)
    return [TicketResponse(id=str(t["_id"]), **t) for t in cursor]

class TicketUpdate(BaseModel):
    status: str
    resolution: Optional[str] = None
    save_as_faq: bool = False

@router.put("/admin/tickets/{ticket_id}")
async def resolve_ticket(ticket_id: str, update: TicketUpdate, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    try:
        # Get ticket to find the creator
        ticket = database.tickets_db.find_one({"_id": ObjectId(ticket_id)})
        if not ticket:
             raise HTTPException(status_code=404, detail="Ticket not found")

        database.tickets_db.update_one(
            {"_id": ObjectId(ticket_id)},
            {"$set": {"status": update.status, "resolution": update.resolution}}
        )

        if update.save_as_faq and update.resolution:
             new_faq = {
                "question": ticket['subject'],
                "answer": update.resolution,
                "category": ticket.get('category', 'General'),
                "created_at": datetime.utcnow(),
                "source": "ticket_resolution"
             }
             if database.faqs_db is not None:
                 result = database.faqs_db.insert_one(new_faq)
                 
                 # Sync with Vector DB for RAG
                 try:
                     from ..services.rag_service import rag_service
                     faq_text = f"Question: {new_faq['question']}\nAnswer: {new_faq['answer']}"
                     rag_service.add_document(
                         faq_text, 
                         metadata={"id": str(result.inserted_id), "type": "faq", "category": new_faq['category']}
                     )
                 except Exception as e:
                     print(f"RAG Sync Error: {e}")

        # Notify the user who created the ticket
        from .admin import _add_notification
        await _add_notification(
            "Ticket Updated", 
            f"Your ticket '{ticket['subject']}' status is now: {update.status}",
            recipient_username=ticket.get("created_by")
        )

        return {"status": "success"}
    except:
        raise HTTPException(status_code=400, detail="Invalid ID")

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

        # Only Admin can delete tickets
        if current_user.role != "admin":
            raise HTTPException(status_code=403, detail="Only admins can delete tickets")

        # For non-admins, ensure ticket is closed? (Optional based on requirements, but safer)
        # The prompt says "delete button should be visible for closed tickets".
        
        database.tickets_db.delete_one({"_id": ObjectId(ticket_id)})
        return {"status": "success", "message": "Ticket deleted successfully"}
    except HTTPException as he:
        raise he
    except Exception as e:
        print(f"Delete Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error")
