from datetime import datetime
from ..core import database

async def create_notification(title: str, message: str, recipient_username: str = None, recipient_role: str = None):
    """
    Creates a notification in the database.
    
    Args:
        title (str): The title of the notification.
        message (str): The body text of the notification.
        recipient_username (str, optional): The specific user to notify. Defaults to None.
        recipient_role (str, optional): The role to notify (e.g., 'admin', 'student'). 'all' or None implies broadcast depending on implementation. Defaults to None.
    """
    if database.notifications_db is not None:
        notification = {
            "title": title,
            "message": message,
            "timestamp": datetime.utcnow(),
            "recipient_username": recipient_username,
            "recipient_role": recipient_role
        }
        database.notifications_db.insert_one(notification)
