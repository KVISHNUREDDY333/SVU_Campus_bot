from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List
from ..core import database
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import rag_service
from bson import ObjectId

router = APIRouter(prefix="/career", tags=["Career Center"])

from ..models.academic import ResumeAnalysisRequest

@router.post("/check-resume")
async def check_resume(req: ResumeAnalysisRequest):
    resume_text = req.resume_text
    # Guidelines for the resume checker
    guidelines = """
    SV University Placement Cell Guidelines:
    1. Contact Info: Must include Email, Phone, and LinkedIn.
    2. Education: Reverse chronological order. Include CGPA.
    3. Skills: Categorize into Technical and Soft Skills.
    4. Projects: Include at least 2 relevant projects.
    5. Internships: Highlight responsibilities and outcomes.
    """
    
    prompt = f"""
    You are an elite Career Strategy Expert and Technical Recruiter with deep knowledge of SV University standards and global industry expectations. 
    Analyze the following resume text with extreme detail and provide a comprehensive report.
    
    Guidelines to consider:
    {guidelines}
    
    Please structure your response with the following sections using clear Markdown:
    
    ### 📊 Resume Score: [X/10]
    Provide a justification for this score based on completeness and impact.
    
    ### 🌟 Key Strengths
    Highlight the most marketable aspects of the resume. What makes this candidate stand out?
    
    ### 🔍 Opportunity for Improvement (Weaknesses)
    Point out missing keywords, vague duty descriptions, or gaps in information specific to SVU guidelines.
    
    ### 💻 Technical & Soft Skills Analysis
    Evaluate the skills listed. Are they relevant for current market trends? Suggest 3-5 high-demand skills to add based on the candidate's field.
    
    ### 🚀 Actionable Roadmap
    Provide 5 specific, high-impact bullet points the candidate should change or add IMMEDIATELY to double their interview chances.
    
    ### 🛠 ATS Compatibility Check
    Analyze how well this resume would be parsed by Applicant Tracking Systems. 
    
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
        print(f"Resume Check Error: {e}")
        raise HTTPException(status_code=500, detail=f"AI Analysis Error: {str(e)}")
