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
    "dirty", "shutup", "f@ck", "s*it", "b*tch"
]

UNIVERSITY_TOPICS = [
    "university", "svu", "college", "degree", "exam", "admission", "fees", 
    "campus", "hostel", "placement", "research", "faculty", "science", 
    "education", "course", "syllabus", "result", "scholarship", "internship",
    "lecture", "note", "study", "academic", "career", "department", "professor",
    "library", "lab", "semester", "grade", "gpa", "mark", "attendance",
    "class", "timetable", "schedule", "bus", "transport", "cafeteria",
    "sports", "gym", "wifi", "login", "portal", "register", "enroll",
    "convocation", "certificate", "transcript", "dean", "vc", "hod",
    "btech", "mtech", "mba", "mca", "phd", "bsc", "msc", "ba", "ma",
    "tirupati", "sri venkateswara", "venkateswara", "hello", "hi", "hey",
    "help", "what", "how", "where", "when", "who", "tell", "explain"
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
        """LLM-based check for topic relevance (Education, Knowledge, University)."""
        # Fast keyword check first to skip LLM if obvious academic intent
        text_lower = text.lower()
        if any(topic in text_lower for topic in UNIVERSITY_TOPICS):
            return True

        if not rag_service.fast_llm:
            rag_service.setup_rag_chain()
        
        prompt = f"""
        University Academic Assistant - Safety & Relevance Filter
        
        TASK: Classify the following user query based on the University's STRICT RESPONSE POLICY.
        
        ALLOWED TOPICS:
        - Education (subjects, concepts, syllabus, notes)
        - Academic support (assignments, projects, coding help)
        - Research and innovation
        - General Knowledge (GK) & Current Affairs
        - Competitive exams (UPSC, GATE, GRE, CAT, etc.)
        - Career guidance and skill development
        - University-related information (SVU settings, campus, etc.)
        - Polite greetings (Hi, Hello, Help)
        
        RESTRICTED / OUT-OF-SCOPE:
        - Hate speech, abusive language, offensive content
        - Adult, explicit, or inappropriate topics
        - Violence, self-harm, illegal activities
        - Personal attacks or harmful ideologies
        - Irrelevant casual chat (recipes, shopping, gossip, entertainment non-GK)
        
        USER QUERY: "{text}"
        
        CLASSIFICATION:
        If SAFE + EDUCATIONAL/ACADEMIC -> Output EXACTLY "YES"
        If UNSAFE or OUT OF SCOPE -> Output EXACTLY "NO"
        """
        try:
            response = await rag_service.fast_llm.ainvoke(prompt)
            result = response.content.strip().upper()
            logger.info(f"Policy Classification for '{text[:20]}...': {result}")
            return "YES" in result
        except Exception as e:
            logger.error(f"Moderation LLM Error: {e}")
            return True # Fail open on system error
            
    @classmethod
    async def check_content(cls, text: str) -> bool:
        """
        Comprehensive check against the strict educational policy.
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
        return "I'm here to assist with academic, educational, and knowledge-based queries only. Please ask a relevant question."
