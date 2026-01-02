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

load_dotenv()
logger = logging.getLogger("uvicorn")
logger.setLevel(logging.INFO)

# Global variables
vector_db = None
llm = None
retrieval_chain = None

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
FRONTEND_DIR = os.path.join(BASE_DIR, '..', 'frontend')
STATIC_DIR = os.path.join(FRONTEND_DIR, 'static')
TEMPLATES_DIR = os.path.join(FRONTEND_DIR, 'templates')
DB_PATH = os.path.join(BASE_DIR, 'chroma_db')

class ChatRequest(BaseModel):
    message: str

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
    
    # 2. Load Vector DB
    if embeddings and os.path.exists(DB_PATH):
        try:
            vector_db = Chroma(persist_directory=DB_PATH, embedding_function=embeddings)
            logger.info(f"Vector DB loaded from {DB_PATH}")
        except Exception as e:
            logger.error(f"Failed to load Vector DB: {e}")
    else:
        logger.warning(f"Vector DB not found at {DB_PATH}. Please run build_vector_db.py")
        
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
        
    # 4. Setup Chain
    if vector_db and llm:
        retriever = vector_db.as_retriever(search_kwargs={"k": 3})
        
        template = """
        You are an intelligent campus assistant for SV University. Use the following context to answer the student's question.
        If the answer is not in the context, say you don't know politely or provide general advice if appropriate.
        Keep answers concise, helpful, and friendly.
        
        Context:
        {context}
        
        Question: {question}
        
        Answer:
        """
        
        prompt = PromptTemplate.from_template(template)
        
        def format_docs(docs):
            return "\n\n".join(doc.page_content for doc in docs)
            
        retrieval_chain = (
            {"context": retriever | format_docs, "question": RunnablePassthrough()}
            | prompt
            | llm
            | StrOutputParser()
        )
        logger.info("RAG Chain initialized successfully.")
            
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
        response_text = retrieval_chain.invoke(request.message)
        return {"status": "success", "response": response_text}
    except Exception as e:
        logger.error(f"Error generating response: {e}")
        return JSONResponse(
            status_code=500, 
            content={"status": "error", "error": "Internal processing error"}
        )

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
