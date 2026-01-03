import os
from dotenv import load_dotenv

load_dotenv()

class Config:
    SECRET_KEY = os.getenv("SECRET_KEY", "your_secret_key_here")
    ALGORITHM = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES = 30
    MONGODB_URI = os.getenv("MONGODB_URI")
    DB_NAME = "svu_chatbot"
    COLLECTION_NAME = os.getenv('MONGODB_COLLECTION', 'svu_vectors')
    EMAIL_ADDRESS = os.getenv("EMAIL_ADDRESS")
    EMAIL_PASSWORD = os.getenv("EMAIL_PASSWORD")
    HF_TOKEN = os.getenv("HF_TOKEN")
    GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
    GOOGLE_CLIENT_SECRET = os.getenv("GOOGLE_CLIENT_SECRET")
