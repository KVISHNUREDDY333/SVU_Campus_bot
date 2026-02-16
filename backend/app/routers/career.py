from fastapi import APIRouter, Depends, HTTPException, UploadFile, File
from typing import List
from ..core import database
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import rag_service
from bson import ObjectId

router = APIRouter(prefix="/career", tags=["Career Center"])

from ..models.academic import ResumeAnalysisRequest, ResumeGenerationRequest

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
    
    target_role_context = f"Target Job Role: {req.target_role}" if req.target_role else "Target Job Role: Not Specified (General Analysis)"
    
    prompt = f"""
    You are an elite Career Strategy Expert and Technical Recruiter with deep knowledge of SV University standards and global industry expectations. 
    Analyze the following resume text with extreme detail and provide a comprehensive report.
    
    {target_role_context}
    
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
    Evaluate the skills listed. Are they relevant for the target role? Suggest 3-5 high-demand skills to add based on the candidate's field and target role.
    
    ### 🚀 Actionable Roadmap
    Provide 5 specific, high-impact bullet points the candidate should change or add IMMEDIATELY to double their interview chances for the target role.
    
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

@router.post("/generate-resume")
async def generate_resume(req: ResumeGenerationRequest):
    prompt = f"""
    You are a Professional Resume Writer and Career Coach. 
    Create a high-impact, ATS-friendly resume for a candidate with the following profile:

    **Candidate Profile:**
    - **Name:** {req.full_name}
    - **Target Role:** {req.target_role}
    - **Experience Level:** {req.experience_level}
    - **Qualification:** {req.qualification} ({req.qualification_percentage})
    - **Technical Skills:** {req.skills_technical}
    - **Coding Skills:** {req.skills_coding}
    - **Soft Skills:** {req.skills_soft}
    - **Research/Publications:** {req.research_publications or "None"}
    - **Industry Experience:** {req.industry_experience or "Fresher/None"}

    **Instructions:**
    1.  **Structure:** use standard professional resume sections: Header, Professional Summary, Skills, Experience (or Projects for freshers), Education, Certifications/Achievements.
    2.  **Professional Summary:** Write a compelling summary tailored to the '{req.target_role}'.
    3.  **Skills:** Organize skills logically.
    4.  **Content:** 
        - If the candidate is a 'Beginner' or 'Fresher', focus on Projects and Academic Achievements. Invent realistic, relevant academic projects if specific project details aren't provided, based on their skills and target role.
        - If 'Intermediate' or 'Professional', focus on Work Experience.
    5.  **Tone:** Professional, action-oriented, and concise.
    6.  **Format:** clean Markdown.

    **Output Resume:**
    (Provide ONLY the resume content in Markdown)
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
