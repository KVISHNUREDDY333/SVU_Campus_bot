from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List
from datetime import datetime
from ..core import database
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import rag_service
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os

from ..models.academic import StudyBuddyChatRequest
import shutil
from bson import ObjectId

router = APIRouter(prefix="/study-buddy", tags=["Study Buddy"])

UPLOAD_DIR = "backend/uploads/study_materials"
os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/chat")
async def chat_with_material(req: StudyBuddyChatRequest, current_user: User = Depends(get_current_user)):
    material = database.study_materials_db.find_one({"_id": ObjectId(req.material_id), "user_id": current_user.username})
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    try:
        from ..services.rag_service import rag_service
        if not rag_service.vector_db:
            rag_service.setup_rag_chain()
        
        # We perform a similarity search filtered by filename and user_id
        # This ensures the context is ONLY from this specific document
        filter_metadata = {
            "source": material["filename"],
            "user_id": current_user.username
        }
        
        # Use existing vector_db for search
        docs = rag_service.vector_db.similarity_search(
            req.query, 
            k=5, 
            filter=filter_metadata
        )
        
        context = "\n\n".join([doc.page_content for doc in docs])
        
        if not context.strip():
            # Fallback if no specific chunks found (maybe metadata mismatch)
            # Try searching just by filename
            docs = rag_service.vector_db.similarity_search(req.query, k=5, filter={"source": material["filename"]})
            context = "\n\n".join([doc.page_content for doc in docs])

        prompt = f"""
        You are an academic assistant helping a student with their lecture notes.
        DOCUMENT: {material['filename']}
        
        CONTEXT FROM DOCUMENT:
        {context}
        
        USER QUESTION:
        {req.query}
        
        INSTRUCTIONS:
        1. Answer based ONLY on the context provided above.
        2. If the answer is not in the context, say: "I couldn't find specific information about that in this document, but I can help you with what's available."
        3. Be encouraging and helpful.
        """
        
        if not rag_service.llm:
             rag_service.setup_rag_chain()
             
        response = await rag_service.llm.ainvoke(prompt)
        return {"response": response.content, "context_used": len(docs) > 0}

    except Exception as e:
        print(f"Study Chat Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI Chat Error: {str(e)}")

@router.post("/upload")
async def upload_material(file: UploadFile = File(...), current_user: User = Depends(get_current_user)):
    file_path = os.path.join(UPLOAD_DIR, f"{current_user.username}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    # Ingest into Vector DB for RAG & Get Text
    num_chunks = 0
    full_text = ""
    try:
        from ..services.rag_service import ingest_pdf
        num_chunks, full_text = await ingest_pdf(file_path, user_id=current_user.username)
    except Exception as e:
        print(f"Study Material Ingestion Failed: {e}")
        # We might still want to continue if we have the file, but RAG won't work.
        # However, for summary we need text. if ingest_pdf failed, we might not have text.
        # Assuming ingest_pdf does the text extraction.
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")

    # Generate Summary immediately
    summary_text = ""
    try:
        from ..services.rag_service import rag_service
        if not rag_service.llm:
             rag_service.setup_rag_chain()
        
        if rag_service.llm:
            prompt = f"""
            You are an elite academic consultant and subject matter expert. 
            Analyze the following educational material with extreme depth and precision.
            
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
            Generate as many high-probability exam questions as possible, covering all levels of Bloom's Taxonomy.
            
            ---
            MATERIAL CONTENT:
            {full_text[:50000]}
            """
            response = await rag_service.llm.ainvoke(prompt)
            summary_text = response.content
            
    except Exception as e:
        print(f"Auto-Summary Failed: {e}")
        # Continue without summary, user can try later
        summary_text = "Summary generation failed. Please try again later."

    # Store in DB
    material = {
        "user_id": current_user.username,
        "filename": file.filename,
        "file_path": file_path,
        "upload_date": datetime.utcnow(),
        "chunks": num_chunks,
        "summary": summary_text # Persist summary
    }
    result = database.study_materials_db.insert_one(material)
    
    return {
        "status": "success", 
        "id": str(result.inserted_id), 
        "filename": file.filename, 
        "chunks": num_chunks,
        "summary": summary_text
    }

@router.get("/materials")
async def get_materials(current_user: User = Depends(get_current_user)):
    materials = list(database.study_materials_db.find({"user_id": current_user.username}).sort("upload_date", -1))
    for m in materials:
        m["id"] = str(m["_id"])
        del m["_id"]
    return materials

@router.post("/summarize/{material_id}")
async def summarize_material(material_id: str, current_user: User = Depends(get_current_user)):
    material = database.study_materials_db.find_one({"_id": ObjectId(material_id), "user_id": current_user.username})
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    # If summary already exists, return it? 
    # User might want to re-generate. Let's re-generate or return existing?
    # For now, let's keep the re-generation logic as distinct action.
    
    try:
        from ..services.rag_service import ingest_pdf
        _, text = await ingest_pdf(material["file_path"])
        
        from ..services.rag_service import rag_service
        if not rag_service.llm:
             rag_service.setup_rag_chain()
        
        prompt = f"""
        You are an elite academic consultant and subject matter expert. 
        Analyze the following educational material with extreme depth and precision.
        
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
        Generate as many high-probability exam questions as possible, covering all levels of Bloom's Taxonomy.
        
        ---
        MATERIAL CONTENT:
        {text[:50000]}
        """
        
        response = await rag_service.llm.ainvoke(prompt)
        
        # Update DB with new summary
        database.study_materials_db.update_one(
            {"_id": ObjectId(material_id)},
            {"$set": {"summary": response.content}}
        )
        
        return {"summary": response.content}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/materials/{material_id}")
async def delete_material(material_id: str, current_user: User = Depends(get_current_user)):
    material = database.study_materials_db.find_one({"_id": ObjectId(material_id), "user_id": current_user.username})
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    if os.path.exists(material["file_path"]):
        os.remove(material["file_path"])
    
    database.study_materials_db.delete_one({"_id": ObjectId(material_id)})
    
    return {"status": "success", "message": "Material deleted"}
