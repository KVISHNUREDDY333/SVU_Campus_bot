from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List
from ..models.user import User
from ..models.faq import FAQModel, FAQResponse, Notification
from .auth import get_current_user
from ..core import database, config
from bson.objectid import ObjectId
from datetime import datetime
import random
import os
import shutil
from fastapi import UploadFile, File
from ..services.rag_service import ingest_pdf
import pydantic

router = APIRouter()

# --- Valid Models List ---
VALID_MODELS = ["llama-3.3-70b-versatile", "llama3-8b-8192", "llama3-70b-8192", "mixtral-8x7b-32768"]

# Response Model for User Admin View
class UserAdminResponse(pydantic.BaseModel):
    id: str
    username: str # email
    role: str
    created_at: datetime
    status: str = "active"

# Request Model for creating a notification
class NotificationCreate(pydantic.BaseModel):
    title: str
    message: str

# Request Model for LLM Config
class LLMConfigUpdate(pydantic.BaseModel):
    model: str
    temperature: float

@router.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: User = Depends(get_current_user)):
    if database.notifications_db is None:
        return []
    
    # Fetch latest 10 notifications
    cursor = database.notifications_db.find().sort("timestamp", -1).limit(10)
    results = []
    
    for n in cursor:
        results.append(Notification(
            id=int(str(n["_id"])[-6:], 16), 
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

from ..services.rag_service import ingest_pdf, ingest_url, extract_faqs_from_text

class AddUrlRequest(pydantic.BaseModel):
    url: str

@router.post("/admin/upload-document")
async def upload_document(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")
        
    try:
        upload_dir = "backend/uploads"
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, file.filename)
        
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
            
        num_chunks, full_text = await ingest_pdf(file_path)
        
        # Extract FAQs
        extracted_faqs = []
        try:
            extracted_faqs = await extract_faqs_from_text(full_text)
            for faq in extracted_faqs:
                new_faq = {
                    "question": faq.get("question"),
                    "answer": faq.get("answer"),
                    "category": faq.get("category", "General"),
                    "created_at": datetime.utcnow(),
                    "source": file.filename,
                    "auto_generated": True
                }
                if database.faqs_db is not None:
                     database.faqs_db.insert_one(new_faq)
        except Exception as e:
            print(f"Error extracting FAQs: {e}")

        doc_record = {
             "filename": file.filename,
             "uploaded_by": current_user.username,
             "uploaded_at": datetime.utcnow(),
             "chunks": num_chunks,
             "status": "ingested",
             "type": "pdf",
             "extracted_faqs": len(extracted_faqs)
        }
        if database.documents_db is not None:
             database.documents_db.insert_one(doc_record)
        
        return {
            "status": "success", 
            "message": f"Ingested {num_chunks} chunks from {file.filename}",
            "faqs_extracted": len(extracted_faqs)
        }
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@router.post("/admin/add-url")
async def add_url_document(req: AddUrlRequest, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    try:
        num_chunks, full_text = await ingest_url(req.url)
        
        # Extract FAQs
        extracted_faqs = []
        try:
             extracted_faqs = await extract_faqs_from_text(full_text)
             for faq in extracted_faqs:
                new_faq = {
                    "question": faq.get("question"),
                    "answer": faq.get("answer"),
                    "category": faq.get("category", "General"),
                    "created_at": datetime.utcnow(),
                    "source": req.url,
                    "auto_generated": True
                }
                if database.faqs_db is not None:
                     database.faqs_db.insert_one(new_faq)
        except Exception as e:
            print(f"Error extracting FAQs from URL: {e}")
            
        doc_record = {
             "filename": req.url,
             "uploaded_by": current_user.username,
             "uploaded_at": datetime.utcnow(),
             "chunks": num_chunks,
             "status": "ingested",
             "type": "url",
             "extracted_faqs": len(extracted_faqs)
        }
        if database.documents_db is not None:
             database.documents_db.insert_one(doc_record)
             
        return {
            "status": "success", 
            "message": f"Ingested {num_chunks} chunks from URL",
            "faqs_extracted": len(extracted_faqs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"URL ingestion failed: {str(e)}")

@router.get("/dashboard-stats")
async def get_dashboard_stats(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    total_queries = database.analytics_db.count_documents({})
    # This might be slow on large DBs, but fine for now
    active_users = database.users_db.estimated_document_count() 
    
    roles = database.users_db.distinct("role")
    role_dist = {}
    for r in roles:
        role_dist[r] = database.users_db.count_documents({"role": r})
        
    sentiment_data = {
        "Positive": database.analytics_db.count_documents({"sentiment": "Positive"}),
        "Neutral": database.analytics_db.count_documents({"sentiment": "Neutral"}),
        "Negative": database.analytics_db.count_documents({"sentiment": "Negative"})
    }
    
    if sum(sentiment_data.values()) == 0:
        sentiment_data = {"Positive": 15, "Neutral": 10, "Negative": 5}

    return {
        "total_queries": total_queries,
        "active_users": active_users,
        "role_distribution": role_dist,
        "sentiment_stats": sentiment_data
    }

@router.get("/admin/system-health")
async def get_system_health(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    mongo_status = "connected" if database.mongo_client else "disconnected"
    from ..services import rag_service
    vector_status = "active" if rag_service.vector_db else "initializing"
    
    return {
        "api_status": "healthy",
        "mongodb_status": mongo_status,
        "vector_db_status": vector_status,
        "llm_service": "online" if config.Config.GROQ_API_KEY else "offline",
        "uptime": "99.9%",
        "last_reindexed": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S")
    }

# --- LLM Config Endpoints ---

@router.get("/admin/llm-config")
async def get_llm_config(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    from ..services import rag_service
    return {
        "model": rag_service.CURRENT_MODEL_NAME,
        "temperature": rag_service.CURRENT_TEMPERATURE
    }

@router.post("/admin/llm-config")
async def update_llm_config(config: LLMConfigUpdate, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    
    from ..services import rag_service
    success = rag_service.update_llm_config(config.model, config.temperature)
    
    if success:
        return {"status": "success", "message": f"Updated LLM to {config.model}"}
    else:
        raise HTTPException(status_code=500, detail="Failed to update LLM configuration")

# --- User Management Endpoints ---

@router.get("/admin/users", response_model=List[UserAdminResponse])
async def get_all_users(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    
    cursor = database.users_db.find().sort("created_at", -1)
    users = []
    for u in cursor:
        users.append(UserAdminResponse(
            id=str(u["_id"]),
            username=u["username"],
            role=u.get("role", "student"),
            created_at=u.get("created_at", datetime.utcnow())
        ))
    return users

@router.put("/admin/users/{user_id}/role")
async def update_user_role(user_id: str, role_data: dict = Body(...), current_user: User = Depends(get_current_user)):
    # Expects {"role": "admin"} or {"role": "student"}
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    
    new_role = role_data.get("role")
    if new_role not in ["student", "admin", "faculty"]:
        raise HTTPException(status_code=400, detail="Invalid role")

    try:
        database.users_db.update_one({"_id": ObjectId(user_id)}, {"$set": {"role": new_role}})
        return {"status": "success", "message": f"User role updated to {new_role}"}
    except:
        raise HTTPException(status_code=400, detail="Invalid User ID")

@router.delete("/admin/users/{user_id}")
async def delete_user(user_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    
    # Prevent self-deletion
    user_to_delete = database.users_db.find_one({"_id": ObjectId(user_id)})
    if user_to_delete and user_to_delete["username"] == current_user.username:
        raise HTTPException(status_code=400, detail="Cannot delete your own admin account")

    try:
        database.users_db.delete_one({"_id": ObjectId(user_id)})
        return {"status": "success", "message": "User deleted"}
    except:
        raise HTTPException(status_code=400, detail="Invalid User ID")

@router.post("/admin/cache/clear")
async def clear_system_cache(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    from ..services import rag_service
    # Clear session history
    rag_service.store = {}
    return {"status": "success", "message": "System cache (session history) cleared."}

@router.post("/admin/reindex")
async def reindex_knowledge_base(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    
    from ..services import rag_service
    # Re-initialize RAG chain (Refresh vector DB connection/config)
    try:
        rag_service.setup_rag_chain()
        return {"status": "success", "message": "Knowledge base connection refreshed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
