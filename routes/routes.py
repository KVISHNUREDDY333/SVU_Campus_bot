# routes.py
import logging
from flask import Blueprint, render_template, request, jsonify, current_app
from backend.chatbot_core import (
    find_relevant_context,
    generate_response_with_groq,
    get_groq_client,
    dataset
)

logger = logging.getLogger(__name__)
routes_bp = Blueprint('routes', __name__)

@routes_bp.route('/')
def index():
    try:
        # Ensure you have templates/index.html in your templates folder
        return render_template('index.html')
    except Exception as e:
        logger.error(f"Error serving index page: {e}")
        # return a minimal HTML response if template missing
        return "<h1>SV University Chatbot</h1><p>Index page not found (templates/index.html)</p>", 200

@routes_bp.route('/chat', methods=['POST'])
def chat():
    try:
        if not request.is_json:
            return jsonify({'error': 'Request must be JSON', 'status': 'error'}), 400

        data = request.get_json()
        if not data:
            return jsonify({'error': 'Invalid JSON data', 'status': 'error'}), 400

        user_query = data.get('message', '').strip()

        if not user_query:
            return jsonify({'error': 'Please enter a question', 'status': 'error'}), 400

        if len(user_query) > 500:
            return jsonify({'error': 'Question too long. Keep under 500 characters.', 'status': 'error'}), 400

        logger.info(f"Processing query: {user_query[:100]}...")

        context = find_relevant_context(user_query)
        logger.info(f"Found {len(context)} context items")

        response_text = generate_response_with_groq(user_query, context)

        return jsonify({
            'response': response_text,
            'status': 'success'
        })

    except Exception as e:
        logger.exception("Error in /chat endpoint")
        return jsonify({'error': 'Error processing your request. Try again later.', 'status': 'error'}), 500

@routes_bp.route('/health')
def health():
    try:
        groq_status = "connected" if get_groq_client() else "not available"
        dataset_status = "loaded" if dataset.get('svu_campus_data') else "not loaded"

        return jsonify({
            'status': 'healthy',
            'message': 'SV University Chatbot is running',
            'groq_api': groq_status,
            'dataset': dataset_status
        })
    except Exception as e:
        logger.error(f"Health check error: {e}")
        return jsonify({'status': 'error', 'message': str(e)}), 500
