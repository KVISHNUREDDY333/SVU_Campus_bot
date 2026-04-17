import uuid
from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel, Field


class NotificationModel(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    user_id: Optional[str] = None  # None for "common" notifications
    type: str = "common"  # common, personal
    title: str
    message: str
    link: Optional[str] = None
    is_read: bool = False
    read_by: List[str] = Field(
        default_factory=list
    )  # List of usernames for common notifications
    cleared_by: List[str] = Field(
        default_factory=list
    )  # List of usernames who cleared/hid this common notif
    created_at: datetime = Field(default_factory=datetime.utcnow)


class NotificationResponse(BaseModel):
    id: str
    user_id: Optional[str]
    type: str
    title: str
    message: str
    link: Optional[str]
    is_read: bool
    created_at: datetime


class NotificationList(BaseModel):
    notifications: List[NotificationResponse]
    unread_count: int
