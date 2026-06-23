from datetime import datetime
from typing import Optional

from pydantic import BaseModel

class User(BaseModel):
    username: str
    password_hash: Optional[str] = None
    role: str = "student"                                   
    created_at: datetime = datetime.utcnow()

class Token(BaseModel):
    access_token: str
    token_type: str
    role: str
    username: str
    full_name: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None

class TokenData(BaseModel):
    username: Optional[str] = None
    role: Optional[str] = None

class RegisterRequest(BaseModel):
    email: str
    password: str
    first_name: str
    last_name: str
    role: str = "student"

class ForgotPasswordRequest(BaseModel):
    email: str

class VerifyOTPRequest(BaseModel):
    email: str
    otp: str
    new_password: str

class VerifyOnlyOTPRequest(BaseModel):
    email: str
    otp: str

class ProfileUpdateRequest(BaseModel):
    first_name: str
    last_name: str
