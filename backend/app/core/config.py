import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "60c39c183b3a3b75959b02299e8ccf9f7deef5c854ac53ff0af88394a1cd3a8a")
    ALGORITHM = os.getenv("ALGORITHM", "HS256")
    ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))
    MONGODB_URI = os.getenv("MONGODB_URI", "mongodb+srv://vishnukamasani3_db_user:S8vdGN0KpcQztrMZ@cluster0.vfi8dom.mongodb.net/?appName=Cluster0")
    DB_NAME = os.getenv("MONGODB_DB", "svu_chatbot")
    COLLECTION_NAME = os.getenv('MONGODB_COLLECTION', 'svu_vectors')
    EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS", "vishnureddyk3333@gmail.com")
    EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD", "agndugehrtbdjzxn")
    GROQ_API_KEY = os.getenv("GROQ_API_KEY", "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")
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID", "966590082510-lcddo6ujff4nmj1s0u81rf60vk0699q6.apps.googleusercontent.com")
    GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET", "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")

