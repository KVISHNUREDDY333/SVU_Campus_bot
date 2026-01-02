import os
import logging
from contextlib import asynccontextmanager
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from dotenv import load_dotenv

# LangChain Imports
from langchain_groq import ChatGroq
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.prompts import PromptTemplate
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser

from typing import Dict
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder

from pymongo import MongoClient
from langchain_mongodb import MongoDBAtlasVectorSearch

load_dotenv()
logger = logging.getLogger("uvicorn")
logger.setLevel(logging.INFO)

# Global variables
vector_db = None
llm = None
retrieval_chain = None

# In-memory history storage
store: Dict[str, BaseChatMessageHistory] = {}

def get_session_history(session_id: str) -> BaseChatMessageHistory:
    if session_id not in store:
        store[session_id] = ChatMessageHistory()
    return store[session_id]

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, '..', 'frontend')
STATIC_DIR = os.path.join(FRONTEND_DIR, 'static')
TEMPLATES_DIR = os.path.join(FRONTEND_DIR, 'templates')

# MongoDB Config
MONGODB_URI = os.getenv('MONGODB_URI')
DB_NAME = os.getenv('MONGODB_DB', 'svu_chatbot')
COLLECTION_NAME = os.getenv('MONGODB_COLLECTION', 'svu_vectors')
INDEX_NAME = "default" 

class ChatRequest(BaseModel):
    message: str
    session_id: str = "default_session"

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup
    global vector_db, llm, retrieval_chain
    
    logger.info("Starting SVU Campus Assistant Backend (FastAPI)...")
    
    # 1. Init Embeddings
    try:
        embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")
        logger.info("Embeddings model initialized.")
    except Exception as e:
        logger.error(f"Failed to load embeddings: {e}")
        embeddings = None
    
    # 2. Connect to MongoDB
    if embeddings and MONGODB_URI:
        try:
            client = MongoClient(MONGODB_URI)
            collection = client[DB_NAME][COLLECTION_NAME]
            
            vector_db = MongoDBAtlasVectorSearch(
                collection=collection,
                embedding=embeddings,
                index_name=INDEX_NAME
            )
            logger.info(f"Connected to MongoDB Atlas Vector Store: {DB_NAME}.{COLLECTION_NAME}")
        except Exception as e:
            logger.error(f"Failed to connect to MongoDB: {e}")
    else:
        logger.warning("MONGODB_URI or Embeddings missing.")
        
    # 3. Init Groq LLM
    groq_api_key = os.getenv("GROQ_API_KEY")
    if groq_api_key:
        try:
            llm = ChatGroq(
                temperature=0.7, 
                model_name="llama-3.1-8b-instant", 
                api_key=groq_api_key
            )
            logger.info("Groq LLM initialized.")
        except Exception as e:
            logger.error(f"Failed to init Groq: {e}")
    else:
        logger.warning("GROQ_API_KEY not found.")
        
    # 4. Setup Chain with History
    if vector_db and llm:
        retriever = vector_db.as_retriever(search_kwargs={"k": 3})
        
        # Contextualize question prompt
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
        
        # QA prompt
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
            if isinstance(docs, list):
                return "\n\n".join(doc.page_content for doc in docs)
            return ""

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
        
        logger.info("RAG Chain with Memory initialized successfully.")
            
    yield
    # Shutdown
    logger.info("Shutting down...")

app = FastAPI(lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount Static Files
if os.path.exists(STATIC_DIR):
    app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

@app.get("/")
async def read_root():
    index_path = os.path.join(TEMPLATES_DIR, 'index.html')
    if os.path.exists(index_path):
        return FileResponse(index_path)
    return HTMLResponse("<h1>Frontend not found</h1>")

@app.post("/chat")
async def chat_endpoint(request: ChatRequest):
    global retrieval_chain
    
    if not retrieval_chain:
        # Fallback if DB not ready
        return {
            "status": "success", 
            "response": "I am currently initializing my knowledge base or there was an error loading it. Please try again in a moment."
        }
        
    try:
        response_text = retrieval_chain.invoke(
            {"input": request.message},
            config={"configurable": {"session_id": request.session_id}}
        )
        return {"status": "success", "response": response_text}
    except Exception as e:
        logger.error(f"Error generating response: {e}")
        return JSONResponse(
            status_code=500, 
            content={"status": "error", "error": "Internal processing error"}
        )

# Mock Data for Admin Panel
faqs_db = [
    {"id": 1, "question": "What are the library timings?", "answer": "The central library is open from 8 AM to 8 PM on weekdays."},
    {"id": 2, "question": "How to access Wi-Fi?", "answer": "Students can register their devices at the computer center to access campus Wi-Fi."},
    {"id": 3, "question": "Where is the health center?", "answer": "The health center is located near the main entrance, opposite to the administrative block."}
]

@app.get("/faqs")
async def get_faqs():
    return faqs_db

class FAQItem(BaseModel):
    question: str
    answer: str

@app.post("/faqs")
async def add_faq(faq: FAQItem):
    new_id = len(faqs_db) + 1
    new_item = {"id": new_id, "question": faq.question, "answer": faq.answer}
    faqs_db.append(new_item)
    return {"status": "success", "message": "FAQ added successfully", "faq": new_item}

@app.get("/health")
async def health():
    return {
        "status": "healthy", 
        "vector_db": vector_db is not None, 
        "llm": llm is not None
    }

if __name__ == "__main__":
    import uvicorn
    # Use port 5000 to match old flask app if needed, or 8000. 
    # User was running on 5000 in main.py. FastAPI default is 8000. 
    # I'll stick to 8000 to avoid conflicts if old generic main.py is running.
    # But user might expect 5000. I'll print a message.
    print("Running on http://localhost:8000")
    uvicorn.run(app, host="0.0.0.0", port=8000)
