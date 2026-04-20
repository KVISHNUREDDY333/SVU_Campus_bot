import logging
from datetime import datetime

from ..core import database

logger = logging.getLogger("uvicorn")

def log_event(level: str, message: str, details: str = None):
    """
    Log an event to the system_logs collection in MongoDB.
    level: INFO, SUCCESS, WARN, ERROR
    """
    try:
        if database.system_logs_db is not None:
            log_entry = {
                "level": level.upper(),
                "message": message,
                "details": details,
                "timestamp": datetime.utcnow(),
            }
            database.system_logs_db.insert_one(log_entry)
            logger.info(f"System Log [{level.upper()}]: {message}")
        else:
            logger.warning(f"System Log DB not initialized. Event: {message}")
    except Exception as e:
        logger.error(f"Failed to write to system_logs_db: {e}")

def get_recent_logs(limit: int = 50):
    """
    Retrieve the most recent logs from the system_logs collection.
    """
    try:
        if database.system_logs_db is not None:
            cursor = database.system_logs_db.find().sort("timestamp", -1).limit(limit)
            return list(cursor)
        return []
    except Exception as e:
        logger.error(f"Failed to fetch system logs: {e}")
        return []
