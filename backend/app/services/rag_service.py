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

# User profiles will be loaded from DB in future
mock_academic_data = {}

def get_session_history(session_id: str) -> BaseChatMessageHistory:
    if session_id not in store:
        store[session_id] = ChatMessageHistory()
    return store[session_id]

# State for dynamic config
CURRENT_MODEL_NAME = "llama-3.3-70b-versatile"
CURRENT_TEMPERATURE = 0.7

def update_llm_config(model_name: str, temperature: float):
    global llm, CURRENT_MODEL_NAME, CURRENT_TEMPERATURE
    CURRENT_MODEL_NAME = model_name
    CURRENT_TEMPERATURE = temperature
    
    # Re-initialize LLM
    try:
        logger.info(f"Updating LLM to {model_name} with temp {temperature}")
        llm = ChatGroq(model=model_name, api_key=Config.GROQ_API_KEY, temperature=temperature)
        
        # We need to rebuild the chains only, but re-running full setup is safer for now to ensure consistency
        setup_rag_chain() 
        return True
    except Exception as e:
        logger.error(f"Failed to update LLM: {e}")
        return False

def setup_rag_chain():
    global vector_db, llm, retrieval_chain, CURRENT_MODEL_NAME, CURRENT_TEMPERATURE
    if not database.mongo_client:
        logger.error("MongoDB client not initialized. Cannot setup RAG.")
        return

    try:
        logger.info("Initializing Embeddings...")
        embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
        
        # Initialize Vector DB if not exists (or always to be safe)
        if not vector_db:
             vector_db = MongoDBAtlasVectorSearch(
                collection=database.mongo_client[Config.DB_NAME][Config.COLLECTION_NAME],
                embedding=embeddings,
                index_name="vector_index",
                relevance_score_fn="cosine",
            )
        
        # Init LLM with current config
        llm = ChatGroq(model=CURRENT_MODEL_NAME, api_key=Config.GROQ_API_KEY, temperature=CURRENT_TEMPERATURE)
        
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
        
        **CRITICAL INSTRUCTIONS**:
        1. **Language Detection**: If the user asks in **Telugu**, reply in **Telugu**. If in **Hindi**, reply in **Hindi**. Otherwise, English.
        2. **Maps**: If the user asks for a location (e.g., "Where is the Library?"), provide a clear description and append "[Map Link]" (frontend will handle this).
        3. **Time**: Use {current_time} for time-sensitive queries.
        4. **Unknowns**: If you don't know, say "I don't know, but you can raise a ticket for this." politely in the user's language.
        
        
        **Language Instruction**: {language_instruction}
        
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
                "current_time": lambda x: x.get("current_time", "Unknown Time"),
                "language_instruction": lambda x: x.get("language_instruction", "Reply in English")
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
        response_text = await retrieval_chain.ainvoke(
            {
                "input": message, 
                "user_context": personal_context_str, 
                "current_time": current_time,
                "language_instruction": lang_instruction
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
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
        splits = text_splitter.split_documents(docs)
        
        # Add to Vector DB
        vector_db.add_documents(splits)
        
        logger.info(f"Successfully ingested {len(splits)} chunks from {url}")
        return len(splits), full_text
    except Exception as e:
        logger.error(f"URL Ingestion Error: {e}")
        raise e

async def ingest_pdf(file_path: str):
    """
    Parses a PDF, splits it, and stores vectors.
    Returns tuple: (num_chunks, full_text_content)
    """
    if not vector_db:
         setup_rag_chain()
         if not vector_db:
             raise Exception("Vector DB not initialized")

    try:
        logger.info(f"Ingesting PDF: {file_path}")
        loader = PyPDFLoader(file_path)
        pages = loader.load()
        
        full_text = "\n\n".join([d.page_content for d in pages])
        
        # Split text
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=1000, chunk_overlap=200)
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
       - "category": One of "Academic", "Admissions", "Campus Life", "General", "Examinations", "Technical", "Placements".
    
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
