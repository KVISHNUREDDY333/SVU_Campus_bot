import json
import os
import logging
from dotenv import load_dotenv
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_mongodb import MongoDBAtlasVectorSearch
from langchain_core.documents import Document
from pymongo import MongoClient

# Setup logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

load_dotenv()

# Config
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, 'svu_dataset.json')
MONGODB_URI = os.getenv('MONGODB_URI')
DB_NAME = os.getenv('MONGODB_DB', 'svu_chatbot')
COLLECTION_NAME = os.getenv('MONGODB_COLLECTION', 'svu_vectors')
INDEX_NAME = "default"  # Ensure this index exists in Atlas or create it

def load_data():
    if not os.path.exists(DATA_PATH):
        raise FileNotFoundError(f"Dataset not found at {DATA_PATH}")
        
    with open(DATA_PATH, 'r', encoding='utf-8') as f:
        data = json.load(f)
    return data

def create_documents(data):
    documents = []
    
    if 'intents' not in data:
        print("Invalid data format: 'intents' key missing.")
        return []

    for intent in data['intents']:
        tag = intent.get('tag', 'General')
        patterns = ", ".join(intent.get('patterns', []))
        keywords = ", ".join(intent.get('keywords', []))
        responses = "\n".join(intent.get('responses', []))
        
        # content constructed to maximize retrieval accuracy
        content = f"Category: {tag}\nKeywords: {keywords}\nCommon User Questions: {patterns}\nAnswer/Information: {responses}"
        
        doc = Document(
            page_content=content,
            metadata={"tag": tag, "source": "svu_dataset"}
        )
        documents.append(doc)
        
    return documents

def build_mongo_vector_db():
    if not MONGODB_URI:
        logger.error("MONGODB_URI not found in environment variables.")
        return

    logger.info("Loading data...")
    data = load_data()
    docs = create_documents(data)
    
    if not docs:
        logger.warning("No documents created.")
        return

    logger.info(f"Created {len(docs)} documents.")

    logger.info("Initializing Embeddings...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    logger.info(f"Connecting to MongoDB: {DB_NAME}.{COLLECTION_NAME}")
    try:
        client = MongoClient(MONGODB_URI)
        collection = client[DB_NAME][COLLECTION_NAME]
        
        # Optional: Delete existing to avoid duplicates if rebuilding
        # collection.delete_many({"source": "svu_dataset"}) # be careful with this in prod
        
        logger.info("Inserting documents into MongoDB Vector Store...")
        
        # Using MongoDBAtlasVectorSearch.from_documents
        MongoDBAtlasVectorSearch.from_documents(
            documents=docs,
            embedding=embeddings,
            collection=collection,
            index_name=INDEX_NAME
        )
        
        logger.info("Successfully populated MongoDB Vector Database!")
        
    except Exception as e:
        logger.error(f"Failed to populate MongoDB: {e}")

if __name__ == "__main__":
    build_mongo_vector_db()
