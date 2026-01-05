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

router = APIRouter()

# Mock Notifications Data
mock_notifications = [
    Notification(id=1, title="Exam Schedule", message="Semester 4 exams start next Monday.", timestamp=datetime.utcnow()),
    Notification(id=2, title="Library Alert", message="Library will be closed this Sunday for maintenance.", timestamp=datetime.utcnow()),
]

@router.get("/dashboard-stats")
async def get_dashboard_stats(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.analytics_db is None:
         return {"total_queries": 0, "role_distribution": {}, "active_users": 0}

    total_queries = database.analytics_db.count_documents({})
    
    pipeline = [
        {"$group": {"_id": "$role", "count": {"$sum": 1}}}
    ]
    role_distribution = list(database.analytics_db.aggregate(pipeline))
    roles = {item['_id']: item['count'] for item in role_distribution}
    
    return {
        "total_queries": total_queries,
        "role_distribution": roles,
        "active_users": database.users_db.count_documents({})
    }

@router.get("/admin/users")
async def list_users(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    users = list(database.users_db.find({}, {"username": 1, "role": 1, "created_at": 1}))
    for u in users: u["_id"] = str(u["_id"])
    return users

@router.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: User = Depends(get_current_user)):
    if random.random() > 0.8:
        new_id = len(mock_notifications) + 1
        mock_notifications.append(Notification(
            id=new_id, 
            title="Update", 
            message=f"New announcement #{new_id}: Please check the notice board.", 
            timestamp=datetime.utcnow()
        ))
    return sorted(mock_notifications, key=lambda x: x.timestamp, reverse=True)[:5]

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
    
    # Mock health check
    return {
        "api_status": "healthy",
        "mongodb_status": "connected",
        "vector_db_status": "active",
        "llm_service": "online",
        "uptime": "99.9%",
        "last_reindexed": datetime.utcnow().strftime("%Y-%m-%d %H:%M")
    }
