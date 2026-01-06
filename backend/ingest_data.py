import asyncio
import os
import sys
from datetime import datetime

# Add project root to path
# We are in backend/ingest_data.py, so project root is ..
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from backend.app.services.rag_service import setup_rag_chain, ingest_url, ingest_pdf
from backend.app.core import database
from backend.app.core.config import Config

# List of URLs provided by user
urls = [
    "https://svuniversity.edu.in/",
    "https://svuniversity.edu.in/about/",
    "https://svuniversity.edu.in/vice-chancellor/",
    "https://svuniversity.edu.in/rector/",
    "https://svuniversity.edu.in/registrar/",
    "https://svuniversity.edu.in/former-vice-chancellors/",
    "https://svuniversity.edu.in/former-rectors/",
    "https://svuniversity.edu.in/former-registars/",
    "https://svuniversity.edu.in/former-joint-registrars/",
    "https://svuniversity.edu.in/executive-council/",
    "https://svuniversity.edu.in/academic-senate/",
    "https://svuniversity.edu.in/finance-committee/",
    "https://svuniversity.edu.in/officers/",
    "https://svuniversity.edu.in/urc-members",
    "https://svuniversity.edu.in/deputy-registrars",
    "https://svuniversity.edu.in/aao",
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
    "https://svuniversity.edu.in/collage-of-engineering/",
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
    "https://svuniversity.edu.in/rs-hostel",
    "https://svuniversity.edu.in/open-air-theatre/",
    "https://svuniversity.edu.in/nss/",
    "https://svuniversity.edu.in/ncc",
    "https://svuniversity.edu.in/day-care-centre/",
    "https://svuniversity.edu.in/sbi-svu-campus-branch/",
    "https://svuniversity.edu.in/gallery/",
    "https://svuniversity.edu.in/sports-games/",
    "https://svuniversity.edu.in/iqac/",
    "https://svuniversity.edu.in/naac",
    "https://svuniversity.edu.in/iiqa/",
    "https://svuniversity.edu.in/ssr",
    "https://svuniversity.edu.in/dvv/"
]

async def main():
    print("Initializing Database and RAG Chain...")
    database.get_db_client()
    setup_rag_chain()
    
    # Normalize and deduplicate URLs
    clean_urls = []
    for u in urls:
        u = u.replace('//', '/').replace('https:/', 'https://')
        clean_urls.append(u)
    
    unique_urls = list(set(clean_urls))
    print(f"Found {len(unique_urls)} unique URLs to ingest.")
    
    # 1. Ingest URLs
    for i, url in enumerate(unique_urls):
        try:
            # Check if exists
            existing = database.documents_db.find_one({"filename": url})
            if existing:
                print(f"Skipping {url}, already ingested.")
                continue

            print(f"[{i+1}/{len(unique_urls)}] Ingesting URL: {url}")
            chunks = await ingest_url(url)
            
            # --- CRITICAL FIX: INSERT METADATA TO DB ---
            doc_record = {
                "filename": url,
                "upload_date": datetime.utcnow(),
                "status": "processed",
                "chunks": chunks,
                "uploaded_by": "System Admin",
                "type": "url"
            }
            database.documents_db.insert_one(doc_record)
            # -------------------------------------------
            
            print(f"  -> Success: {chunks} chunks")
        except Exception as e:
            print(f"  -> Failed: {e}")

    # 2. Ingest PDFs from backend/uploads
    script_dir = os.path.dirname(__file__)
    uploads_dir = os.path.join(script_dir, "uploads")
    
    if os.path.exists(uploads_dir):
        files = [f for f in os.listdir(uploads_dir) if f.lower().endswith('.pdf')]
        print(f"\nFound {len(files)} PDFs in {uploads_dir}")
        print("-" * 30)
        
        for i, filename in enumerate(files):
            # Check if exists
            existing = database.documents_db.find_one({"filename": filename})
            if existing:
                print(f"Skipping {filename}, already ingested.")
                continue

            file_path = os.path.join(uploads_dir, filename)
            try:
                print(f"[{i+1}/{len(files)}] Ingesting PDF: {filename}")
                chunks = await ingest_pdf(file_path)
                
                # --- CRITICAL FIX: INSERT METADATA TO DB ---
                doc_record = {
                    "filename": filename,
                    "upload_date": datetime.utcnow(),
                    "status": "processed",
                    "chunks": chunks,
                    "uploaded_by": "System Admin",
                    "type": "pdf"
                }
                database.documents_db.insert_one(doc_record)
                # -------------------------------------------

                print(f"  -> Success: {chunks} chunks")
            except Exception as e:
                print(f"  -> Failed: {e}")
    else:
        print(f"\nUploads directory not found at {uploads_dir}")

    database.close_db_client()
    print("\nBatch Ingestion Complete.")

if __name__ == "__main__":
    asyncio.run(main())
