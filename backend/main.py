import uvicorn
import os
import sys
import logging
import asyncio
import platform
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles

if platform.system() == 'Windows':
    asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(project_root)

from backend.app.core.config import Config
from backend.app.core.database import get_db_client, close_db_client
from backend.app.services.rag_service import setup_rag_chain
from backend.app.routers import auth, chat, admin, tickets, calendar, study_buddy, career, notifications, locations
from backend.app.core.security import get_password_hash
from backend.app.core import database
from datetime import datetime

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn")

async def seed_admin():
    email = "vishnureddyk3333@gmail.com"
    password = "Vishnu@369"
    try:
        hashed_pwd = get_password_hash(password)
        user_data = {
            "username": email,
            "password_hash": hashed_pwd,
            "full_name": "Admin",
            "role": "admin",
            "created_at": datetime.utcnow()
        }
        database.users_db.update_one(
            {"username": email},
            {"$set": user_data},
            upsert=True
        )
        logger.info(f"Seeded Admin User: {email}")
    except Exception as e:
        logger.error(f"Failed to seed admin: {e}")

async def seed_data():
    try:
        if database.exam_dates_db.count_documents({}) == 0:
            from datetime import timedelta
            database.exam_dates_db.insert_many([
                {"subject": "Data Structures & Algorithms", "date": datetime.utcnow() + timedelta(days=15), "department": "Common"},
                {"subject": "Database Management Systems", "date": datetime.utcnow() + timedelta(days=22), "department": "Common"}
            ])
            logger.info("Seeded sample exam dates")
    except Exception as e:
        logger.error(f"Failed to seed data: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    logger.info("Starting Application Components...")
    get_db_client()
    
    try:
        if database.users_db is not None:
             database.users_db.create_index([("created_at", -1)])
             database.users_db.create_index("username", unique=True)
        if database.calendar_db is not None:
             database.calendar_db.create_index([("date", 1)])
        if database.tickets_db is not None:
             database.tickets_db.create_index([("created_at", -1)])
        if database.documents_db is not None:
             database.documents_db.create_index([("uploaded_at", -1)])
        if database.faqs_db is not None:
             database.faqs_db.create_index([("category", 1)])
        if database.suggested_faqs_db is not None:
             database.suggested_faqs_db.create_index([("created_at", -1)])
        if database.notifications_db is not None:
             database.notifications_db.create_index([("created_at", -1)])
             database.notifications_db.create_index([("user_id", 1)])
    except Exception as e:
        logger.error(f"Failed to create indexes: {e}")

    setup_rag_chain()
    await seed_admin()
    await seed_data()
    yield
    logger.info("Shutting Down Application Components...")
    close_db_client()

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=Config.SECRET_KEY)

app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(admin.router)
app.include_router(tickets.router)
app.include_router(calendar.router)
app.include_router(study_buddy.router)
app.include_router(career.router)
app.include_router(notifications.router)
app.include_router(locations.router)

static_dir = os.path.join(project_root, "frontend", "static")
if not os.path.exists(static_dir):
    raise RuntimeError(f"Static directory not found: {static_dir}")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

@app.get("/")
async def read_root():
    from fastapi.responses import FileResponse
    template_path = os.path.join(project_root, "frontend", "templates", "index.html")
    if not os.path.exists(template_path):
        raise RuntimeError(f"Template not found: {template_path}")
    response = FileResponse(template_path)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"Running on http://127.0.0.1:{port}")
    # Use import string for better reload support
    uvicorn.run("backend.main:app", host="127.0.0.1", port=port, reload=True)
