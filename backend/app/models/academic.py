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

class StudyBuddyChatRequest(BaseModel):
    material_id: str
    query: str
