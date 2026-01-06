import uvicorn
import os
import sys
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles

# Define Project Root
project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(project_root)

# Import internal modules
# Note: Since this file is in backend/, and we appended .. to sys.path,
# we access app modules via backend.app...
from backend.app.core.config import Config
from backend.app.core.database import get_db_client, close_db_client
from backend.app.services.rag_service import setup_rag_chain
from backend.app.routers import auth, chat, admin, documents
from backend.app.core.security import get_password_hash
from backend.app.core import database
from datetime import datetime

# Logging Setup
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
        # Upsert: Update if exists, Insert if not
        # We verify username (email)
        database.users_db.update_one(
            {"username": email},
            {"$set": user_data},
            upsert=True
        )
        logger.info(f"Seeded Admin User: {email}")
    except Exception as e:
        logger.error(f"Failed to seed admin: {e}")

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    logger.info("Starting Application Components...")
    get_db_client()
    setup_rag_chain()
    await seed_admin()
    yield
    # Shutdown
    logger.info("Shutting Down Application Components...")
    close_db_client()

# Initialize FastAPI App
app = FastAPI(lifespan=lifespan)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)
app.add_middleware(SessionMiddleware, secret_key=Config.SECRET_KEY)

# Include Routers
app.include_router(auth.router)
app.include_router(chat.router)
app.include_router(admin.router)
app.include_router(documents.router)

# Static Files (Frontend) - Use Absolute Path
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
    return FileResponse(template_path)

if __name__ == "__main__":
    port = int(os.getenv("PORT", 8000))
    print(f"Running on http://127.0.0.1:{port}")
    # Run the app object directly
    uvicorn.run(app, host="127.0.0.1", port=port)
