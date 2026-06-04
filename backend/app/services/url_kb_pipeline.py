"""
url_kb_pipeline.py
==================
Bulk URL ingestion pipeline for the SVU Campus Bot knowledge base.
Orchestrates: Fetch → Extract FAQs (zero-LLM) → Embed → Store in MongoDB.

Key features
------------
* Completely LLM-free — only BeautifulSoup + HuggingFace embeddings.
* Per-job progress tracking stored in the ``kb_jobs`` MongoDB collection.
* Idempotent: duplicate FAQs (same normalised question) are skipped.
* Stores the source URL on every FAQ document for provenance.
"""

import asyncio
import logging
import uuid
from datetime import datetime
from typing import Any

from ..core import database
from .url_faq_extractor import extract_faqs_from_url

logger = logging.getLogger("uvicorn")

# ---------------------------------------------------------------------------
# Job state helpers  (stored in MongoDB `kb_jobs` collection)
# ---------------------------------------------------------------------------

def _get_jobs_col():
    if database.mongo_client is None:
        return None
    from ..core.config import Config
    return database.mongo_client[Config.DB_NAME]["kb_jobs"]


def create_job(urls: list[str], submitted_by: str = "admin") -> str:
    """Create a new ingestion job record and return its job_id."""
    job_id = str(uuid.uuid4())
    doc = {
        "job_id": job_id,
        "urls": urls,
        "total_urls": len(urls),
        "processed_urls": 0,
        "total_faqs_extracted": 0,
        "total_faqs_stored": 0,
        "status": "pending",          # pending | running | done | failed
        "submitted_by": submitted_by,
        "created_at": datetime.utcnow(),
        "updated_at": datetime.utcnow(),
        "results": [],                 # per-URL summary
        "errors": [],
    }
    col = _get_jobs_col()
    if col is not None:
        col.insert_one(doc)
    logger.info(f"[KB-PIPELINE] Job {job_id} created with {len(urls)} URLs.")
    return job_id


def get_job(job_id: str) -> dict | None:
    col = _get_jobs_col()
    if col is None:
        return None
    doc = col.find_one({"job_id": job_id})
    if doc:
        doc["_id"] = str(doc["_id"])
    return doc


def _update_job(job_id: str, update: dict):
    col = _get_jobs_col()
    if col is not None:
        col.update_one(
            {"job_id": job_id},
            {"$set": {**update, "updated_at": datetime.utcnow()}},
        )


def list_jobs(limit: int = 20) -> list[dict]:
    col = _get_jobs_col()
    if col is None:
        return []
    docs = list(col.find().sort("created_at", -1).limit(limit))
    for d in docs:
        d["_id"] = str(d["_id"])
    return docs


# ---------------------------------------------------------------------------
# Core ingestion logic
# ---------------------------------------------------------------------------

async def _store_faq(faq: dict[str, Any], embeddings_model) -> bool:
    """
    Embed and store a single FAQ into svu_vectors.
    Returns True if inserted, False if duplicate/skipped.
    """
    if database.svu_vectors_db is None:
        logger.error("[KB-PIPELINE] svu_vectors_db not available.")
        return False

    import re
    from bson import ObjectId

    question = faq.get("question", "").strip()
    answer = faq.get("answer", "").strip()
    source_url = faq.get("source_url", "")
    category = faq.get("category", "General")
    keywords = faq.get("keywords", [])

    if not question or not answer:
        return False

    # --- Duplicate check ---
    existing = database.svu_vectors_db.find_one(
        {
            "type": "faq",
            "text": {
                "$regex": f"Question:\\s*{re.escape(question[:80])}",
                "$options": "i",
            },
        }
    )
    if existing:
        logger.debug(f"[KB-PIPELINE] Skipping duplicate: {question[:60]}")
        return False

    content = f"Question: {question}\nAnswer: {answer}"

    # --- Embed ---
    embedding = None
    if embeddings_model:
        try:
            embedding = await asyncio.to_thread(embeddings_model.embed_query, content)
        except Exception as exc:
            logger.warning(f"[KB-PIPELINE] Embedding failed for FAQ: {exc}")

    # --- Insert ---
    doc = {
        "text": content,
        "question": question,
        "answer": answer,
        "source": source_url,
        "source_url": source_url,
        "type": "faq",
        "faq_id": str(ObjectId()),
        "category": category,
        "keywords": keywords,
        "created_at": datetime.utcnow(),
        "ingestion_method": "url_kb_pipeline",  # tag so we know how it was added
    }
    if embedding:
        doc["embedding"] = embedding

    try:
        database.svu_vectors_db.insert_one(doc)
        return True
    except Exception as exc:
        logger.error(f"[KB-PIPELINE] DB insert error: {exc}")
        return False


async def _process_single_url(url: str, embeddings_model) -> dict[str, Any]:
    """Process one URL: extract FAQs and store them. Returns a result summary."""
    result: dict[str, Any] = {
        "url": url,
        "faqs_extracted": 0,
        "faqs_stored": 0,
        "status": "ok",
        "error": None,
    }
    try:
        # Run blocking extract in thread pool
        faqs = await asyncio.to_thread(extract_faqs_from_url, url)
        result["faqs_extracted"] = len(faqs)

        stored = 0
        for faq in faqs:
            success = await _store_faq(faq, embeddings_model)
            if success:
                stored += 1

        result["faqs_stored"] = stored

        # Record in documents collection for the admin panel
        if database.documents_db is not None:
            existing_doc = database.documents_db.find_one({"filename": url})
            if existing_doc:
                database.documents_db.update_one(
                    {"filename": url},
                    {
                        "$set": {
                            "last_modified": datetime.utcnow(),
                            "extracted_faqs": existing_doc.get("extracted_faqs", 0) + stored,
                        }
                    },
                )
            else:
                database.documents_db.insert_one(
                    {
                        "filename": url,
                        "uploaded_by": "url_kb_pipeline",
                        "uploaded_at": datetime.utcnow(),
                        "last_modified": datetime.utcnow(),
                        "chunks": len(faqs),
                        "status": "active",
                        "type": "url",
                        "extracted_faqs": stored,
                    }
                )

        logger.info(
            f"[KB-PIPELINE] {url} → extracted={len(faqs)}, stored={stored}"
        )
    except Exception as exc:
        result["status"] = "error"
        result["error"] = str(exc)
        logger.error(f"[KB-PIPELINE] Error processing {url}: {exc}")

    return result


# ---------------------------------------------------------------------------
# Public API — called by the router
# ---------------------------------------------------------------------------

async def run_pipeline(job_id: str, urls: list[str]):
    """
    Background coroutine that runs the full ingestion pipeline for a job.
    Updates the job document in MongoDB as it progresses.
    """
    # Lazy-import embeddings from rag_service to avoid circular imports
    try:
        from .rag_service import embeddings as embeddings_model
    except Exception:
        embeddings_model = None
        logger.warning("[KB-PIPELINE] Could not load embeddings — FAQs will be stored without vectors.")

    _update_job(job_id, {"status": "running"})
    logger.info(f"[KB-PIPELINE] Job {job_id} started. URLs: {len(urls)}")

    total_extracted = 0
    total_stored = 0
    results = []
    errors = []

    for i, url in enumerate(urls):
        url = url.strip()
        if not url:
            continue

        result = await _process_single_url(url, embeddings_model)
        results.append(result)
        total_extracted += result["faqs_extracted"]
        total_stored += result["faqs_stored"]

        if result["status"] == "error":
            errors.append({"url": url, "error": result["error"]})

        _update_job(
            job_id,
            {
                "processed_urls": i + 1,
                "total_faqs_extracted": total_extracted,
                "total_faqs_stored": total_stored,
                "results": results,
                "errors": errors,
            },
        )

        # Polite crawl delay
        await asyncio.sleep(1.0)

    final_status = "done" if not errors or total_stored > 0 else "failed"
    _update_job(
        job_id,
        {
            "status": final_status,
            "processed_urls": len(urls),
            "total_faqs_extracted": total_extracted,
            "total_faqs_stored": total_stored,
            "results": results,
            "errors": errors,
        },
    )
    logger.info(
        f"[KB-PIPELINE] Job {job_id} complete. "
        f"Extracted={total_extracted}, Stored={total_stored}, Status={final_status}"
    )
