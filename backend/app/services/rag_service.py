from langchain_mongodb import MongoDBAtlasVectorSearch
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_groq import ChatGroq
from langchain_core.chat_history import BaseChatMessageHistory
from langchain_mongodb.chat_message_histories import MongoDBChatMessageHistory
from langchain.chains import create_history_aware_retriever, create_retrieval_chain
from langchain.chains.combine_documents import create_stuff_documents_chain
from langchain_core.prompts import ChatPromptTemplate, MessagesPlaceholder
from langchain_core.runnables.history import RunnableWithMessageHistory
from langchain_core.runnables import RunnablePassthrough, RunnableLambda
from langchain_core.output_parsers import StrOutputParser
from langchain_community.document_loaders import PyPDFLoader, WebBaseLoader
from langchain_community.tools import DuckDuckGoSearchRun
from langchain_text_splitters import RecursiveCharacterTextSplitter
from langchain.schema import Document
import logging
import os
import json
import re
from datetime import datetime

# Configure environment variables to suppress Hugging Face warnings
os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
os.environ["TRANSFORMERS_VERBOSITY"] = "error"
os.environ["TOKENIZERS_PARALLELISM"] = "false" # Avoids potential parallelism warnings

try:
    # Suppress verbose "unauthenticated requests" warnings from huggingface_hub
    from huggingface_hub.utils import logging as hf_logging
    hf_logging.set_verbosity_error()
except Exception:
    pass
from ..core.config import Config
from ..core import database
from .logging_service import log_event
from .response_refiner import get_response_refiner
from .prompt_templates import get_context_cleaning_prompt
from .enhanced_faq_chatbot import get_enhanced_faq_chatbot

logger = logging.getLogger("uvicorn")

MASTER_AGENT_PROMPT = """🛡️ UNIVERSITY ELITE ACADEMIC ASSISTANT POLICY (SVU-OFFICIAL)
You are the Official High-Fidelity Academic Assistant for Sri Venkateswara University (SVU). Your mission is to provide the absolute best, most factual, and highly relevant academic support to students and staff.

🔒 STRICT RESPONSE POLICY & SAFETY:
1. ✅ ALLOWED CONTENT (Strictly Academic):
   - Comprehensive subject matter explanations
   - Official University info (Admissions, Fees, Results, Calendar)
   - Career growth, coding help, and competitive exam preparation (GATE, UPSC)
   - Verified General Knowledge (GK) and Current Affairs

2. 🧠 RESPONSE QUALITY STANDARDS (ELITE-TIER):
   - **FACTUALITY**: Never hallucinate. Every detail must be cross-verified against the provided Context.
   - **STRUCTURE**: Use professional Markdown (Bold titles, Bulleted lists, Tables for data).
   - **TONE**: Authoritative yet student-friendly. Maintain the dignity of Sri Venkateswara University.
   - **RELEVANCE**: Focus purely on the user's intent. Do not include fluff.

3. ❌ PROHIBITED CONTENT:
   - No hate speech, offensive content, or inappropriate topics.
   - Reject non-educational casual chat with the official Rejection Response.

4. 🚫 OFFICIAL REJECTION RESPONSE:
   "I'm here to support academic and knowledge-related queries only. Please ask something related to studies, exams, or general knowledge."
"""

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
        
        doc_count = collection.count_documents({"SessionId": session_id})
        
        if doc_count > limit:
            delete_count = doc_count - limit
            
            cursor = collection.find(
                {"SessionId": session_id},
                {"_id": 1}
            ).sort("_id", 1).limit(delete_count)
            
            ids_to_delete = [doc["_id"] for doc in cursor]
            
            if ids_to_delete:
                collection.delete_many({"_id": {"$in": ids_to_delete}})
                logger.info(f"Trimmed session {session_id}: Deleted {len(ids_to_delete)} old messages. Kept {limit}.")
    except Exception as e:
        logger.error(f"Error trimming history: {e}")

CURRENT_TEMPERATURE = 0.0

try:
    # Reverted to all-MiniLM-L6-v2 (384) to match existing MongoDB Vector Index
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

smart_llm = None
fast_llm = None

def setup_rag_chain(force_reload: bool = False):
    global vector_db, smart_llm, fast_llm, retrieval_chain, llm
    log_event("INFO", "Starting RAG Pipeline init...")
    try:
        # Streamlined startup logs
        logger.info("Initializing Intelligence Engine (Groq)...")
        smart_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID, 
            groq_api_key=Config.GROQ_API_KEY, 
            temperature=CURRENT_TEMPERATURE,
            model_kwargs={"top_p": 0.9},
            timeout=60
        )
        fast_llm = ChatGroq(
            model=Config.GROQ_FAST_MODEL_ID, 
            groq_api_key=Config.GROQ_API_KEY, 
            temperature=0.1,
            timeout=60
        )
        
        llm = smart_llm

        if not database.mongo_client:
            logger.warning("MongoDB client not initialized yet. Skipping Vector DB setup.")
            log_event("WARN", "MongoDB client not ready for RAG setup.")
            return

        logger.info("Initializing Embeddings and Vector DB...")
        
        if not vector_db or force_reload:
             vector_db = MongoDBAtlasVectorSearch(
                collection=database.mongo_client[Config.DB_NAME][Config.COLLECTION_NAME],
                embedding=embeddings,
                index_name="vector_index",
                relevance_score_fn="cosine",
             )
             log_event("SUCCESS", "Connected to MongoDB Atlas Vector Store.")
        
        contextualize_q_system_prompt = """Given a chat history and the latest user question, formulate a standalone question which can be understood without the chat history. 
        
        CRITICAL: 
        1. If the user's question is in a language other than English, YOU MUST TRANSLATE IT TO ENGLISH.
        2. EXCLUSION: If the user query is clearly UNSAFE, offensive, or non-educational (e.g., adult content, hate speech, violence), DO NOT rephrase it. Instead, return the string "UNSAFE_QUERY".
        
        The standalone question must be in English to search the database effectively."""
        
        contextualize_q_prompt = ChatPromptTemplate.from_messages(
            [
                ("system", contextualize_q_system_prompt),
                MessagesPlaceholder(variable_name="chat_history"),
                ("human", "{input}"),
            ]
        )
        
        base_retriever = vector_db.as_retriever(
            search_type="similarity",
            search_kwargs={"k": 5}
        )

        history_aware_retriever = (
            RunnablePassthrough.assign(
                rephrased_query=contextualize_q_prompt | fast_llm | StrOutputParser()
            )
            | (lambda x: base_retriever.invoke(x["rephrased_query"]))
        )

        qa_system_prompt = """You are the official University Safe Academic Assistant for SVU. 

🎯 MISSION: Deliver accurate, factual, and academic-quality information.

🧠 CLASSIFICATION & SAFETY:
- If query is SAFE + EDUCATIONAL → Answer helpfully.
- If UNSAFE or OUT OF SCOPE → Reject with: "I'm here to support academic and knowledge-related queries only. Please ask something related to studies, exams, or general knowledge."

📌 STANDARDIZED ELITE ANSWER STRUCTURE:
1. **Direct Answer**: (Concise, high-impact overview)
2. **📌 Key Details**: (Structured bullet points for steps, official rules, or technical data)
3. **Professional Guidance**: (Relevant academic advice or next steps in the student's journey)

🚫 RESTRICTIONS:
- Ground all facts in the provided Cleaned Context.
- Use **BOLD TEXT** for critical terms.
- Use Markdown Tables for ANY numerical or comparative data.
- If information is missing from context, state: "I don't have official data on this specific point from the university records, but here is what I can provide based on general academic knowledge: [Response]" OR suggest contacting the administrative office.

Cleaned Context:
{context}

Known Entities: {entities}
Language Rule: {language_instruction}
"""
        
        qa_prompt = ChatPromptTemplate.from_messages(
            [
                ("system", qa_system_prompt),
                MessagesPlaceholder(variable_name="chat_history"),
                ("human", "{input}"),
            ]
        )
        
        def format_docs(docs):
            if not docs:
                return ""
            return "\n\n".join(doc.page_content for doc in docs)

        async def safe_rag_chain(input_dict):
            context_str = input_dict["context"]
            
            logger.info(f"[RAG] Context length: {len(context_str)} chars for query: {input_dict.get('input', '')[:80]}")
            if context_str.strip():
                logger.info(f"[RAG] Context preview: {context_str[:200]}...")
            
            if len(context_str.strip()) < 10:
                logger.warning("[RAG] Context empty or too short")
                return "I don’t have enough information to answer that. Please contact the university office."
            
            return await (qa_prompt | smart_llm | StrOutputParser()).ainvoke(input_dict)

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
            | RunnableLambda(safe_rag_chain)
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



async def _search_keywords_directly(query: str, limit: int = 5, return_list: bool = False, doc_type: str = None, keywords: list = None):
    """
    Search by keyword directly in svu_vectors collection (useful if vector search misses exact terms).
    Optional 'doc_type' allows targeting specific results like 'faq'.
    """
    if database.svu_vectors_db is None:
        return [] if return_list else ""
    try:
        search_words = keywords if keywords else [w for w in query.split() if len(w) > 3]
        if not search_words:
            return [] if return_list else ""
        
        # Use OR logic to match any of the important keywords across multiple fields
        regex_pattern = "|".join(re.escape(word) for word in search_words)
        regex_obj = re.compile(regex_pattern, re.IGNORECASE)
        
        search_query = {
            "$or": [
                {"text": {"$regex": regex_obj}},
                {"category": {"$regex": regex_obj}},
                {"keywords": {"$in": [regex_obj]}} 
            ]
        }
        
        if doc_type:
            search_query["type"] = doc_type
            
        results = list(database.svu_vectors_db.find(
            search_query,
            {"text": 1, "category": 1, "_id": 0}
        ).sort("created_at", -1).limit(limit)) # Prioritize newer records
        
        if not results:
            return [] if return_list else ""
            
        texts = [doc.get("text", "") for doc in results if "text" in doc]
        if return_list:
            return texts
            
        context = "\n\n".join(texts)
        scope = f"(Type: {doc_type})" if doc_type else ""
        logger.info(f"Keyword search {scope} found {len(results)} results using words: {search_words}")
        return context
    except Exception as e:
        logger.error(f"Keyword search error: {e}")
        return [] if return_list else ""

def _search_vectors_directly(query: str, limit: int = 10, return_list: bool = False):
    """Search svu_vectors collection using embedding-based similarity search.
    Uses similarity threshold filtering to ensure high confidence."""
    if not vector_db:
        return [] if return_list else ""
    try:
        results = vector_db.similarity_search_with_score(query, k=limit + 3)
        
        if not results:
            return [] if return_list else ""
            
        # Threshold: 0.50 (cosine similarity) - Lowered from 0.60 to improve recall
        valid_docs = [doc for doc, score in results if score >= 0.50]
        valid_docs = valid_docs[:limit]
        
        if not valid_docs:
            logger.info(f"Vector search found results, but none met the 0.50 threshold for query: {query[:50]}")
            return [] if return_list else ""
        
        if return_list:
            return valid_docs
            
        context = "\n\n".join(doc.page_content for doc in valid_docs if doc.page_content)
        logger.info(f"Vectors similarity search found {len(valid_docs)} valid results for query: {query[:50]}")
        return context
    except Exception as e:
        logger.error(f"Vectors similarity search error: {e}")
        return [] if return_list else ""

def _reciprocal_rank_fusion(vector_results, keyword_results, k=60):
    """Combines vector and keyword results using Reciprocal Rank Fusion."""
    scores = {}
    from langchain.schema import Document
    
    # Vector results processing
    for rank, doc in enumerate(vector_results):
        content = doc.page_content if hasattr(doc, 'page_content') else str(doc)
        if content not in scores:
            scores[content] = {"score": 0.0, "doc": doc}
        scores[content]["score"] += 1.0 / (rank + k + 1)
        
    # Keyword results processing
    for rank, content in enumerate(keyword_results):
        if not content: continue
        if content not in scores:
            scores[content] = {"score": 0.0, "doc": Document(page_content=content)}
        scores[content]["score"] += 1.0 / (rank + k + 1)
        
    # Sort and return top documents
    fused = sorted(scores.values(), key=lambda x: x["score"], reverse=True)
    return [item["doc"] for item in fused]

async def _hybrid_search(query: str, limit: int = 10, keywords: list = None):
    """
    Performs hybrid search combining Vector and Keyword retrieval via RRF.
    Prioritizes FAQ-specific keyword hits to ensure official answers are delivered first.
    """
    # 1. Targeted Keyword Search (FAQs only)
    faq_keyword_results = await _search_keywords_directly(query, limit=5, return_list=True, doc_type="faq", keywords=keywords)
    
    # 2. Broader Keyword Search (All sources)
    broad_keyword_results = await _search_keywords_directly(query, limit=limit, return_list=True, keywords=keywords)
    
    # 3. Vector Similarity Search (All sources)
    # Note: _search_vectors_directly is currently sync but wrapped for future-proofing
    vector_docs = _search_vectors_directly(query, limit=limit, return_list=True)
    
    # Combine results using RRF
    # We pass both sets of keyword results; RRF handles the overlap naturally
    fused_docs = _reciprocal_rank_fusion(vector_docs, faq_keyword_results + broad_keyword_results)
    
    return fused_docs[:limit]


async def generate_response(message: str, session_id: str, user_role: str, current_time: str, language: str = "en"):
    if not smart_llm:
        return "System initializing, please try again in a moment."

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
        user_username = session_id
        
        trim_session_history(session_id, limit=10)
        update_entities(session_id, message)
        entities_str = str(get_session_entities(session_id))

        try:
            # 1. QUERY ANALYSIS: Advanced Query Rewriting
            logger.info(f"[RAG] Rephrasing query: {message[:50]}")
            extracted_keywords = []
            user_requirements = "Standard 3-Part Answer"
            rephrased_query = message
            
            if fast_llm:
                try:
                    history = get_session_history(session_id).messages[-3:]
                    analysis_prompt = f"""Analyze the User Query and Chat History to improve retrieval quality.

TASK: Rewrite the user query into a clear, detailed, and search-optimized standalone question in English.
- Expand short queries and clarify user intent.
- Add missing context if implied (e.g., 'scholarships' -> 'Sri Venkateswara University scholarships').
- Make it semantically rich for vector search but keep original intent unchanged.

Chat History: {history}
User Query: {message}

Output format (JSON):
{{
    "standalone_query": "Expanded search-optimized English query",
    "keywords": ["key", "words", "only"],
    "requirements": "any specific user-requested structure"
}}
"""
                    analysis_res = await fast_llm.ainvoke(analysis_prompt)
                    analysis_content = analysis_res.content if hasattr(analysis_res, 'content') else str(analysis_res)
                    
                    if "{" in analysis_content and "}" in analysis_content:
                        json_str = analysis_content[analysis_content.find("{"):analysis_content.rfind("}")+1]
                        analysis_data = json.loads(json_str)
                        rephrased_query = analysis_data.get("standalone_query", message)
                        extracted_keywords = analysis_data.get("keywords", [])
                        user_requirements = analysis_data.get("requirements", "Standard 3-Part Answer")
                        logger.info(f"[RAG] Rewritten Query: {rephrased_query}")
                except Exception as analysis_e:
                    logger.warning(f"Query analysis failed: {analysis_e}")

            # 2. FAQ-FIRST RESPONSE PATH FOR MAIN CHAT
            faq_chatbot = get_enhanced_faq_chatbot()
            faq_result = await faq_chatbot.generate_faq_response_bundle(
                user_query=message,
                retrieval_query=rephrased_query,
                session_id=session_id,
                context=(
                    f"User Context: {personal_context_str}\n"
                    f"Known Entities: {entities_str}\n"
                    f"User Requirements: {user_requirements}"
                ),
                language_instruction=lang_instruction,
            )

            if faq_result.get("matched") and faq_result.get("response"):
                logger.info(
                    "[RAG] FAQ answer served for main chat (confidence=%s)",
                    faq_result.get("confidence", 0.0),
                )
                refiner = get_response_refiner()
                return await refiner.format_for_display(faq_result["response"])

            # 3. RETRIEVAL PHASE: Optimized Hybrid Search
            fused_docs = await _hybrid_search(rephrased_query, limit=10, keywords=extracted_keywords)
            raw_context = "\n\n".join([doc.page_content for doc in fused_docs])
            
            # 4. CONTEXT CLEANING PHASE
            logger.info(f"[RAG] Cleaning Context ({len(raw_context)} chars)")
            cleaned_context = "I don’t have enough information to answer that. Please contact the university office."
            
            if raw_context.strip() and fast_llm:
                try:
                    cleaning_prompt = get_context_cleaning_prompt(
                        query=rephrased_query,
                        raw_context=raw_context
                    )
                    cleaning_res = await fast_llm.ainvoke(cleaning_prompt)
                    cleaned_context = cleaning_res.content if hasattr(cleaning_res, 'content') else str(cleaning_res)
                except Exception as cleaning_e:
                    logger.warning(f"Context cleaning failed: {cleaning_e}")
                    cleaned_context = raw_context # Fallback to raw

            # 5. GENERATION PHASE: Standardized Answer Structure
            if len(cleaned_context.strip()) < 15:
                 return "I don’t have enough information to answer that. Please contact the university office."

            master_prompt = f"""{MASTER_AGENT_PROMPT}

Current Time: {current_time}
User Context: {personal_context_str}
Language Rule: {lang_instruction}
User Requirements: {user_requirements}

Cleaned Context (Knowledge Base):
---
{cleaned_context}
---

User Request: {message}

--- CRITICAL QUALITY RULES ---
1. **ACCURACY & FACTUALITY**: Mentally cross-verify every detail. Only output correct, reliable academic information.
2. **SAFETY FIRST**: If the request is non-educational or harmful, use the Rejection Response.
3. **STYLE**: Keep the answer simple, relevant, and directly useful. Do not add unnecessary explanation.
4. **LENGTH CONTROL**: If the question needs a short factual answer, answer in 1-2 sentences. Give longer detail only when the question asks for it.
5. **ZERO HALLUCINATION**: Only state what is confirmed by context or verified academic knowledge (GK).
"""
            
            response = await smart_llm.ainvoke(master_prompt)
            raw_response = response.content if hasattr(response, 'content') else str(response)
            
            # Refine response for better quality
            refiner = get_response_refiner()
            refined_response = await refiner.refine_response(
                raw_response=raw_response,
                original_query=message,
                context=cleaned_context
            )
            
            # Format for display
            formatted_response = await refiner.format_for_display(refined_response)
            
            return formatted_response
            
        except Exception as e:
            error_str = str(e).lower()
            if "413" in error_str or "429" in error_str or "rate limit" in error_str or "too large" in error_str:
                logger.warning(f"Rate Limit or Context Limit Hit ({e}). Retrying with trimmed history...")
                trim_session_history(session_id, limit=2)
                return "The system is currently experiencing high demand. Please try again in a few minutes."
            else:
                raise e
    except Exception as e:
        import traceback
        logger.error(f"RAG Chain Invocation Error: {e}\n{traceback.format_exc()}")
        raise e

async def process_and_refine_knowledge(text: str, source: str):
    """
    Automated pipeline: Extract -> Refine -> Ingest (with embeddings).
    This replaces the manual 'Train the Brain' feature.
    """
    try:
        # 1. Extract raw FAQs
        logger.info(f"[AUTO-TRAIN] Extracting FAQs from: {source}")
        raw_faqs = await extract_faqs_from_text(text)
        if not raw_faqs:
            logger.warning(f"[AUTO-TRAIN] No FAQs extracted from: {source}")
            return 0
            
        # 2. Refine FAQs using full context
        logger.info(f"[AUTO-TRAIN] Refining {len(raw_faqs)} FAQs for: {source}")
        refined_faqs = await refine_kb_data(raw_faqs, text)
        
        # 3. Ingest each refined FAQ (ingest_faq handles embeddings)
        inserted_count = 0
        for faq in refined_faqs:
            success = await ingest_faq(
                question=faq.get("question"),
                answer=faq.get("answer"),
                category=faq.get("category", "General"),
                source=source
            )
            if success:
                inserted_count += 1
        
        logger.info(f"[AUTO-TRAIN] Completed. Ingested {inserted_count} refined FAQs for: {source}")
        return inserted_count
    except Exception as e:
        logger.error(f"[AUTO-TRAIN] Error processing knowledge for {source}: {e}")
        return 0

async def ingest_url(url: str, store_vectors: bool = True):
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

        text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=75)
        splits = text_splitter.split_documents(docs)
        
        if store_vectors and vector_db:
             vector_db.add_documents(splits)
        elif store_vectors:
             logger.warning("Vector DB not initialized, skipping storage")
        
        logger.info(f"Successfully ingested {len(splits)} chunks from {url}")
        return len(splits), full_text
    except Exception as e:
        logger.error(f"URL Ingestion Error: {e}")
        raise e

async def ingest_pdf(file_path: str, user_id: str = "public", store_vectors: bool = True):
    """
    Parses a PDF, splits it, and stores vectors.
    Returns tuple: (num_chunks, full_text_content)
    """
    if not vector_db:
         setup_rag_chain()

    try:
        if not os.path.exists(file_path):
            logger.error(f"File not found: {file_path}")
            return 0, f"Error: File not found at {file_path}"
            
        logger.info(f"Ingesting PDF: {file_path} for user: {user_id}")
        
        full_text = ""
        try:
            from pypdf import PdfReader
            reader = PdfReader(file_path)
            text_parts = []
            for page in reader.pages:
                text_parts.append(page.extract_text() or "")
            full_text = "\n\n".join(text_parts)
            logger.info(f"Extracted {len(full_text)} chars using pypdf directly.")
        except Exception as e:
            logger.error(f"pypdf extraction failed: {e}, falling back to loader.")
        
        loader = PyPDFLoader(file_path)
        pages = loader.load()
        
        if not full_text.strip():
            full_text = "\n\n".join([d.page_content for d in pages])
            logger.info(f"Extracted {len(full_text)} chars using PyPDFLoader.")

        filename = os.path.basename(file_path)
        
        for page in pages:
            page.metadata["user_id"] = user_id
            page.metadata["source"] = filename 
        
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=75)
        
        if full_text.strip() and not pages:
             splits = text_splitter.create_documents([full_text], metadatas=[{"source": filename, "user_id": user_id}])
        else:
             splits = text_splitter.split_documents(pages)
        
        if store_vectors and vector_db:
             vector_db.add_documents(splits)
        elif store_vectors:
             logger.warning("Vector DB not initialized, skipping storage")
        
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

        logger.info("Ingesting Text Chunk...")
        
        doc = Document(page_content=text, metadata=metadata or {})
        
        text_splitter = RecursiveCharacterTextSplitter(chunk_size=400, chunk_overlap=75)
        splits = text_splitter.split_documents([doc])
        
        vector_db.add_documents(splits)
        return len(splits)
    except Exception as e:
        logger.error(f"Text Ingestion Error: {e}")
        raise e

async def ingest_calendar_event(event_id: str, title: str, from_date: str, to_date: str, event_type: str, location: str = "", description: str = ""):
    """
    Ingests a calendar event/exam into the vector database.
    Formats the event as a searchable entry for the RAG system.
    """
    try:
        # Formulate a clear, descriptive question and answer pair for the vector store
        # This structure helps the RAG retrieve the event when the user asks about it.
        # Adding 'upcoming' keywords to improve relevance for future-dated queries.
        
        question = f"What are the details for the upcoming {event_type}: {title}?"
        
        # Clean up dates for better readability in the answer
        try:
            start_dt = datetime.fromisoformat(from_date)
            end_dt = datetime.fromisoformat(to_date)
            start = start_dt.strftime("%B %d, %Y at %I:%M %p")
            end = end_dt.strftime("%B %d, %Y at %I:%M %p")
        except:
            start = from_date
            end = to_date
            
        answer = f"Yes, there is an upcoming {event_type} titled '{title}'. It is scheduled from {start} to {end}."
        if location:
            answer += f" Location: {location}."
        if description:
            answer += f" Additional Details: {description}"
            
        # Use existing ingest_faq to handle the embedding and storage
        # We prefix the ID to avoid collisions and allow targeted deletion
        vector_id = f"event_{event_id}"
        
        success = await ingest_faq(
            question=question,
            answer=answer,
            category="Calendar",
            source="calendar",
            faq_id=vector_id
        )
        
        if success:
            logger.info(f"Successfully ingested calendar event: {title} (ID: {vector_id})")
        return success
    except Exception as e:
        logger.error(f"Error ingesting calendar event {title}: {e}")
        return False

async def remove_calendar_event(event_id: str):
    """
    Removes a calendar event from the vector database.
    """
    if database.svu_vectors_db is None:
        return False
        
    try:
        vector_id = f"event_{event_id}"
        result = database.svu_vectors_db.delete_one({"faq_id": vector_id})
        if result.deleted_count > 0:
            logger.info(f"Successfully removed calendar event vector: {vector_id}")
            return True
        return False
    except Exception as e:
        logger.error(f"Error removing calendar event vector {event_id}: {e}")
        return False

async def ingest_faq(question: str, answer: str, category: str = "General", source: str = "manual", faq_id: str = None):
    """
    Ingests a single FAQ into the svu_vectors collection with a flat structure.
    Generates embeddings manually and inserts directly to ensure consistency with admin management.
    """
    if database.svu_vectors_db is None:
        logger.error("Database not available for FAQ ingestion")
        return False
        
    try:
        import re
        from bson import ObjectId
        # Check for duplicates based on exact or highly similar question text
        existing_faq = database.svu_vectors_db.find_one({
            "type": "faq",
            "text": {"$regex": f"Question:\\s*{re.escape(question)}", "$options": "i"}
        })
        
        if existing_faq and not faq_id:
            logger.info(f"Skipping duplicate FAQ: {question[:50]}")
            return False

        content = f"Question: {question}\nAnswer: {answer}"
        
        # Generate embedding
        embedding = None
        if embeddings:
            try:
                embedding = embeddings.embed_query(content)
            except Exception as e:
                logger.error(f"Error generating embedding for FAQ: {e}")
        
        # Prepare flat document
        faq_doc = {
            "text": content,
            "source": source,
            "type": "faq",
            "faq_id": faq_id or str(ObjectId()),
            "category": category,
            "created_at": datetime.utcnow()
        }
        
        if embedding:
            faq_doc["embedding"] = embedding
            
        if faq_id:
            # Upsert by faq_id
            database.svu_vectors_db.update_one(
                {"faq_id": faq_id},
                {"$set": faq_doc},
                upsert=True
            )
        else:
            database.svu_vectors_db.insert_one(faq_doc)
            
        return True
    except Exception as e:
        logger.error(f"FAQ Ingestion Error: {e}")
        return False

async def extract_faqs_from_text(text: str):
    """
    Uses the LLM to extract the MAXIMUM possible FAQ pairs from the given text.
    Strategy: smaller chunks + aggressive prompt + second-pass extraction + deduplication.
    """
    if not llm:
         return []
    
    import json
    import re
    import asyncio

    chunk_size = 3000
    overlap = 500  # Overlap to avoid cutting information at boundaries
    chunks = []
    for i in range(0, len(text), chunk_size - overlap):
        chunks.append(text[i:i + chunk_size])
    
    all_faqs = []
    
    logger.info(f"[MAX-FAQ] Extracting FAQs from {len(text)} chars in {len(chunks)} chunks (3k each)...")

    async def _parse_faq_response(content: str) -> list:
        """Parse LLM response to extract FAQ list from JSON."""
        json_match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
        if not json_match:
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
        
        if json_match:
            json_str = json_match.group(1) if json_match.groups() else json_match.group(0)
            try:
                data = json.loads(json_str)
                return data.get("faqs", [])
            except json.JSONDecodeError as je:
                logger.warning(f"JSON Decode Error: {je}")
        return []

    for i, chunk in enumerate(chunks):
        pass1_prompt = f"""
PHASE 2: FAQ GENERATION — MODE: EXHAUSTIVE MAXIMUM EXTRACTION

You are analyzing text fragment Part {i+1}/{len(chunks)}.

**CRITICAL INSTRUCTION**: Generate AT LEAST 15-20 FAQ pairs from this text. Extract EVERY possible piece of information as a separate FAQ. Do NOT summarize or merge related facts — keep them as individual Q&A pairs.

**Mine EVERY detail for FAQs including but not limited to**:
- Dates (deadlines, schedules, academic calendar dates)
- Fees (tuition, hostel, exam, application, registration)
- Names (departments, officials, buildings, programs)
- Contact info (phone numbers, emails, office locations, websites)
- Procedures (how to apply, register, pay fees, get transcripts)
- Eligibility criteria (age limits, percentage requirements, qualifications)
- Rules and regulations (attendance, exams, dress code, hostel rules)
- Facilities (labs, libraries, hostels, sports, canteen)
- Scholarships and financial aid (types, eligibility, application process)
- Exam patterns (marks distribution, passing criteria, revaluation)
- Placement info (companies, packages, eligibility)
- Research programs (PhD, M.Phil, areas of research)
- Faculty information (HODs, professors, specializations)
- Important links and resources
- Any numerical data (seats, ratios, capacities, distances)

**TECHNIQUE**: For each piece of information, generate the question a student would naturally ask. Create MULTIPLE questions about the same topic from different angles when possible.

Example: If text says "Hostel fee is ₹5000 per semester, due by July 15":
- FAQ 1: "What is the hostel fee?" → "₹5000 per semester"
- FAQ 2: "When is the hostel fee due?" → "July 15"  
- FAQ 3: "How much does it cost to stay in the hostel for one semester?" → "₹5000"

**Source Text**:
{chunk}

**Output Format** — Return ONLY valid JSON, nothing else:
{{
    "faqs": [
        {{
            "question": "Natural question a student would ask",
            "answer": "Complete, detailed answer extracted from source text.",
            "category": "Admissions|Courses & Programs|Eligibility|Entrance Exams|Fees|Scholarships|Academic Calendar|Examinations|Results|Departments|Faculty|Research|Hostels|Placements|Rules & Regulations|Notifications|Contact & Administration|General",
            "keywords": ["keyword1", "keyword2", "keyword3"]
        }}
    ]
}}
"""
        
        pass1_faqs = []
        try:
            response = await llm.ainvoke(pass1_prompt)
            pass1_faqs = await _parse_faq_response(response.content)
            all_faqs.extend(pass1_faqs)
            logger.info(f"[MAX-FAQ] Chunk {i+1} Pass 1: Extracted {len(pass1_faqs)} FAQs")
        except Exception as e:
            logger.error(f"[MAX-FAQ] Pass 1 Error (Chunk {i+1}): {e}")

        if len(chunks) > 1:
            await asyncio.sleep(2)

        existing_questions = [f.get("question", "") for f in pass1_faqs]
        existing_summary = "\n".join([f"- {q}" for q in existing_questions[:20]])

        pass2_prompt = f"""
FAQ GENERATION — SECOND PASS: FIND WHAT WAS MISSED

The following FAQs were already extracted from this text:
{existing_summary}

**YOUR JOB**: Read the source text again carefully and generate ADDITIONAL FAQs that were NOT covered above. Look for:
- Minor details, footnotes, sub-points that were overlooked
- Alternative phrasings of important questions students might ask
- Implicit information (e.g., if it says "open Mon-Fri 9-5", generate "Is the office open on weekends?" → "No, it is open Monday to Friday, 9 AM to 5 PM")
- Comparative questions (e.g., "What is the difference between X and Y?")
- Yes/No questions about policies and eligibility

Generate AT LEAST 5-10 additional FAQs.

**Source Text**:
{chunk}

**Output Format** — Return ONLY valid JSON:
{{
    "faqs": [
        {{
            "question": "Question not covered in first pass",
            "answer": "Detailed answer from source.",
            "category": "Appropriate category",
            "keywords": ["keyword1", "keyword2"]
        }}
    ]
}}
"""
        try:
            response2 = await llm.ainvoke(pass2_prompt)
            pass2_faqs = await _parse_faq_response(response2.content)
            all_faqs.extend(pass2_faqs)
            logger.info(f"[MAX-FAQ] Chunk {i+1} Pass 2: Extracted {len(pass2_faqs)} additional FAQs")
        except Exception as e:
            logger.error(f"[MAX-FAQ] Pass 2 Error (Chunk {i+1}): {e}")

        if len(chunks) > 1:
            await asyncio.sleep(2)

    seen_questions = set()
    unique_faqs = []
    for faq in all_faqs:
        q = faq.get("question", "").strip().lower()
        q_normalized = re.sub(r'[^\w\s]', '', q)
        if q_normalized and q_normalized not in seen_questions:
            seen_questions.add(q_normalized)
            unique_faqs.append(faq)
    
    logger.info(f"[MAX-FAQ] Total: {len(all_faqs)} raw → {len(unique_faqs)} unique FAQs after dedup")
    return unique_faqs

async def refine_kb_data(faqs: list, context: str):
    """
    Refines existing FAQs by improving clarity, adding context, and ensuring they are student-friendly.
    This corresponds to the 'Thorough Training' request.
    """
    if not llm or not faqs:
        return faqs

    import json
    import re
    
    import asyncio
    
    batch_size = 10
    
    sem = asyncio.Semaphore(5)
    async def process_batch(batch):
        async with sem:
            batch_json = json.dumps(batch, indent=2)
            refine_prompt = f"""
            PHASE 4: KNOWLEDGE REFINEMENT (THOROUGH TRAINING)
        
            You are the University Information Architect. Your goal is to take extracted Q&A pairs and REFINE them into high-quality, professional, and student-centric information.
        
            **Source Context**:
            {context[:8000]} # Limit context
        
            **Current Q&A Pairs**:
            {batch_json}
        
            **Instructions**:
            1. **Enhance Detail**: Add relevant context from the source text that might be missing.
            2. **Clarity & Tone**: Ensure the answer is clear, polite, and authoritative.
            3. **Accuracy**: Cross-reference each answer with the source context. Fix any subtle inaccuracies.
            4. **Refined keywords**: Update keywords to be more descriptive for search.
        
            **Output Format**:
            Return ONLY valid JSON in the exact same structure as the input:
            {{
                "faqs": [
                    {{
                        "question": "Refined question",
                        "answer": "Deeply refined, high-context answer.",
                        "category": "Category",
                        "keywords": ["key", "words"]
                    }}
                ]
            }}
            """
            try:
                response = await llm.ainvoke(refine_prompt)
                content = response.content
            
                json_match = re.search(r'```json\s*(\{.*?\})\s*```', content, re.DOTALL)
                if not json_match:
                    json_match = re.search(r'\{.*\}', content, re.DOTALL)
            
                if json_match:
                    data = json.loads(json_match.group(0))
                    return data.get("faqs", [])
                else:
                    return batch
            except Exception as e:
                logger.error(f"Refinement Batch Error: {e}")
                return batch

    # Prepare all tasks
    tasks = []
    for i in range(0, len(faqs), batch_size):
        batch = faqs[i : i + batch_size]
        tasks.append(process_batch(batch))
        
    # Run concurrently (Groq API handles high concurrency well)
    logger.info(f"Refining {len(tasks)} batches concurrently...")
    results = await asyncio.gather(*tasks, return_exceptions=True)
    
    refined_faqs = []
    for res in results:
        if isinstance(res, Exception):
            logger.error(f"Batch gathering error: {res}")
        elif isinstance(res, list):
            refined_faqs.extend(res)
            
    return refined_faqs

async def validate_faq_with_web(question: str, answer: str):
    """
    Validates the FAQ against the official SVU website.
    Returns Dictionary: { status: "VERIFIED"|"PARTIALLY_VERIFIED"|"INVALID", score: float, source_url: str }
    """
    if not llm: return {"status": "VERIFIED", "score": 0.5, "source_url": ""} # Fail open
    
    try:
        search = DuckDuckGoSearchRun()
        query = f"site:svuniversity.edu.in {question}"
        search_results = search.run(query)
        
        validation_prompt = f"""
        PHASE 3: TRUTH VALIDATION (CRITICAL)
        
        You are the University Truth Officer.
        
        **Question**: {question}
        **Proposed Answer**: {answer}
        
        **Official Search Results**:
        {search_results}
        
        **Task**:
        Verify the Proposed Answer effectively against the Search Results.
        
        **Output Format**:
        VALID JSON ONLY:
        {{
            "status": "VERIFIED" | "PARTIALLY_VERIFIED" | "INVALID",
            "confidence": 0.0 to 1.0,
            "reason": "Brief explanation"
        }}
        
        **Rules**:
        - "VERIFIED": Validated by search results.
        - "PARTIALLY_VERIFIED": Plausible but details missing.
        - "INVALID": Contradicted or Not Found.
        """
        
        response = await llm.ainvoke(validation_prompt)
        content = response.content
        import json
        import re
        
        json_match = re.search(r'\{.*\}', content, re.DOTALL)
        if json_match:
            try:
                result = json.loads(json_match.group(0))
                return {
                    "status": result.get("status", "PARTIALLY_VERIFIED"),
                    "score": result.get("confidence", 0.5),
                    "source_url": "https://svuniversity.edu.in/" # Ideally extract from search results but DDG tool text often hides pure URLs 
                }
            except:
                pass
        
        return {"status": "PARTIALLY_VERIFIED", "score": 0.5, "source_url": ""}
        
    except Exception as e:
        logger.error(f"Validation Error: {e}")
        return {"status": "PARTIALLY_VERIFIED", "score": 0.1, "source_url": "error"}
