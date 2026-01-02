import os
import logging
import datetime
import re
import random
from contextlib import asynccontextmanager
from typing import Dict, Optional, List

from fastapi import FastAPI, Request, Depends, HTTPException, status
from fastapi.responses import JSONResponse, FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm

from pydantic import BaseModel, Field
from dotenv import load_dotenv

# Auth dependencies
import jwt
import bcrypt
import smtplib
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart

# LangChain Imports
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.output_parsers import StrOutputParser
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory

from pymongo import MongoClient
from langchain_mongodb import MongoDBAtlasVectorSearch

load_dotenv()
logger = logging.getLogger("uvicorn")
logger.setLevel(logging.INFO)

# --- Configuration & Secrets ---
SECRET_KEY = os.getenv("SECRET_KEY")
ALGORITHM = "HS256"
ACCESS_TOKEN_EXPIRE_MINUTES = 60

# MongoDB Config
MONGODB_URI = os.getenv('MONGODB_URI')
DB_NAME = os.getenv('MONGODB_DB', 'svu_chatbot')
COLLECTION_NAME = os.getenv('MONGODB_COLLECTION', 'svu_vectors')
USERS_COLLECTION = "users"
OTPS_COLLECTION = "otps"

# Global variables
vector_db = None
llm = None
retrieval_chain = None
mongo_client = None
users_db = None
otps_db = None # New OTP collection

# In-memory chat history (production should use Redis/Mongo)
store: Dict[str, BaseChatMessageHistory] = {}

def get_session_history(session_id: str) -> BaseChatMessageHistory:
    if session_id not in store:
        store[session_id] = ChatMessageHistory()
    return store[session_id]

# --- Paths ---
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, '..', 'frontend')
STATIC_DIR = os.path.join(FRONTEND_DIR, 'static')
TEMPLATES_DIR = os.path.join(FRONTEND_DIR, 'templates')

# --- Auth Setup ---

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

class User(BaseModel):
    username: str
    full_name: Optional[str] = None
    role: str = "student" # student, faculty, admin, parent
    disabled: Optional[bool] = None

class UserInDB(User):
    hashed_password: str

class Token(BaseModel):
    access_token: str
    token_type: str
    username: str
    role: str
    full_name: str

class RegisterRequest(BaseModel):
    username: str
    password: str
    full_name: str
    role: str = "student"

def verify_password(plain_password, hashed_password):
    # bcrypt requires bytes
    return bcrypt.checkpw(plain_password.encode('utf-8'), hashed_password.encode('utf-8'))

def get_password_hash(password):
    # bcrypt returns bytes, decode to string for storage
    return bcrypt.hashpw(password.encode('utf-8'), bcrypt.gensalt()).decode('utf-8')

# Validation Logic
EMAIL_REGEX = r"^[a-zA-Z0-9_.+-]+@[a-zA-Z0-9-]+\.[a-zA-Z0-9-.]+$"
PASSWORD_REGEX = r"^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&#])[A-Za-z\d@$!%*?&#]{8,}$"

def validate_email(email: str):
    if not re.match(EMAIL_REGEX, email):
        raise HTTPException(status_code=400, detail="Invalid email format (e.g., user@domain.com)")

def validate_password(password: str):
    if not re.match(PASSWORD_REGEX, password):
        raise HTTPException(
            status_code=400,
            detail="Password must be at least 8 characters and include uppercase, lowercase, number, and special character."
        )

def create_access_token(data: dict, expires_delta: Optional[datetime.timedelta] = None):
    to_encode = data.copy()
    if expires_delta:
        expire = datetime.datetime.utcnow() + expires_delta
    else:
        expire = datetime.datetime.utcnow() + datetime.timedelta(minutes=15)
    to_encode.update({"exp": expire})
    encoded_jwt = jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
    return encoded_jwt

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, SECRET_KEY, algorithms=[ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None:
            raise credentials_exception
    except jwt.PyJWTError:
        raise credentials_exception
        
    user = users_db.find_one({"username": username})
    if user is None:
        raise credentials_exception
    return User(**user)

# --- Chat Models ---
# ... (Existing Imports)
# ...

# Global variables
# ...
analytics_db = None

# ...

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default_session"
    incognito: bool = False

# ...

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global vector_db, llm, retrieval_chain, mongo_client, users_db, analytics_db, otps_db
    
    logger.info("Starting SVU Campus Assistant Backend v2 (RBAC Enabled)...")
    
    # Init Mongo
    if MONGODB_URI:
        try:
            mongo_client = MongoClient(MONGODB_URI)
            db = mongo_client[DB_NAME]
            users_db = db[USERS_COLLECTION]
            otps_db = db[OTPS_COLLECTION]
            
            uri_status = "Set" if MONGODB_URI else "Not Set (Localhost?)"
            logger.info(f"MONGODB_URI Status: {uri_status}")
            if MONGODB_URI:
                logger.info(f"URI Prefix: {MONGODB_URI[:15]}...")
                
            user_count = users_db.count_documents({})
            logger.info(f"Connected to MongoDB: {DB_NAME}")
            logger.info(f"Users Collection: {USERS_COLLECTION} | Count: {user_count}")
            
            # Ensure index on username
            users_db.create_index("username", unique=True)
            
            # --- SEED SUPER ADMIN ---
            admin_email = "vishnureddyk3333@gmail.com"
            admin_pass_raw = "Vishnu@369"
            admin_hash = get_password_hash(admin_pass_raw)
            
            # Update or Insert Admin
            users_db.update_one(
                {"username": admin_email},
                {"$set": {
                    "username": admin_email,
                    "full_name": "System Admin",
                    "role": "admin",
                    "hashed_password": admin_hash,
                    "created_at": datetime.datetime.utcnow()
                }},
                upsert=True
            )
            logger.info(f"Admin User '{admin_email}' seeded/updated successfully.")
            # ------------------------
            # Ensure TTL index on OTPs (expire after 10 mins)
            otps_db.create_index("created_at", expireAfterSeconds=600)
            
            # Init Embeddings & Vector DB
            embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
            vector_db = MongoDBAtlasVectorSearch(
                collection=db[COLLECTION_NAME],
                embedding=embeddings,
                index_name="default"
            )
            logger.info("Vector DB initialized.")
        except Exception as e:
            logger.error(f"MongoDB Error: {e}")
            analytics_db = None # Fallback
    
    # Init LLM
    groq_api_key = os.getenv("GROQ_API_KEY")
    if groq_api_key:
        llm = ChatGroq(temperature=0.7, model_name="llama-3.1-8b-instant", api_key=groq_api_key)
        
    # Init Chain
    if vector_db and llm:
        setup_rag_chain()
        
    yield
    # Shutdown
    logger.info("Shutting down...")
    if mongo_client:
        mongo_client.close()

def setup_rag_chain():
    global retrieval_chain
    retriever = vector_db.as_retriever(search_kwargs={"k": 3})
    
    contextualize_q_system_prompt = """Given a chat history and the latest user question 
    which might reference context in the chat history, formulate a standalone question 
    which can be understood without the chat history. Do NOT answer the question, 
    just reformulate it if needed and otherwise return it as is."""
    
    contextualize_q_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", contextualize_q_system_prompt),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ]
    )
    
    history_aware_retriever = (
        {
                "chat_history": lambda x: x["chat_history"], 
                "input": lambda x: x["input"]
        }
        | contextualize_q_prompt 
        | llm 
        | StrOutputParser() 
        | retriever
    )
    
    qa_system_prompt = """You are an intelligent campus assistant for SV University. 
    Use the following pieces of retrieved context to answer the question.
    If the answer is not in the context, say you don't know politely.
    Keep answers concise, helpful, and friendly.
    
    Context: {context}"""
    
    qa_prompt = ChatPromptTemplate.from_messages(
        [
            ("system", qa_system_prompt),
            MessagesPlaceholder(variable_name="chat_history"),
            ("human", "{input}"),
        ]
    )
    
    def format_docs(docs):
        return "\n\n".join(doc.page_content for doc in docs) if isinstance(docs, list) else ""

    question_answer_chain = (
        {
            "context": history_aware_retriever | format_docs,
            "chat_history": lambda x: x["chat_history"],
            "input": lambda x: x["input"]
        }
        | qa_prompt
        | llm
        | StrOutputParser()
    )
    
    retrieval_chain = RunnableWithMessageHistory(
        question_answer_chain,
        get_session_history,
        input_messages_key="input",
        history_messages_key="chat_history",
    )

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Static
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

# --- Routes ---

@app.get("/")
async def read_root():
    index_path = os.path.join(TEMPLATES_DIR, 'index.html')
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Frontend not found</h1>")

@app.get("/login_page")
async def login_page():
    index_path = os.path.join(TEMPLATES_DIR, 'index.html')
    return FileResponse(index_path)

@app.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    # Normalize username
    clean_username = form_data.username.strip().lower()
    logger.info(f"Login attempt for: {clean_username}")
    
    user_dict = users_db.find_one({"username": clean_username})
    if not user_dict:
        logger.warning(f"Login failed: User '{clean_username}' not found. Input was '{form_data.username}'")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    try:
        if not verify_password(form_data.password, user_dict['hashed_password']):
            logger.warning(f"Login failed: Incorrect password for user {clean_username}")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Incorrect username or password",
                headers={"WWW-Authenticate": "Bearer"},
            )
    except Exception as e:
        logger.error(f"Login error (crypto): {e}")
        # If hash is invalid, it's effectively an auth failure (or corrupted user)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Authentication failed due to system error",
            headers={"WWW-Authenticate": "Bearer"},
        )
    
    access_token_expires = datetime.timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user_dict["username"], "role": user_dict.get("role", "student")},
        expires_delta=access_token_expires
    )
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "username": user_dict["username"], 
        "role": user_dict.get("role", "student"),
        "full_name": user_dict.get("full_name", "User")
    }

@app.post("/register", response_model=Token)
async def register(req: RegisterRequest):
    # Normalize inputs
    req.username = req.username.strip().lower()
    logger.info(f"Registration attempt for: {req.username} (Role: {req.role})")
    
    # Validate Inputs
    validate_email(req.username)
    validate_password(req.password)

    # Security: Prevent unauthorized admin registration
    if req.role == 'admin' and req.username != "vishnureddyk3333@gmail.com":
         raise HTTPException(status_code=403, detail="Admin role is restricted.")
    
    if users_db.find_one({"username": req.username}):
        raise HTTPException(status_code=400, detail="Username already registered")
        
    hashed_password = get_password_hash(req.password)
    user_doc = {
        "username": req.username,
        "full_name": req.full_name.strip(),
        "role": req.role,
        "hashed_password": hashed_password,
        "created_at": datetime.datetime.utcnow()
    }
    users_db.insert_one(user_doc)
    
    access_token = create_access_token(data={"sub": req.username, "role": req.role})
    return {"access_token": access_token, "token_type": "bearer", "username": req.username, "role": req.role}

class ForgotPasswordRequest(BaseModel):
    username: str

class ResetPasswordRequest(BaseModel):
    username: str
    otp: str
    new_password: str

def send_otp_email(to_email: str, otp: str):
    smtp_server = "smtp.gmail.com"
    smtp_port = 587
    sender_email = "vishnureddyk3333@gmail.com"
    sender_password = "agnd ugeh rtbd jzxn" # App Password
    
    subject = "Your OTP for Password Reset"
    body = f"Your OTP is: {otp}\n\nThis OTP is valid for 10 minutes."
    
    msg = MIMEMultipart()
    msg['From'] = sender_email
    msg['To'] = to_email
    msg['Subject'] = subject
    msg.attach(MIMEText(body, 'plain'))
    
    try:
        server = smtplib.SMTP(smtp_server, smtp_port)
        server.starttls()
        server.login(sender_email, sender_password)
        text = msg.as_string()
        server.sendmail(sender_email, to_email, text)
        server.quit()
        logger.info(f"OTP sent successfully to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False

@app.post("/forgot-password")
async def forgot_password(req: ForgotPasswordRequest):
    req.username = req.username.strip().lower()
    
    user = users_db.find_one({"username": req.username})
    if not user:
        # Security: Don't reveal user existence
        return {"status": "success", "message": "If email exists, OTP sent"}
        
    otp = str(random.randint(100000, 999999))
    
    # Store OTP
    otps_db.insert_one({
        "username": req.username,
        "otp": otp,
        "created_at": datetime.datetime.utcnow()
    })
    
    # Send Email
    send_otp_email(req.username, otp)
    
    return {"status": "success", "message": "OTP sent to email"}

@app.post("/reset-password")
async def reset_password(req: ResetPasswordRequest):
    req.username = req.username.strip().lower()
    
    # Verify OTP
    record = otps_db.find_one({"username": req.username, "otp": req.otp})
    if not record:
        raise HTTPException(status_code=400, detail="Invalid or expired OTP")
        
    # Validate New Password
    validate_password(req.new_password)
    
    # Update Password
    new_hashed = get_password_hash(req.new_password)
    users_db.update_one(
        {"username": req.username},
        {"$set": {"hashed_password": new_hashed}}
    )
    
    # Delete used OTP
    otps_db.delete_many({"username": req.username})
    
    return {"status": "success", "message": "Password updated successfully"}

@app.post("/chat")
async def chat_endpoint(request: ChatRequest, current_user: User = Depends(get_current_user)):
    global retrieval_chain
    if not retrieval_chain:
        return {"status": "error", "response": "Knowledge base initializing..."}
        
    try:
        # Analytics Logging
        if not request.incognito and analytics_db is not None:
            analytics_db.insert_one({
                "timestamp": datetime.datetime.utcnow(),
                "role": current_user.role,
                "user_id": str(current_user.username),
                "topic": "general",
                "length": len(request.message)
            })
            logger.info(f"User {current_user.username} ({current_user.role}) asked: {request.message}")
        else:
            logger.info(f"Incognito user asked a question.")
        
        response_text = retrieval_chain.invoke(
            {"input": request.message},
            config={"configurable": {"session_id": request.session_id if not request.incognito else "temp_session"}}
        )
        return {"status": "success", "response": response_text}
    except Exception as e:
        logger.error(f"Chat Error: {e}")
        return JSONResponse(status_code=500, content={"status": "error", "error": "Processing error"})

@app.get("/dashboard-stats")
async def get_dashboard_stats(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    
    if analytics_db is None:
         return {"total_queries": 0, "role_distribution": {}, "active_users": 0}

    total_queries = analytics_db.count_documents({})
    
    pipeline = [
        {"$group": {"_id": "$role", "count": {"$sum": 1}}}
    ]
    role_distribution = list(analytics_db.aggregate(pipeline))
    roles = {item['_id']: item['count'] for item in role_distribution}
    
    return {
        "total_queries": total_queries,
        "role_distribution": roles,
        "active_users": users_db.count_documents({})
    }

class Notification(BaseModel):
    id: int
    title: str
    message: str
    timestamp: datetime.datetime
    read: bool = False

# Mock Notifications Data
mock_notifications = [
    Notification(id=1, title="Exam Schedule", message="Semester 4 exams start next Monday.", timestamp=datetime.datetime.utcnow()),
    Notification(id=2, title="Library Alert", message="Library will be closed this Sunday for maintenance.", timestamp=datetime.datetime.utcnow()),
]

@app.get("/admin/users")
async def list_users(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(status_code=403, detail="Admin access required")
    users = list(users_db.find({}, {"username": 1, "role": 1, "created_at": 1}))
    # Convert ObjectId to string
    for u in users: u["_id"] = str(u["_id"])
    return users

@app.get("/notifications", response_model=List[Notification])
async def get_notifications(current_user: User = Depends(get_current_user)):
    # In real app, filter by user role/preferences
    # Simulating a new notification randomly
    import random
    if random.random() > 0.8:
        new_id = len(mock_notifications) + 1
        mock_notifications.append(Notification(
            id=new_id, 
            title="Update", 
            message=f"New announcement #{new_id}: Please check the notice board.", 
            timestamp=datetime.datetime.utcnow()
        ))
    # Return sorted by time, newest first
    return sorted(mock_notifications, key=lambda x: x.timestamp, reverse=True)[:5]

@app.get("/users/me", response_model=User)
async def read_users_me(current_user: User = Depends(get_current_user)):
    return current_user

# Mock Admin Data (Existing)
faqs_db = [
    {"id": 1, "question": "Library Timings?", "answer": "8 AM - 8 PM"},
]

@app.get("/faqs")
async def get_faqs():
    return faqs_db

if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    print(f"Running on http://localhost:{port}")
    uvicorn.run(app, host="0.0.0.0", port=port)
