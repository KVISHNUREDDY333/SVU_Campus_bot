from pymongo import MongoClient
import logging
import certifi
from .config import Config

logger = logging.getLogger("uvicorn")

mongo_client = None
users_db = None
otps_db = None
svu_vectors_db = None
documents_db = None
analytics_db = None

tickets_db = None
calendar_db = None
notifications_db = None
suggested_faqs_db = None
study_materials_db = None
locations_db = None
trending_queries_db = None

exam_dates_db = None
system_logs_db = None

def get_db_client():
    global mongo_client, users_db, otps_db, svu_vectors_db, documents_db, analytics_db, tickets_db, calendar_db, notifications_db, suggested_faqs_db, study_materials_db, exam_dates_db, locations_db, trending_queries_db, system_logs_db
    if Config.MONGODB_URI:
        try:
            # Extended timeouts to handle DNS resolution issues (Server Do53 timeouts)
            mongo_client = MongoClient(
                Config.MONGODB_URI, 
                tlsCAFile=certifi.where(),
                serverSelectionTimeoutMS=30000, # 30s selection timeout
                connectTimeoutMS=20000          # 20s connection timeout
            )
            db = mongo_client[Config.DB_NAME]
            users_db = db["users"]
            otps_db = db["otps"]
            svu_vectors_db = db[Config.COLLECTION_NAME]  # svu_vectors — single source for all FAQs + vectors
            documents_db = db["documents"]
            analytics_db = db["analytics_logs"]
            tickets_db = db["tickets"]
            notifications_db = db["notifications"]
            calendar_db = db["calendar"]
            suggested_faqs_db = db["suggested_faqs"]
            study_materials_db = db["study_materials"]
            locations_db = db["locations"]
            trending_queries_db = db["trending_queries"]

            exam_dates_db = db["exam_dates"]
            system_logs_db = db["system_logs"]
            logger.info("Connected to MongoDB")
        except Exception as e:
            logger.error(f"MongoDB Connection Error: {e}")
            mongo_client = None
    else:
        logger.warning("MONGODB_URI not set. Running without database.")
        
def close_db_client():
    if mongo_client:
        mongo_client.close()
