from flask import Flask
from dotenv import load_dotenv
import logging
import os

from routes.routes import routes_bp

load_dotenv()
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

def create_app():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    frontend_dir = os.path.join(base_dir, '..', 'frontend')

    app = Flask(
        __name__,
        template_folder=os.path.join(frontend_dir, 'templates'),
        static_folder=os.path.join(frontend_dir, 'static')
    )

    app.config['SECRET_KEY'] = os.getenv('SECRET_KEY', 'fallback_secret_key_for_development')

    app.register_blueprint(routes_bp)

    return app


if __name__ == '__main__':
    app = create_app()

    print("\n" + "="*50)
    print("🚀 Starting SV University Chatbot...")
    print("="*50)

    if not os.getenv('GROQ_API_KEY'):
        print("⚠️  WARNING: GROQ_API_KEY not found in environment variables! (Groq responses will be disabled)")
    else:
        print("✅ GROQ_API_KEY found")

    # Import dataset status from chatbot_core 
    try:
        from chatbot_core import dataset
        if dataset.get('svu_campus_data'):
            print(f"✅ Dataset loaded with {len(dataset['svu_campus_data'])} categories")
        else:
            print("⚠️  WARNING: Dataset not loaded properly")
    except Exception:
        print("⚠️  Could not determine dataset status")

    # Run server
    app.run(debug=True, host='0.0.0.0', port=int(os.getenv('PORT', 5000)))
