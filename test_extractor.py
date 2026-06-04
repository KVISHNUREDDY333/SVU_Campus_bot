"""Quick extractor test for SVU pages"""
import urllib3
urllib3.disable_warnings()

import sys, os
sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))
from backend.app.services.url_faq_extractor import extract_faqs_from_url

test_urls = [
    "https://svuniversity.edu.in/college-of-arts/",
    "https://svuniversity.edu.in/library/",
    "https://svuniversity.edu.in/womens-hostels/",
    "https://svuniversity.edu.in/about/",
]
total = 0
for url in test_urls:
    faqs = extract_faqs_from_url(url)
    total += len(faqs)
    slug = url.rstrip("/").split("/")[-1] or "home"
    print(f"{slug:<30s} -> {len(faqs)} FAQs")
    for f in faqs[:2]:
        print(f"  Q: {f['question'][:80]}")
        print(f"  A: {f['answer'][:100]}")
    print()
print(f"Total: {total} FAQs from {len(test_urls)} URLs")
