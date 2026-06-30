import logging

from langchain_groq import ChatGroq

from ..core.config import Config

logger = logging.getLogger("uvicorn")

class ResponseRefiner:
    """Refines raw RAG responses into high-quality, well-structured answers."""

    def __init__(self):
        self.refiner_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID,
            groq_api_key=Config.GROQ_API_KEY,
            temperature=0.3,
            timeout=60,
        )

    async def refine_response(
        self, raw_response: str, original_query: str, context: str = ""
    ) -> str:
        """
        Refines a raw response into a polished, well-structured answer.

        Args:
            raw_response: The initial response from RAG
            original_query: The user's original question
            context: Optional context about the query

        Returns:
            Refined, high-quality response
        """
        if not raw_response or len(raw_response.strip()) < 10:
            return raw_response

        refine_prompt = f"""You are an academic response editor for Sri Venkateswara University's official chatbot.

**Original User Query**: {original_query}

**Raw Response to Refine**:
{raw_response}

**Refinement Guidelines**:
1. **Grammar & Clarity**: Fix grammatical errors, awkward phrasing, or unclear sentences.
2. **PRESERVE FORMATTING**: Keep all tables, bullet points, numbered lists, bold text, and headings intact. Do NOT flatten tables into paragraphs.
3. **Size Preservation**: Maintain the original answer length. Do not expand a short answer or compress a detailed one.
4. **Tone**: Professional, factual, and student-friendly.
5. **Remove Filler**: Cut generic advice, motivational text, and phrases like "it is important", "please note", "it is recommended" unless directly relevant.
6. **Direct Start**: The response must begin with the answer, not with "Sure!", "Great question!", or similar preamble.
7. **Bold Key Terms**: Ensure important names, dates, fees, and deadlines are in **bold**.

**Output Requirements**:
- Return ONLY the refined response
- Maintain all factual information from the original
- Do not add new facts or unsupported claims
- Preserve all Markdown formatting (tables, lists, bold, headings)

Refined Response:"""

        try:
            response = await self.refiner_llm.ainvoke(refine_prompt)
            refined = (
                response.content if hasattr(response, "content") else str(response)
            )

            logger.info(
                f"[REFINER] Refined response ({len(raw_response)} → {len(refined)} chars)"
            )
            return refined.strip()
        except Exception as e:
            logger.error(f"[REFINER] Error refining response: {e}")
            return raw_response

    async def enhance_with_reasoning(self, response: str, query: str) -> str:
        """
        Adds clear reasoning and logical flow to responses.

        Args:
            response: The response to enhance
            query: The original query

        Returns:
            Response with improved reasoning and structure
        """
        if not response or len(response.strip()) < 10:
            return response

        reasoning_prompt = f"""You are an expert at explaining complex academic concepts with clear reasoning.

**User Question**: {query}

**Current Response**:
{response}

**Task**: Enhance this response by:
1. Adding clear logical reasoning and explanations
2. Explaining the "why" behind key points, not just the "what"
3. Using transitional phrases for better flow (e.g., "This is important because...", "As a result...", "Furthermore...")
4. Breaking down complex information into digestible parts
5. Adding relevant context where helpful
6. Maintaining professional academic tone

**Output**: Return ONLY the enhanced response with improved reasoning and flow. Do not add meta-commentary."""

        try:
            response_obj = await self.refiner_llm.ainvoke(reasoning_prompt)
            enhanced = (
                response_obj.content
                if hasattr(response_obj, "content")
                else str(response_obj)
            )

            logger.info(f"[REASONING] Enhanced response with better reasoning")
            return enhanced.strip()
        except Exception as e:
            logger.error(f"[REASONING] Error enhancing reasoning: {e}")
            return response

    async def validate_accuracy(self, response: str, context: str) -> dict:
        """
        Validates response accuracy against provided context.

        Returns:
            {
                "is_accurate": bool,
                "confidence": float (0-1),
                "issues": [list of issues if any],
                "suggestions": [list of improvements if any]
            }
        """
        if not response or not context:
            return {
                "is_accurate": True,
                "confidence": 0.5,
                "issues": [],
                "suggestions": [],
            }

        validation_prompt = f"""You are a fact-checker for university information.

**Context (Source of Truth)**:
{context[:2000]}

**Response to Validate**:
{response}

**Task**: Check if the response is accurate based on the context provided.

Return ONLY valid JSON:
{ 
    "is_accurate": true/false,
    "confidence": 0.0-1.0,
    "issues": ["issue1", "issue2"],
    "suggestions": ["suggestion1", "suggestion2"]
} """

        try:
            import json
            import re

            response_obj = await self.refiner_llm.ainvoke(validation_prompt)
            content = (
                response_obj.content
                if hasattr(response_obj, "content")
                else str(response_obj)
            )

            json_match = re.search(r"\{.*\}", content, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group(0))
                return result
        except Exception as e:
            logger.error(f"[VALIDATOR] Error validating response: {e}")

        return {"is_accurate": True, "confidence": 0.5, "issues": [], "suggestions": []}

    async def format_for_display(self, response: str) -> str:
        """
        Ensures response is properly formatted for web display.
        Handles Markdown, line breaks, and special formatting.
        """
        if not response:
            return response

        response = response.replace("##", "\n##").replace("###", "\n###")

        response = (
            response.replace("\n•", "\n• ")
            .replace("\n-", "\n- ")
            .replace("\n*", "\n* ")
        )

        while "\n\n\n" in response:
            response = response.replace("\n\n\n", "\n\n")

        return response.strip()

_refiner_instance = None

def get_response_refiner() -> ResponseRefiner:
    """Get or create the response refiner singleton."""
    global _refiner_instance
    if _refiner_instance is None:
        _refiner_instance = ResponseRefiner()
    return _refiner_instance
