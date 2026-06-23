import uvicorn
import os
import sys
import logging
import asyncio
import platform
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from starlette.middleware.sessions import SessionMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates
from pymongo.errors import PyMongoError
from bson.errors import InvalidId

logging.basicConfig(level=logging.INFO, format='%(levelname)s:     %(message)s')
logger = logging.getLogger("uvicorn")

logging.getLogger("httpx").setLevel(logging.WARNING)
logging.getLogger("sentence_transformers").setLevel(logging.WARNING)
logging.getLogger("huggingface_hub").setLevel(logging.ERROR)
logging.getLogger("transformers").setLevel(logging.ERROR)
logging.getLogger("uvicorn.access").setLevel(logging.WARNING)

if platform.system() == 'Windows':
    import warnings
                                                                                                            
    warnings.filterwarnings("ignore", category=DeprecationWarning, message=".*asyncio.*(WindowsSelectorEventLoopPolicy|set_event_loop_policy).*")
    
    try:
                                                                                    
        if hasattr(asyncio, 'WindowsProactorEventLoopPolicy'):
            asyncio.set_event_loop_policy(asyncio.WindowsProactorEventLoopPolicy())
        else:
            asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    except Exception as e:
        logger.warning(f"Loop policy configuration skipped: {e}")

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
sys.path.append(project_root)

from backend.app.core.config import Config
from backend.app.core.database import get_db_client, close_db_client
from backend.app.services.rag_service import setup_rag_chain
from backend.app.routers import auth, chat, admin, tickets, calendar, study_buddy, career, notifications
from backend.app.core.security import get_password_hash
from backend.app.services.logging_service import log_event
from backend.app.core import database
from datetime import datetime

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
    log_event("INFO", "Server components initializing...")
    
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
    
    display_app_stats(app)
    
    yield
    logger.info("Shutting Down Application Components...")
    close_db_client()

def display_app_stats(app: FastAPI):
    """Prints a summary of the application status to the terminal."""
    try:
        import platform
        import sys
        from collections import Counter
        
        print("\n" + "+" + "-"*68 + "+")
        print("|" + " SVU CAMPUS BOT - APPLICATION STARTUP STATS ".center(68) + "|")
        print("+" + "-"*68 + "+")
        
        print(f"| [SYSTEM INFO]")
        print(f"|   OS        : {platform.system()} {platform.release()}")
        print(f"|   Python    : {sys.version.split()[0]}")
        print(f"|   PID       : {os.getpid()}")
        
        print(f"|")
        print(f"| [APPLICATION COMPONENTS]")
        print(f"|   FastAPI   : Loaded")
        print(f"|   RAG Chain : Initialized")
        
        print(f"|")
        print(f"| [DATABASE STATUS]")
        if database.mongo_client:
            try:
                print(f"|   Connection: Active")
                print(f"|   Database  : {Config.DB_NAME}")
                
                collections = {
                    "Users": database.users_db,
                    "Tickets": database.tickets_db,
                    "Docs": database.documents_db,
                    "Vectors": database.svu_vectors_db,
                    "Exams": database.exam_dates_db
                }
                
                for name, coll in collections.items():
                    if coll is not None:
                        count = coll.count_documents({})
                        print(f"|   - {name:10}: {count} records")
                    else:
                        print(f"|   - {name:10}: Unavailable")
            except Exception as e:
                print(f"|   Database Error: {e}")
        else:
            print("|   Connection: Disconnected")
            
        print(f"|")
        print(f"| [API ROUTE SUMMARY]")
        routes = [r for r in app.routes if hasattr(r, "path")]
        print(f"|   Total Routes: {len(routes)}")
        
        methods = []
        for r in routes:
            if hasattr(r, "methods"):
                methods.extend(list(r.methods))
        method_counts = Counter(methods)
        important_methods = ["GET", "POST", "PUT", "DELETE", "PATCH"]
        methods_display = [f"{m}: {method_counts[m]}" for m in important_methods if method_counts[m] > 0]
        print(f"|   Methods     : {', '.join(methods_display)}")

        print(f"|")
        print(f"| [ENVIRONMENT]")
        print(f"|   Port      : {os.getenv('PORT', '8888')}")
        print(f"|   Debug     : {os.getenv('DEBUG', 'False')}")
        
        print("+" + "-"*68 + "+\n")
    except Exception as e:
        logger.error(f"Failed to display startup stats: {e}")

app = FastAPI(lifespan=lifespan)

@app.exception_handler(PyMongoError)
async def pymongo_exception_handler(request: Request, exc: PyMongoError):
    logger.error(f"Database error occurred: {exc}")
    return JSONResponse(
        status_code=503,
        content={"detail": "Database service is temporarily unavailable. Please try again later."},
    )

@app.exception_handler(InvalidId)
async def invalid_id_exception_handler(request: Request, exc: InvalidId):
    return JSONResponse(
        status_code=400,
        content={"detail": "Invalid resource identifier format."},
    )

@app.exception_handler(AttributeError)
async def attribute_error_handler(request: Request, exc: AttributeError):
    # Map NoneType attribute access on database references to a clean 503 Service Unavailable
    exc_str = str(exc)
    if "NoneType" in exc_str and any(db_name in exc_str for db_name in ["db", "collection", "_db"]):
        logger.critical(f"Database service is disconnected or not configured: {exc}")
        return JSONResponse(
            status_code=503,
            content={"detail": "Database service is currently unavailable."},
        )
    raise exc

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

static_dir = os.path.join(project_root, "frontend", "static")
if not os.path.exists(static_dir):
    raise RuntimeError(f"Static directory not found: {static_dir}")
app.mount("/static", StaticFiles(directory=static_dir), name="static")

templates_dir = os.path.join(project_root, "frontend", "templates")
if not os.path.exists(templates_dir):
    raise RuntimeError(f"Templates directory not found: {templates_dir}")
templates = Jinja2Templates(directory=templates_dir)

@app.get("/")
async def read_root(request: Request):
    context = {"google_client_id": Config.GOOGLE_CLIENT_ID}
    response = templates.TemplateResponse(request=request, name="index.html", context=context)
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    response.headers["Pragma"] = "no-cache"
    response.headers["Expires"] = "0"
    return response

if __name__ == "__main__":
                                                    
    port = int(os.getenv("PORT", 8888))
                                                 
    uvicorn.run("backend.main:app", host="127.0.0.1", port=port, reload=True)
