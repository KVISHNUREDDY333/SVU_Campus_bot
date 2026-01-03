from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from .auth import get_current_admin_user
from ..services.rag_service import ingest_pdf
import shutil
import os
import logging

router = APIRouter()
logger = logging.getLogger("uvicorn")

UPLOAD_DIR = "backend/uploads"
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
        return {"status": "success", "message": f"Successfully ingested {file.filename}", "chunks": num_chunks}
    except Exception as e:
        logger.error(f"Ingestion Failed: {e}")
        # We return 500 but strictly speaking the file upload worked, just processing failed.
        raise HTTPException(status_code=500, detail=f"Ingestion failed: {str(e)}")
