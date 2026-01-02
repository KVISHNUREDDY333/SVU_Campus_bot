# chatbot_core.py
import os
import json
import logging
from dotenv import load_dotenv

# Optional Groq client import attempt
try:
    from groq import Groq
except Exception:
    Groq = None  # keep safe if groq package or credentials missing

load_dotenv()
logger = logging.getLogger(__name__)

# ---------------------------
# Dataset loading & helpers
# ---------------------------
def convert_intents_to_dataset(intents):
    """Convert intent-based structure to expected dataset format"""
    campus_data = {}
    common_queries = []

    for intent in intents:
        tag = intent.get('tag', '')
        responses = intent.get('responses', [])
        patterns = intent.get('patterns', [])

        if responses:
            campus_data[tag] = responses  # keep ALL responses

        if patterns:
            common_queries.append({
                'category': tag,
                'keywords': patterns
            })

    return {
        "svu_campus_data": campus_data,
        "common_queries": common_queries
    }

def load_dataset():
    try:
        possible_paths = [
            'dataset/queries_responses.json',
            'svu_dataset.json',
            'queries_responses.json'
        ]

        for path in possible_paths:
            if os.path.exists(path):
                logger.info(f"Loading dataset from {path}")
                with open(path, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                    if isinstance(data, dict) and 'intents' in data:
                        return convert_intents_to_dataset(data['intents'])
                    return data

        logger.warning("No dataset file found, using basic fallback structure")
        return {
            "svu_campus_data": {
                "courses": ["SVU offers UG, PG, and Doctoral programs in Engineering, Sciences, Arts, and Management"],
                "hostel": ["Yes, hostel facilities are available for both boys and girls"],
                "fees": ["Fee structure varies by program. Contact college office for details"],
                "admissions": ["Admissions through various entrance exams and direct applications"]
            },
            "common_queries": []
        }
    except Exception as e:
        logger.error(f"Error loading dataset: {e}")
        return {"svu_campus_data": {}, "common_queries": []}


dataset = load_dataset()
logger.info(f"Dataset loaded with {len(dataset.get('svu_campus_data', {}))} categories")


# ---------------------------
# Query processing
# ---------------------------
def find_relevant_context(query):
    """Find relevant context from dataset based on query keywords"""
    query_lower = query.lower()
    relevant_info = []

    keyword_mappings = {
        'course': ['courses', 'programs', 'degrees', 'curriculum', 'subjects'],
        'fee': ['fees', 'cost', 'tuition', 'payment', 'money'],
        'hostel': ['accommodation', 'residence', 'living', 'rooms'],
        'admission': ['admissions', 'join', 'entry', 'enrollment'],
        'exam': ['exams', 'test', 'assessment', 'evaluation'],
        'facility': ['facilities', 'infrastructure', 'amenities']
    }

    for category, data in dataset.get('svu_campus_data', {}).items():
        if category.lower() in query_lower:
            if isinstance(data, list):
                for r in data[:3]:
                    relevant_info.append(f"{category}: {str(r)[:200]}...")
            else:
                relevant_info.append(f"{category}: {str(data)[:200]}...")

        for main_keyword, related_keywords in keyword_mappings.items():
            if main_keyword == category.lower() or category.lower() in related_keywords:
                if any(keyword in query_lower for keyword in related_keywords + [main_keyword]):
                    if isinstance(data, list):
                        for r in data[:3]:
                            relevant_info.append(f"{category}: {str(r)[:200]}...")
                    else:
                        relevant_info.append(f"{category}: {str(data)[:200]}...")

    if not relevant_info and dataset.get('svu_campus_data'):
        for category, data in list(dataset['svu_campus_data'].items())[:2]:
            if isinstance(data, list):
                relevant_info.append(f"{category}: {str(data[0])[:150]}...")
            else:
                relevant_info.append(f"{category}: {str(data)[:150]}...")

    return relevant_info[:3]


# ---------------------------
# Groq client init & response generation
# ---------------------------
_groq_client = None

def init_groq_client():
    global _groq_client
    try:
        groq_api_key = os.getenv('GROQ_API_KEY')
        if Groq is None or not groq_api_key:
            logger.info("Groq client not initialized (missing package or API key). Using fallback mode.")
            _groq_client = None
            return None
        _groq_client = Groq(api_key=groq_api_key)
        logger.info("Groq client initialized successfully")
        return _groq_client
    except Exception as e:
        logger.error(f"Failed to initialize Groq client: {e}")
        _groq_client = None
        return None

# Initialize on import (safe)
init_groq_client()

def get_groq_client():
    return _groq_client

def get_fallback_response(query, context):
    """Fallback response when Groq API is not available"""
    query_lower = query.lower()

    if any(word in query_lower for word in ['course', 'program', 'degree', 'study']):
        return "SV University offers UG, PG, and Doctoral programs. Visit svuniversity.edu.in/academics/ for details."

    elif any(word in query_lower for word in ['fee', 'cost', 'tuition', 'money']):
        return "Fee structure varies by program. Contact the accounts office or visit the website for details."

    elif any(word in query_lower for word in ['hostel', 'accommodation', 'residence']):
        return "SV University provides hostel facilities for both boys and girls. Details at svuniversity.edu.in/hostels/"

    elif any(word in query_lower for word in ['admission', 'join', 'entry']):
        return "Admissions are conducted through entrance exams and direct applications. Visit the official site for info."

    elif any(word in query_lower for word in ['contact', 'phone', 'email']):
        return "Contact SV University at +91 877 2248589 or email registrar@svuniversity.edu.in"

    else:
        if context:
            return f"Based on available information: {context[0][:200]}... For more info, visit the official site."
        else:
            return "Thank you for your question. For the most accurate information, visit svuniversity.edu.in."

def generate_response_with_groq(query, context):
    """Generate response using Groq Llama 3.1 (if available) otherwise fallback"""
    try:
        client = get_groq_client()
        if not client:
            return get_fallback_response(query, context)

        context_text = "\n".join(context) if context else "General SV University information available"

        system_prompt = """You are a helpful assistant for SV University students. You provide accurate, friendly responses about:
- Academic programs, courses, and curriculum
- Admission procedures and requirements
- Fees, scholarships, and financial aid
- Hostel and accommodation facilities
- Campus facilities and student life
- Placements and career guidance
- Safety and support services"""

        user_prompt = f"""Based on this SV University information:
{context_text}

Student question: {query}

Please provide a helpful response that directly addresses their question and respond only required answer."""

        completion = client.chat.completions.create(
            model="llama-3.1-8b-instant",
            messages=[
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt}
            ],
            temperature=0.7,
            max_tokens=400,
            top_p=0.9
        )

        response = completion.choices[0].message.content.strip()
        logger.info("Successfully generated response with Groq")
        return response

    except Exception as e:
        logger.error(f"Error with Groq API: {e}")
        return get_fallback_response(query, context)
