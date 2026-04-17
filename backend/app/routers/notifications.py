from fastapi import APIRouter, Depends, HTTPException

from ..models.notification import NotificationList, NotificationResponse
from ..models.user import User
from ..routers.auth import get_current_user
from ..services import notification_service

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=NotificationList)
async def get_notifications(current_user: User = Depends(get_current_user)):
    """
    Get all notifications for the current user (common + personal).
    """
    notifications_data = await notification_service.get_user_notifications(
        current_user.username
    )

    # Map MongoDB data to response model
    notifications = []
    unread_count = 0
    for n in notifications_data:
        notif_type = n.get("type", "common")

        # Calculate is_read:
        # For personal: use the field directly
        # For common: check if username is in read_by list
        if notif_type == "personal":
            is_read = n.get("is_read", False)
        else:
            read_by = n.get("read_by", [])
            is_read = current_user.username in read_by or n.get("is_read", False)

        notif = NotificationResponse(
            id=n.get("id"),
            user_id=n.get("user_id"),
            type=notif_type,
            title=n.get("title"),
            message=n.get("message"),
            link=n.get("link"),
            is_read=is_read,
            created_at=n.get("created_at"),
        )
        notifications.append(notif)
        if not is_read:
            unread_count += 1

    return NotificationList(notifications=notifications, unread_count=unread_count)


@router.patch("/{notification_id}/read")
async def mark_as_read(
    notification_id: str, current_user: User = Depends(get_current_user)
):
    """
    Mark a notification as read.
    """
    success = await notification_service.mark_notification_as_read(
        notification_id, current_user.username
    )
    if not success:
        raise HTTPException(
            status_code=400, detail="Failed to mark notification as read"
        )
    return {"message": "Notification marked as read"}


@router.patch("/read-all")
async def mark_all_as_read(current_user: User = Depends(get_current_user)):
    """
    Mark all notifications as read for the current user.
    """
    success = await notification_service.mark_all_as_read(current_user.username)
    if not success:
        raise HTTPException(
            status_code=400, detail="Failed to mark all notifications as read"
        )
    return {"message": "All notifications marked as read"}


@router.delete("/clear-all")
async def clear_all_notifications(current_user: User = Depends(get_current_user)):
    """
    Clear (delete personal / hide common) all notifications for the current user.
    """
    success = await notification_service.clear_all_notifications(current_user.username)
    if not success:
        raise HTTPException(status_code=400, detail="Failed to clear notifications")
    return {"message": "Notifications cleared"}


@router.delete("/{notification_id}")
async def delete_notification(
    notification_id: str, current_user: User = Depends(get_current_user)
):
    """
    Delete a specific personal notification or hide a common one.
    """
    success = await notification_service.delete_notification(
        notification_id, current_user.username
    )
    if not success:
        raise HTTPException(status_code=400, detail="Failed to delete notification")
    return {"message": "Notification deleted"}
