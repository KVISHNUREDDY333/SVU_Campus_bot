import logging
import os
import shutil
from datetime import datetime
from typing import List

import pydantic
from bson.objectid import ObjectId
from fastapi import APIRouter, BackgroundTasks, Body, Depends, File, HTTPException, UploadFile

from ..core import config, database
from ..utils.file_validator import save_and_validate_file
from ..models.faq import (
    FAQModel,
    FAQRequest,
    FAQResponse,
    SuggestedFAQModel,
    SuggestedFAQResponse,
)
from ..models.location import LocationModel, LocationResponse, LocationUpdate
from ..models.trending import (
    TrendingQueryModel,
    TrendingQueryResponse,
    TrendingQueryUpdate,
)
from ..models.user import User
from ..services import notification_service
from ..services.logging_service import get_recent_logs
from ..services.rag_service import embeddings, ingest_pdf, ingest_text, ingest_url
from .auth import get_current_admin_user, get_current_user, get_password_hash

logger = logging.getLogger("uvicorn")
router = APIRouter()

VALID_MODELS = ["llama-3.3-70b-versatile"]

class UserAdminResponse(pydantic.BaseModel):
    id: str
    username: str         
    role: str
    created_at: datetime
    status: str = "active"

class UserCreate(pydantic.BaseModel):
    username: str
    password: str
    role: str = "student"

@router.get("/admin/faqs", response_model=List[FAQResponse])
async def get_faqs():
    if database.svu_vectors_db is None:
        return []
                                              
    faqs = list(database.svu_vectors_db.find({"type": "faq"}).sort("created_at", -1))
    results = []
    for f in faqs:
        text = f.get("text", "")
                                                                                       
        question = ""
        answer = ""
        if "Question:" in text and "Answer:" in text:
            parts = text.split("Answer:", 1)
            question = parts[0].replace("Question:", "").strip()
            answer = parts[1].strip()
        else:
            question = text[:100] if text else "No question"
            answer = text

        results.append(
            FAQResponse(
                id=str(f["_id"]),
                question=question,
                answer=answer,
                category=f.get(
                    "category", f.get("metadata", {}).get("category", "General")
                ),
                created_at=f.get("created_at", datetime.utcnow()),
                source_urls=f.get("source_urls", [f.get("source", "")]),
                verified=f.get("verified", False),
            )
        )
    return results

@router.post("/admin/faqs", response_model=FAQResponse)
async def create_faq(
    faq: FAQModel, current_user: User = Depends(get_current_admin_user)
):

    from ..services.rag_service import ingest_faq as rag_ingest_faq

    faq_id = str(ObjectId())

    try:
        await rag_ingest_faq(
            question=faq.question,
            answer=faq.answer,
            category=faq.category,
            source="admin_manual",
            faq_id=faq_id,
        )
    except Exception as e:
        logger.error(f"Failed to ingest FAQ into vector DB: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to create FAQ: {e}")

    await notification_service.create_notification(
        title="New FAQ Added",
        message=f"A new FAQ about '{faq.category}' has been added to the system.",
        notification_type="common",
    )

    return FAQResponse(
        id=faq_id,
        question=faq.question,
        answer=faq.answer,
        category=faq.category,
        created_at=datetime.utcnow(),
        source_urls=[],
        verified=False,
    )

@router.delete("/admin/faqs/{faq_id}")
async def delete_faq(faq_id: str, current_user: User = Depends(get_current_admin_user)):

    try:
        if database.svu_vectors_db is None or database.documents_db is None:
            raise HTTPException(status_code=503, detail="Database not available")

        faq = database.svu_vectors_db.find_one({"_id": ObjectId(faq_id)})
        if not faq:
            faq = database.svu_vectors_db.find_one({"faq_id": faq_id})

        if not faq:
            raise HTTPException(status_code=404, detail="FAQ not found")

        source = faq.get("source")

        result = database.svu_vectors_db.delete_one({"_id": faq["_id"]})

        if result.deleted_count > 0:
                                                                  
            if source:
                database.documents_db.update_one(
                    {"filename": source},
                    {
                        "$inc": {"extracted_faqs": -1},
                        "$set": {"last_modified": datetime.utcnow()},
                    },
                )
            return {
                "status": "success",
                "message": "FAQ deleted and document count updated",
            }
        else:
            raise HTTPException(status_code=404, detail="FAQ not found during deletion")
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Delete FAQ Error: {e}")
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
        "timestamp": datetime.utcnow(),
    }

    database.suggested_faqs_db.insert_one(new_suggestion)

    return {"status": "success", "message": "FAQ suggestion submitted for review"}

@router.get("/admin/suggested-faqs", response_model=List[SuggestedFAQResponse])
async def get_suggested_faqs(current_user: User = Depends(get_current_admin_user)):

    if database.suggested_faqs_db is None:
        return []

    suggestions = list(database.suggested_faqs_db.find().sort("timestamp", -1))
    results = []
    for s in suggestions:
        results.append(
            SuggestedFAQResponse(
                id=str(s["_id"]),
                question=s["question"],
                answer=s["answer"],
                suggested_by=s.get("suggested_by", "Unknown"),
                timestamp=s.get("timestamp", datetime.utcnow()),
            )
        )
    return results

@router.post("/admin/suggested-faqs/{suggestion_id}/approve")
async def approve_suggested_faq(
    suggestion_id: str, current_user: User = Depends(get_current_admin_user)
):

    if database.suggested_faqs_db is None or database.svu_vectors_db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    suggestion = database.suggested_faqs_db.find_one({"_id": ObjectId(suggestion_id)})
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")

    new_faq = {
        "question": suggestion["question"],
        "answer": suggestion["answer"],
        "category": "User added faqs",
        "created_at": datetime.utcnow(),
        "suggested_by": suggestion.get("suggested_by"),
    }

    from ..services.rag_service import ingest_faq as rag_ingest_faq

    faq_id = str(ObjectId())

    try:
        await rag_ingest_faq(
            question=new_faq["question"],
            answer=new_faq["answer"],
            category=new_faq["category"],
            source="community_suggestion",
            faq_id=faq_id,
        )
    except Exception as e:
        logger.error(f"Failed to ingest FAQ into vector DB: {e}")

    suggestor = suggestion.get("suggested_by")
    if suggestor:
        await notification_service.create_notification(
            title="FAQ Approved",
            message=f"Your suggested FAQ '{suggestion.get('question')[:30]}...' has been approved.",
            user_id=suggestor,
            notification_type="personal",
        )

    database.suggested_faqs_db.delete_one({"_id": ObjectId(suggestion_id)})

    return {"status": "success", "message": "FAQ approved and published"}

@router.delete("/admin/suggested-faqs/{suggestion_id}")
async def reject_suggested_faq(
    suggestion_id: str, current_user: User = Depends(get_current_admin_user)
):

    suggestion = database.suggested_faqs_db.find_one({"_id": ObjectId(suggestion_id)})
    if not suggestion:
        raise HTTPException(status_code=404, detail="Suggestion not found")
                                            
    suggestor = suggestion.get("suggested_by")
    if suggestor:
        await notification_service.create_notification(
            title="FAQ Suggestion Update",
            message=f"Your suggested FAQ '{suggestion.get('question')[:30]}...' has been rejected by the admin.",
            user_id=suggestor,
            notification_type="personal",
        )

    database.suggested_faqs_db.delete_one({"_id": ObjectId(suggestion_id)})

    return {"status": "success", "message": "FAQ suggestion rejected"}

class AddTextRequest(pydantic.BaseModel):
    title: str
    content: str

class AddUrlRequest(pydantic.BaseModel):
    url: str

@router.post("/admin/add-text")
async def add_text_document(
    req: AddTextRequest, current_user: User = Depends(get_current_admin_user)
):

    try:
        logger.debug(f"Ingesting Text: {req.title}")

        doc_metadata = {
            "source": req.title,
            "type": "text_entry",
            "uploaded_by": current_user.username,
        }
        num_chunks = await ingest_text(req.content, metadata=doc_metadata, store_vectors=False)
        logger.debug(f"Text Entry Ingested. Chunks: {num_chunks}")

        from ..services.rag_service import process_and_refine_knowledge

        inserted_count = await process_and_refine_knowledge(req.content, req.title)

        doc_record = {
            "filename": req.title,                          
            "uploaded_by": current_user.username,
            "uploaded_at": datetime.utcnow(),
            "last_modified": datetime.utcnow(),
            "chunks": num_chunks,
            "status": "active",
            "type": "text",
            "extracted_faqs": inserted_count,
            "content": req.content,
        }
        if database.documents_db is not None:
            database.documents_db.insert_one(doc_record)

        return {
            "status": "success",
            "message": f"Ingested text '{req.title}'",
            "faqs_extracted": inserted_count,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Text ingestion failed: {str(e)}")

@router.post("/admin/upload-document")
async def upload_document(
    file: UploadFile = File(...), current_user: User = Depends(get_current_admin_user)
):

    try:
        upload_dir = config.Config.UPLOAD_DIR
        os.makedirs(upload_dir, exist_ok=True)
        file_path = os.path.join(upload_dir, file.filename)

        await save_and_validate_file(file, file_path, allowed_extensions=['.pdf'])

        logger.debug(f"Ingesting PDF: {file.filename}")
        num_chunks, full_text = await ingest_pdf(
            file_path, user_id="public", store_vectors=False
        )
        logger.debug(f"PDF Ingested. Chunks: {num_chunks}. Text len: {len(full_text)}")

        from ..services.rag_service import process_and_refine_knowledge

        inserted_count = await process_and_refine_knowledge(full_text, file.filename)

        doc_record = {
            "filename": file.filename,
            "uploaded_by": current_user.username,
            "uploaded_at": datetime.utcnow(),
            "last_modified": datetime.utcnow(),
            "chunks": num_chunks,
            "status": "active",
            "type": "pdf",
            "extracted_faqs": inserted_count,
        }
        if database.documents_db is not None:
            database.documents_db.insert_one(doc_record)

        return {
            "status": "success",
            "message": f"Ingested {num_chunks} chunks from {file.filename}",
            "faqs_extracted": inserted_count,
        }

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Upload failed: {str(e)}")

@router.post("/admin/add-url")
async def add_url_document(
    req: AddUrlRequest, current_user: User = Depends(get_current_admin_user)
):

    try:
        logger.debug(f"Ingesting URL: {req.url}")
        num_chunks, full_text = await ingest_url(req.url, store_vectors=False)
        logger.debug(f"URL Ingested. Chunks: {num_chunks}. Text len: {len(full_text)}")

        from ..services.rag_service import process_and_refine_knowledge

        inserted_count = await process_and_refine_knowledge(full_text, req.url)

        doc_record = {
            "filename": req.url,
            "uploaded_by": current_user.username,
            "uploaded_at": datetime.utcnow(),
            "last_modified": datetime.utcnow(),
            "chunks": num_chunks,
            "status": "active",
            "type": "url",
            "extracted_faqs": inserted_count,
        }
        if database.documents_db is not None:
            database.documents_db.insert_one(doc_record)

        return {
            "status": "success",
            "message": f"Ingested {num_chunks} chunks from URL",
            "faqs_extracted": inserted_count,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"URL ingestion failed: {str(e)}")

class ImportFAQsRequest(pydantic.BaseModel):
    source_name: str
    faqs: list  # List of dicts with 'question', 'answer', optional 'category', 'keywords'

@router.post("/admin/import-faqs")
async def import_processed_faqs(
    req: ImportFAQsRequest, current_user: User = Depends(get_current_admin_user)
):
    """
    Import pre-processed FAQs directly into the database.
    No LLM is used — FAQs are stored as-is with embeddings generated for vector search.
    """
    try:
        if not req.faqs:
            raise HTTPException(status_code=400, detail="No FAQs provided")

        if not req.source_name or not req.source_name.strip():
            raise HTTPException(status_code=400, detail="Source name is required")

        from ..services.rag_service import ingest_faq as rag_ingest_faq

        inserted_count = 0
        skipped_count = 0
        errors = []

        for i, faq_item in enumerate(req.faqs):
            question = faq_item.get("question", "").strip()
            answer = faq_item.get("answer", "").strip()
            category = faq_item.get("category", "General").strip()

            if not question or not answer:
                skipped_count += 1
                continue

            try:
                success = await rag_ingest_faq(
                    question=question,
                    answer=answer,
                    category=category,
                    source=req.source_name.strip(),
                )
                if success:
                    inserted_count += 1
                else:
                    skipped_count += 1  # Likely a duplicate
            except Exception as e:
                errors.append(f"FAQ #{i+1}: {str(e)}")
                logger.error(f"Error importing FAQ #{i+1}: {e}")

        # Create a document record for tracking in the Knowledge Base table
        doc_record = {
            "filename": req.source_name.strip(),
            "uploaded_by": current_user.username,
            "uploaded_at": datetime.utcnow(),
            "last_modified": datetime.utcnow(),
            "chunks": 0,
            "status": "active",
            "type": "faq_import",
            "extracted_faqs": inserted_count,
        }
        if database.documents_db is not None:
            database.documents_db.insert_one(doc_record)

        logger.info(
            f"[FAQ-IMPORT] {inserted_count} FAQs imported, {skipped_count} skipped from '{req.source_name}'"
        )

        return {
            "status": "success",
            "message": f"Imported {inserted_count} FAQs from '{req.source_name}'",
            "imported": inserted_count,
            "skipped": skipped_count,
            "errors": errors[:5] if errors else [],
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"FAQ Import Error: {e}")
        raise HTTPException(status_code=500, detail=f"FAQ import failed: {str(e)}")

@router.get("/dashboard-stats")
async def get_dashboard_stats(current_user: User = Depends(get_current_admin_user)):

    logger.info(f"Fetching dashboard stats for user: {current_user.username}")

    stats = {
        "total_queries": 0,
        "active_users": 0,
        "total_documents": 0,
        "role_distribution": {},
        "sentiment_stats": {"Positive": 0, "Neutral": 0, "Negative": 0},
    }

    try:
                                      
        if database.analytics_db is not None:
            stats["total_queries"] = database.analytics_db.count_documents({})

            stats["sentiment_stats"] = {
                "Positive": database.analytics_db.count_documents(
                    {"sentiment": "Positive"}
                ),
                "Neutral": database.analytics_db.count_documents(
                    {"sentiment": "Neutral"}
                ),
                "Negative": database.analytics_db.count_documents(
                    {"sentiment": "Negative"}
                ),
            }

        if database.users_db is not None:
            stats["active_users"] = database.users_db.estimated_document_count()
            roles = database.users_db.distinct("role")
            for r in roles:
                stats["role_distribution"][r] = database.users_db.count_documents(
                    {"role": r}
                )

        if database.documents_db is not None:
            doc_count = database.documents_db.count_documents({})
            logger.debug(f"Found {doc_count} documents in DB")
            stats["total_documents"] = doc_count
        else:
            logger.critical("documents_db is None!")

        return stats

    except Exception as e:
        logger.error(f"Dashboard Stats Error: {e}")
                                                 
        return stats

@router.get("/admin/system-health")
async def get_system_health(current_user: User = Depends(get_current_admin_user)):

    database.get_db_client()                                         
    mongo_status = "connected" if database.mongo_client else "disconnected"
    from ..services import rag_service

    vector_status = "active" if rag_service.vector_db else "offline"

    return {
        "api_status": "healthy",
        "mongodb_status": mongo_status,
        "vector_db_status": vector_status,
        "llm_service": "online" if config.Config.GROQ_API_KEY else "offline",
        "uptime": "99.9%",
        "last_reindexed": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
    }

@router.get("/admin/users", response_model=List[UserAdminResponse])
async def get_all_users(
    skip: int = 0, limit: int = 50, current_user: User = Depends(get_current_admin_user)
):

    projection = {"_id": 1, "username": 1, "role": 1, "created_at": 1, "status": 1}
    cursor = (
        database.users_db.find({}, projection)
        .sort("created_at", -1)
        .skip(skip)
        .limit(limit)
    )

    users = []
    for u in cursor:
        users.append(
            UserAdminResponse(
                id=str(u["_id"]),
                username=u["username"],
                role=u.get("role", "student"),
                created_at=u.get("created_at", datetime.utcnow()),
                status=u.get("status", "active"),
            )
        )
    return users

@router.post("/admin/users", status_code=201)
async def create_user(
    user_data: UserCreate, current_user: User = Depends(get_current_admin_user)
):

    if database.users_db.find_one({"username": user_data.username}):
        raise HTTPException(status_code=400, detail="User already exists")

    new_user = {
        "username": user_data.username,
        "password_hash": get_password_hash(user_data.password),
        "role": user_data.role,
        "created_at": datetime.utcnow(),
        "status": "active",
    }

    database.users_db.insert_one(new_user)
    return {"status": "success", "message": f"User {user_data.username} created"}

@router.put("/admin/users/{user_id}/role")
async def update_user_role(
    user_id: str,
    role_data: dict = Body(...),
    current_user: User = Depends(get_current_admin_user),
):

    new_role = role_data.get("role")
    if new_role not in ["student", "admin", "faculty"]:
        raise HTTPException(status_code=400, detail="Invalid role")

    try:
        database.users_db.update_one(
            {"_id": ObjectId(user_id)}, {"$set": {"role": new_role}}
        )
        return {"status": "success", "message": f"User role updated to {new_role}"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid User ID: {str(e)}")

@router.delete("/admin/users/{user_id}")
async def delete_user(
    user_id: str, current_user: User = Depends(get_current_admin_user)
):

    user_to_delete = database.users_db.find_one({"_id": ObjectId(user_id)})
    if user_to_delete and user_to_delete["username"] == current_user.username:
        raise HTTPException(
            status_code=400, detail="Cannot delete your own admin account"
        )

    try:
        database.users_db.delete_one({"_id": ObjectId(user_id)})
        return {"status": "success", "message": "User deleted"}
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Invalid User ID: {str(e)}")

@router.post("/admin/cache/clear")
async def clear_system_cache(current_user: User = Depends(get_current_admin_user)):

    from ..services import rag_service

    rag_service.store = {}
    return {"status": "success", "message": "System cache (session history) cleared."}

@router.get("/admin/system-logs")
async def get_admin_system_logs(
    limit: int = 50, current_user: User = Depends(get_current_admin_user)
):

    logs = get_recent_logs(limit)
                                                     
    formatted_logs = []
    for log in logs:
        formatted_logs.append(
            {
                "level": log["level"],
                "message": log["message"],
                "details": log.get("details"),
                "timestamp": log["timestamp"].strftime("%Y-%m-%d %H:%M:%S"),
            }
        )
    return formatted_logs

@router.post("/admin/reindex")
async def reindex_knowledge_base(current_user: User = Depends(get_current_admin_user)):

    from ..services import rag_service

    try:
                                       
        database.get_db_client()
                                                           
        rag_service.setup_rag_chain(force_reload=True)
        return {"status": "success", "message": "Knowledge base connection refreshed."}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/admin/documents")
async def list_documents(
    skip: int = 0, limit: int = 50, current_user: User = Depends(get_current_admin_user)
):

    if database.documents_db is None:
        return []

    docs = []
    cursor = (
        database.documents_db.find().sort("uploaded_at", -1).skip(skip).limit(limit)
    )
    for doc in cursor:
        doc["_id"] = str(doc["_id"])
        docs.append(doc)
    return docs

@router.get("/admin/brain/status")
@router.get("/admin/documents/{doc_id}/faqs", response_model=List[FAQResponse])
async def get_document_faqs(
    doc_id: str, current_user: User = Depends(get_current_admin_user)
):

    if database.documents_db is None or database.svu_vectors_db is None:
        raise HTTPException(status_code=500, detail="Database not available")

    from bson import ObjectId

    try:
        doc = database.documents_db.find_one({"_id": ObjectId(doc_id)})
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")

        identifier = doc.get("filename")
        if not identifier:
            return []

        faqs_raw = list(
            database.svu_vectors_db.find({"type": "faq", "source": identifier})
        )

        if not faqs_raw:
            logger.info(
                f"No type='faq' docs found for {identifier}, trying lenient search..."
            )
            faqs_raw = list(
                database.svu_vectors_db.find(
                    {
                        "source": identifier,
                        "text": {"$regex": "Question:", "$options": "i"},
                    }
                )
            )

        faqs = []
        for f in faqs_raw:
            text = f.get("text", "")
            question = ""
            answer = ""
            if "Question:" in text and "Answer:" in text:
                parts = text.split("Answer:", 1)
                question = parts[0].replace("Question:", "").strip()
                answer = parts[1].strip()
            else:
                                                    
                question = text[:100]
                answer = text

            faqs.append(
                FAQResponse(
                    id=str(f["_id"]),
                    question=question,
                    answer=answer,
                    category=f.get("category", "General"),
                    created_at=f.get("created_at", datetime.utcnow()),
                    source_urls=f.get("source_urls", [f.get("source", identifier)]),
                    verified=f.get("verified", False),
                )
            )

        return faqs
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/admin/documents/{doc_id}")
async def delete_document(
    doc_id: str, current_user: User = Depends(get_current_admin_user)
):

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
            return {
                "status": "success",
                "message": "Document deleted (No filename found for cascade)",
            }

        database.documents_db.delete_one({"_id": ObjectId(doc_id)})

        import re
        safe_filename = re.escape(filename)
                                       
        source_regex = {"$regex": f"^{safe_filename}$", "$options": "i"}

        if database.svu_vectors_db is not None:
                                                  
            delete_result = database.svu_vectors_db.delete_many(
                {"type": "faq", "source": source_regex}
            )
            logger.info(
                f"Deleted {delete_result.deleted_count} FAQs associated with {filename}"
            )

        if database.mongo_client is not None:
            vector_collection_name = Config.COLLECTION_NAME or "documents"
            vector_collection = database.mongo_client[Config.DB_NAME][
                vector_collection_name
            ]

            vector_delete_result = vector_collection.delete_many(
                {
                    "$or": [
                        {"source": source_regex},
                        {"metadata.source": source_regex}
                    ]
                }
            )
            logger.info(
                f"Deleted {vector_delete_result.deleted_count} vector chunks for {filename}"
            )

        return {
            "status": "success",
            "message": f"Document and associated data deleted for {filename}",
        }

    except Exception as e:
        logger.error(f"Delete Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")

@router.put("/admin/faqs/{faq_id}")
async def update_faq(
    faq_id: str, faq: FAQRequest, current_user: User = Depends(get_current_admin_user)
):

    if database.svu_vectors_db is None:
        raise HTTPException(status_code=500, detail="Database not available")

    from bson import ObjectId

    try:
        formatted_text = f"Question: {faq.question}\nAnswer: {faq.answer}"
        update_data = {
            "text": formatted_text,
            "category": faq.category,
            "updated_at": datetime.utcnow(),
            "updated_by": current_user.username,
        }

        if embeddings:
            try:
                update_data["embedding"] = embeddings.embed_query(formatted_text)
            except Exception as e:
                logger.error(f"Error re-embedding FAQ {faq_id}: {e}")
        result = database.svu_vectors_db.update_one(
            {"_id": ObjectId(faq_id)}, {"$set": update_data}
        )

        if result.matched_count == 0:
            raise HTTPException(status_code=404, detail="FAQ not found")

        updated_faq = database.svu_vectors_db.find_one({"_id": ObjectId(faq_id)})
        if updated_faq:
            source = updated_faq.get("source")
            if source:
                database.documents_db.update_one(
                    {"filename": source}, {"$set": {"last_modified": datetime.utcnow()}}
                )

        return {
            "status": "success",
            "message": "FAQ updated and re-indexed successfully",
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))

@router.get("/locations", response_model=List[LocationResponse])
async def get_public_locations(current_user: User = Depends(get_current_user)):
    """Public endpoint to fetch locations for all authenticated users."""
    if database.locations_db is None:
        return []

    cursor = database.locations_db.find().sort("name", 1)
    results = []
    for loc in cursor:
        results.append(
            LocationResponse(
                id=str(loc["_id"]),
                name=loc["name"],
                category=loc["category"],
                description=loc.get("description"),
                created_at=loc.get("created_at", datetime.utcnow()),
            )
        )
    return results

@router.get("/admin/locations", response_model=List[LocationResponse])
async def get_all_locations(current_user: User = Depends(get_current_admin_user)):

    return await get_public_locations(current_user)

@router.post("/admin/locations", response_model=LocationResponse)
async def create_location(
    loc: LocationModel, current_user: User = Depends(get_current_admin_user)
):

    new_loc = loc.dict()
    new_loc["created_at"] = datetime.utcnow()

    result = database.locations_db.insert_one(new_loc)
    new_loc["id"] = str(result.inserted_id)

    await notification_service.create_notification(
        title="New Location Added",
        message=f"New campus location '{loc.name}' is now available in the map.",
        notification_type="common",
    )

    return new_loc

@router.put("/admin/locations/{loc_id}", response_model=LocationResponse)
async def update_location(
    loc_id: str,
    loc_update: LocationUpdate,
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    update_data = {k: v for k, v in loc_update.dict().items() if v is not None}
    if not update_data:
        raise HTTPException(status_code=400, detail="No data to update")

    result = database.locations_db.update_one(
        {"_id": ObjectId(loc_id)}, {"$set": update_data}
    )

    if result.matched_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")

    updated_loc = database.locations_db.find_one({"_id": ObjectId(loc_id)})
    updated_loc["id"] = str(updated_loc["_id"])

    await notification_service.create_notification(
        title="Location Updated",
        message=f"Campus location '{updated_loc.get('name')}' has been updated.",
        notification_type="common",
    )

    return updated_loc

@router.delete("/admin/locations/{loc_id}")
async def delete_location(loc_id: str, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    if database.locations_db is None:
        raise HTTPException(status_code=503, detail="Database not available")

    result = database.locations_db.delete_one({"_id": ObjectId(loc_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Location not found")

    await notification_service.create_notification(
        title="Location Removed",
        message="A campus location has been removed from the map.",
        notification_type="common",
    )

    return {"status": "success", "message": "Location deleted"}

@router.get("/admin/trending", response_model=List[TrendingQueryResponse])
async def get_trending_queries():
    if database.trending_queries_db is None:
        return []
    queries = list(database.trending_queries_db.find().sort("order", 1))
    results = []
    for q in queries:
        results.append(
            TrendingQueryResponse(
                id=str(q["_id"]),
                text=q["text"],
                subtext=q["subtext"],
                icon=q["icon"],
                response=q.get("response"),
                link=q.get("link"),
                order=q.get("order", 0),
                created_at=q.get("created_at", datetime.utcnow()),
            )
        )
    return results

@router.post("/admin/trending", response_model=TrendingQueryResponse)
async def add_trending_query(
    query: TrendingQueryModel, current_user: User = Depends(get_current_user)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    if database.trending_queries_db is None:
        raise HTTPException(status_code=500, detail="Database not initialized")

    count = database.trending_queries_db.count_documents({})
    if count >= 4:
        raise HTTPException(
            status_code=400, detail="Maximum of 4 trending queries allowed"
        )

    new_query = query.dict()
    new_query["created_at"] = datetime.utcnow()

    result = database.trending_queries_db.insert_one(new_query)

    new_query.pop("_id", None)

    await notification_service.create_notification(
        title="Trending Today",
        message=f"Check out the new trending query: '{query.text}'",
        notification_type="common",
    )

    return TrendingQueryResponse(id=str(result.inserted_id), **new_query)

@router.put("/admin/trending/{query_id}", response_model=TrendingQueryResponse)
async def update_trending_query(
    query_id: str,
    update: TrendingQueryUpdate,
    current_user: User = Depends(get_current_user),
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    if database.trending_queries_db is None:
        raise HTTPException(status_code=500, detail="Database not initialized")

    update_data = {k: v for k, v in update.dict().items() if v is not None}

    if not update_data:
        raise HTTPException(status_code=400, detail="No data provided for update")

    result = database.trending_queries_db.find_one_and_update(
        {"_id": ObjectId(query_id)}, {"$set": update_data}, return_document=True
    )

    if not result:
        raise HTTPException(status_code=404, detail="Query not found")

    result.pop("_id", None)

    await notification_service.create_notification(
        title="Trending Queries Update",
        message=f"The trending topics have been updated. Check them out!",
        notification_type="common",
    )

    return TrendingQueryResponse(id=query_id, **result)

@router.delete("/admin/trending/{query_id}")
async def delete_trending_query(
    query_id: str, current_user: User = Depends(get_current_user)
):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    if database.trending_queries_db is None:
        raise HTTPException(status_code=500, detail="Database not initialized")

    result = database.trending_queries_db.delete_one({"_id": ObjectId(query_id)})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Query not found")

    await notification_service.create_notification(
        title="Trending Queries Update",
        message=f"Trending queries have been refreshed.",
        notification_type="common",
    )

    return {"status": "success", "message": "Query deleted"}

@router.post("/admin/repair/sync-faq-counts")
async def sync_faqs_count(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")

    if database.documents_db is None or database.svu_vectors_db is None:
        raise HTTPException(status_code=500, detail="Database not available")

    try:
        docs = list(database.documents_db.find({}))
        synced_count = 0

        for doc in docs:
            filename = doc.get("filename")
            if not filename:
                continue

            actual_count = database.svu_vectors_db.count_documents(
                {"source": filename, "type": "faq"}
            )

            database.documents_db.update_one(
                {"_id": doc["_id"]}, {"$set": {"extracted_faqs": actual_count}}
            )
            synced_count += 1

        return {
            "status": "success",
            "message": f"Synced FAQ counts for {synced_count} documents",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# URL Knowledge-Base Pipeline  (Zero-LLM batch ingestion)
# ---------------------------------------------------------------------------

class IngestUrlsRequest(pydantic.BaseModel):
    urls: List[str]


@router.post("/admin/kb/ingest-urls")
async def ingest_urls_pipeline(
    req: IngestUrlsRequest,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(get_current_admin_user),
):
    """
    Submit a list of URLs for zero-LLM FAQ extraction.
    Returns a job_id that can be polled for progress.
    The extraction runs in the background.
    """
    from ..services.url_kb_pipeline import create_job, run_pipeline

    urls = [u.strip() for u in req.urls if u.strip()]
    if not urls:
        raise HTTPException(status_code=400, detail="No valid URLs provided.")
    if len(urls) > 50:
        raise HTTPException(status_code=400, detail="Maximum 50 URLs per job.")

    job_id = create_job(urls, submitted_by=current_user.username)

    # Run in FastAPI background task so the response returns immediately
    background_tasks.add_task(run_pipeline, job_id, urls)

    logger.info(
        f"[KB-PIPELINE] Job {job_id} submitted by {current_user.username} with {len(urls)} URLs."
    )
    return {
        "status": "submitted",
        "job_id": job_id,
        "total_urls": len(urls),
        "message": "Extraction started in background. Poll /admin/kb/jobs/{job_id} for progress.",
    }


@router.get("/admin/kb/jobs")
async def list_kb_jobs(
    limit: int = 20,
    current_user: User = Depends(get_current_admin_user),
):
    """List recent knowledge-base ingestion jobs."""
    from ..services.url_kb_pipeline import list_jobs
    return list_jobs(limit=limit)


@router.get("/admin/kb/jobs/{job_id}")
async def get_kb_job_status(
    job_id: str,
    current_user: User = Depends(get_current_admin_user),
):
    """Get status and per-URL results for a specific ingestion job."""
    from ..services.url_kb_pipeline import get_job
    job = get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found.")
    return job


@router.delete("/admin/kb/jobs/{job_id}")
async def delete_kb_job(
    job_id: str,
    current_user: User = Depends(get_current_admin_user),
):
    """Delete a completed job record from the database."""
    from ..core.config import Config
    col = database.mongo_client[Config.DB_NAME]["kb_jobs"] if database.mongo_client else None
    if col is None:
        raise HTTPException(status_code=503, detail="Database not available.")
    result = col.delete_one({"job_id": job_id})
    if result.deleted_count == 0:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"status": "success", "message": f"Job {job_id} deleted."}

