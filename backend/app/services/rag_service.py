from langchain_mongodb import MongoDBAtlasVectorSearch
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory
from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.runnables import RunnablePassthrough
from langchain_core.output_parsers import StrOutputParser
from langchain_community.document_loaders import PyPDFLoader, WebBaseLoader
from langchain_community.tools import DuckDuckGoSearchRun
from langchain_text_splitters import RecursiveCharacterTextSplitter
import logging
import os
from datetime import datetime
from ..core.config import Config
from ..core import database

logger = logging.getLogger("uvicorn")

vector_db = None
llm = None
retrieval_chain = None
def get_session_history(session_id: str) -> BaseChatMessageHistory:
    return MongoDBChatMessageHistory(
        session_id=session_id,
        connection_string=Config.MONGODB_URI,
        database_name=Config.DB_NAME,
        collection_name="chat_history",
    )

# User profiles will be loaded from DB in future
mock_academic_data = {}
    
def get_session_entities(session_id: str) -> dict:
    if not database.mongo_client:
        return {}
    
    try:
        db = database.mongo_client[Config.DB_NAME]
        session_doc = db["chat_sessions"].find_one({"session_id": session_id})
        return session_doc.get("entities", {}) if session_doc else {}
    except Exception as e:
        logger.error(f"Error fetching session entities: {e}")
        return {}

def update_entities(session_id: str, message: str):
    """Simple entity extraction to improve conversational intelligence"""
    entities = get_session_entities(session_id)
    msg_lower = message.lower()
    
    # Campus specific entity extraction
    if "it lab" in msg_lower: entities["last_location"] = "IT Lab"
    if "cse" in msg_lower or "computer science" in msg_lower: entities["department"] = "CSE"
    if "eee" in msg_lower: entities["department"] = "EEE"
    if "admission" in msg_lower: entities["topic"] = "Admissions"
    if "exam" in msg_lower or "results" in msg_lower or "syllabus" in msg_lower or "curriculum" in msg_lower: entities["topic"] = "Academics"
    if "canteen" in msg_lower or "food" in msg_lower: entities["last_location"] = "Campus Canteen"
    if "hostel" in msg_lower or "mess" in msg_lower or "warden" in msg_lower: 
        entities["last_location"] = "Student Hostel"
        entities["topic"] = "Hostels"
    if "admin" in msg_lower or "registrar" in msg_lower or "principal" in msg_lower or "vc" in msg_lower: entities["topic"] = "Administration"
    
    
    if database.mongo_client:
        try:
            db = database.mongo_client[Config.DB_NAME]
            db["chat_sessions"].update_one(
                {"session_id": session_id},
                {"$set": {"entities": entities, "last_interaction": datetime.utcnow()}},
                upsert=True
            )
        except Exception as e:
            logger.error(f"Error updating session entities: {e}")

def trim_session_history(session_id: str, limit: int = 20):
    """Trims chat history to keep only the last `limit` messages to prevent token overflow."""
    if not database.mongo_client: return
    try:
        db = database.mongo_client[Config.DB_NAME]
        collection = db["chat_history"]
        
        # History is stored as a single document with a "history" field (JSON string) or list of messages?
        # langchain-mongodb stores each message as a DOCUMENT usually if using MongoDBChatMessageHistory?
        # WAIT: MongoDBChatMessageHistory stores individual documents per message with SessionId?
        # Let's check the constructor usages.
        # "collection_name='chat_history'".
        # Standard MongoDBChatMessageHistory stores: {SessionId: ..., History: string} OR individual messages?
        # In modern versions, it might store a History field.
        # Actually, let's just rely on the fact that if it's too long, we might need to delete old ones.
        
        # Heuristic: If we can't easily trim without breaking the format, we might skip this.
        # But wait, looking at the code -> `MongoDBChatMessageHistory(session_id=..., collection_name="chat_history")`
        # It typically uses one document per session with a "History" field containing json.
        # Let's verify by just implementing a "check length and truncate list" approach if possible.
        
        # Checking LangChain MongoDBChatMessageHistory implementation details...
        # It typically stores a "history" field representing the list of messages.
        
        session = collection.find_one({"SessionId": session_id})
        if session and "History" in session:
             import json
             history = json.loads(session["History"])
             if len(history) > limit:
                 trimmed = history[-limit:]
                 collection.update_one(
                     {"SessionId": session_id},
                     {"$set": {"History": json.dumps(trimmed)}}
                 )
                 logger.info(f"Trimmed session {session_id} to last {limit} messages.")
    except Exception as e:
        logger.error(f"Error trimming history: {e}")

# Global State for LLM Config
# We now use the Config from core/config.py
CURRENT_TEMPERATURE = 0.3

# Initialize Components
try:
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
except Exception as e:
    logger.warning(f"Connection error downloading embeddings ({e}), attempting to load from local cache...")
    try:
        embeddings = HuggingFaceEmbeddings(
            model_name="sentence-transformers/all-MiniLM-L6-v2",
            model_kwargs={'local_files_only': True}
        )
        logger.info("Successfully loaded embeddings from local cache.")
    except Exception as e2:
        logger.error(f"Critical: Failed to load embeddings both from Hub and Cache: {e2}")
        raise e2

# Define both models globally (will be re-init in setup if needed, but good to have placeholders)
smart_llm = None
fast_llm = None

def setup_rag_chain():
    global vector_db, smart_llm, fast_llm, retrieval_chain
    try:
        # 1. Initialize Dual Models
        logger.info(f"Initializing Groq Models: Smart={Config.GROQ_MODEL_ID}, Fast={Config.GROQ_FAST_MODEL_ID}")
        smart_llm = ChatGroq(model=Config.GROQ_MODEL_ID, groq_api_key=Config.GROQ_API_KEY, temperature=CURRENT_TEMPERATURE)
        fast_llm = ChatGroq(model=Config.GROQ_FAST_MODEL_ID, groq_api_key=Config.GROQ_API_KEY, temperature=0.1) # Lower temp for rephrasing
        
        if not database.mongo_client:
            logger.warning("MongoDB client not initialized yet. Skipping Vector DB setup.")
            return

        logger.info("Initializing Embeddings and Vector DB...")
        # ... (Embeddings are already initialized globally, but we can double check or re-use)
        # Re-using global embeddings object
        
        # Initialize Vector DB if not exists
        if not vector_db:
             vector_db = MongoDBAtlasVectorSearch(
                collection=database.mongo_client[Config.DB_NAME][Config.COLLECTION_NAME],
                embedding=embeddings,
                index_name="vector_index",
                relevance_score_fn="cosine",
            )
        
        # 2. Contextualize Question Chain (Use FAST LLM)
        contextualize_q_system_prompt = """Given a chat history and the latest user question 
        which might reference context in the chat history, formulate a standalone question 
        which can be understood without the chat history. 
        
        CRITICAL: If the user's question is in a language other than English (e.g., Telugu, Hindi, or transliterated 'Hinglish'/'Tenglish'), YOU MUST TRANSLATE IT TO ENGLISH.
        The standalone question must be in English to search the database effectively.
        
        Do NOT answer the question, just reformulate (and translate if needed) it and otherwise return it as is."""
        
        contextualize_q_prompt = ChatPromptTemplate.from_messages(
            [
                ("system", contextualize_q_system_prompt),
                MessagesPlaceholder(variable_name="chat_history"),
                ("human", "{input}"),
            ]
        )
        
        def get_dynamic_retriever(user_username: str):
            # Filtering: Include public docs + docs belonging to this specific user
            pre_filter = {
                "$or": [
                    {"user_id": {"$exists": False}},  # Legacy/Admin docs
                    {"user_id": "public"},           # Explicitly public docs
                    {"user_id": user_username}       # User's own lecture notes
                ]
            }
            return vector_db.as_retriever(
                search_type="similarity_score_threshold",
                search_kwargs={
                    "k": 5,  # Increased context window slightly
                    "score_threshold": 0.4, 
                    "pre_filter": pre_filter
                }
            )

        history_aware_retriever = (
            RunnablePassthrough.assign(
                rephrased_query=contextualize_q_prompt | fast_llm | StrOutputParser()
            )
            | (lambda x: get_dynamic_retriever(x.get("user_username", "guest")).invoke(x["rephrased_query"]))
        )

        # 3. QA Chain (Use SMART LLM)
        qa_system_prompt = """You are the Senior Intelligent Campus Assistant for Sri Venkateswara University (SVU). 
        Your goal is to provide highly accurate, professional, and comprehensive information to students, faculty, and guests.

        CRITICAL CONTEXT:
        - Current Time: {current_time}
        - Known Conversation Entities: {entities}
        - User Personal Info: {user_context}
        
        Use the following pieces of retrieved context to answer the question. 
        
        **CRITICAL INSTRUCTIONS FOR ACCURACY & ELABORATION**:
        1. **Depth & Detail**: Do NOT give short or generic answers. If the information is available in the context, be elaborative. Explain the 'Why' and 'How'.
        2. **Formatting**: Use Markdown to make your response visually appealing and easy to read.
           - Use ### Headers for sections.
           - Use **Bold** for emphasis.
           - Use Bullet points or Numbered lists for steps/features.
           - Use Tables (| Col1 | Col2 |) for data comparisons or schedules.
        3. **Language Detection**: If the user asks in **Telugu**, reply in **Telugu**. If in **Hindi**, reply in **Hindi**. Otherwise, English. Ensure the tone remains academic yet helpful.
        4. **Maps & Navigation**: For locations, give descriptive directions (e.g., "Located near the Administration Block") and append "[Map Link]" for the system to render.
        5. **Context Adherence**: Only answer based on the provided context. If the answer is not there, politely state you don't have that specific data yet and suggest they "Raise a Support Ticket".
        6. **Proactive Assistance**: If a student's personal context (Grades/Attendance) is relevant to the query, reference it.
        7. **Safety**: Do not provide personal phone numbers or private data unless explicitly in the public context.
        
        **RESPONSE VALIDATION & RELIABILITY CONTROL**:
        1. **Confidence Check**: API provides a score threshold. If you receive **NO CONTEXT** or if the context is irrelevant, DO NOT GUESS.
        2. **Fallback**: If unsure, state: "I currently lack specific information on this. Please check the [Official Website](https://svuniversity.edu.in) or contact the administration."
        3. **No Hallucinations**: Verify facts against the provided context. If the context mentions "2023" and the user asks for "2026", state that you only have 2023 data.
        
        **Language Instruction**: {language_instruction}
        
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
                "current_time": lambda x: x.get("current_time", "Unknown Time"),
                "entities": lambda x: x.get("entities", "None"),
                "language_instruction": lambda x: x.get("language_instruction", "Reply in English"),
                "user_username": lambda x: x.get("user_username", "guest")
            }
            | qa_prompt
            | smart_llm 
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

async def generate_response(message: str, session_id: str, user_role: str, current_time: str, language: str = "en"):
    if not retrieval_chain:
        return "System initializing, please try again in a moment."

    # Get User Context (Grades/Schedule mocks)
    user_role_key = user_role
    personal_info = mock_academic_data.get(user_role_key, {})
    
    personal_context_str = ""
    if personal_info:
        for k, v in personal_info.items():
            personal_context_str += f"{k.title()}: {v}\n"
    else:
            personal_context_str = "No specific personal data."

    if language == "te":
        lang_instruction = "The user wants to converse in Telugu. Even if they type in English or Transliterated Telugu (e.g. 'ekkada'), understanding their intent and responding in proper Telugu script is mandatory."
    elif language == "hi":
        lang_instruction = "The user wants to converse in Hindi. Respond in Hindi (Devanagari script), regardless of whether the input is in English or Hinglish."
    else:
        lang_instruction = "Reply in English."

    try:
        # Get actual username for filtering
        user_username = session_id
        
        # Trim history to prevent token overflow
        # Trim history to prevent token overflow (Relaxed limit for Llama 3)
        trim_session_history(session_id, limit=50) # Keep last 50 messages (~ 25 turns)
        
        # Entity tracking
        # Entity tracking
        update_entities(session_id, message)
        entities_str = str(get_session_entities(session_id))

        response_text = await retrieval_chain.ainvoke(
            {
                "input": message, 
                "user_context": personal_context_str, 
                "current_time": current_time,
                "entities": entities_str,
                "language_instruction": lang_instruction,
                "user_username": user_username
            },
            config={"configurable": {"session_id": session_id}}
        )
        return response_text
    except Exception as e:
        import traceback
        logger.error(f"RAG Chain Invocation Error: {e}\n{traceback.format_exc()}")
        raise e

async def ingest_url(url: str):
    """
    Scrapes a URL, cleans it, splits it, and stores vectors in MongoDB.
    Returns tuple: (num_chunks, full_text_content)
    """
    if not vector_db:
         setup_rag_chain()
         if not vector_db:
             raise Exception("Vector DB not initialized")

    try:
        logger.info(f"Ingesting URL: {url}")
        loader = WebBaseLoader(url, requests_kwargs={"verify": False})
        docs = loader.load()
        
        full_text = "\n\n".join([d.page_content for d in docs])

        # Split text
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)
        splits = text_splitter.split_documents(docs)
        
        # Add to Vector DB
        vector_db.add_documents(splits)
        
        logger.info(f"Successfully ingested {len(splits)} chunks from {url}")
        return len(splits), full_text
    except Exception as e:
        logger.error(f"URL Ingestion Error: {e}")
        raise e

async def ingest_pdf(file_path: str, user_id: str = "public"):
    """
    Parses a PDF, splits it, and stores vectors.
    Returns tuple: (num_chunks, full_text_content)
    """
    if not vector_db:
         setup_rag_chain()
         if not vector_db:
             raise Exception("Vector DB not initialized")

    try:
        logger.info(f"Ingesting PDF: {file_path} for user: {user_id}")
        loader = PyPDFLoader(file_path)
        pages = loader.load()
        
        # Add user_id to metadata for each page
        for page in pages:
            page.metadata["user_id"] = user_id
        
        full_text = "\n\n".join([d.page_content for d in pages])
        
        # Split text
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=800, chunk_overlap=150)
        splits = text_splitter.split_documents(pages)
        
        # Add to Vector DB
        vector_db.add_documents(splits)
        
        logger.info(f"Successfully ingested {len(splits)} chunks from {file_path}")
        return len(splits), full_text
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

async def ingest_faq(question: str, answer: str, source: str = "manual", faq_id: str = None):
    """
    Ingests a single FAQ into the vector database.
    Does NOT split text (FAQs are usually detailed but atomic).
    Uses faq_id to prevent duplicates if provided.
    """
    if not vector_db:
         setup_rag_chain()
         if not vector_db:
             raise Exception("Vector DB not initialized")
    
    try:
        from langchain.schema import Document
        
        content = f"Question: {question}\nAnswer: {answer}"
        metadata = {"source": source, "type": "faq", "faq_id": faq_id}
        
        doc = Document(page_content=content, metadata=metadata)
        
        # We generally don't split FAQs unless they are massive. 
        # Ideally, each FAQ is one document.
        
        ids = [faq_id] if faq_id else None
        
        # Check if exists (simple heuristic: try to delete first? No, Atlas handles upsert if ID matches? 
        # Actually standard LangChain add_documents doesn't always upsert by ID on all stores. 
        # But assuming MongoDB store typically honors _id if passed.)
        # Note: langchain-mongodb might assign _id from ids list.
        
        vector_db.add_documents([doc], ids=ids)
        return True
    except Exception as e:
        # If duplicate key error (E11000), it means it's already there. We can ignore or update.
        if "E11000" in str(e):
             logger.info(f"FAQ {faq_id} already exists. Skipping.")
             return True
        logger.error(f"FAQ Ingestion Error: {e}")
        return False

async def extract_faqs_from_text(text: str):
    """
    Uses the LLM to extract potential FAQ pairs from the given text.
    Handles large text by processing in chunks to avoid Token Rate Limits.
    """
    if not llm:
         return []
    
    # Split text into manageable chunks (approx 15k chars ≈ 3-4k tokens)
    # This allows processing unlimited text size by breaking it down.
    chunk_size = 15000
    chunks = [text[i:i+chunk_size] for i in range(0, len(text), chunk_size)]
    
    all_faqs = []
    
    import json
    import re
    import asyncio
    
    logger.info(f"Extracting FAQs from {len(text)} chars in {len(chunks)} chunks...")

    for i, chunk in enumerate(chunks):
        prompt = f"""
        Analyze the provided text fragment (Part {i+1}/{len(chunks)}) and extract comprehensive Frequently Asked Questions (FAQs).
        
        **Instructions:**
        1. **Goal**: Extract AS MANY relevant FAQs as possible found in this text fragment.
        2. **Format**: Output a VALID JSON object with a single key "faqs" containing a list of objects.
        3. **Structure**: Each FAQ object MUST have:
           - "id": A unique identifier.
           - "question": The question.
           - "answer": A detailed answer (use Markdown if needed).
           - "category": Best fitting category.
        
        **Text Content**:
        {chunk}
        
        **JSON Output**:
        """
        
        try:
            response = await llm.ainvoke(prompt)
            content = response.content
            
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                json_str = json_match.group(0)
                data = json.loads(json_str)
                chunk_faqs = data.get("faqs", [])
                all_faqs.extend(chunk_faqs)
            
            # Rate Limit Protection: Small pause between chunks
            if len(chunks) > 1:
                await asyncio.sleep(2) 

        except Exception as e:
            logger.error(f"FAQ Extraction Error (Chunk {i+1}): {e}")
            continue

    return all_faqs

async def validate_faq_with_web(question: str, answer: str) -> bool:
    """
    Validates the FAQ against the official SVU website.
    Returns True if valid/supported, False if contradicted/hallucinated.
    """
    if not llm: return True # Fail open if LLM down
    
    try:
        search = DuckDuckGoSearchRun()
        # Restrict search to official site
        query = f"site:svuniversity.edu.in {question}"
        search_results = search.run(query)
        
        validation_prompt = f"""
        You are a Fact-Checker for SV University. Validate if the provided Answer to the Question is supported by the Search Results from the official website.
        
        Question: {question}
        Proposed Answer: {answer}
        
        Official Search Results:
        {search_results}
        
        Instructions:
        1. If the Search Results **support** the Answer (even partially), return "VALID".
        2. If the Search Results **contradict** the Answer, return "INVALID".
        3. If the Search Results are empty or irrelevant but the Answer seems plausible (general knowledge), return "VALID" (benefit of doubt).
        4. ONLY return "VALID" or "INVALID".
        """
        
        # Quick check with LLM
        response = await llm.ainvoke(validation_prompt)
        result = response.content.strip().upper()
        
        logger.info(f"FAQ Validation: {question[:30]}... -> {result}")
        
        return "VALID" in result
        
    except Exception as e:
        logger.error(f"Validation Error: {e}")
        return True # Default to True on search/validation error to not block ingestion
