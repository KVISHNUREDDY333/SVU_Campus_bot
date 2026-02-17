from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List
from ..models.user import User
from ..models.faq import FAQModel, FAQResponse, Notification, SuggestedFAQModel, SuggestedFAQResponse, FAQRequest
from .auth import get_current_user, get_password_hash
from ..models.location import LocationModel, LocationResponse, LocationUpdate
from ..models.trending import TrendingQueryModel, TrendingQueryResponse, TrendingQueryUpdate

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

VALID_MODELS = ["llama-3.3-70b-versatile"]

class UserAdminResponse(pydantic.BaseModel):
    id: str
    username: str # email
    role: str
    created_at: datetime
    status: str = "active"

class UserCreate(pydantic.BaseModel):
    username: str
    password: str
    role: str = "student"

class NotificationCreate(pydantic.BaseModel):
    title: str
    message: str

from ..utils.notifications import create_notification

@router.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: User = Depends(get_current_user)):
    if database.notifications_db is None:
        return []
    
    query = {
        "$or": [
            {"recipient_username": current_user.username}, 
            {"recipient_role": current_user.role},
            {"recipient_username": None, "recipient_role": None}
        ]
    }
    cursor = database.notifications_db.find(query).sort("timestamp", -1).limit(10)
    results = []
    
    for n in cursor:
        results.append(Notification(
            id=int(str(n["_id"])[-6:], 16), 
            title=n.get("title", ""),
            message=n.get("message", ""),
            timestamp=n.get("timestamp", datetime.utcnow()),
            recipient_username=n.get("recipient_username"),
            recipient_role=n.get("recipient_role")
        ))
    return results

@router.post("/admin/notifications", response_model=Notification)
async def admin_create_notification(note: NotificationCreate, current_user: User = Depends(get_current_user)):
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

@router.get("/admin/faqs", response_model=List[FAQResponse])
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
            created_at=f.get("created_at", datetime.utcnow()),
            source_urls=f.get("source_urls", []),
            verified=f.get("verified", False)
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
        from ..core.config import Config
        
        result = database.faqs_db.delete_one({"_id": ObjectId(faq_id)})
        if result.deleted_count == 0:
            raise HTTPException(status_code=404, detail="FAQ not found")
            
        vector_collection_name = Config.COLLECTION_NAME or "documents"
        vector_collection = database.mongo_client[Config.DB_NAME][vector_collection_name]
        
        vector_collection.delete_many({"metadata.faq_id": faq_id})
        
        return {"status": "success", "message": "FAQ and associated vector deleted"}
    except Exception as e:
        print(f"Delete FAQ Error: {e}")
        raise HTTPException(status_code=400, detail="Failed to delete FAQ")

@router.post("/faqs/suggest")
async def suggest_faq(faq: SuggestedFAQModel):
    if database.suggested_faqs_db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    new_suggestion = {
        "question": faq.question,
        "answer": faq.answer,
        "category": faq.category,
        "suggested_by": faq.suggested_by,
        "timestamp": datetime.utcnow()
    }
    
    database.suggested_faqs_db.insert_one(new_suggestion)
    
    await create_notification(
        "New FAQ Suggestion", 
        f"A student suggested: {faq.question[:50]}...", 
        recipient_role="admin"
    )

    return {"status": "success", "message": "FAQ suggestion submitted for review"}

@router.get("/admin/suggested-faqs", response_model=List[SuggestedFAQResponse])
async def get_suggested_faqs(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.suggested_faqs_db is None:
        return []
    
    suggestions = list(database.suggested_faqs_db.find().sort("timestamp", -1))
    results = []
    for s in suggestions:
        results.append(SuggestedFAQResponse(
            id=str(s["_id"]),
            question=s["question"],
            answer=s["answer"],
            suggested_by=s.get("suggested_by", "Unknown"),
            timestamp=s.get("timestamp", datetime.utcnow())
        ))
    return results

@router.post("/admin/suggested-faqs/{suggestion_id}/approve")
async def approve_suggested_faq(suggestion_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.suggested_faqs_db is None or database.faqs_db is None:
        raise HTTPException(status_code=503, detail="Database not available")
    
    suggestion = database.suggested_faqs_db.find_one({"_id": ObjectId(suggestion_id)})
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    
    new_faq = {
        "question": suggestion["question"],
        "answer": suggestion["answer"],
        "category": "User added faqs",
        "created_at": datetime.utcnow(),
        "suggested_by": suggestion.get("suggested_by")
    }
    
    result = database.faqs_db.insert_one(new_faq)
    new_faq_id = str(result.inserted_id)

    if suggestion.get("suggested_by"):
        await create_notification(
            "Suggestion Approved", 
            f"Your FAQ suggestion was approved: {new_faq['question'][:50]}...",
            recipient_username=suggestion.get("suggested_by")
        )
    
    try:
        from ..services.rag_service import ingest_text
        faq_text = f"Question: {new_faq['question']}\nAnswer: {new_faq['answer']}\nCategory: {new_faq['category']}"
        await ingest_text(faq_text, metadata={"source": "faq", "faq_id": new_faq_id, "category": new_faq["category"]})
    except Exception as e:
        print(f"Failed to ingest FAQ into vector DB: {e}")
    
    database.suggested_faqs_db.delete_one({"_id": ObjectId(suggestion_id)})
    
    return {"status": "success", "message": "FAQ approved and published"}

@router.delete("/admin/suggested-faqs/{suggestion_id}")
async def reject_suggested_faq(suggestion_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    suggestion = database.suggested_faqs_db.find_one({"_id": ObjectId(suggestion_id)})
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    if suggestion.get("suggested_by"):
        await create_notification(
            "Suggestion Rejected", 
            f"Your FAQ suggestion was declined by the admin.",
            recipient_username=suggestion.get("suggested_by")
        )

    database.suggested_faqs_db.delete_one({"_id": ObjectId(suggestion_id)})
    
    return {"status": "success", "message": "FAQ suggestion rejected"}

from ..services.rag_service import ingest_pdf, ingest_url, extract_faqs_from_text, ingest_faq, validate_faq_with_web

class AddTextRequest(pydantic.BaseModel):
    title: str
    content: str

class AddUrlRequest(pydantic.BaseModel):
    url: str

@router.post("/admin/add-text")
async def add_text_document(req: AddTextRequest, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    try:
        print(f"[DEBUG] Ingesting Text: {req.title}")
        
        from ..services.rag_service import ingest_text
        doc_metadata = {"source": req.title, "type": "text_entry", "uploaded_by": current_user.username}
        num_chunks = await ingest_text(req.content, metadata=doc_metadata)
        print(f"[DEBUG] Text Entry Ingested. Chunks: {num_chunks}")

        extracted_faqs = []
        try:
            extracted_faqs = await extract_faqs_from_text(req.content)
            print(f"[DEBUG] Extracted {len(extracted_faqs)} raw FAQs from Text Entry")
            
            inserted_count = 0
            for faq in extracted_faqs:
                status = "MANUAL_ENTRY"
                score = 1.0
                source_url = ""
                
                new_faq = {
                    "question": faq.get("question"),
                    "answer": faq.get("answer"),
                    "category": faq.get("category", "General"),
                    "keywords": faq.get("keywords", []),
                    "created_at": datetime.utcnow(),
                    "source_urls": [req.title], # Use title as source reference
                    "verified": True,
                    "verification_status": status,
                    "verification_source": "Admin Manual Entry",
                    "confidence_score": score,
                    "last_verified": datetime.utcnow()
                }
                
                if database.faqs_db is not None:
                     res = database.faqs_db.insert_one(new_faq)
                     new_faq_id = str(res.inserted_id)
                     inserted_count += 1
                     
                     await ingest_faq(
                         question=new_faq["question"], 
                         answer=new_faq["answer"], 
                         source=req.title, 
                         faq_id=new_faq_id
                     )
            print(f"[DEBUG] Text Entry FAQ Insertion Complete. Total inserted: {inserted_count}")
                    
        except Exception as e:
            print(f"Error extracting/indexing FAQs from Text: {e}")
            
        doc_record = {
             "filename": req.title, # Title acts as filename
             "uploaded_by": current_user.username,
             "uploaded_at": datetime.utcnow(),
             "chunks": num_chunks,
             "status": "ingested",
             "type": "text",
             "extracted_faqs": len(extracted_faqs),
             "content": req.content # Store full content for re-extraction
        }
        if database.documents_db is not None:
             database.documents_db.insert_one(doc_record)
             
        return {
            "status": "success", 
            "message": f"Ingested text '{req.title}'",
            "faqs_extracted": len(extracted_faqs)
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text ingestion failed: {str(e)}")
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
            
        print(f"[DEBUG] Ingesting PDF: {file.filename}")
        num_chunks, full_text = await ingest_pdf(file_path, user_id="public", store_vectors=True)
        print(f"[DEBUG] PDF Ingested. Chunks: {num_chunks}. Text len: {len(full_text)}")
        
        extracted_faqs = []
        try:
            extracted_faqs = await extract_faqs_from_text(full_text)
            print(f"[DEBUG] Extracted {len(extracted_faqs)} raw FAQs from PDF")
            
            inserted_count = 0
            for faq in extracted_faqs:
                status = "MANUAL_ENTRY"
                score = 1.0
                source_url = ""
                
                new_faq = {
                    "question": faq.get("question"),
                    "answer": faq.get("answer"),
                    "category": faq.get("category", "General"),
                    "keywords": faq.get("keywords", []),
                    "created_at": datetime.utcnow(),
                    "source_urls": [file.filename],
                    "verified": True,
                    "verification_status": status, 
                    "verification_source": "Admin Upload",
                    "confidence_score": score,
                    "last_verified": datetime.utcnow()
                }
                
                if database.faqs_db is not None:
                     res = database.faqs_db.insert_one(new_faq)
                     new_faq_id = str(res.inserted_id)
                     inserted_count += 1
                     print(f"[DEBUG] Inserted FAQ ID: {new_faq_id}")
                     
                     await ingest_faq(
                         question=new_faq["question"], 
                         answer=new_faq["answer"], 
                         source=file.filename, 
                         faq_id=new_faq_id
                     )
            print(f"[DEBUG] PDF FAQ Insertion Complete. Total inserted: {inserted_count}")

        except Exception as e:
            print(f"Error extracting/indexing FAQs: {e}")

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
        print(f"[DEBUG] Ingesting URL: {req.url}")
        num_chunks, full_text = await ingest_url(req.url, store_vectors=True)
        print(f"[DEBUG] URL Ingested. Chunks: {num_chunks}. Text len: {len(full_text)}")
        
        extracted_faqs = []
        try:
             extracted_faqs = await extract_faqs_from_text(full_text)
             print(f"[DEBUG] Extracted {len(extracted_faqs)} raw FAQs from URL")
             
             inserted_count = 0
             for faq in extracted_faqs:
                status = "MANUAL_ENTRY"
                score = 1.0
                source_url = req.url
                
                new_faq = {
                    "question": faq.get("question"),
                    "answer": faq.get("answer"),
                    "category": faq.get("category", "General"),
                    "keywords": faq.get("keywords", []),
                    "created_at": datetime.utcnow(),
                    "source_urls": [req.url], 
                    "verified": True,
                    "verification_status": status,
                    "verification_source": "Admin URL",
                    "confidence_score": score,
                    "last_verified": datetime.utcnow()
                }
                
                if database.faqs_db is not None:
                     res = database.faqs_db.insert_one(new_faq)
                     new_faq_id = str(res.inserted_id)
                     inserted_count += 1
                     print(f"[DEBUG] Inserted FAQ ID: {new_faq_id}")
                     
                     await ingest_faq(
                         question=new_faq["question"], 
                         answer=new_faq["answer"], 
                         source=req.url, 
                         faq_id=new_faq_id
                     )
             print(f"[DEBUG] URL FAQ Insertion Complete. Total inserted: {inserted_count}")
                     
        except Exception as e:
            print(f"Error extracting/indexing FAQs from URL: {e}")
            
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
        
    print(f"Fetching dashboard stats for user: {current_user.username}")
    
    # Initialize defaults
    stats = {
        "total_queries": 0,
        "active_users": 0,
        "total_documents": 0,
        "role_distribution": {},
        "sentiment_stats": {"Positive": 0, "Neutral": 0, "Negative": 0}
    }

    try:
        # 1. Total Queries (Analytics)
        if database.analytics_db is not None:
             stats["total_queries"] = database.analytics_db.count_documents({})
             
             stats["sentiment_stats"] = {
                "Positive": database.analytics_db.count_documents({"sentiment": "Positive"}),
                "Neutral": database.analytics_db.count_documents({"sentiment": "Neutral"}),
                "Negative": database.analytics_db.count_documents({"sentiment": "Negative"})
            }

        # 2. Users Stats
        if database.users_db is not None:
            stats["active_users"] = database.users_db.estimated_document_count()
            roles = database.users_db.distinct("role")
            for r in roles:
                stats["role_distribution"][r] = database.users_db.count_documents({"role": r})

        # 3. Documents Stats (The Critical Part)
        if database.documents_db is not None:
            doc_count = database.documents_db.count_documents({})
            print(f"DEBUG: Found {doc_count} documents in DB")
            stats["total_documents"] = doc_count
        else:
            print("CRITICAL: documents_db is None!")

        return stats

    except Exception as e:
        print(f"Dashboard Stats Error: {e}")
        # Return partial stats instead of failing
        return stats

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

@router.get("/admin/users", response_model=List[UserAdminResponse])
async def get_all_users(
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    
    projection = {"_id": 1, "username": 1, "role": 1, "created_at": 1, "status": 1}
    cursor = database.users_db.find({}, projection).sort("created_at", -1).skip(skip).limit(limit)
    
    users = []
    for u in cursor:
        users.append(UserAdminResponse(
            id=str(u["_id"]),
            username=u["username"],
            role=u.get("role", "student"),
            created_at=u.get("created_at", datetime.utcnow()),
            status=u.get("status", "active")
        ))
    return users

@router.post("/admin/users", status_code=201)
async def create_user(user_data: UserCreate, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.users_db.find_one({"username": user_data.username}):
        raise HTTPException(status_code=400, detail="User already exists")
    
    new_user = {
        "username": user_data.username,
        "hashed_password": get_password_hash(user_data.password),
        "role": user_data.role,
        "created_at": datetime.utcnow(),
        "status": "active"
    }
    
    database.users_db.insert_one(new_user)
    return {"status": "success", "message": f"User {user_data.username} created"}

@router.put("/admin/users/{user_id}/role")
async def update_user_role(user_id: str, role_data: dict = Body(...), current_user: User = Depends(get_current_user)):
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
    rag_service.store = {}
    return {"status": "success", "message": "System cache (session history) cleared."}

@router.post("/admin/reindex")
async def reindex_knowledge_base(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
         raise HTTPException(status_code=403, detail="Admin access required")
    
    from ..services import rag_service
    try:
        rag_service.setup_rag_chain()
        return {"status": "success", "message": "Knowledge base connection refreshed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/documents")
async def list_documents(
    skip: int = 0,
    limit: int = 50,
    current_user: User = Depends(get_current_user)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.documents_db is None:
        return []
        
    docs = []
    cursor = database.documents_db.find().sort("uploaded_at", -1).skip(skip).limit(limit)
    for doc in cursor:
        doc["_id"] = str(doc["_id"])
        docs.append(doc)
    return docs

@router.get("/admin/documents/{doc_id}/faqs", response_model=List[FAQResponse])
async def get_document_faqs(doc_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.documents_db is None or database.faqs_db is None:
        raise HTTPException(status_code=500, detail="Database not available")
    
    from bson import ObjectId
    try:
        doc = database.documents_db.find_one({"_id": ObjectId(doc_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        identifier = doc.get("filename")
        if not identifier:
            return []
            
        faqs = list(database.faqs_db.find({"source_urls": identifier}))
        
        for f in faqs:
            f["id"] = str(f["_id"])
            
        return faqs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/admin/documents/{doc_id}")
async def delete_document(doc_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
        
    try:
        from ..core.config import Config
        
        if database.documents_db is None:
             raise HTTPException(status_code=503, detail="Database not available")

        doc = database.documents_db.find_one({"_id": ObjectId(doc_id)})
        if not doc:
             raise HTTPException(status_code=404, detail="Document not found")
        
        filename = doc.get("filename")
        if not filename:
             database.documents_db.delete_one({"_id": ObjectId(doc_id)})
             return {"status": "success", "message": "Document deleted (No filename found for cascade)"}

        database.documents_db.delete_one({"_id": ObjectId(doc_id)})
        
        if database.faqs_db is not None:
            delete_result = database.faqs_db.delete_many({"source_urls": filename})
            print(f"Deleted {delete_result.deleted_count} FAQs associated with {filename}")

        vector_collection_name = Config.COLLECTION_NAME or "documents"
        vector_collection = database.mongo_client[Config.DB_NAME][vector_collection_name]
        
        vector_delete_result = vector_collection.delete_many({"metadata.source": filename})
        print(f"Deleted {vector_delete_result.deleted_count} vector chunks for {filename}")
        
        return {"status": "success", "message": f"Document and associated data deleted for {filename}"}

    except Exception as e:
        print(f"Delete Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")



@router.put("/admin/faqs/{faq_id}")
async def update_faq(faq_id: str, faq: FAQRequest, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.faqs_db is None:
        raise HTTPException(status_code=500, detail="Database not available")
        
    from bson import ObjectId
    try:
        update_data = {
            "question": faq.question,
            "answer": faq.answer,
            "category": faq.category,
            "updated_at": datetime.utcnow(),
            "updated_by": current_user.username
        }
        
        result = database.faqs_db.update_one(
            {"_id": ObjectId(faq_id)},
            {"$set": update_data}
        )
        
        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="FAQ not found")
            
        return {"status": "success", "message": "FAQ updated successfully"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- Location Management Endpoints ---

@router.get("/admin/locations", response_model=List[LocationResponse])
async def get_all_locations(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
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

@router.post("/admin/locations", response_model=LocationResponse)
async def create_location(loc: LocationModel, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    new_loc = loc.dict()
    new_loc["created_at"] = datetime.utcnow()
    
    result = database.locations_db.insert_one(new_loc)
    new_loc["id"] = str(result.inserted_id)
    return new_loc

@router.put("/admin/locations/{loc_id}", response_model=LocationResponse)
async def update_location(loc_id: str, loc_update: LocationUpdate, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    update_data = {k: v for k, v in loc_update.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")
    
    result = database.locations_db.update_one(
        {"_id": ObjectId(loc_id)},
        {"$set": update_data}
    )
    
    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
        
    updated_loc = database.locations_db.find_one({"_id": ObjectId(loc_id)})
    updated_loc["id"] = str(updated_loc["_id"])
    return updated_loc

@router.delete("/admin/locations/{loc_id}")
async def delete_location(loc_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = database.locations_db.delete_one({"_id": ObjectId(loc_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")
        
    return {"status": "success", "message": "Location deleted"}

@router.get('/admin/trending', response_model=List[TrendingQueryResponse])
async def get_trending_queries():
    if database.trending_queries_db is None:
        return []
    queries = list(database.trending_queries_db.find().sort('order', 1))
    results = []
    for q in queries:
        results.append(TrendingQueryResponse(
            id=str(q['_id']),
            text=q['text'],
            subtext=q['subtext'],
            icon=q['icon'],
            response=q.get('response'),
            order=q.get('order', 0),
            created_at=q.get('created_at', datetime.utcnow())
        ))
    return results

@router.post('/admin/trending', response_model=TrendingQueryResponse)
async def add_trending_query(query: TrendingQueryModel, current_user: User = Depends(get_current_user)):
    if current_user.role != 'admin':
        raise HTTPException(status_code=403, detail='Admin access required')
    
    if database.trending_queries_db is None:
        raise HTTPException(status_code=500, detail='Database not initialized')

    # Check for maximum limit of 4 queries
    count = database.trending_queries_db.count_documents({})
    if count >= 4:
        raise HTTPException(status_code=400, detail="Maximum of 4 trending queries allowed")
    
    new_query = query.dict()
    new_query['created_at'] = datetime.utcnow()
    
    result = database.trending_queries_db.insert_one(new_query)
    
    # Remove _id as it might interface with Pydantic validation if it's an ObjectId
    new_query.pop('_id', None)
    
    return TrendingQueryResponse(
        id=str(result.inserted_id),
        **new_query
    )

@router.put('/admin/trending/{query_id}', response_model=TrendingQueryResponse)
async def update_trending_query(query_id: str, update: TrendingQueryUpdate, current_user: User = Depends(get_current_user)):
    if current_user.role != 'admin':
        raise HTTPException(status_code=403, detail='Admin access required')
        
    if database.trending_queries_db is None:
         raise HTTPException(status_code=500, detail='Database not initialized')

    # Filter out None values
    update_data = {k: v for k, v in update.dict().items() if v is not None}
    
    if not update_data:
        raise HTTPException(status_code=400, detail="No data provided for update")

    result = database.trending_queries_db.find_one_and_update(
        {'_id': ObjectId(query_id)},
        {'$set': update_data},
        return_document=True
    )
    
    if not result:
        raise HTTPException(status_code=404, detail="Query not found")
        
    # Remove _id for Pydantic
    result.pop('_id', None)
    
    return TrendingQueryResponse(
        id=query_id,
        **result
    )

@router.delete('/admin/trending/{query_id}')
async def delete_trending_query(query_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != 'admin':
        raise HTTPException(status_code=403, detail='Admin access required')
    
    if database.trending_queries_db is None:
         raise HTTPException(status_code=500, detail='Database not initialized')
    
    result = database.trending_queries_db.delete_one({'_id': ObjectId(query_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail='Query not found')
        
    return {'status': 'success', 'message': 'Query deleted'}



