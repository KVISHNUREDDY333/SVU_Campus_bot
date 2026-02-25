import logging
import re
from typing import Tuple
from ..services import rag_service

logger = logging.getLogger("uvicorn")

# List of common offensive/bad words (expanded for better coverage)
# Note: In a real production app, this would be much larger or use a dedicated library.
BAD_WORDS = [
    "damn", "hell", "stupid", "idiot", "nonsense", "useless", "garbage", 
    "abuse", "hate", "kill", "die", "murder", "explicit", "porn", "sexy",
    "dirty", "shutup", "f@ck", "s*it", "b*tch" # Standard censorship patterns
]

UNIVERSITY_TOPICS = [
    "university", "svu", "college", "degree", "exam", "admission", "fees", 
    "campus", "hostel", "placement", "research", "faculty", "science", 
    "education", "course", "syllabus", "result", "scholarship", "internship",
    "lecture", "note", "study", "academic", "career", "department", "professor"
]

class ModerationService:
    @staticmethod
    def is_profane(text: str) -> bool:
        """Simple keyword-based profanity check."""
        text_lower = text.lower()
        # Remove special characters to catch variations like "f.u.c.k"
        clean_text = re.sub(r'[^a-zA-Z\s]', '', text_lower)
        
        for word in BAD_WORDS:
            if word in clean_text or word in text_lower:
                logger.warning(f"Profanity detected: {word}")
                return True
        return False

    @staticmethod
    async def is_on_topic(text: str) -> bool:
        """LLM-based check for topic relevance (University, Education, Science)."""
        # Fast keyword check first to skip LLM if obvious
        text_lower = text.lower()
        if any(topic in text_lower for topic in UNIVERSITY_TOPICS):
            return True

        if not rag_service.fast_llm:
            rag_service.setup_rag_chain()
        
        prompt = f"""
        Classification Task: Is the following user query relevant to a University, Education, or Science context?
        
        RULES:
        - University context: Campus life, exams, SVU departments, admissions, hostels, results, etc.
        - Education context: Learning, courses, study tips, academic concepts.
        - Science context: Physics, chemistry, technology, research, mathematics, etc.
        - Irrelevant context: Cooking, sports (unless university sports), entertainment, politics, general chat, shopping, etc.

        QUERY: "{text}"
        
        Output EXACTLY "YES" or "NO".
        """
        try:
            response = await rag_service.fast_llm.ainvoke(prompt)
            result = response.content.strip().upper()
            logger.info(f"Topic Relevance Check for '{text[:20]}...': {result}")
            return "YES" in result
        except Exception as e:
            logger.error(f"Moderation LLM Error: {e}")
            return True # Fail open on system error to avoid blocking valid queries

    @classmethod
    async def check_content(cls, text: str) -> bool:
        """
        Comprehensive check. Returns True if OK, False if restricted.
        """
        if not text:
            return True
            
        if cls.is_profane(text):
            return False
            
        if not await cls.is_on_topic(text):
            return False
            
        return True

    @staticmethod
    def get_rejection_message() -> str:
        return "I am not supposed to answer your query."
