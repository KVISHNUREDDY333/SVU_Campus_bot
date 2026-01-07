from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List
from datetime import datetime
from ..core import database
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import rag_service
import os
import shutil
from bson import ObjectId

router = APIRouter(prefix="/study-buddy", tags=["Study Buddy"])

UPLOAD_DIR = "uploads/study_materials"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/upload")
async def upload_material(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    file_path = os.path.join(UPLOAD_DIR, f"{current_user.username}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Ingest into Vector DB for RAG (private to user)
    num_chunks = 0
    try:
        from ..services.rag_service import ingest_pdf
        num_chunks, _ = await ingest_pdf(file_path, user_id=current_user.username)
    except Exception as e:
        print(f"Study Material Ingestion Failed: {e}")

    # Store in DB
    material = {
        "user_id": current_user.username,
        "filename": file.filename,
        "file_path": file_path,
        "upload_date": datetime.utcnow(),
        "chunks": num_chunks
    }
    result = database.study_materials_db.insert_one(material)
    
    return {"status": "success", "id": str(result.inserted_id), "filename": file.filename, "chunks": num_chunks}

@router.get("/materials")
async def get_materials(current_user: User = Depends(get_current_user)):
    materials = list(database.study_materials_db.find({"user_id": current_user.username}))
    for m in materials:
        m["id"] = str(m["_id"])
        del m["_id"]
    return materials

@router.post("/summarize/{material_id}")
async def summarize_material(material_id: str, current_user: User = Depends(get_current_user)):
    material = database.study_materials_db.find_one({"_id": ObjectId(material_id), "user_id": current_user.username})
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    try:
        from ..services.rag_service import ingest_pdf
        _, text = await ingest_pdf(material["file_path"])
        
        if not rag_service.llm:
            try:
                rag_service.setup_rag_chain()
            except Exception as e:
                raise HTTPException(status_code=500, detail=f"LLM Initialization Failed: {str(e)}")
        
        # Double check if still None (e.g. if setup_rag_chain returned early due to missing DB)
        if not rag_service.llm:
             # Try a minimal setup or just error out with a better message
             raise HTTPException(status_code=500, detail="AI Service is currently offline. Please ensure the backend is connected to the database and API keys are valid.")
        
        prompt = f"""
        You are an elite academic consultant and subject matter expert. 
        Analyze the following educational material with extreme depth and precision.
        Your goal is to be a powerful academic companion to the student.
        
        Please provide a comprehensive report structured as follows:
        
        ### 📌 Deep Topic Overview
        A detailed explanation of the core subject, its significance, and the main objectives of this material.
        
        ### 🔑 Definitions & Core Concepts
        Create an extensive glossary of all technical terms, formulas, or key dates mentioned. Explain each in easy-to-understand language.
        
        ### 📝 Master Summary
        A massive, structured breakdown of the entire document. Use hierarchy, bullet points, and sections to organize the knowledge logically. 
        Capture all the nuances—no detail is too small if it's relevant to the topic.
        
        ### 💡 Strategic Study Roadmap
        Provide a step-by-step guide on how to master this specific content. Suggest related topics to review and memory techniques (like Mnemonics) suitable for this data.
        
        ### ❓ Expert Exam Preparation (Comprehensive)
        Generate as many high-probability exam questions as possible, covering all levels of Bloom's Taxonomy (from memory to critical application). 
        Include:
        - Multiple Choice Questions (Short)
        - Descriptive/Long Answer Questions (Detailed)
        - Scenario-based application questions.
        
        ---
        MATERIAL CONTENT:
        {text[:50000]}
        """
        
        try:
            response = await rag_service.llm.ainvoke(prompt)
            return {"summary": response.content}
        except AttributeError:
             # This happens if rag_service.llm is None despite the checks
             raise HTTPException(status_code=500, detail="AI Service unavailable: LLM engine failed to warm up.")
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/exams")
async def get_exams(current_user: User = Depends(get_current_user)):
    # Fetch exams for the user's department or common ones
    exams = list(database.exam_dates_db.find({"$or": [{"department": current_user.role}, {"department": "Common"}]}))
    for e in exams:
        e["id"] = str(e["_id"])
        del e["_id"]
    return exams

@router.post("/add-exam")
async def add_exam(exam: dict, current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can add exam dates")
    
    exam["date"] = datetime.fromisoformat(exam["date"])
    database.exam_dates_db.insert_one(exam)
    return {"status": "success"}
