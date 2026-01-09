from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from .auth import get_current_admin_user
from ..services.rag_service import ingest_pdf, ingest_url
from ..core import database
import shutil
import os
import logging
from datetime import datetime
from bson.objectid import ObjectId
from typing import List

router = APIRouter()
logger = logging.getLogger("uvicorn")
import pydantic

UPLOAD_DIR = "uploads/documents"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/admin/upload")
async def upload_document(file: UploadFile = File(...), admin_user = Depends(get_current_admin_user)):
    # 1. Validate File Type
    if not file.filename.lower().endswith('.pdf'):
        raise HTTPException(status_code=400, detail="Only PDF files are allowed")

    # 2. Save File
    file_path = os.path.join(UPLOAD_DIR, file.filename)
    try:
        with open(file_path, "wb") as buffer:
            shutil.copyfileobj(file.file, buffer)
    except Exception as e:
        logger.error(f"File Save Error: {e}")
        raise HTTPException(status_code=500, detail="Could not save file")

    # 3. Trigger Ingestion (Async)
    # Note: For production, this should be a background task. For now, we await it.
    try:
        num_chunks = await ingest_pdf(file_path)
        
        # 4. Save Metadata to MongoDB
        doc_record = {
            "filename": file.filename,
            "upload_date": datetime.utcnow(),
            "status": "processed",
            "chunks": num_chunks,
            "uploaded_by": admin_user.username
        }
        database.documents_db.insert_one(doc_record)
        
        return {"status": "success", "message": f"Successfully ingested {file.filename}", "chunks": num_chunks}
    except Exception as e:
        logger.error(f"Ingestion Failed: {e}")
        # Record failure if possible, or just error out
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")

class UrlRequest(pydantic.BaseModel):
    url: str

@router.post("/admin/ingest-url")
async def ingest_url_endpoint(request: UrlRequest, admin_user = Depends(get_current_admin_user)):
    try:
        num_chunks = await ingest_url(request.url)
        
        # Save Metadata
        doc_record = {
            "filename": request.url,
            "upload_date": datetime.utcnow(),
            "status": "processed",
            "chunks": num_chunks,
            "uploaded_by": admin_user.username,
            "type": "url"
        }
        database.documents_db.insert_one(doc_record)
        
        return {"status": "success", "message": f"Successfully ingested {request.url}", "chunks": num_chunks}
    except Exception as e:
        logger.error(f"URL Ingestion Failed: {e}")
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")

@router.get("/admin/documents")
async def list_documents(admin_user = Depends(get_current_admin_user)):
    docs = []
    cursor = database.documents_db.find().sort("upload_date", -1)
    for doc in cursor:
        doc["_id"] = str(doc["_id"])
        docs.append(doc)
    return docs

@router.delete("/admin/documents/{doc_id}")
async def delete_document(doc_id: str, admin_user = Depends(get_current_admin_user)):
    try:
        result = database.documents_db.delete_one({"_id": ObjectId(doc_id)})
        if result.deleted_count == 0:
             raise HTTPException(status_code=404, detail="Document not found")
        
        # Optional: Delete actual file from disk
        # Optional: Remove vectors from Vector DB (requires storing IDs or source filtering)
        
        return {"status": "success", "message": "Document deleted"}
    except Exception as e:
        logger.error(f"Delete Error: {e}")
        raise HTTPException(status_code=500, detail="Failed to delete document")
