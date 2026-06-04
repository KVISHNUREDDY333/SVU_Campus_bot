"""
run_url_extraction.py
=====================
Standalone runner for the Zero-LLM URL FAQ extraction pipeline.
Run from the project root:  python run_url_extraction.py
"""

import asyncio
import hashlib
import logging
import os
import re
import sys
import time
from datetime import datetime
from typing import Any

import urllib3
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# ── path setup ──────────────────────────────────────────────────────────────
sys.path.insert(0, os.path.dirname(__file__))
from dotenv import load_dotenv
load_dotenv()

# ── logging ──────────────────────────────────────────────────────────────────
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    datefmt="%H:%M:%S",
)
logger = logging.getLogger("extractor")

# ── MongoDB connection ────────────────────────────────────────────────────────
import certifi
from pymongo import MongoClient

MONGODB_URI = os.getenv("MONGODB_URI")
MONGODB_DB  = os.getenv("MONGODB_DB", "svu_chatbot")
COLLECTION  = os.getenv("MONGODB_COLLECTION", "svu_vectors")

if not MONGODB_URI:
    logger.critical("MONGODB_URI not set in .env — aborting.")
    sys.exit(1)

mongo_client = MongoClient(MONGODB_URI, tlsCAFile=certifi.where(), serverSelectionTimeoutMS=30000)
db           = mongo_client[MONGODB_DB]
vectors_col  = db[COLLECTION]
documents_col = db["documents"]
jobs_col     = db["kb_jobs"]
logger.info(f"Connected to MongoDB: {MONGODB_DB} / {COLLECTION}")

# ── embeddings (HuggingFace, offline-capable) ────────────────────────────────
try:
    os.environ["HF_HUB_DISABLE_SYMLINKS_WARNING"] = "1"
    os.environ["TRANSFORMERS_VERBOSITY"] = "error"
    os.environ["TOKENIZERS_PARALLELISM"] = "false"
    from langchain_huggingface import HuggingFaceEmbeddings
    embeddings = HuggingFaceEmbeddings(model_name="sentence-transformers/all-MiniLM-L6-v2")
    logger.info("Embeddings model loaded.")
except Exception as e:
    embeddings = None
    logger.warning(f"Could not load embeddings ({e}). FAQs will be stored without vectors.")

# ── extractor import ─────────────────────────────────────────────────────────
from backend.app.services.url_faq_extractor import extract_faqs_from_url

# ── URL list ─────────────────────────────────────────────────────────────────
URLS = [
    "https://svuniversity.edu.in/",
    "https://svuniversity.edu.in/about/",
    "https://svuniversity.edu.in/vice-chancellor/",
    "https://svuniversity.edu.in/former-vice-chancellors/",
    "https://svuniversity.edu.in/rector/",
    "https://svuniversity.edu.in/former-rectors/",
    "https://svuniversity.edu.in/registrar/",
    "https://svuniversity.edu.in/former-registars/",
    "https://svuniversity.edu.in/former-joint-registrars/",
    "https://svuniversity.edu.in/executive-council/",
    "https://svuniversity.edu.in/academic-senate/",
    "https://svuniversity.edu.in/officers/",
    "https://svuniversity.edu.in/urc-members",
    "https://svuniversity.edu.in/deputy-registrars",
    "https://svuniversity.edu.in/aao",
    "https://svuniversity.edu.in/finance-committee/",
    "https://svuniversity.edu.in/cpc-members",
    "https://svuniversity.edu.in/college-of-arts/",
    "https://svuniversity.edu.in/college-principal-cfa/",
    "https://svuniversity.edu.in/sv-arts-department/",
    "https://svuniversity.edu.in/college-events-cfa/",
    "https://svuniversity.edu.in/college-staff-cfa/",
    "https://svuniversity.edu.in/college-of-science/",
    "https://svuniversity.edu.in/college-of-science-principal/",
    "https://svuniversity.edu.in/college-of-science-department/",
    "https://svuniversity.edu.in/events-achievements-cfs/",
    "https://svuniversity.edu.in/collage-of-science-administration/",
    "https://svuniversity.edu.in/college-of-engineering/",
    "https://svuniversity.edu.in/college-departments-cfe/",
    "https://svuniversity.edu.in/college-events-cfe/",
    "https://svuniversity.edu.in/collage-of-engineering-administration-staff/",
    "https://svuniversity.edu.in/about-cmcs/",
    "https://svuniversity.edu.in/collage-of-commerce/",
    "https://svuniversity.edu.in/college-departments-cmcs/",
    "https://svuniversity.edu.in/college-events-cm-cs/",
    "https://svuniversity.edu.in/collage-of-commerce-cmcs/",
    "https://svuniversity.edu.in/college-of-pharmaceutical-sciences/",
    "https://svuniversity.edu.in/collage-of-pharmacy/",
    "https://svuniversity.edu.in/college-departments-cfp/",
    "https://svuniversity.edu.in/college-events-cfp/",
    "https://svuniversity.edu.in/collage-of-pharmacy-administration/",
    "https://svuniversity.edu.in/collage-of-pharmacy-sif-report/",
    "https://svuniversity.edu.in/advanced-centre-for-atmospheric-sciences",
    "https://svuniversity.edu.in/bioinformatics-infrastructure-facility-bif",
    "https://svuniversity.edu.in/cseap-studies-center",
    "https://svuniversity.edu.in/computer-center/",
    "https://svuniversity.edu.in/cerdat/",
    "https://svuniversity.edu.in/doa/",
    "https://svuniversity.edu.in/dst-purse-centre-3",
    "https://svuniversity.edu.in/mmttc-center/",
    "https://svuniversity.edu.in/ori-center",
    "https://svuniversity.edu.in/usi-center",
    "https://svuniversity.edu.in/academic-programme/",
    "https://svuniversity.edu.in/professional-courses/",
    "https://svuniversity.edu.in/degree-course-syllabus/",
    "https://svuniversity.edu.in/pg-course-syllabus/",
    "https://svuniversity.edu.in/dean-development",
    "https://svuniversity.edu.in/dean-rd",
    "https://svuniversity.edu.in/dean-commerce-management/",
    "https://svuniversity.edu.in/dean-cdc",
    "https://svuniversity.edu.in/dean-international-relations",
    "https://svuniversity.edu.in/dean-it",
    "https://svuniversity.edu.in/dean-faculty-of-sciences",
    "https://svuniversity.edu.in/dean-of-examinations/",
    "https://svuniversity.edu.in/research/",
    "https://svuniversity.edu.in/college-affiliation/",
    "https://svuniversity.edu.in/control-of-examination/",
    "https://svuniversity.edu.in/facilities/",
    "https://svuniversity.edu.in/library/",
    "https://svuniversity.edu.in/stadium/",
    "https://svuniversity.edu.in/health-center/",
    "https://svuniversity.edu.in/womens-hostels/",
    "https://svuniversity.edu.in/svu-guest-house/",
    "https://svuniversity.edu.in/campus-school/",
    "https://svuniversity.edu.in/annyamaya-bhavan/",
    "https://svuniversity.edu.in/internet-facility/",
    "https://svuniversity.edu.in/s-v-university-post-office/",
    "https://svuniversity.edu.in/labs/",
    "https://svuniversity.edu.in/nss/",
    "https://svuniversity.edu.in/ncc",
    "https://svuniversity.edu.in/day-care-centre/",
    "https://svuniversity.edu.in/sbi-svu-campus-branch/",
    "https://svuniversity.edu.in/rs-hostel",
    "https://svuniversity.edu.in/open-air-theatre/",
    "https://svuniversity.edu.in/gallery/",
    "https://svuniversity.edu.in/sports-games/",
    "https://svuniversity.edu.in/iqac/",
    "https://svuniversity.edu.in/naac",
    "https://svuniversity.edu.in/iiqa/",
    "https://svuniversity.edu.in/ssr",
    "https://svuniversity.edu.in/dvv/",
]

# ── helpers ───────────────────────────────────────────────────────────────────

def _fingerprint(q: str) -> str:
    q = q.lower()
    q = re.sub(r"[^a-z0-9 ]", "", q)
    q = re.sub(r"\s+", " ", q).strip()
    return hashlib.md5(q.encode()).hexdigest()


def store_faq(faq: dict[str, Any]) -> bool:
    """Store a single FAQ into MongoDB. Returns True if inserted, False if duplicate."""
    from bson import ObjectId

    question = faq.get("question", "").strip()
    answer   = faq.get("answer",   "").strip()
    source   = faq.get("source_url", "")

    if not question or not answer:
        return False

    # Duplicate check
    existing = vectors_col.find_one({
        "type": "faq",
        "text": {"$regex": f"Question:\\s*{re.escape(question[:80])}", "$options": "i"},
    })
    if existing:
        return False

    content   = f"Question: {question}\nAnswer: {answer}"
    embedding = None
    if embeddings:
        try:
            embedding = embeddings.embed_query(content)
        except Exception as exc:
            logger.warning(f"Embedding error: {exc}")

    doc = {
        "text":             content,
        "question":         question,
        "answer":           answer,
        "source":           source,
        "source_url":       source,
        "type":             "faq",
        "faq_id":           str(ObjectId()),
        "category":         faq.get("category", "General"),
        "keywords":         faq.get("keywords", []),
        "created_at":       datetime.utcnow(),
        "ingestion_method": "url_kb_pipeline",
    }
    if embedding:
        doc["embedding"] = embedding

    vectors_col.insert_one(doc)
    return True


def record_document(url: str, extracted: int, stored: int):
    existing = documents_col.find_one({"filename": url})
    if existing:
        documents_col.update_one(
            {"filename": url},
            {"$set": {"last_modified": datetime.utcnow(),
                       "extracted_faqs": existing.get("extracted_faqs", 0) + stored}}
        )
    else:
        documents_col.insert_one({
            "filename":       url,
            "uploaded_by":    "url_kb_pipeline",
            "uploaded_at":    datetime.utcnow(),
            "last_modified":  datetime.utcnow(),
            "chunks":         extracted,
            "status":         "active",
            "type":           "url",
            "extracted_faqs": stored,
        })


# ── main ──────────────────────────────────────────────────────────────────────

def run():
    # Deduplicate URLs while preserving order
    seen_urls: set[str] = set()
    unique_urls = []
    for u in URLS:
        u = u.strip().rstrip("/").rstrip()
        # normalise trailing slash variants
        if u not in seen_urls:
            seen_urls.add(u)
            unique_urls.append(u)

    total_urls      = len(unique_urls)
    total_extracted = 0
    total_stored    = 0
    global_seen_fps: set[str] = set()

    logger.info(f"{'='*60}")
    logger.info(f"SVU Knowledge Base Extraction — {total_urls} URLs")
    logger.info(f"Target DB : {MONGODB_DB} → {COLLECTION}")
    logger.info(f"{'='*60}")

    for idx, url in enumerate(unique_urls, 1):
        logger.info(f"[{idx:02d}/{total_urls}] Processing: {url}")
        try:
            faqs = extract_faqs_from_url(url)
            extracted = len(faqs)
            stored    = 0

            for faq in faqs:
                fp = _fingerprint(faq["question"])
                if fp in global_seen_fps:
                    continue          # cross-URL global dedup
                global_seen_fps.add(fp)
                if store_faq(faq):
                    stored += 1

            record_document(url, extracted, stored)
            total_extracted += extracted
            total_stored    += stored

            status = "✓" if extracted > 0 else "○"
            logger.info(
                f"  {status} Extracted={extracted:3d}  Stored={stored:3d}  "
                f"(cumulative: {total_stored} stored)"
            )
        except Exception as exc:
            logger.error(f"  ✗ Error: {exc}")

        time.sleep(0.8)   # polite crawl delay

    logger.info(f"{'='*60}")
    logger.info(f"DONE — URLs={total_urls}  Extracted={total_extracted}  Stored={total_stored}")
    logger.info(f"{'='*60}")


if __name__ == "__main__":
    run()
