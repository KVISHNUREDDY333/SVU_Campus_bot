import json
import os
from langchain_huggingface import HuggingFaceEmbeddings
from langchain_chroma import Chroma
from langchain_core.documents import Document
import shutil

# Paths
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_PATH = os.path.join(BASE_DIR, 'svu_dataset.json')
DB_PATH = os.path.join(BASE_DIR, 'chroma_db')

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
            metadata={"tag": tag}
        )
        documents.append(doc)
        
    return documents

def build_vector_db():
    print("Loading data...")
    data = load_data()
    docs = create_documents(data)
    
    if not docs:
        print("No documents created.")
        return

    print(f"Created {len(docs)} documents.")

    print("Initializing Embeddings (this may take a moment)...")
    embeddings = HuggingFaceEmbeddings(model_name="all-MiniLM-L6-v2")

    if os.path.exists(DB_PATH):
        print("Removing old Vector DB...")
        shutil.rmtree(DB_PATH)

    print("Creating Vector Store...")
    vector_db = Chroma.from_documents(
        documents=docs,
        embedding=embeddings,
        persist_directory=DB_PATH
    )
    
    print(f"Vector DB successfully created at {DB_PATH}")

if __name__ == "__main__":
    build_vector_db()
