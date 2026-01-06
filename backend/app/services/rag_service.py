from langchain_community.vectorstores import MongoDBAtlasVectorSearch
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory
from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.output_parsers import StrOutputParser
from langchain_community.document_loaders import PyPDFLoader, WebBaseLoader
from langchain_text_splitters import RecursiveCharacterTextSplitter
import logging
import os
from ..core.config import Config
from ..core import database

logger = logging.getLogger("uvicorn")

vector_db = None
llm = None
retrieval_chain = None
store = {}

# Mock Academic Data (Inject here for now)
mock_academic_data = {
    "student": {
        "grades": "Current Semester (Sem 4): \n- Artificial Intelligence: A\n- Web Technologies: A+\n- Probability & Statistics: B+\n- CGPA: 8.5",
        "schedule": "Monday: 09:00 AM - AI Class (Room 304)\nTuesday: 11:00 AM - Web Lab (Lab 2)\nWednesday: 10:00 AM - Library Hour"
    },
    "faculty": {
        "schedule": "Monday: 10:00 AM - Staff Meeting\nWednesday: 02:00 PM - Research Review"
    },
    "admin": {
        "access": "Full System Access. Maintenance scheduled for Sunday 2 AM."
    }
}

def get_session_history(session_id: str) -> BaseChatMessageHistory:
    if session_id not in store:
        store[session_id] = ChatMessageHistory()
    return store[session_id]

def setup_rag_chain():
    global vector_db, llm, retrieval_chain
    if not database.mongo_client:
        logger.error("MongoDB client not initialized. Cannot setup RAG.")
        return

    try:
        logger.info("Initializing Embeddings...")
        embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
        
        vector_db = MongoDBAtlasVectorSearch(
            collection=database.mongo_client[Config.DB_NAME][Config.COLLECTION_NAME],
            embedding=embeddings,
            index_name="vector_index",
            relevance_score_fn="cosine",
        )
        
        llm = ChatGroq(model="llama-3.3-70b-versatile", api_key=Config.GROQ_API_KEY)
        
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
        
        Current Time: {current_time}
        
        Personal Context (User Specific Info):
        {user_context}
        
        Use the following pieces of retrieved context to answer the question.
        Use the provided Current Time to answer time-sensitive questions (e.g., "is the library open now?").
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
                "input": lambda x: x["input"],
                "user_context": lambda x: x.get("user_context", "No personal data available."),
                "current_time": lambda x: x.get("current_time", "Unknown Time")
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
        logger.info("RAG Chain Setup Complete.")
        
    except Exception as e:
        logger.error(f"Error setting up RAG chain: {e}")

async def generate_response(message: str, session_id: str, user_role: str, incognito: bool, current_time: str):
    if not retrieval_chain:
        return "System initializing, please try again in a moment."

    # Get User Context (Grades/Schedule mocks)
    user_role_key = user_role if not incognito else "guest"
    personal_info = mock_academic_data.get(user_role_key, {})
    
    personal_context_str = ""
    if personal_info:
        for k, v in personal_info.items():
            personal_context_str += f"{k.title()}: {v}\n"
    else:
            personal_context_str = "No specific personal data."

    try:
        response_text = await retrieval_chain.ainvoke(
            {"input": message, "user_context": personal_context_str, "current_time": current_time},
            config={"configurable": {"session_id": session_id if not incognito else "temp_session"}}
        )
        return response_text
    except Exception as e:
        import traceback
        logger.error(f"RAG Chain Invocation Error: {e}\n{traceback.format_exc()}")
        raise e

async def ingest_url(url: str):
    """
    Scrapes a URL, cleans it, splits it, and stores vectors in MongoDB.
    """
    if not vector_db:
         setup_rag_chain()
         if not vector_db:
             raise Exception("Vector DB not initialized")

    try:
        logger.info(f"Ingesting URL: {url}")
        loader = WebBaseLoader(url, requests_kwargs={"verify": False})
        docs = loader.load()
        
        # Split text
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        splits = text_splitter.split_documents(docs)
        
        # Add to Vector DB
        vector_db.add_documents(splits)
        
        logger.info(f"Successfully ingested {len(splits)} chunks from {url}")
        return len(splits)
    except Exception as e:
        logger.error(f"URL Ingestion Error: {e}")
        raise e

async def ingest_pdf(file_path: str):
    """
    Parses a PDF, splits it into chunks, and stores vectors in MongoDB.
    """
    if not vector_db:
         # Try to initialize if not already done (e.g. if no server startup hook ran, though strictly it should have)
         setup_rag_chain()
         if not vector_db:
             raise Exception("Vector DB not initialized")

    try:
        logger.info(f"Ingesting PDF: {file_path}")
        loader = PyPDFLoader(file_path)
        pages = loader.load()
        
        # Split text
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        splits = text_splitter.split_documents(pages)
        
        # Add to Vector DB
        # MongoDBAtlasVectorSearch logic inside langchain handles the embedding generation using the 'embedding' object we passed during init
        vector_db.add_documents(splits)
        
        logger.info(f"Successfully ingested {len(splits)} chunks from {file_path}")
        return len(splits)
    except Exception as e:
        logger.error(f"Ingestion Error: {e}")
        raise e

async def ingest_text(text: str, metadata: dict = None):
    """
    Ingests raw text into the vector database.
    """
    if not vector_db:
         setup_rag_chain()
         if not vector_db:
             raise Exception("Vector DB not initialized")
    
    try:
        from langchain.schema import Document
        logger.info("Ingesting Text Chunk...")
        
        doc = Document(page_content=text, metadata=metadata or {})
        
        # Split text (optional for short FAQs but good practice)
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        splits = text_splitter.split_documents([doc])
        
        vector_db.add_documents(splits)
        return len(splits)
    except Exception as e:
        logger.error(f"Text Ingestion Error: {e}")
        raise e
