from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime

class StudyMaterialModel(BaseModel):
    user_id: str
    filename: str
    file_id: str
    upload_date: datetime = datetime.utcnow()

class ExamDateModel(BaseModel):
    subject: str
    date: datetime
    description: Optional[str] = None
    department: str = "Common"


class ResumeAnalysisRequest(BaseModel):
    resume_text: str
    target_role: Optional[str] = None

class ResumeGenerationRequest(BaseModel):
    full_name: str
    contact_email: str
    contact_phone: Optional[str] = None
    linkedin: Optional[str] = None
    qualification: str
    qualification_percentage: str
    skills_soft: str
    skills_technical: str
    skills_coding: str
    experience_level: str  # Beginner, Intermediate, Professional
    target_role: str
    research_publications: Optional[str] = None
    industry_experience: Optional[str] = None


class StudyBuddyChatRequest(BaseModel):
    material_id: str
    query: str

class ZenRequest(BaseModel):
    query: str
    history: List[dict] = []
