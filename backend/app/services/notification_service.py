from typing import List, Optional
from datetime import datetime
import logging
from ..core import database
from ..models.notification import NotificationModel

logger = logging.getLogger("uvicorn")

async def create_notification(
    title: str,
    message: str,
    user_id: Optional[str] = None,
    notification_type: str = "common",
    link: Optional[str] = None
):
    """
    Creates a notification in the database.
    If user_id is None, it's a 'common' notification for everyone.
    """
    try:
        notification = NotificationModel(
            user_id=user_id,
            type=notification_type,
            title=title,
            message=message,
            link=link
        )
        
        # In a real system, we might want to use a separate collection for "read" flags 
        # for common notifications per user, but for this implementation we'll 
        # keep it simple: common notifications are just broadcasted.
        
        database.notifications_db.insert_one(notification.dict())
        logger.info(f"Notification created: {title} ({notification_type})")
        return notification
    except Exception as e:
        logger.error(f"Failed to create notification: {e}")
        return None

async def get_user_notifications(username: str) -> List[dict]:
    """
    Fetches notifications for a user, including:
    1. Common notifications (type='common')
    2. Personal notifications (type='personal' AND user_id=username)
    """
    try:
        query = {
            "$or": [
                {"type": "common", "cleared_by": {"$ne": username}},
                {"type": "personal", "user_id": username}
            ]
        }
        
        # Sort by creation date descending
        cursor = database.notifications_db.find(query).sort("created_at", -1).limit(50)
        notifications = list(cursor)
        
        return notifications
    except Exception as e:
        logger.error(f"Failed to fetch notifications for {username}: {e}")
        return []

async def mark_notification_as_read(notification_id: str, username: str):
    """
    Marks a notification as read for a specific user.
    """
    try:
        # Check if it's personal or common
        notif = database.notifications_db.find_one({"id": notification_id})
        if not notif:
            return False
            
        if notif.get("type") == "personal":
            database.notifications_db.update_one(
                {"id": notification_id},
                {"$set": {"is_read": True}}
            )
        else:
            # Common notification: add user to read_by if not already there
            database.notifications_db.update_one(
                {"id": notification_id},
                {"$addToSet": {"read_by": username}}
            )
        return True
    except Exception as e:
        logger.error(f"Failed to mark notification {notification_id} as read: {e}")
        return False

async def mark_all_as_read(username: str):
    """
    Marks all notifications for a user as read.
    """
    try:
        # 1. Update personal notifications
        database.notifications_db.update_many(
            {"type": "personal", "user_id": username, "is_read": False},
            {"$set": {"is_read": True}}
        )
        
        # 2. Update common notifications by adding user to read_by
        # This is a bit tricky in MongoDB to update multiple documents by adding to a set 
        # based on an exclusion, but $addToSet handles the "if not exists" part.
        database.notifications_db.update_many(
            {"type": "common"},
            {"$addToSet": {"read_by": username}}
        )
        return True
    except Exception as e:
        logger.error(f"Failed to mark all notifications as read for {username}: {e}")
        return False

async def delete_notification(notification_id: str, username: str):
    """
    Deletes a personal notification or hides a common one for the user.
    """
    try:
        notif = database.notifications_db.find_one({"id": notification_id})
        if not notif:
            return False
            
        if notif.get("type") == "personal":
            # Real delete for personal
            database.notifications_db.delete_one({"id": notification_id, "user_id": username})
        else:
            # Hide for common
            database.notifications_db.update_one(
                {"id": notification_id},
                {"$addToSet": {"cleared_by": username}}
            )
        return True
    except Exception as e:
        logger.error(f"Failed to delete/hide notification {notification_id} for {username}: {e}")
        return False

async def clear_all_notifications(username: str):
    """
    For 'personal' notifications, we delete them.
    For 'common' notifications, we add the user to cleared_by to hide them.
    """
    try:
        # 1. Delete personal
        database.notifications_db.delete_many({"type": "personal", "user_id": username})
        
        # 2. Hide common ones that exist currently
        database.notifications_db.update_many(
            {"type": "common", "cleared_by": {"$ne": username}},
            {"$addToSet": {"cleared_by": username}}
        )
        return True
    except Exception as e:
        logger.error(f"Failed to clear notifications for {username}: {e}")
        return False
