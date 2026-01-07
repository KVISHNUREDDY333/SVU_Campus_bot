from langchain_community.vectorstores import MongoDBAtlasVectorSearch
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain_community.chat_message_histories import ChatMessageHistory
from langchain_core.chat_history import BaseChatMessageHistory
from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.runnables import RunnablePassthrough
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

# User profiles will be loaded from DB in future
mock_academic_data = {}

def get_session_history(session_id: str) -> BaseChatMessageHistory:
    if session_id not in store:
        store[session_id] = {
            "history": ChatMessageHistory(),
            "entities": {}
        }
    return store[session_id]["history"]

def get_session_entities(session_id: str) -> dict:
    if session_id not in store:
        get_session_history(session_id)
    return store[session_id].get("entities", {})

def update_entities(session_id: str, message: str):
    """Simple entity extraction to improve conversational intelligence"""
    entities = get_session_entities(session_id)
    msg_lower = message.lower()
    
    # Campus specific entity extraction
    if "it lab" in msg_lower: entities["last_location"] = "IT Lab"
    if "cse" in msg_lower or "computer science" in msg_lower: entities["department"] = "CSE"
    if "eee" in msg_lower: entities["department"] = "EEE"
    if "admission" in msg_lower: entities["topic"] = "Admissions"
    if "exam" in msg_lower or "results" in msg_lower: entities["topic"] = "Academics"
    if "canteen" in msg_lower: entities["last_location"] = "Campus Canteen"
    if "hostel" in msg_lower: entities["last_location"] = "Student Hostel"
    
    store[session_id]["entities"] = entities

# State for dynamic config
CURRENT_MODEL_NAME = "llama-3.3-70b-versatile"
CURRENT_TEMPERATURE = 0.3  # Reduced for higher precision as requested

def update_llm_config(model_name: str, temperature: float):
    global llm, CURRENT_MODEL_NAME, CURRENT_TEMPERATURE
    CURRENT_MODEL_NAME = model_name
    CURRENT_TEMPERATURE = temperature
    
    # Re-initialize LLM
    try:
        logger.info(f"Updating LLM to {model_name} with temp {temperature}")
        llm = ChatGroq(model=model_name, groq_api_key=Config.GROQ_API_KEY, temperature=temperature)
        
        # We need to rebuild the chains only, but re-running full setup is safer for now to ensure consistency
        setup_rag_chain() 
        return True
    except Exception as e:
        logger.error(f"Failed to update LLM: {e}")
        return False

def setup_rag_chain():
    global vector_db, llm, retrieval_chain, CURRENT_MODEL_NAME, CURRENT_TEMPERATURE
    try:
        # Init LLM with current config FIRST (so it works even if DB is delayed)
        llm = ChatGroq(model=CURRENT_MODEL_NAME, groq_api_key=Config.GROQ_API_KEY, temperature=CURRENT_TEMPERATURE)
        
        if not database.mongo_client:
            logger.warning("MongoDB client not initialized yet. Skipping Vector DB setup.")
            return

        logger.info("Initializing Embeddings and Vector DB...")
        embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
        
        # Initialize Vector DB if not exists
        if not vector_db:
             vector_db = MongoDBAtlasVectorSearch(
                collection=database.mongo_client[Config.DB_NAME][Config.COLLECTION_NAME],
                embedding=embeddings,
                index_name="vector_index",
                relevance_score_fn="cosine",
            )
        
        retriever = vector_db.as_retriever(search_kwargs={"k": 3})
        
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
            return vector_db.as_retriever(search_kwargs={"k": 8, "pre_filter": pre_filter})

        history_aware_retriever = (
            RunnablePassthrough.assign(
                rephrased_query=contextualize_q_prompt | llm | StrOutputParser()
            )
            | (lambda x: get_dynamic_retriever(x.get("user_username", "guest")).get_relevant_documents(x["rephrased_query"]))
        )
        
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
        6. **Proactive Assistance**: If a student's personal context (Grades/Attendance) is relevant to the query, reference it to provide a personalized experience.
        
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

async def generate_response(message: str, session_id: str, user_role: str, incognito: bool, current_time: str, language: str = "en"):
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

    if language == "te":
        lang_instruction = "The user wants to converse in Telugu. Even if they type in English or Transliterated Telugu (e.g. 'ekkada'), understanding their intent and responding in proper Telugu script is mandatory."
    elif language == "hi":
        lang_instruction = "The user wants to converse in Hindi. Respond in Hindi (Devanagari script), regardless of whether the input is in English or Hinglish."
    else:
        lang_instruction = "Reply in English."

    try:
        # Get actual username for filtering
        user_username = session_id if not incognito else "guest"
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

async def extract_faqs_from_text(text: str):
    """
    Uses the LLM to extract potential FAQ pairs from the given text.
    """
    if not llm:
         return []
    
    # We remove the hard limit. The model (likely Llama 3 70B) handles large context (128k).
    # However, purely massive texts might still need chunking if they exceed ~100k chars.
    # For now, we trust the uploaded document size is reasonable for a single pass or that the LLM service handles it.
    
    prompt = f"""
    Analyze the provided text and extract comprehensive Frequently Asked Questions (FAQs).
    
    **Instructions:**
    1. **Goal**: Extract AS MANY relevant FAQs as possible found in the text. Do not limit to 3-5. If there are 50 valid questions, extract 50.
    2. **Format**: Output a VALID JSON object with a single key "faqs" containing a list of objects.
    3. **Structure**: Each FAQ object MUST have:
       - "id": A unique sequential identifier (e.g., "FAQ_001", "FAQ_002").
       - "question": The clear, concise question.
       - "answer": A detailed answer. 
         * **CRITICAL**: If the answer involves data, lists, or steps, format it using **Markdown**.
         * Use Markdown tables, bullet points, and bold text where appropriate to represent the data structure faithfully (e.g., Use `| Col1 | Col2 |` for tables).
       - "category": One of "Academic", "Admissions", "Administration", "Events", "Colleges", "Departments", "Hostels", "Sports", "About SVU", "Campus Life", "General", "Examinations", "Technical", "Placements".
    
    **Text Content**:
    {text}
    
    **JSON Output**:
    """
    
    try:
        # Depending on the text length, this might take time.
        response = await llm.ainvoke(prompt)
        content = response.content
        
        import json
        import re
        
        # cleaning markdown code blocks
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            json_str = json_match.group(0)
            data = json.loads(json_str)
            return data.get("faqs", [])
        return []
    except Exception as e:
        logger.error(f"FAQ Extraction Error: {e}")
        return []
