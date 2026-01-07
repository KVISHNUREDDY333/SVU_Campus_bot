from pymongo import MongoClient
import logging
from .config import Config

logger = logging.getLogger("uvicorn")

mongo_client = None
users_db = None
otps_db = None
faqs_db = None
documents_db = None
analytics_db = None
notifications_db = None
tickets_db = None
calendar_db = None
suggested_faqs_db = None
study_materials_db = None
placement_records_db = None
exam_dates_db = None

def get_db_client():
    global mongo_client, users_db, otps_db, faqs_db, documents_db, analytics_db, notifications_db, tickets_db, calendar_db, suggested_faqs_db, study_materials_db, placement_records_db, exam_dates_db
    if Config.MONGODB_URI:
        try:
            mongo_client = MongoClient(Config.MONGODB_URI)
            db = mongo_client[Config.DB_NAME]
            users_db = db["users"]
            otps_db = db["otps"]
            faqs_db = db["faqs"]
            documents_db = db["documents"]
            analytics_db = db["analytics_logs"]
            tickets_db = db["tickets"]
            notifications_db = db["notifications"]
            calendar_db = db["calendar"]
            suggested_faqs_db = db["suggested_faqs"]
            study_materials_db = db["study_materials"]
            placement_records_db = db["placement_records"]
            exam_dates_db = db["exam_dates"]
            logger.info("Connected to MongoDB")
        except Exception as e:
            logger.error(f"MongoDB Connection Error: {e}")
            mongo_client = None
    else:
        logger.warning("MONGODB_URI not set. Running without database.")
        
def close_db_client():
    if mongo_client:
        mongo_client.close()
