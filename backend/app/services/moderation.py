import logging
import re

from ..services import rag_service

logger = logging.getLogger("uvicorn")

# List of common offensive/bad words (expanded for better coverage)
BAD_WORDS = [
    "damn",
    "hell",
    "stupid",
    "idiot",
    "nonsense",
    "useless",
    "garbage",
    "abuse",
    "hate",
    "kill",
    "die",
    "murder",
    "explicit",
    "porn",
    "sexy",
    "dirty",
    "shutup",
    "f@ck",
    "s*it",
    "b*tch",
    "violence",
    "harm",
    "illegal",
]

UNIVERSITY_TOPICS = [
    "university",
    "svu",
    "college",
    "degree",
    "exam",
    "admission",
    "fees",
    "campus",
    "hostel",
    "placement",
    "research",
    "faculty",
    "science",
    "education",
    "course",
    "syllabus",
    "result",
    "scholarship",
    "internship",
    "lecture",
    "note",
    "study",
    "academic",
    "career",
    "department",
    "professor",
    "library",
    "lab",
    "semester",
    "grade",
    "gpa",
    "mark",
    "attendance",
    "class",
    "timetable",
    "schedule",
    "bus",
    "transport",
    "cafeteria",
    "sports",
    "gym",
    "wifi",
    "login",
    "portal",
    "register",
    "enroll",
    "convocation",
    "certificate",
    "transcript",
    "dean",
    "vc",
    "hod",
    "btech",
    "mtech",
    "mba",
    "mca",
    "phd",
    "bsc",
    "msc",
    "ba",
    "ma",
    "tirupati",
    "sri venkateswara",
    "venkateswara",
    "hello",
    "hi",
    "hey",
    "help",
    "what",
    "how",
    "where",
    "when",
    "who",
    "tell",
    "explain",
    "programming",
    "coding",
    "python",
    "java",
    "math",
    "physics",
    "chemistry",
    "biology",
    "history",
    "geography",
    "economics",
    "politics",
    "gk",
    "current affairs",
]


class ModerationService:
    @staticmethod
    def is_profane(text: str) -> bool:
        """Simple keyword-based profanity check."""
        text_lower = text.lower()
        clean_text = re.sub(r"[^a-zA-Z\s]", "", text_lower)

        for word in BAD_WORDS:
            if word in clean_text or word in text_lower:
                logger.warning(f"Safety/Profanity Check Failed: {word}")
                return True
        return False

    @staticmethod
    async def is_on_topic(text: str) -> bool:
        """LLM-based check for topic relevance (Education, Academic Support, Knowledge)."""
        text_lower = text.lower()

        # Fast keyword check first
        if any(topic in text_lower for topic in UNIVERSITY_TOPICS):
            return True

        if not rag_service.fast_llm:
            rag_service.setup_rag_chain()

        prompt = f"""
        Classification Task: Is the following user query SAFE and RELATED to Education, Academics, or General Knowledge?
        
        SAFE_EDU CATEGORIES:
        - Education (subjects, coding, syllabus)
        - Academic Support (assignments, career guidance)
        - Research & General Knowledge (current affairs, science, history)
        - University Information (admissions, campus, exams)
        - Polite greetings (hi, hello)
        
        REJECT CATEGORIES (UNSAFE/OUT_OF_SCOPE):
        - Hate, abuse, explicit, or dark content.
        - Irrelevant casual chat (politics opinions, gossip, shopping).
        - Instructions for illegal or harmful activities.

        QUERY: "{text}"
        
        Output EXACTLY "YES" or "NO".
        """
        try:
            response = await rag_service.fast_llm.ainvoke(prompt)
            result = response.content.strip().upper()
            return "YES" in result
        except Exception as e:
            logger.error(f"Moderation LLM Error: {e}")
            return True  # Fail open on system error

    @classmethod
    async def check_content(cls, text: str) -> bool:
        """
        Comprehensive check. Returns True if SAFE_EDU, False otherwise.
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
        return "I'm here to support academic and knowledge-related queries only. Please ask something related to studies, exams, or general knowledge."
