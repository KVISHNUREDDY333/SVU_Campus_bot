from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from typing import List, Optional
import logging
import io
from pypdf import PdfReader
from ..core import database
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import rag_service
from bson import ObjectId

router = APIRouter(prefix="/career", tags=["Career Center"])
logger = logging.getLogger("uvicorn")

from ..models.academic import ResumeAnalysisRequest, ResumeGenerationRequest

async def perform_resume_analysis(resume_text: str, target_role: Optional[str] = None):
    """Refactored helper function to handle AI resume analysis logic."""
    # Guidelines for the resume checker
    guidelines = """
    SV University Placement Cell Guidelines:
    1. Contact Info: Must include Email, Phone, and LinkedIn.
    2. Education: Reverse chronological order. Include CGPA.
    3. Skills: Categorize into Technical and Soft Skills.
    4. Projects: Include at least 2 relevant projects.
    5. Internships: Highlight responsibilities and outcomes.
    """
    
    target_role_context = f"Target Job Role: {target_role}" if target_role else "Target Job Role: Not Specified (General Analysis)"
    
    prompt = f"""🛡️ UNIVERSITY SAFE ACADEMIC ASSISTANT - CAREER MODE
    You are an elite Career Strategy Expert at SVU. 
    
    TASK: Analyze the following resume with surgical precision and academic-grade accuracy.
    
    🔒 SAFETY: Ensure the content is professional and academic. Reject if it contains unsafe or offensive material.
    
    QUALITY STANDARDS:
    - Deliver factual, data-driven feedback.
    - Match skills against the target role: {target_role if target_role else 'General Analysis'}.
    - Ground all observations in the Provided Text.
    
    Placement Guidelines:
    {guidelines}
    
    STRUCTURE:
    - **📊 Resume Score**: Data-driven justification.
    - **🌟 Key Strengths**: Marketable assets.
    - **🔍 Critical Weaknesses**: Missing keywords or metrics.
    - **🚀 Actionable Roadmap**: High-impact execution steps.
    
    Resume Text:
    {resume_text[:4000]}
    """
    
    if not rag_service.llm:
        try:
            rag_service.setup_rag_chain()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LLM Initialization Failed: {str(e)}")
            
    if not rag_service.llm:
         raise HTTPException(status_code=500, detail="LLM service is not available")
    
    try:
        response = await rag_service.llm.ainvoke(prompt)
        return {"analysis": response.content}
    except Exception as e:
        logger.error(f"Resume Analysis Logic Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI Analysis Error: {str(e)}")

@router.post("/check-resume")
async def check_resume(req: ResumeAnalysisRequest):
    return await perform_resume_analysis(req.resume_text, req.target_role)

@router.post("/check-resume-file")
async def check_resume_file(file: UploadFile = File(...), target_role: Optional[str] = Form(None)):
    if not file.filename.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported.")
    
    try:
        content = await file.read()
        pdf_file = io.BytesIO(content)
        reader = PdfReader(pdf_file)
        full_text = ""
        for page in reader.pages:
            full_text += page.extract_text() or ""
            
        if not full_text.strip():
             raise HTTPException(status_code=400, detail="Could not extract text from PDF. It might be scanned or empty.")
             
        return await perform_resume_analysis(full_text, target_role)
        
    except Exception as e:
        logger.error(f"Resume PDF Processing Error: {e}")
        raise HTTPException(status_code=500, detail=f"Failed to process PDF: {str(e)}")

@router.post("/generate-resume")
async def generate_resume(req: ResumeGenerationRequest):
    # Check safety
    from ..services.moderation import ModerationService
    if not await ModerationService.check_content(req.skills_technical + " " + req.projects):
         return {"resume": ModerationService.get_rejection_message()}

    prompt = f"""🛡️ UNIVERSITY SAFE ACADEMIC ASSISTANT - RESUME GENERATOR
    You are a Master Resume Architect at SVU Career Center.
    
    TASK: Generate a high-fidelity, professional resume based on the student's data.

    🔒 SAFETY: Ensure all generated content is professional and academic.
    
    QUALITY RULES:
    - Ground content in the Profile Data.
    - Use active, professional terminology.
    - Ensure logical flow and ATS optimization.

    Profile Data:
    - Name: {req.full_name}
    - Role: {req.target_role}
    - Skills: {req.skills_technical}, {req.skills_coding}
    - Projects: {req.projects}
    
    Output structured Markdown resume only.
    """

    if not rag_service.llm:
        try:
            rag_service.setup_rag_chain()
        except Exception as e:
            raise HTTPException(status_code=500, detail=f"LLM Initialization Failed: {str(e)}")
            
    if not rag_service.llm:
         raise HTTPException(status_code=500, detail="LLM service is not available")
    
    try:
        response = await rag_service.llm.ainvoke(prompt)
        return {"resume": response.content}
    except Exception as e:
        print(f"Resume Generation Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI Generation Error: {str(e)}")

from pydantic import BaseModel
class ResumeDownloadRequest(BaseModel):
    resume_text: str
    format: str  # 'pdf' or 'docx'
    
from fastapi.responses import StreamingResponse
from ..utils.resume_generator import generate_pdf, generate_docx

@router.post("/download-resume")
async def download_resume(req: ResumeDownloadRequest):
    try:
        if req.format == 'pdf':
            pdf_file = generate_pdf(req.resume_text)
            return StreamingResponse(
                pdf_file, 
                media_type="application/pdf", 
                headers={"Content-Disposition": "attachment; filename=resume.pdf"}
            )
        elif req.format == 'docx':
            docx_file = generate_docx(req.resume_text)
            return StreamingResponse(
                docx_file,
                media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                headers={"Content-Disposition": "attachment; filename=resume.docx"}
            )
        else:
            raise HTTPException(status_code=400, detail="Invalid format. Use 'pdf' or 'docx'.")
            
    except Exception as e:
        print(f"Download Error: {e}")
        raise HTTPException(status_code=500, detail=f"Download Failed: {str(e)}")
