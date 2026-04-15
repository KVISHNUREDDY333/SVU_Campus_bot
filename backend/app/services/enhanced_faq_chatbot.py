"""
Enhanced FAQ Matching & Response Generation System
Intelligently matches user questions to database FAQs and generates appropriately-sized responses
"""

import logging
import json
import re
from typing import List, Dict, Tuple, Optional
from datetime import datetime
from langchain_groq import ChatGroq
from langchain_core.output_parsers import StrOutputParser
from ..core.config import Config
from ..core import database

logger = logging.getLogger("uvicorn")


class FAQMatcher:
    """Matches user questions to relevant FAQs in the database."""
    
    def __init__(self):
        self.matcher_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID,
            groq_api_key=Config.GROQ_API_KEY,
            temperature=0.1,
            timeout=60
        )
    
    async def find_relevant_faqs(self, user_query: str, limit: int = 5) -> List[Dict]:
        """
        Find relevant FAQs from database that match user query.
        
        Args:
            user_query: User's question
            limit: Maximum number of FAQs to return
            
        Returns:
            List of relevant FAQ documents
        """
        if database.svu_vectors_db is None:
            logger.warning("[FAQ_MATCHER] Database not available")
            return []
        
        try:
            # 1. Extract keywords from query
            keywords = await self._extract_keywords(user_query)
            logger.info(f"[FAQ_MATCHER] Extracted keywords: {keywords}")
            
            # 2. Search by keywords
            keyword_faqs = self._search_by_keywords(user_query, keywords, limit)
            logger.info(f"[FAQ_MATCHER] Found {len(keyword_faqs)} FAQs by keyword search")
            
            # 3. Search by semantic similarity
            semantic_faqs = await self._search_by_similarity(user_query, limit)
            logger.info(f"[FAQ_MATCHER] Found {len(semantic_faqs)} FAQs by semantic search")
            
            # 4. Combine and rank results
            combined_faqs = self._combine_and_rank(keyword_faqs, semantic_faqs, limit)
            logger.info(f"[FAQ_MATCHER] Combined and ranked {len(combined_faqs)} FAQs")
            
            return combined_faqs
            
        except Exception as e:
            logger.error(f"[FAQ_MATCHER] Error finding relevant FAQs: {e}")
            return []
    
    async def _extract_keywords(self, query: str) -> List[str]:
        """Extract important keywords from user query."""
        try:
            extraction_prompt = f"""Extract 3-5 most important keywords from this question that would help find relevant FAQs.
            
Question: {query}

Return ONLY a JSON array of keywords, nothing else:
["keyword1", "keyword2", "keyword3"]"""
            
            response = await self.matcher_llm.ainvoke(extraction_prompt)
            content = response.content if hasattr(response, 'content') else str(response)
            
            # Parse JSON array
            json_match = re.search(r'\[.*\]', content, re.DOTALL)
            if json_match:
                keywords = json.loads(json_match.group(0))
                return keywords
        except Exception as e:
            logger.warning(f"[FAQ_MATCHER] Error extracting keywords: {e}")
        
        # Fallback: extract words > 3 characters
        return [w for w in query.split() if len(w) > 3]
    
    def _search_by_keywords(self, query: str, keywords: List[str], limit: int) -> List[Dict]:
        """Search FAQs by keyword matching."""
        try:
            # Build regex pattern
            regex_pattern = "|".join(re.escape(kw) for kw in keywords)
            regex_obj = re.compile(regex_pattern, re.IGNORECASE)
            
            # Search in FAQ text and keywords
            search_query = {
                "type": "faq",
                "$or": [
                    {"text": {"$regex": regex_obj}},
                    {"keywords": {"$in": [regex_obj]}},
                    {"category": {"$regex": regex_obj}}
                ]
            }
            
            faqs = list(database.svu_vectors_db.find(search_query).limit(limit))
            logger.info(f"[FAQ_MATCHER] Keyword search found {len(faqs)} FAQs")
            return faqs
            
        except Exception as e:
            logger.error(f"[FAQ_MATCHER] Error in keyword search: {e}")
            return []
    
    async def _search_by_similarity(self, query: str, limit: int) -> List[Dict]:
        """Search FAQs by semantic similarity."""
        try:
            from ..services.rag_service import embeddings
            
            if embeddings is None:
                logger.warning("[FAQ_MATCHER] Embeddings not available")
                return []
            
            # Generate query embedding
            query_embedding = embeddings.embed_query(query)
            
            # Search using vector similarity
            faqs = list(database.svu_vectors_db.aggregate([
                {
                    "$search": {
                        "cosmosSearch": {
                            "vector": query_embedding,
                            "k": limit
                        },
                        "returnScore": True
                    }
                },
                {
                    "$match": {"type": "faq"}
                },
                {
                    "$limit": limit
                }
            ]))
            
            logger.info(f"[FAQ_MATCHER] Semantic search found {len(faqs)} FAQs")
            return faqs
            
        except Exception as e:
            logger.warning(f"[FAQ_MATCHER] Error in semantic search: {e}")
            return []
    
    def _combine_and_rank(self, keyword_faqs: List[Dict], semantic_faqs: List[Dict], limit: int) -> List[Dict]:
        """Combine and rank FAQs from different search methods."""
        try:
            # Create ranking dictionary
            faq_scores = {}
            
            # Score keyword matches (higher weight)
            for idx, faq in enumerate(keyword_faqs):
                faq_id = str(faq.get('_id', ''))
                score = (len(keyword_faqs) - idx) * 2  # Higher score for earlier results
                faq_scores[faq_id] = {
                    'score': score,
                    'faq': faq
                }
            
            # Score semantic matches
            for idx, faq in enumerate(semantic_faqs):
                faq_id = str(faq.get('_id', ''))
                score = (len(semantic_faqs) - idx)
                
                if faq_id in faq_scores:
                    faq_scores[faq_id]['score'] += score
                else:
                    faq_scores[faq_id] = {
                        'score': score,
                        'faq': faq
                    }
            
            # Sort by score and return top results
            ranked = sorted(faq_scores.values(), key=lambda x: x['score'], reverse=True)
            result = [item['faq'] for item in ranked[:limit]]
            
            logger.info(f"[FAQ_MATCHER] Ranked {len(result)} FAQs")
            return result
            
        except Exception as e:
            logger.error(f"[FAQ_MATCHER] Error ranking FAQs: {e}")
            return keyword_faqs[:limit]


class ResponseSizer:
    """Determines appropriate response size based on query complexity."""
    
    def __init__(self):
        self.sizer_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID,
            groq_api_key=Config.GROQ_API_KEY,
            temperature=0.2,
            timeout=60
        )
    
    async def determine_response_size(self, query: str, faq_content: str) -> Dict:
        """
        Determine appropriate response size and structure.
        
        Returns:
            {
                'size': 'small' | 'medium' | 'large',
                'word_count': int,
                'structure': 'simple' | 'detailed' | 'comprehensive',
                'include_examples': bool,
                'include_steps': bool,
                'include_tables': bool
            }
        """
        try:
            sizing_prompt = f"""Analyze this question and FAQ content to determine appropriate response size.

Question: {query}

FAQ Content: {faq_content[:500]}

Determine:
1. Response size: 'small' (1-2 sentences), 'medium' (3-5 sentences), or 'large' (detailed with sections)
2. Word count target: small=50-100, medium=150-300, large=400-800
3. Structure: 'simple' (plain text), 'detailed' (with bullets), 'comprehensive' (with sections, tables, examples)
4. Include examples: true/false
5. Include step-by-step: true/false
6. Include comparison table: true/false

Return ONLY valid JSON:
{{
    "size": "small|medium|large",
    "word_count": number,
    "structure": "simple|detailed|comprehensive",
    "include_examples": true/false,
    "include_steps": true/false,
    "include_tables": true/false
}}"""
            
            response = await self.sizer_llm.ainvoke(sizing_prompt)
            content = response.content if hasattr(response, 'content') else str(response)
            
            json_match = re.search(r'\{.*\}', content, re.DOTALL)
            if json_match:
                result = json.loads(json_match.group(0))
                logger.info(f"[RESPONSE_SIZER] Determined size: {result['size']}")
                return result
                
        except Exception as e:
            logger.warning(f"[RESPONSE_SIZER] Error determining size: {e}")
        
        # Default: medium response
        return {
            'size': 'medium',
            'word_count': 200,
            'structure': 'detailed',
            'include_examples': True,
            'include_steps': False,
            'include_tables': False
        }


class FAQResponseGenerator:
    """Generates refined responses from FAQ content."""
    
    def __init__(self):
        self.generator_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID,
            groq_api_key=Config.GROQ_API_KEY,
            temperature=0.3,
            timeout=60
        )
    
    async def generate_response(
        self,
        user_query: str,
        faq_content: str,
        response_config: Dict,
        context: str = ""
    ) -> str:
        """
        Generate refined response from FAQ content.
        
        Args:
            user_query: User's original question
            faq_content: FAQ content from database
            response_config: Configuration for response size/structure
            context: Additional context
            
        Returns:
            Refined, well-structured response
        """
        try:
            # Build generation prompt based on response config
            prompt = self._build_generation_prompt(
                user_query,
                faq_content,
                response_config,
                context
            )
            
            response = await self.generator_llm.ainvoke(prompt)
            generated = response.content if hasattr(response, 'content') else str(response)
            
            logger.info(f"[FAQ_GENERATOR] Generated response ({len(generated)} chars)")
            return generated.strip()
            
        except Exception as e:
            logger.error(f"[FAQ_GENERATOR] Error generating response: {e}")
            return faq_content
    
    def _build_generation_prompt(
        self,
        query: str,
        faq_content: str,
        config: Dict,
        context: str
    ) -> str:
        """Build generation prompt based on response configuration."""
        
        size = config.get('size', 'medium')
        structure = config.get('structure', 'detailed')
        word_count = config.get('word_count', 200)
        include_examples = config.get('include_examples', True)
        include_steps = config.get('include_steps', False)
        include_tables = config.get('include_tables', False)
        
        # Size-specific instructions
        size_instructions = {
            'small': 'Keep response to 1-2 sentences. Be concise and direct.',
            'medium': f'Provide a balanced response of approximately {word_count} words. Include key information.',
            'large': f'Provide a comprehensive response of approximately {word_count} words. Include detailed information, examples, and context.'
        }
        
        # Structure-specific instructions
        structure_instructions = {
            'simple': 'Use plain text format. No special formatting.',
            'detailed': 'Use bullet points and bold text for key terms. Organize information logically.',
            'comprehensive': 'Use sections with headers, bullet points, tables, and examples. Organize hierarchically.'
        }
        
        # Build prompt
        prompt = f"""You are an expert at refining FAQ content into high-quality responses.

User Question: {query}

FAQ Content (Source):
{faq_content}

{f'Additional Context: {context}' if context else ''}

Response Requirements:
1. Size: {size_instructions[size]}
2. Structure: {structure_instructions[structure]}
3. Word Count Target: {word_count} words
4. Include Examples: {'Yes - provide relevant examples' if include_examples else 'No - focus on core information'}
5. Include Step-by-Step: {'Yes - provide numbered steps if applicable' if include_steps else 'No'}
6. Include Tables: {'Yes - use tables for comparison/data' if include_tables else 'No'}

Quality Standards:
- Accuracy: Ensure all information is accurate and grounded in the FAQ
- Clarity: Use clear, professional language
- Organization: Structure information logically
- Completeness: Address all aspects of the question
- Formatting: Use Markdown properly (**bold**, • bullets, 1. numbered lists)

Generate the refined response now:"""
        
        return prompt


class EnhancedFAQChatbot:
    """Enhanced chatbot that uses FAQ database for intelligent responses."""
    
    def __init__(self):
        self.faq_matcher = FAQMatcher()
        self.response_sizer = ResponseSizer()
        self.response_generator = FAQResponseGenerator()
        self.refiner_llm = ChatGroq(
            model=Config.GROQ_MODEL_ID,
            groq_api_key=Config.GROQ_API_KEY,
            temperature=0.3,
            timeout=60
        )
    
    async def generate_faq_based_response(
        self,
        user_query: str,
        session_id: str = "",
        context: str = ""
    ) -> str:
        """
        Generate response using FAQ database.
        
        Args:
            user_query: User's question
            session_id: Session ID for context
            context: Additional context
            
        Returns:
            Refined response based on FAQ
        """
        try:
            logger.info(f"[ENHANCED_CHATBOT] Processing query: {user_query[:80]}")
            
            # Step 1: Find relevant FAQs
            relevant_faqs = await self.faq_matcher.find_relevant_faqs(user_query, limit=3)
            
            if not relevant_faqs:
                logger.warning("[ENHANCED_CHATBOT] No relevant FAQs found")
                return "I don't have specific information about this topic. Please contact the university office for more details."
            
            # Step 2: Select best FAQ
            best_faq = relevant_faqs[0]
            faq_content = best_faq.get('text', '')
            logger.info(f"[ENHANCED_CHATBOT] Selected FAQ: {faq_content[:100]}")
            
            # Step 3: Determine response size
            response_config = await self.response_sizer.determine_response_size(
                user_query,
                faq_content
            )
            logger.info(f"[ENHANCED_CHATBOT] Response config: {response_config['size']}")
            
            # Step 4: Generate refined response
            refined_response = await self.response_generator.generate_response(
                user_query,
                faq_content,
                response_config,
                context
            )
            
            # Step 5: Final refinement for quality
            final_response = await self._final_refinement(
                refined_response,
                user_query,
                response_config
            )
            
            logger.info(f"[ENHANCED_CHATBOT] Generated response ({len(final_response)} chars)")
            return final_response
            
        except Exception as e:
            logger.error(f"[ENHANCED_CHATBOT] Error generating FAQ-based response: {e}")
            return "I encountered an error processing your question. Please try again."
    
    async def _final_refinement(
        self,
        response: str,
        query: str,
        config: Dict
    ) -> str:
        """Apply final refinement to response."""
        try:
            refinement_prompt = f"""Apply final quality refinement to this response.

Original Query: {query}

Current Response:
{response}

Response Size: {config['size']}
Target Word Count: {config['word_count']}

Final Refinement Checklist:
1. Verify response matches the required size ({config['size']})
2. Ensure proper Markdown formatting
3. Check for clarity and professionalism
4. Verify all information is accurate
5. Ensure logical organization
6. Add proper spacing and line breaks

Return ONLY the refined response, no explanations."""
            
            response_obj = await self.refiner_llm.ainvoke(refinement_prompt)
            refined = response_obj.content if hasattr(response_obj, 'content') else str(response_obj)
            
            return refined.strip()
            
        except Exception as e:
            logger.warning(f"[ENHANCED_CHATBOT] Error in final refinement: {e}")
            return response


# Singleton instance
_enhanced_chatbot_instance = None

def get_enhanced_faq_chatbot() -> EnhancedFAQChatbot:
    """Get or create the enhanced FAQ chatbot singleton."""
    global _enhanced_chatbot_instance
    if _enhanced_chatbot_instance is None:
        _enhanced_chatbot_instance = EnhancedFAQChatbot()
    return _enhanced_chatbot_instance
