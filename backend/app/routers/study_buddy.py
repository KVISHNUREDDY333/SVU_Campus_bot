from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List
import logging
from datetime import datetime
from ..core import database
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import rag_service
from langchain_text_splitters import RecursiveCharacterTextSplitter
import os
from ..services.moderation import ModerationService

from ..models.academic import StudyBuddyChatRequest, ZenRequest
import shutil
from bson import ObjectId
from pypdf import PdfReader
from pydantic import BaseModel

class StudyMaterialTextRequest(BaseModel):
    title: str
    content: str

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/study-buddy", tags=["Study Buddy"])


# Get absolute path to backend directory (assuming router is in backend/app/routers)
# .../backend/app/routers/study_buddy.py -> .../backend
# Standardise to project root "uploads" folder
CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
# app/routers -> app -> backend -> project_root
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(CURRENT_DIR)))
UPLOAD_DIR = os.path.abspath(os.path.join(PROJECT_ROOT, "uploads", "study_materials"))

os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/chat")
async def chat_with_material(req: StudyBuddyChatRequest, current_user: User = Depends(get_current_user)):
    material = database.study_materials_db.find_one({"_id": ObjectId(req.material_id), "user_id": current_user.username})
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")
    
    # Check content restrictions
    if not await ModerationService.check_content(req.query):
        return {"response": ModerationService.get_rejection_message(), "context_used": False}
    
    try:
        if not rag_service.vector_db:
            rag_service.setup_rag_chain()
        
        # We perform a similarity search filtered by filename and user_id
        # This ensures the context is ONLY from this specific document
        filter_metadata = {
            "source": material["filename"],
            "user_id": current_user.username
        }
        
        # Use existing vector_db for search with higher k and score filtering if needed
        # The new embeddings (mpnet) will automatically improve these results.
        docs = rag_service.vector_db.similarity_search_with_score(
            req.query, 
            k=8, 
            filter=filter_metadata
        )
        
        # Filter by threshold 0.5 (slightly lower for specific docs to be safe)
        valid_docs = [doc for doc, score in docs if score >= 0.5]
        if not valid_docs:
             # Fallback to search just by filename
             docs = rag_service.vector_db.similarity_search(req.query, k=5, filter={"source": material["filename"]})
             valid_docs = docs
             
        context = "\n\n".join([doc.page_content for doc in valid_docs])
        
        prompt = f"""
        You are an academic assistant helping a student with their lecture notes.
        DOCUMENT: {material['filename']}
        
        CONTEXT FROM DOCUMENT:
        {context}
        
        USER QUESTION:
        {req.query}
        
        INSTRUCTIONS:
        1. Answer based ONLY on the context provided above. Do NOT use external knowledge.
        2. If the answer is not in the context, say: "I'm sorry, but that specific information is not available in the uploaded document. I can only provide details found within the provided data."
        3. Be encouraging and helpful.
        """
        
        if not rag_service.llm:
             rag_service.setup_rag_chain()
             
        response = await rag_service.llm.ainvoke(prompt)
        return {"response": response.content, "context_used": len(valid_docs) > 0}

    except Exception as e:
        print(f"Study Chat Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI Chat Error: {str(e)}")

@router.post("/zen")
async def ask_zen(req: ZenRequest, current_user: User = Depends(get_current_user)):
    """
    Direct generative AI interaction (Groq-like) without vector search.
    History is managed in-memory (sent by client).
    """
    try:
        # Check content restrictions
        if not await ModerationService.check_content(req.query):
            return {"response": ModerationService.get_rejection_message()}

        if not rag_service.llm:
            rag_service.setup_rag_chain()
        
        system_prompt = """You are Zen, the elite Academic AI Strategist for Sri Venkateswara University (SVU). 
        You represent the pinnacle of academic brilliance, combined with deep empathy and a mission to accelerate student success.

        PERSONA & IDENTITY:
        1. Context: You are deployed in the SVU Smart Campus Ecosystem.
        2. Tone: Professional, sophisticated, intellectually rigorous, yet deeply encouraging.
        3. Expertise: You possess PhD-level knowledge across Engineering, Pharma, Management, and Sciences.

        REASONING & STYLE FRAMEWORK:
        1. High-Density Information: Provide detailed, well-structured, and accurate academic content. Avoid fluff.
        2. Visual Hierarchy: Use professional Markdown (### Headers, **Bold**, `inline code`, and Tables) for clarity.
        3. Code Excellence: When providing code, use clear blocks with language tags, comments, and best practices.
        4. Technical Accuracy: Use LaTeX notation (e.g., $E=mc^2$ or $$ formula $$) for all mathematical and scientific equations.
        5. SVU Context: If appropriate, mention SVU departments, local placement standards, or campus resources.

        FOLLOW-UP LOGIC:
        At the end of EVERY response, provide EXACTLY 3 relevant, thought-provoking follow-up question chips. 
        Formatting: Separate them with a double newline after your main response.
        """
        
        # Construct message list for LangChain
        messages = [("system", system_prompt)]
        for msg in req.history[-10:]: # Pass last 10 turns
            role = "human" if msg["role"] == "user" else "ai"
            messages.append((role, msg["content"]))
        
        messages.append(("human", req.query))
        
        response = await rag_service.llm.ainvoke(messages)
        return {"response": response.content}

    except Exception as e:
        logger.error(f"Zen Chat Error: {e}")
        raise HTTPException(status_code=500, detail=f"Zen AI Error: {str(e)}")

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
        if not rag_service.fast_llm:
             rag_service.setup_rag_chain()
        
        if rag_service.fast_llm:
            prompt = f"""
            You are an expert academic tutor. Analyze the following document text and provide a structured learning summary.
            
            OUTPUT FORMAT (Strictly follow this structure):
            
            **📝 Summary**
            [Provide a concise overview of the document's main topic and purpose in 3-5 sentences.]

            **🔑 Key Points**
            [List 5-8 most critical concepts or takeaways from the text.]
            - Point 1
            - Point 2
            ...

            **✅ Advantages / Benefits**
            [List the positive aspects, pros, or benefits discussed in the text.]
            - Advantage 1
            - Advantage 2
            ...

            **⚠️ Limitations / Challenges**
            [List the negative aspects, cons, limitations, or challenges discussed.]
            - Limitation 1
            - Limitation 2
            ...

            **💡 Examples**
            [Provide 3-4 concrete examples mentioned in the text (or relevant analogies if none exist), with a simple and brief explanation for each.]
            - **Example 1**: [Brief explanation]
            - **Example 2**: [Brief explanation]
            ...
            
            ---
            At the end of your analysis, please ask: "Do you have any specific questions about this analysis or would you like me to clarify anything from the document?"

            CRITICAL GROUNDING RULE: You must base all information EXCLUSIVELY on the provided document text. Do not use external facts or general knowledge. If information is missing, state that it is not in the document.
            
            MATERIAL CONTENT:
            {full_text[:10000]}
            """
            response = await rag_service.fast_llm.ainvoke(prompt)
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

@router.post("/upload-text")
async def upload_text_material(req: StudyMaterialTextRequest, current_user: User = Depends(get_current_user)):
    # Create a pseudo-filename
    filename = f"{req.title}.txt"
    file_path = os.path.join(UPLOAD_DIR, f"{current_user.username}_{filename}")
    
    # Save text to file
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(req.content)
    
    # Ingest text into Vector DB
    num_chunks = 0
    try:
        from ..services.rag_service import ingest_text
        # We use ingest_text which expects text and metadata
        num_chunks = await ingest_text(
            req.content, 
            metadata={"source": filename, "user_id": current_user.username}
        )
    except Exception as e:
        print(f"Study Material Text Ingestion Failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process text: {str(e)}")

    # Generate Summary
    summary_text = ""
    try:
        if not rag_service.fast_llm:
             rag_service.setup_rag_chain()
        
        if rag_service.fast_llm:
            prompt = f"""
            You are an expert academic tutor. Analyze the following document text and provide a structured learning summary.
            
            OUTPUT FORMAT (Strictly follow this structure):
            
            **📝 Summary**
            [Provide a concise overview of the document's main topic and purpose in 3-5 sentences.]

            **🔑 Key Points**
            [List 5-8 most critical concepts or takeaways from the text.]
            - Point 1
            - Point 2
            ...

            **✅ Advantages / Benefits**
            [List the positive aspects, pros, or benefits discussed in the text.]
            - Advantage 1
            - Advantage 2
            ...

            **⚠️ Limitations / Challenges**
            [List the negative aspects, cons, limitations, or challenges discussed.]
            - Limitation 1
            - Limitation 2
            ...

            **💡 Examples**
            [Provide 3-4 concrete examples mentioned in the text (or relevant analogies if none exist), with a simple and brief explanation for each.]
            - **Example 1**: [Brief explanation]
            - **Example 2**: [Brief explanation]
            ...
            
            ---
            At the end of your analysis, please ask: "Do you have any specific questions about this analysis or would you like me to clarify anything from the document?"

            CRITICAL GROUNDING RULE: You must base all information EXCLUSIVELY on the provided document text. Do not use external facts or general knowledge. If information is missing, state that it is not in the document.
            
            MATERIAL CONTENT:
            {req.content[:10000]}
            """
            response = await rag_service.fast_llm.ainvoke(prompt)
            summary_text = response.content
            
    except Exception as e:
        print(f"Auto-Summary Failed: {e}")
        summary_text = "Summary generation failed. Please try again later."

    # Store in DB
    material = {
        "user_id": current_user.username,
        "filename": filename,
        "file_path": file_path,
        "upload_date": datetime.utcnow(),
        "chunks": num_chunks,
        "summary": summary_text,
        "type": "text"
    }
    result = database.study_materials_db.insert_one(material)
    
    return {
        "status": "success", 
        "id": str(result.inserted_id), 
        "filename": filename, 
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
        text = ""
        file_path = material["file_path"]
        
        if file_path.endswith(".pdf"):
            from ..services.rag_service import ingest_pdf
            _, text = await ingest_pdf(file_path)
        else:
            # Assume plain text for other types like .txt
            with open(file_path, "r", encoding="utf-8") as f:
                text = f.read()
            logger.info(f"Read {len(text)} chars from text file: {file_path}")
        
        if not rag_service.fast_llm:
             rag_service.setup_rag_chain()
        
        prompt = f"""
        You are an expert academic tutor. Analyze the following document text and provide a structured learning summary.
        
        OUTPUT FORMAT (Strictly follow this structure):
        
        **📝 Summary**
        [Provide a concise overview of the document's main topic and purpose in 3-5 sentences.]

        **🔑 Key Points**
        [List 5-8 most critical concepts or takeaways from the text.]
        - Point 1
        - Point 2
        ...

        **✅ Advantages / Benefits**
        [List the positive aspects, pros, or benefits discussed in the text.]
        - Advantage 1
        - Advantage 2
        ...

        **⚠️ Limitations / Challenges**
        [List the negative aspects, cons, limitations, or challenges discussed.]
        - Limitation 1
        - Limitation 2
        ...

        **💡 Examples**
        [Provide 3-4 concrete examples mentioned in the text (or relevant analogies if none exist), with a simple and brief explanation for each.]
        - **Example 1**: [Brief explanation]
        - **Example 2**: [Brief explanation]
        ...
        
        ---
        At the end of your analysis, please ask: "Do you have any specific questions about this analysis or would you like me to clarify anything from the document?"

        CRITICAL GROUNDING RULE: You must base all information EXCLUSIVELY on the provided document text. Do not use external facts or general knowledge. If information is missing, state that it is not in the document.
        
        MATERIAL CONTENT:
        {text[:10000]}
        """
        
        response = await rag_service.fast_llm.ainvoke(prompt)
        
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
