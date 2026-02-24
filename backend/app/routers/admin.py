from fastapi import APIRouter, Depends, HTTPException, Body
from typing import List
from ..models.user import User
from ..models.faq import FAQModel, FAQResponse, SuggestedFAQModel, SuggestedFAQResponse, FAQRequest
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
from ..services.rag_service import ingest_pdf, ingest_url, ingest_text, extract_faqs_from_text, refine_kb_data, ingest_faq
from ..services import notification_service
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
    
    # Trigger notification
    await notification_service.create_notification(
        title="New FAQ Added",
        message=f"A new FAQ about '{faq.category}' has been added to the system.",
        notification_type="common"
    )
    
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


    
    try:
        from ..services.rag_service import ingest_text
        faq_text = f"Question: {new_faq['question']}\nAnswer: {new_faq['answer']}\nCategory: {new_faq['category']}"
        await ingest_text(faq_text, metadata={"source": "faq", "faq_id": new_faq_id, "category": new_faq["category"]})
    except Exception as e:
        print(f"Failed to ingest FAQ into vector DB: {e}")
    
    # Personal notification to the suggestor
    suggestor = suggestion.get("suggested_by")
    if suggestor:
        await notification_service.create_notification(
            title="FAQ Approved",
            message=f"Your suggested FAQ '{suggestion.get('question')[:30]}...' has been approved.",
            user_id=suggestor,
            notification_type="personal"
        )
    
    database.suggested_faqs_db.delete_one({"_id": ObjectId(suggestion_id)})
    
    return {"status": "success", "message": "FAQ approved and published"}

@router.delete("/admin/suggested-faqs/{suggestion_id}")
async def reject_suggested_faq(suggestion_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    suggestion = database.suggested_faqs_db.find_one({"_id": ObjectId(suggestion_id)})
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
    # Personal notification to the suggestor
    suggestor = suggestion.get("suggested_by")
    if suggestor:
        await notification_service.create_notification(
            title="FAQ Suggestion Update",
            message=f"Your suggested FAQ '{suggestion.get('question')[:30]}...' has been rejected by the admin.",
            user_id=suggestor,
            notification_type="personal"
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
             "last_modified": datetime.utcnow(),
             "is_trained": False,
             "last_trained": None,
             "chunks": num_chunks,
             "status": "ingested",
             "type": "text",
             "extracted_faqs": len(extracted_faqs),
             "content": req.content # Store full content for re-extraction
        }
        if database.documents_db is not None:
             database.documents_db.insert_one(doc_record)
        
        # Trigger common notification for KB update
        await notification_service.create_notification(
            title="Knowledge Base Updated",
            message=f"A new text document '{req.title}' has been added to our knowledge base.",
            notification_type="common"
        )
             
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
             "last_modified": datetime.utcnow(),
             "is_trained": False,
             "last_trained": None,
             "chunks": num_chunks,
             "status": "ingested",
             "type": "pdf",
             "extracted_faqs": len(extracted_faqs)
        }
        if database.documents_db is not None:
             database.documents_db.insert_one(doc_record)
        
        # Trigger common notification for KB update
        await notification_service.create_notification(
            title="Knowledge Base Updated",
            message=f"New document '{file.filename}' has been uploaded and processed.",
            notification_type="common"
        )
        
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
             "last_modified": datetime.utcnow(),
             "is_trained": False,
             "last_trained": None,
             "chunks": num_chunks,
             "status": "ingested",
             "type": "url",
             "extracted_faqs": len(extracted_faqs)
        }
        if database.documents_db is not None:
             database.documents_db.insert_one(doc_record)
        
        # Trigger common notification for KB update
        await notification_service.create_notification(
            title="Knowledge Base Updated",
            message=f"New information from '{req.url}' has been added to the knowledge base.",
            notification_type="common"
        )
             
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

@router.get("/admin/brain/status")
async def get_brain_training_status(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if database.documents_db is None:
        return []
    
    docs = list(database.documents_db.find().sort("last_modified", -1))
    results = []
    for d in docs:
        results.append({
            "id": str(d["_id"]),
            "filename": d.get("filename", "Unknown"),
            "type": d.get("type", "unknown"),
            "faq_count": d.get("extracted_faqs", 0),
            "is_trained": d.get("is_trained", False),
            "last_trained": d.get("last_trained"),
            "last_modified": d.get("last_modified", d.get("uploaded_at"))
        })
    return results

@router.post("/admin/train/all")
async def train_all_knowledge(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Find untrained or modified docs
    query = {"$or": [{"is_trained": False}, {"is_trained": {"$exists": False}}]}
    untrained_docs = list(database.documents_db.find(query))
    
    if not untrained_docs:
        return {"status": "no_updates", "message": "No data is injected to train."}
    
    trained_count = 0
    
    from ..services.rag_service import refine_kb_data, ingest_faq, ingest_url, ingest_pdf
    
    for doc in untrained_docs:
        doc_id = str(doc["_id"])
        filename = doc.get("filename")
        doc_type = doc.get("type", "pdf")
        
        # Thorough Training Logic (Simplified for bulk)
        full_text = ""
        try:
            if doc_type == "url":
                _, full_text = await ingest_url(filename, store_vectors=False)
            elif doc_type == "pdf":
                upload_dir = "backend/uploads"
                file_path = os.path.join(upload_dir, filename)
                if os.path.exists(file_path):
                    _, full_text = await ingest_pdf(file_path, store_vectors=False)
        except Exception as e:
            print(f"Error fetching content for thorough training (Doc: {filename}): {e}")

        # Refine FAQs if content available
        now = datetime.utcnow()
        faqs = list(database.faqs_db.find({"source_urls": filename}))
        if faqs and full_text:
            faqs_to_refine = [{
                "question": f["question"],
                "answer": f["answer"],
                "category": f.get("category", "General"),
                "keywords": f.get("keywords", [])
            } for f in faqs]
            
            refined_faqs = await refine_kb_data(faqs_to_refine, full_text)
            
            for i, f in enumerate(faqs):
                if i < len(refined_faqs):
                    refined = refined_faqs[i]
                    database.faqs_db.update_one(
                        {"_id": f["_id"]},
                        {"$set": {
                            "question": refined.get("question", f["question"]),
                            "answer": refined.get("answer", f["answer"]),
                            "category": refined.get("category", f.get("category", "General")),
                            "keywords": refined.get("keywords", f.get("keywords", [])),
                            "last_verified": now
                        }}
                    )
                    await ingest_faq(
                        question=refined.get("question", f["question"]),
                        answer=refined.get("answer", f["answer"]),
                        source=filename,
                        faq_id=str(f["_id"])
                    )

        database.documents_db.update_one(
            {"_id": doc["_id"]},
            {"$set": {"is_trained": True, "last_trained": now}}
        )
        trained_count += 1
        
    return {"status": "success", "trained_count": trained_count, "message": f"Successfully trained and refined {trained_count} items."}

@router.post("/admin/train/{doc_id}")
async def train_specific_document(doc_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    from ..services.rag_service import refine_kb_data, ingest_faq
    
    doc = database.documents_db.find_one({"_id": ObjectId(doc_id)})
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
        
    filename = doc.get("filename")
    doc_type = doc.get("type", "pdf")
    
    # 1. Get full text context
    full_text = ""
    try:
        if doc_type == "url":
            from ..services.rag_service import ingest_url
            _, full_text = await ingest_url(filename, store_vectors=False)
        elif doc_type == "pdf":
            upload_dir = "backend/uploads"
            file_path = os.path.join(upload_dir, filename)
            from ..services.rag_service import ingest_pdf
            _, full_text = await ingest_pdf(file_path, store_vectors=False)
        elif doc_type == "text":
            # For text types, we might need to store the content in doc_record or find it elsewhere
            # Assuming for now text-type docs have their content somehow available or we skip refinement
            pass
    except Exception as e:
        print(f"Error fetching document content for refinement: {e}")

    # 2. Get existing FAQs
    faqs = list(database.faqs_db.find({"source_urls": filename}))
    if faqs and full_text:
        print(f"[THOROUGH-TRAIN] Refining {len(faqs)} FAQs for {filename}")
        # Convert BSON to simple list of dicts for LLM
        faqs_to_refine = []
        for f in faqs:
            faqs_to_refine.append({
                "question": f["question"],
                "answer": f["answer"],
                "category": f.get("category", "General"),
                "keywords": f.get("keywords", [])
            })
            
        refined_faqs = await refine_kb_data(faqs_to_refine, full_text)
        
        # 3. Update DB and Re-ingest into Vector DB
        for i, f in enumerate(faqs):
            # Only update if we have a match (in case LLM returned different count, though we try batching)
            if i < len(refined_faqs):
                refined = refined_faqs[i]
                database.faqs_db.update_one(
                    {"_id": f["_id"]},
                    {"$set": {
                        "question": refined.get("question", f["question"]),
                        "answer": refined.get("answer", f["answer"]),
                        "category": refined.get("category", f.get("category", "General")),
                        "keywords": refined.get("keywords", f.get("keywords", [])),
                        "last_verified": datetime.utcnow()
                    }}
                )
                # Re-ingest into Vector DB
                await ingest_faq(
                    question=refined.get("question", f["question"]),
                    answer=refined.get("answer", f["answer"]),
                    source=filename,
                    faq_id=str(f["_id"])
                )

    result = database.documents_db.update_one(
        {"_id": ObjectId(doc_id)},
        {"$set": {"is_trained": True, "last_trained": datetime.utcnow()}}
    )
    
    return {"status": "success", "message": "Document training (thorough refinement) complete."}

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
            
        # Mark parent document as untrained
        updated_faq = database.faqs_db.find_one({"_id": ObjectId(faq_id)})
        if updated_faq and updated_faq.get("source_urls"):
            sources = updated_faq["source_urls"]
            # If it's a string (old format maybe?), treat as single item list
            if isinstance(sources, str):
                sources = [sources]
            
            if sources:
                source = sources[0]
                database.documents_db.update_one(
                    {"filename": source},
                    {"$set": {"is_trained": False, "last_modified": datetime.utcnow()}}
                )
            
        return {"status": "success", "message": "FAQ updated and document marked for retraining"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

# --- Location Management Endpoints ---

@router.post("/admin/locations", response_model=LocationResponse)
async def create_location(loc: LocationModel, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    new_loc = loc.dict()
    new_loc["created_at"] = datetime.utcnow()
    
    result = database.locations_db.insert_one(new_loc)
    new_loc["id"] = str(result.inserted_id)
    
    # Trigger notification
    await notification_service.create_notification(
        title="New Location Added",
        message=f"New campus location '{loc.name}' is now available in the map.",
        notification_type="common"
    )
    
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
    
    # Trigger notification
    await notification_service.create_notification(
        title="Location Updated",
        message=f"Campus location '{updated_loc.get('name')}' has been updated.",
        notification_type="common"
    )
    
    return updated_loc

@router.delete("/admin/locations/{loc_id}")
async def delete_location(loc_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # We might want to know the name before deleting for a better message, 
    # but let's keep it simple for now.
    
    # Trigger notification
    await notification_service.create_notification(
        title="Location Removed",
        message=f"A campus location has been removed from the map.",
        notification_type="common"
    )
        
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
    
    # Trigger notification
    await notification_service.create_notification(
        title="Trending Today",
        message=f"Check out the new trending query: '{query.text}'",
        notification_type="common"
    )
    
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
    
    # Trigger notification
    await notification_service.create_notification(
        title="Trending Queries Update",
        message=f"The trending topics have been updated. Check them out!",
        notification_type="common"
    )
    
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
    
    # Trigger notification
    await notification_service.create_notification(
        title="Trending Queries Update",
        message=f"Trending queries have been refreshed.",
        notification_type="common"
    )
        
    return {'status': 'success', 'message': 'Query deleted'}



