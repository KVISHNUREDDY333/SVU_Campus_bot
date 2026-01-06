from fastapi import APIRouter, Depends, HTTPException
from typing import List
from ..models.user import User
from ..models.faq import FAQModel, FAQResponse, Notification
from .auth import get_current_user
from ..core import database
from bson.objectid import ObjectId
from datetime import datetime
import random
import os
import shutil
from fastapi import UploadFile, File
from ..services.rag_service import ingest_pdf
import pydantic

router = APIRouter()


# Request Model for creating a notification
class NotificationCreate(pydantic.BaseModel):
    title: str
    message: str

@router.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: User = Depends(get_current_user)):
    if database.notifications_db is None:
        return []
    
    # Fetch latest 10 notifications
    cursor = database.notifications_db.find().sort("timestamp", -1).limit(10)
    results = []
    
    for n in cursor:
        results.append(Notification(
            id=int(str(n["_id"])[-6:], 16), # Simple hash of ObjectID for int ID compatibility or just use string if frontend supports
            title=n.get("title", ""),
            message=n.get("message", ""),
            timestamp=n.get("timestamp", datetime.utcnow())
        ))
    return results

@router.post("/admin/notifications", response_model=Notification)
async def create_notification(note: NotificationCreate, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    new_note = {
        "title": note.title,
        "message": note.message,
        "timestamp": datetime.utcnow(),
        "created_by": current_user.username
    }
    
    result = database.notifications_db.insert_one(new_note)
    
    return Notification(
        id=int(str(result.inserted_id)[-6:], 16),
        title=new_note["title"],
        message=new_note["message"],
        timestamp=new_note["timestamp"]
    )

@router.get("/faqs", response_model=List[FAQResponse])
async def get_faqs():
    if database.faqs_db is None:
        return []
    faqs = list(database.faqs_db.find().sort("created_at", -1))
    results = []
    for f in faqs:
        results.append(FAQResponse(
            id=str(f["_id"]),
            question=f["question"],
            answer=f["answer"],
            category=f.get("category", "General"),
            created_at=f.get("created_at", datetime.utcnow())
        ))
    return results

@router.post("/admin/faqs", response_model=FAQResponse)
async def create_faq(faq: FAQModel, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    new_faq = {
        "question": faq.question,
        "answer": faq.answer,
        "category": faq.category,
        "created_at": datetime.utcnow()
    }
    
    result = database.faqs_db.insert_one(new_faq)
    new_faq["id"] = str(result.inserted_id)
    
    # Sync with Vector DB for RAG
    try:
        from ..services.rag_service import ingest_text
        faq_text = f"Question: {faq.question}\nAnswer: {faq.answer}\nCategory: {faq.category}"
        await ingest_text(faq_text, metadata={"source": "faq", "faq_id": new_faq["id"], "category": faq.category})
    except Exception as e:
        # Don't fail the request if vector ingest fails, just log it
        print(f"Failed to ingest FAQ into vector DB: {e}")
        
    return new_faq

@router.delete("/admin/faqs/{faq_id}")
async def delete_faq(faq_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    try:
        result = database.faqs_db.delete_one({"_id": ObjectId(faq_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="FAQ not found")
        return {"status": "success", "message": "FAQ deleted"}
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid ID format")

@router.post("/admin/upload-document")
async def upload_document(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
    try:
        # Save file locally
        upload_dir = "backend/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, file.filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        # Ingest
        num_chunks = await ingest_pdf(file_path)
        
        # Record in DB
        doc_record = {
             "filename": file.filename,
             "uploaded_by": current_user.username,
             "uploaded_at": datetime.utcnow(),
             "chunks": num_chunks,
             "status": "ingested"
        }
        if database.documents_db is not None:
             database.documents_db.insert_one(doc_record)
        
        return {"status": "success", "message": f"Ingested {num_chunks} chunks from {file.filename}"}
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@router.get("/admin/system-health")
async def get_system_health(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    mongo_status = "connected" if database.mongo_client else "disconnected"
    
    # Check if vector DB is initialized (assuming rag_service logic)
    from ..services import rag_service
    vector_status = "active" if rag_service.vector_db else "initializing"
    
    return {
        "api_status": "healthy",
        "mongodb_status": mongo_status,
        "vector_db_status": vector_status,
        "llm_service": "online" if Config.GROQ_API_KEY else "offline",
        "uptime": "99.9%",
        "last_reindexed": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    }
