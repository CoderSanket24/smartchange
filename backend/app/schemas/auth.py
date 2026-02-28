from pydantic import BaseModel, EmailStr
from datetime import datetime
from typing import Optional


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str
    password: str


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"


class UserOut(BaseModel):
    id: int
    email: str
    username: str
    created_at: Optional[datetime]

    class Config:
        from_attributes = True
