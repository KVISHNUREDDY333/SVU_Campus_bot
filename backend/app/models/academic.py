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

class PlacementRecordModel(BaseModel):
    year: int
    company_name: str
    package: float
    student_name: Optional[str] = None
    department: str

class ResumeAnalysisRequest(BaseModel):
    resume_text: str
