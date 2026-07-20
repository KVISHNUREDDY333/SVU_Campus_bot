import logging
import re

from ..services import rag_service

logger = logging.getLogger("uvicorn")

# ── Truly bad, unsafe, and impolite words ──
# These are words that are ALWAYS inappropriate regardless of context.
# We match WHOLE WORDS ONLY to avoid false positives
# (e.g., "class" won't match "ass", "hello" won't match "hell").
PROFANITY_WORDS = [
    # Profanity / slurs
    "fuck", "f*ck", "f@ck", "fck", "fucker", "fucking", "fuk",
    "shit", "s*it", "sh1t", "bullshit",
    "bitch", "b*tch", "b1tch",
    "asshole", "a**hole", "arsehole",
    "bastard", "cunt", "dick", "piss",
    "motherfucker", "mf", "stfu", "gtfo", "lmfao",
    "whore", "slut", "hoe",
    # Explicit / sexual
    "porn", "pornography", "xxx", "nude", "nudes",
    "boobs", "boob", "vagina", "penis",
    # Extreme violence / threats
    "murder", "rape", "molest", "terrorist", "terrorism",
    "suicide", "bomb", "gun", "massacre", "knife",
    # Hate speech
    "nigger", "nigga", "faggot", "fag", "retard", "retarded",
    "chink", "spic", "kike",
]

# Words that are impolite / abusive when directed at someone
IMPOLITE_DIRECTED_PHRASES = [
    "shut up", "shutup", "shut the hell up",
    "go to hell", "go die", "drop dead",
    "you suck", "you are useless", "you are stupid",
    "you are an idiot", "you idiot", "you fool",
    "you moron", "you dumb", "piece of shit",
    "waste of time", "screw you", "damn you",
    "get lost", "piss off", "buzz off",
]


class ModerationService:
    @staticmethod
    def is_profane(text: str) -> bool:
        """
        Whole-word profanity check that reads the full sentence.
        Does NOT split words — checks each bad word as an independent whole word
        in the sentence using word boundary regex.
        """
        text_lower = text.lower().strip()

        # ── Step 1: Check for impolite directed phrases (multi-word) ──
        for phrase in IMPOLITE_DIRECTED_PHRASES:
            if phrase in text_lower:
                logger.warning(f"Moderation: Impolite phrase detected: '{phrase}'")
                return True

        # ── Step 2: Whole-word profanity check ──
        # Remove special chars for leet-speak detection but keep spaces
        clean_text = re.sub(r"[^a-zA-Z0-9\s]", "", text_lower)

        for word in PROFANITY_WORDS:
            clean_word = re.sub(r"[^a-zA-Z0-9]", "", word.lower())
            # Use word boundary \b to match WHOLE WORDS ONLY
            # This prevents "class" matching "ass", "hello" matching "hell", etc.
            pattern = r"\b" + re.escape(clean_word) + r"\b"
            if re.search(pattern, clean_text):
                logger.warning(f"Moderation: Profanity detected: '{word}'")
                return True
            # Also check the original text (with special chars) for obfuscated forms
            if re.search(r"\b" + re.escape(word) + r"\b", text_lower):
                logger.warning(f"Moderation: Profanity detected (original): '{word}'")
                return True

        return False

    @staticmethod
    async def is_safe_intent(text: str) -> bool:
        """
        LLM-based check ONLY for safety — not topic restriction.
        Allows any normal question. Only blocks genuinely abusive,
        unsafe, or sexually explicit messages.
        """
        if not rag_service.fast_llm:
            rag_service.setup_rag_chain()

        prompt = f"""You are a content safety classifier for a university chatbot.

READ THE FULL MESSAGE CAREFULLY. Do NOT split or misinterpret words.
For example: "class" is NOT a bad word, "hello" is NOT bad, "assignment" is fine,
"die casting" is fine, "harmful chemicals in chemistry" is a valid academic topic.

BLOCK ONLY if the message contains:
- Profanity, slurs, or vulgar language
- Sexual or explicit content
- Threats of violence or self-harm
- Hate speech targeting any group
- Requests for illegal activities (drugs, weapons, hacking)
- Extreme rudeness or personal attacks directed at someone

ALLOW everything else including:
- Any academic question (even about sensitive topics like war history, biology, etc.)
- General knowledge questions
- Casual greetings, small talk, jokes
- Career advice, coding help, life advice
- Questions about any subject or topic
- Questions containing words that LOOK similar to bad words but aren't (e.g., "class", "hello", "assess", "therapist", "cocktail", "manipulate")

MESSAGE: "{text}"

Reply with EXACTLY one word: "SAFE" or "UNSAFE".
"""
        try:
            response = await rag_service.fast_llm.ainvoke(prompt)
            result = response.content.strip().upper()
            is_safe = "SAFE" in result and "UNSAFE" not in result
            if not is_safe:
                logger.warning(f"Moderation LLM flagged message as unsafe: '{text[:80]}...'")
            return is_safe
        except Exception as e:
            logger.error(f"Moderation LLM Error: {e}")
            return True  # Fail-open: allow if LLM is unavailable

    @classmethod
    async def check_content(cls, text: str) -> bool:
        """
        Comprehensive check. Returns True if SAFE, False otherwise.
        Only blocks bad, unsafe, and impolite content.
        Does NOT restrict by topic.
        """
        if not text or not text.strip():
            return True

        # Step 1: Fast keyword check for obvious profanity (whole-word matching)
        if cls.is_profane(text):
            return False

        # Step 2: LLM-based safety check for subtle abuse/unsafe content
        if not await cls.is_safe_intent(text):
            return False

        return True

    @staticmethod
    def get_rejection_message() -> str:
        return (
            "I'm sorry, but I can't respond to messages that contain inappropriate "
            "or offensive language. Please rephrase your question respectfully, "
            "and I'll be happy to help! 😊"
        )
