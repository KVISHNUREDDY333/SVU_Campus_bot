"""
FAQ-first matching and concise response generation for the main chatbot.
"""

import logging
import re
from difflib import SequenceMatcher
from typing import Any, Dict, List

from langchain_groq import ChatGroq

from ..core import database
from ..core.config import Config

logger = logging.getLogger("uvicorn")

STOPWORDS = {
    "a",
    "an",
    "and",
    "are",
    "at",
    "be",
    "by",
    "can",
    "for",
    "from",
    "how",
    "i",
    "in",
    "is",
    "it",
    "me",
    "my",
    "of",
    "on",
    "or",
    "please",
    "the",
    "to",
    "what",
    "when",
    "where",
    "which",
    "who",
    "with",
    "would",
    "you",
}

def _normalize_text(value: str) -> str:
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", (value or "").lower())).strip()

def _tokenize(value: str) -> List[str]:
    tokens = []
    for token in _normalize_text(value).split():
        if len(token) > 2 and token not in STOPWORDS:
            tokens.append(token)
    return tokens

def _parse_faq_text(text: str) -> Dict[str, str]:
    raw_text = (text or "").strip()
    question_match = re.search(r"Question:\s*(.+?)(?:\n|$)", raw_text, re.IGNORECASE)
    answer_match = re.search(r"Answer:\s*(.+)", raw_text, re.IGNORECASE | re.DOTALL)

    question = question_match.group(1).strip() if question_match else ""
    answer = answer_match.group(1).strip() if answer_match else ""

    if not question and raw_text:
        question = raw_text.splitlines()[0].strip()[:200]
    if not answer and raw_text:
        answer = raw_text

    return {"question": question, "answer": answer}

class FAQMatcher:
    """Matches user questions to the best FAQs in svu_vectors."""

    def _extract_keywords(self, query: str) -> List[str]:
        seen = set()
        keywords = []
        for token in _tokenize(query):
            if token not in seen:
                seen.add(token)
                keywords.append(token)
        return keywords[:8]

    def _normalize_faq_doc(self, faq: Dict[str, Any]) -> Dict[str, Any]:
        parsed = _parse_faq_text(faq.get("text", ""))
        question = (faq.get("question") or parsed["question"]).strip()
        answer = (faq.get("answer") or parsed["answer"]).strip()
        text = faq.get("text") or f"Question: {question}\nAnswer: {answer}"
        return {
            "_id": faq.get("_id"),
            "faq_id": str(faq.get("faq_id") or faq.get("_id") or ""),
            "question": question,
            "answer": answer,
            "category": faq.get("category", "General"),
            "text": text,
            "vector_score": float(faq.get("vector_score", 0.0) or 0.0),
            "keyword_hit": bool(faq.get("keyword_hit", False)),
        }

    def _faq_key(self, faq: Dict[str, Any]) -> str:
        return faq.get("faq_id") or _normalize_text(faq.get("question", ""))[:160]

    async def _search_by_keywords(
        self, keywords: List[str], limit: int
    ) -> List[Dict[str, Any]]:
        if database.svu_vectors_db is None or not keywords:
            return []

        try:
            regex = re.compile(
                "|".join(re.escape(word) for word in keywords), re.IGNORECASE
            )
            query = {
                "type": "faq",
                "$or": [
                    {"question": {"$regex": regex}},
                    {"answer": {"$regex": regex}},
                    {"text": {"$regex": regex}},
                    {"category": {"$regex": regex}},
                ],
            }
            import asyncio
            results = await asyncio.to_thread(
                lambda: list(
                    database.svu_vectors_db.find(query)
                    .sort("created_at", -1)
                    .limit(max(limit * 4, 10))
                )
            )
            normalized = []
            for item in results:
                item["keyword_hit"] = True
                normalized.append(self._normalize_faq_doc(item))
            return normalized
        except Exception as exc:
            logger.error(f"[FAQ_MATCHER] Keyword search error: {exc}")
            return []

    async def _search_by_similarity(
        self, query: str, limit: int
    ) -> List[Dict[str, Any]]:
        try:
            from . import rag_service

            if not rag_service.vector_db:
                rag_service.setup_rag_chain()
            if not rag_service.vector_db:
                return []

            docs = rag_service.vector_db.similarity_search_with_score(
                query,
                k=max(limit * 4, 10),
                filter={"type": "faq"},
            )

            normalized = []
            for doc, score in docs:
                if float(score or 0.0) < 0.35:
                    continue
                parsed = _parse_faq_text(getattr(doc, "page_content", ""))
                metadata = getattr(doc, "metadata", {}) or {}
                normalized.append(
                    {
                        "faq_id": str(
                            metadata.get("faq_id") or metadata.get("_id") or ""
                        ),
                        "question": (
                            metadata.get("question") or parsed["question"]
                        ).strip(),
                        "answer": (metadata.get("answer") or parsed["answer"]).strip(),
                        "category": metadata.get("category", "General"),
                        "text": getattr(doc, "page_content", ""),
                        "vector_score": float(score or 0.0),
                        "keyword_hit": False,
                    }
                )
            return normalized
        except Exception as exc:
            logger.warning(f"[FAQ_MATCHER] Semantic search error: {exc}")
            return []

    def _score_faq(self, user_query: str, faq: Dict[str, Any]) -> float:
        query_tokens = set(_tokenize(user_query))
        question_tokens = set(_tokenize(faq.get("question", "")))
        answer_tokens = set(_tokenize(faq.get("answer", "")))
        category_tokens = set(_tokenize(str(faq.get("category", ""))))

        if not query_tokens:
            return 0.0

        question_overlap = len(query_tokens & question_tokens) / len(query_tokens)
        answer_overlap = len(query_tokens & answer_tokens) / len(query_tokens)
        category_overlap = 1.0 if query_tokens & category_tokens else 0.0
        sequence_score = SequenceMatcher(
            None,
            _normalize_text(user_query),
            _normalize_text(faq.get("question", "")),
        ).ratio()

        phrase_bonus = (
            0.08
            if _normalize_text(user_query) in _normalize_text(faq.get("question", ""))
            else 0.0
        )
        score = (
            (0.40 * question_overlap)
            + (0.18 * answer_overlap)
            + (0.05 * category_overlap)
            + (0.17 * sequence_score)
            + (0.15 * min(max(float(faq.get("vector_score", 0.0) or 0.0), 0.0), 1.0))
            + phrase_bonus
        )
        if faq.get("keyword_hit"):
            score += 0.05
        return round(min(score, 0.99), 3)

    def _combine_and_rank(
        self,
        user_query: str,
        keyword_faqs: List[Dict[str, Any]],
        semantic_faqs: List[Dict[str, Any]],
        limit: int,
    ) -> List[Dict[str, Any]]:
        merged: Dict[str, Dict[str, Any]] = {}

        for faq in keyword_faqs + semantic_faqs:
            key = self._faq_key(faq)
            if key in merged:
                merged[key]["keyword_hit"] = merged[key]["keyword_hit"] or faq.get(
                    "keyword_hit", False
                )
                merged[key]["vector_score"] = max(
                    merged[key]["vector_score"], faq.get("vector_score", 0.0)
                )
                if len(faq.get("answer", "")) > len(merged[key].get("answer", "")):
                    merged[key]["question"] = faq.get("question", "")
                    merged[key]["answer"] = faq.get("answer", "")
                    merged[key]["text"] = faq.get("text", "")
                    merged[key]["category"] = faq.get("category", "General")
            else:
                merged[key] = faq

        ranked = list(merged.values())
        for faq in ranked:
            faq["match_confidence"] = self._score_faq(user_query, faq)

        ranked.sort(
            key=lambda item: (
                item.get("match_confidence", 0.0),
                item.get("vector_score", 0.0),
                len(item.get("answer", "")),
            ),
            reverse=True,
        )
        return ranked[:limit]

    async def find_relevant_faqs(
        self, user_query: str, limit: int = 5
    ) -> List[Dict[str, Any]]:
        if database.svu_vectors_db is None:
            logger.warning("[FAQ_MATCHER] Database not available")
            return []

        try:
            keywords = self._extract_keywords(user_query)
            keyword_faqs = await self._search_by_keywords(keywords, limit)
            semantic_faqs = await self._search_by_similarity(user_query, limit)
            ranked = self._combine_and_rank(
                user_query, keyword_faqs, semantic_faqs, limit
            )
            logger.info(f"[FAQ_MATCHER] Ranked {len(ranked)} FAQs for main chat")
            return ranked
        except Exception as exc:
            logger.error(f"[FAQ_MATCHER] Error finding relevant FAQs: {exc}")
            return []

class ResponseSizer:
    """Determines how much content to return based on the question."""

    def determine_response_size(self, query: str, faq_content: str) -> Dict[str, Any]:
        normalized_query = _normalize_text(query)
        tokens = _tokenize(query)
        faq_words = max(len((faq_content or "").split()), 40)

        explicit_small = any(
            text in normalized_query
            for text in ["brief", "short", "one line", "in short"]
        )
        explicit_large = any(
            text in normalized_query
            for text in ["detailed", "full details", "complete", "all details"]
        )
        process_query = any(
            text in normalized_query
            for text in ["how", "process", "procedure", "steps", "apply", "documents"]
        )
        list_query = any(
            text in normalized_query
            for text in ["list", "all", "available", "requirements", "facilities"]
        )
        comparison_query = any(
            text in normalized_query
            for text in [
                "fee",
                "fees",
                "structure",
                "compare",
                "comparison",
                "eligibility",
            ]
        )
        table_query = any(
            text in normalized_query
            for text in [
                "fee", "fees", "structure", "schedule", "dates", "eligibility",
                "cutoff", "cut off", "salary", "placement", "rank", "marks",
                "compare", "comparison", "difference", "vs", "versus",
            ]
        )

        short_fact_query = len(tokens) <= 7 and any(
            normalized_query.startswith(prefix)
            for prefix in ["what", "when", "where", "who", "which", "is", "are", "can"]
        )

        if explicit_small:
            size = "small"
        elif explicit_large or process_query or list_query or len(tokens) >= 12:
            size = "large"
        elif short_fact_query and not comparison_query:
            size = "small"
        else:
            size = "medium"

        word_limits = {
            "small": {"min": 18, "max": 55, "structure": "simple"},
            "medium": {"min": 60, "max": 150, "structure": "detailed"},
            "large": {"min": 160, "max": 280, "structure": "structured"},
        }
        selected = word_limits[size]
        estimated_words = faq_words if size != "small" else int(faq_words * 0.45)
        word_count = max(selected["min"], min(selected["max"], estimated_words))

        return {
            "size": size,
            "word_count": word_count,
            "structure": selected["structure"],
            "include_steps": process_query,
            "include_list": list_query or comparison_query,
            "prefer_table": table_query,
        }

class FAQResponseGenerator:
    """Generates concise, user-facing responses from FAQ content."""

    def __init__(self):
        self.generator_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID,
            groq_api_key=Config.GROQ_API_KEY,
            temperature=0.1,
            timeout=60,
        )

    async def generate_response(
        self,
        user_query: str,
        faq_content: str,
        response_config: Dict[str, Any],
        context: str = "",
        language_instruction: str = "Reply in English.",
    ) -> str:
        try:
            prompt = self._build_generation_prompt(
                user_query,
                faq_content,
                response_config,
                context,
                language_instruction,
            )

            response = await self.generator_llm.ainvoke(prompt)
            generated = (
                response.content if hasattr(response, "content") else str(response)
            )

            logger.info(f"[FAQ_GENERATOR] Generated response ({len(generated)} chars)")
            return generated.strip()

        except Exception as e:
            logger.error(f"[FAQ_GENERATOR] Error generating response: {e}")
            return faq_content

    def _build_generation_prompt(
        self,
        query: str,
        faq_content: str,
        config: Dict[str, Any],
        context: str,
        language_instruction: str,
    ) -> str:
        size = config.get("size", "medium")
        structure = config.get("structure", "detailed")
        word_count = config.get("word_count", 100)
        include_steps = config.get("include_steps", False)
        include_list = config.get("include_list", False)
        prefer_table = config.get("prefer_table", False)

        size_instructions = {
            "small": "Answer in 1-2 sentences only.",
            "medium": f"Answer in about {word_count} words with only the necessary details.",
            "large": f"Answer in about {word_count} words with clear structure and only relevant details.",
        }
        structure_instructions = {
            "simple": "Use a short plain answer.",
            "detailed": "Use a direct opening and short bullet points only if needed.",
            "structured": "Use short sections or bullets only when they help readability.",
        }

        return f"""You are the Official Academic Assistant for Sri Venkateswara University (SVU).
Your job is to deliver the BEST possible answer using the FAQ data retrieved from the university database.

Language Rule: {language_instruction}

User Question: {query}

Retrieved FAQ Data from Database:
{faq_content}

Additional Context:
{context or "None"}

RESPONSE FORMAT SELECTION (Choose the BEST format for this answer):
- **📊 TABLE**: Use a Markdown table when the data involves fees, dates, comparisons, eligibility criteria, schedules, or any structured numerical/categorical data.
- **📋 BULLET POINTS**: Use bullet points when listing facilities, requirements, documents needed, rules, or multiple distinct items.
- **🔢 NUMBERED STEPS**: Use numbered lists when explaining a process, procedure, or step-by-step instructions (e.g., admission process, application steps).
- **📝 PARAGRAPH**: Use a concise paragraph for simple factual questions, definitions, or single-point answers.
- **🔀 MIXED**: Combine formats when the answer has both factual overview AND structured data.

Response Size Guide:
- {size_instructions[size]}
- {structure_instructions[structure]}
{"- Include clear step-by-step instructions since the user is asking about a process." if include_steps else ""}
{"- Use structured list or table format since the user is asking for enumerable information." if include_list else ""}
{"- ⚠️ STRONGLY PREFER TABLE FORMAT: This query involves structured data (fees/dates/eligibility/comparisons). Use a Markdown table as the primary format." if prefer_table else ""}

QUALITY STANDARDS (MANDATORY):
1. **FACTUAL ACCURACY**: Use ONLY the FAQ data provided. Never hallucinate or invent information.
2. **PROFESSIONAL TONE**: Authoritative yet student-friendly. Represent SVU with dignity.
3. **BOLD KEY TERMS**: Use **bold** for important names, dates, amounts, and critical terms.
4. **COMPLETENESS**: Answer every aspect the user asked about using the available data.
5. **NO FILLER**: Do not add background explanations, generic advice, importance statements, or motivational text unless explicitly asked.
6. **DIRECT START**: Begin directly with the answer. No preamble like "Sure!" or "Great question!".

Return ONLY the final polished answer."""

class EnhancedFAQChatbot:
    """FAQ-first chatbot for the main chat experience."""

    def __init__(self):
        self.faq_matcher = FAQMatcher()
        self.response_sizer = ResponseSizer()
        self.response_generator = FAQResponseGenerator()
        self.refiner_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID,
            groq_api_key=Config.GROQ_API_KEY,
            temperature=0.1,
            timeout=60,
        )

    def _build_context(
        self, primary_faq: Dict[str, Any], related_faqs: List[Dict[str, Any]]
    ) -> str:
        blocks = [
            "Primary FAQ",
            f"Question: {primary_faq.get('question', '').strip()}",
            f"Answer: {primary_faq.get('answer', '').strip()}",
        ]
        if related_faqs:
            blocks.append("\nRelated FAQs")
            for index, faq in enumerate(related_faqs, start=1):
                blocks.append(f"{index}. Question: {faq.get('question', '').strip()}")
                blocks.append(f"   Answer: {faq.get('answer', '').strip()}")
        return "\n".join(blocks).strip()

    async def generate_faq_response_bundle(
        self,
        user_query: str,
        retrieval_query: str = "",
        session_id: str = "",
        context: str = "",
        language_instruction: str = "Reply in English.",
    ) -> Dict[str, Any]:
        del session_id

        try:
            lookup_query = retrieval_query or user_query
            relevant_faqs = await self.faq_matcher.find_relevant_faqs(
                lookup_query, limit=5
            )
            if not relevant_faqs:
                return {
                    "matched": False,
                    "confidence": 0.0,
                    "response": "",
                    "primary_faq": None,
                }

            primary_faq = relevant_faqs[0]
            confidence = float(primary_faq.get("match_confidence", 0.0) or 0.0)
            if confidence < 0.23:
                logger.info("[ENHANCED_CHATBOT] No strong FAQ match found")
                return {
                    "matched": False,
                    "confidence": confidence,
                    "response": "",
                    "primary_faq": primary_faq,
                }

            related_faqs = []
            for faq in relevant_faqs[1:]:
                faq_confidence = float(faq.get("match_confidence", 0.0) or 0.0)
                if faq_confidence >= max(0.18, confidence - 0.10):
                    related_faqs.append(faq)
                if len(related_faqs) >= 2:
                    break

            faq_context = self._build_context(primary_faq, related_faqs)
            response_config = self.response_sizer.determine_response_size(
                user_query, faq_context
            )
            raw_response = await self.response_generator.generate_response(
                user_query=user_query,
                faq_content=faq_context,
                response_config=response_config,
                context=context,
                language_instruction=language_instruction,
            )
            final_response = await self._final_refinement(
                response=raw_response,
                query=user_query,
                config=response_config,
                faq_context=faq_context,
                language_instruction=language_instruction,
            )
            return {
                "matched": True,
                "confidence": confidence,
                "response": final_response,
                "primary_faq": primary_faq,
            }
        except Exception as exc:
            logger.error(
                f"[ENHANCED_CHATBOT] Error generating FAQ-based response: {exc}"
            )
            return {
                "matched": False,
                "confidence": 0.0,
                "response": "",
                "primary_faq": None,
            }

    async def generate_faq_based_response(
        self,
        user_query: str,
        session_id: str = "",
        context: str = "",
        language_instruction: str = "Reply in English.",
    ) -> str:
        bundle = await self.generate_faq_response_bundle(
            user_query=user_query,
            retrieval_query="",
            session_id=session_id,
            context=context,
            language_instruction=language_instruction,
        )
        if bundle.get("matched"):
            return bundle.get("response", "")
        return "I don't have the exact answer in the FAQ database."

    async def _final_refinement(
        self,
        response: str,
        query: str,
        config: Dict[str, Any],
        faq_context: str,
        language_instruction: str,
    ) -> str:
        try:
            prompt = f"""Polish this university chatbot answer before delivery.

Language Rule: {language_instruction}

User Query:
{query}

FAQ Context (Source of Truth):
{faq_context}

Current Answer:
{response}

POLISHING RULES:
1. PRESERVE ALL FORMATTING: Keep tables, bullet points, numbered lists, and bold text exactly as they are. Do NOT convert tables to paragraphs or vice versa.
2. FACTUAL GROUNDING: Ensure every fact matches the FAQ Context. Remove anything not supported by the data.
3. SIZE TARGET: Keep the answer {config.get("size", "medium")} (~{config.get("word_count", 100)} words). Trim only filler and redundancy.
4. REMOVE FILLER: Cut phrases like "it is important to note", "please remember", "as mentioned earlier", generic warnings, and motivational text.
5. DIRECT START: The answer must begin directly with the information. No greeting or preamble.
6. PROFESSIONAL TONE: Maintain SVU's authoritative yet friendly tone.

Return ONLY the polished answer with all original formatting preserved."""

            response_obj = await self.refiner_llm.ainvoke(prompt)
            return (
                response_obj.content
                if hasattr(response_obj, "content")
                else str(response_obj)
            ).strip()
        except Exception as exc:
            logger.warning(f"[ENHANCED_CHATBOT] Final refinement error: {exc}")
            return response

_enhanced_chatbot_instance = None

def get_enhanced_faq_chatbot() -> EnhancedFAQChatbot:
    """Get or create the enhanced FAQ chatbot singleton."""
    global _enhanced_chatbot_instance
    if _enhanced_chatbot_instance is None:
        _enhanced_chatbot_instance = EnhancedFAQChatbot()
    return _enhanced_chatbot_instance
