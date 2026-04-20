import logging
import os
import shutil
from datetime import datetime

from bson import ObjectId
from fastapi import APIRouter, Depends, File, HTTPException, UploadFile
from pydantic import BaseModel

from ..core import database
from ..models.academic import StudyBuddyChatRequest, ZenRequest
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import rag_service
from ..services.moderation import ModerationService

class StudyMaterialTextRequest(BaseModel):
    title: str
    content: str

logger = logging.getLogger("uvicorn")
router = APIRouter(prefix="/study-buddy", tags=["Study Buddy"])

CURRENT_DIR = os.path.dirname(os.path.abspath(__file__))
                                               
PROJECT_ROOT = os.path.dirname(os.path.dirname(os.path.dirname(CURRENT_DIR)))
UPLOAD_DIR = os.path.abspath(os.path.join(PROJECT_ROOT, "uploads", "study_materials"))

os.makedirs(UPLOAD_DIR, exist_ok=True)

@router.post("/chat")
async def chat_with_material(
    req: StudyBuddyChatRequest, current_user: User = Depends(get_current_user)
):
    material = database.study_materials_db.find_one(
        {"_id": ObjectId(req.material_id), "user_id": current_user.username}
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if not await ModerationService.check_content(req.query):
        return {
            "response": ModerationService.get_rejection_message(),
            "context_used": False,
        }

    try:
        if not rag_service.vector_db:
            rag_service.setup_rag_chain()

        filter_metadata = {
            "source": material["filename"],
            "user_id": current_user.username,
        }

        docs = rag_service.vector_db.similarity_search_with_score(
            req.query, k=8, filter=filter_metadata
        )

        valid_docs = [doc for doc, score in docs if score >= 0.5]
        if not valid_docs:
                                                 
            docs = rag_service.vector_db.similarity_search(
                req.query, k=5, filter={"source": material["filename"]}
            )
            valid_docs = docs

        context = "\n\n".join([doc.page_content for doc in valid_docs])

        prompt = f"""🛡️ UNIVERSITY SAFE ACADEMIC ASSISTANT - STUDY BUDDY MODE
        You are a Senior Academic Expert at SVU. 
        
        TASK: Analyze the provided academic material with absolute accuracy.
        
        🔒 SAFETY RULES:
        - If query is non-academic or harmful, respond with: "I'm here to support academic and knowledge-related queries only. Please ask something related to studies, exams, or general knowledge."
        
        📊 QUALITY STANDARDS:
        - Deliver factual, logically sound, and correct information.
        - Ground every claim strictly in the provided document: {material['filename']}
        - Use structured Markdown (Tables, Code blocks) for clarity.
        
        CONTEXT:
        {context}
        
        STUDENT INQUIRY:
        {req.query}
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
                                    
        if not await ModerationService.check_content(req.query):
            return {"response": ModerationService.get_rejection_message()}

        if not rag_service.llm:
            rag_service.setup_rag_chain()

        system_prompt = """🛡️ UNIVERSITY SAFE ACADEMIC ASSISTANT - ZEN AI MODE
        You are Zen, the pinnacle of Academic Intelligence.

        🎯 MISSION: Support students with safe, educational, and high-quality knowledge.

        🔒 STRICT SAFETY POLICY:
        - SAFE CONTENT: Education, Academic Support, Research, GK, Career guidance.
        - REJECT: Hate, adult, offensive, violent, or non-educational casual chat.
        - REJECTION MESSAGE: "I'm here to support academic and knowledge-related queries only. Please ask something related to studies, exams, or general knowledge."

        🧠 QUALITY RULES:
        - Deliver factual, accurate, and professional responses.
        - Zero hallucinations—only output correct information.
        - Use precise Markdown and academic tone.
        """

        messages = [("system", system_prompt)]
        for msg in req.history[-10:]:                      
            role = "human" if msg["role"] == "user" else "ai"
            messages.append((role, msg["content"]))

        messages.append(("human", req.query))

        response = await rag_service.llm.ainvoke(messages)
        return {"response": response.content}

    except Exception as e:
        logger.error(f"Zen Chat Error: {e}")
        raise HTTPException(status_code=500, detail=f"Zen AI Error: {str(e)}")

@router.post("/upload")
async def upload_material(
    file: UploadFile = File(...), current_user: User = Depends(get_current_user)
):
    file_path = os.path.join(UPLOAD_DIR, f"{current_user.username}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    num_chunks = 0
    full_text = ""
    try:
        from ..services.rag_service import ingest_pdf

        num_chunks, full_text = await ingest_pdf(
            file_path, user_id=current_user.username
        )
    except Exception as e:
        print(f"Study Material Ingestion Failed: {e}")
                                                                                  
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")

    summary_text = ""
    try:
        if not rag_service.fast_llm:
            rag_service.setup_rag_chain()

        if rag_service.fast_llm:
            prompt = f"""🛡️ UNIVERSITY SAFE ACADEMIC ASSISTANT - SUMMARY MODE
            Provide an accurate, factual, and high-quality academic summary of the text below.

            🔒 SAFETY: If content is unsafe, reject the task.
            
            OUTPUT FORMAT:
            **📝 Summary**: Comprehensive and factually grounded overview.
            **🔑 Key Insights**: 5-8 critical concepts extracted from text.
            **💡 Applications**: Real-world examples found in the material.
            
            MATERIAL CONTENT:
            {full_text[:10000] if 'full_text' in locals() else text[:10000]}
            """
            response = await rag_service.fast_llm.ainvoke(prompt)
            summary_text = response.content

    except Exception as e:
        print(f"Auto-Summary Failed: {e}")
                                                      
        summary_text = "Summary generation failed. Please try again later."

    material = {
        "user_id": current_user.username,
        "filename": file.filename,
        "file_path": file_path,
        "upload_date": datetime.utcnow(),
        "chunks": num_chunks,
        "summary": summary_text,                   
    }
    result = database.study_materials_db.insert_one(material)

    return {
        "status": "success",
        "id": str(result.inserted_id),
        "filename": file.filename,
        "chunks": num_chunks,
        "summary": summary_text,
    }

@router.post("/upload-text")
async def upload_text_material(
    req: StudyMaterialTextRequest, current_user: User = Depends(get_current_user)
):
                              
    filename = f"{req.title}.txt"
    file_path = os.path.join(UPLOAD_DIR, f"{current_user.username}_{filename}")

    with open(file_path, "w", encoding="utf-8") as f:
        f.write(req.content)

    num_chunks = 0
    try:
        from ..services.rag_service import ingest_text

        num_chunks = await ingest_text(
            req.content, metadata={"source": filename, "user_id": current_user.username}
        )
    except Exception as e:
        print(f"Study Material Text Ingestion Failed: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process text: {str(e)}")

    summary_text = ""
    try:
        if not rag_service.fast_llm:
            rag_service.setup_rag_chain()

        if rag_service.fast_llm:
            prompt = f"""
            You are a highly analytical expert academic tutor. Provide an immensely accurate, highly relevant, and deeply insightful learning summary based STRICTLY on the document text below.
            
            OUTPUT FORMAT (Deliver a professional structure):
            
            **📝 Summary**
            [Provide a concise, ultra-accurate overview of the document's main topic and real intent in 3-5 high-density sentences.]

            **🔑 Critical Insights & Key Points**
            [Extract the 5-8 most critical, verifiable concepts or takeaways directly from the text. Skip fluff.]
            - Point 1
            - Point 2
            ...

            **✅ Core Advantages / Benefits**
            [List any positive aspects, pros, or benefits actively discussed in the text. Ignore if none exist.]

            **⚠️ Key Limitations / Challenges**
            [List any negative aspects, cons, limitations, or challenges actively discussed. Ignore if none exist.]

            **💡 Relevant Examples / Applications**
            [Extract 3-4 concrete examples actually mentioned in the text with a simple, accurate explanation for each.]
            
            ---
            At the end of your analysis, strictly ask one simple engaging question about whether they need clarification on these extracted insights.

            CRITICAL GROUNDING RULE: Do NOT hallucinate. Do not add outside knowledge. Every point must map to the textual content. Accuracy is paramount.
            
            MATERIAL CONTENT:
            {req.content[:10000]}
            """
            response = await rag_service.fast_llm.ainvoke(prompt)
            summary_text = response.content

    except Exception as e:
        print(f"Auto-Summary Failed: {e}")
        summary_text = "Summary generation failed. Please try again later."

    material = {
        "user_id": current_user.username,
        "filename": filename,
        "file_path": file_path,
        "upload_date": datetime.utcnow(),
        "chunks": num_chunks,
        "summary": summary_text,
        "type": "text",
    }
    result = database.study_materials_db.insert_one(material)

    return {
        "status": "success",
        "id": str(result.inserted_id),
        "filename": filename,
        "chunks": num_chunks,
        "summary": summary_text,
    }

@router.get("/materials")
async def get_materials(current_user: User = Depends(get_current_user)):
    materials = list(
        database.study_materials_db.find({"user_id": current_user.username}).sort(
            "upload_date", -1
        )
    )
    for m in materials:
        m["id"] = str(m["_id"])
        del m["_id"]
    return materials

@router.post("/summarize/{material_id}")
async def summarize_material(
    material_id: str, current_user: User = Depends(get_current_user)
):
    material = database.study_materials_db.find_one(
        {"_id": ObjectId(material_id), "user_id": current_user.username}
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    try:
        text = ""
        file_path = material["file_path"]

        if file_path.endswith(".pdf"):
            from ..services.rag_service import ingest_pdf

            _, text = await ingest_pdf(file_path)
        else:
                                                         
            with open(file_path, "r", encoding="utf-8") as f:
                text = f.read()
            logger.info(f"Read {len(text)} chars from text file: {file_path}")

        if not rag_service.fast_llm:
            rag_service.setup_rag_chain()

        prompt = f"""🛡️ UNIVERSITY SAFE ACADEMIC ASSISTANT - SUMMARY MODE
        Provide an accurate, factual, and high-quality academic summary of the text below.

        🔒 SAFETY: If content is unsafe, reject the task.
        
        OUTPUT FORMAT:
        **📝 Summary**: Comprehensive and factually grounded overview.
        **🔑 Key Insights**: 5-8 critical concepts extracted from text.
        **💡 Applications**: Real-world examples found in the material.
        
        MATERIAL CONTENT:
        {text[:10000]}
        """

        response = await rag_service.fast_llm.ainvoke(prompt)

        database.study_materials_db.update_one(
            {"_id": ObjectId(material_id)}, {"$set": {"summary": response.content}}
        )

        return {"summary": response.content}

    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@router.delete("/materials/{material_id}")
async def delete_material(
    material_id: str, current_user: User = Depends(get_current_user)
):
    material = database.study_materials_db.find_one(
        {"_id": ObjectId(material_id), "user_id": current_user.username}
    )
    if not material:
        raise HTTPException(status_code=404, detail="Material not found")

    if os.path.exists(material["file_path"]):
        os.remove(material["file_path"])

    database.study_materials_db.delete_one({"_id": ObjectId(material_id)})

    return {"status": "success", "message": "Material deleted"}
