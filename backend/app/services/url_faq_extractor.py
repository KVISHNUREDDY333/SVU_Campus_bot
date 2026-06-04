"""
url_faq_extractor.py
====================
Zero-LLM FAQ extraction from University web pages.
Uses rule-based heuristics with BeautifulSoup to extract FAQ pairs
from structured HTML patterns without any AI/LLM dependency.

Extraction strategies (in priority order):
1. Explicit <dt>/<dd> definition lists (classic FAQ markup)
2. Accordion / disclosure patterns (summary+details, aria-expanded)
3. Heading + next-sibling paragraph pairs (H2/H3/H4 followed by <p>)
4. Question-sentence detection in <p> / <li> tags
5. Table rows where first cell is a question-like sentence
6. Bold/strong label followed by content in the same block

Deduplication is done via a normalised question fingerprint set.
"""

import hashlib
import logging
import re
import time
from typing import Any
from urllib.parse import urljoin, urlparse

import requests
from bs4 import BeautifulSoup, NavigableString, Tag

logger = logging.getLogger("uvicorn")

# ---------------------------------------------------------------------------
# Constants & helpers
# ---------------------------------------------------------------------------

UNIVERSITY_CATEGORY_KEYWORDS: dict[str, list[str]] = {
    "Admissions": [
        "admission", "apply", "application", "eligibility", "entrance",
        "seat", "merit", "rank", "counselling", "registration",
    ],
    "Fees": [
        "fee", "fees", "tuition", "payment", "challan", "scholarship",
        "stipend", "refund", "fine", "charge", "hostel fee",
    ],
    "Examinations": [
        "exam", "examination", "result", "revaluation", "mark", "grade",
        "internal", "external", "supplementary", "backlog", "hall ticket",
    ],
    "Academic Calendar": [
        "calendar", "schedule", "semester", "academic year", "holiday",
        "vacation", "commencement", "convocation",
    ],
    "Hostels": [
        "hostel", "accommodation", "warden", "mess", "room", "dormitory",
        "pg", "residential",
    ],
    "Placements": [
        "placement", "campus drive", "company", "package", "recruit",
        "internship", "job", "career",
    ],
    "Departments": [
        "department", "cse", "ece", "eee", "mech", "civil", "it ",
        "computer science", "electronics", "electrical", "mechanical",
    ],
    "Faculty": [
        "professor", "faculty", "lecturer", "hod", "head of department",
        "teaching staff", "guide",
    ],
    "Research": [
        "research", "phd", "m.phil", "thesis", "publication", "journal",
        "project", "grant",
    ],
    "Scholarships": [
        "scholarship", "financial aid", "stipend", "fellowship", "ebc",
        "merit", "sc st scholarship",
    ],
    "Facilities": [
        "library", "lab", "laboratory", "sports", "ground", "gym",
        "canteen", "wifi", "internet", "nss", "ncc",
    ],
    "Contact & Administration": [
        "contact", "address", "phone", "email", "office", "registrar",
        "vice chancellor", "principal", "administration", "helpline",
    ],
    "Rules & Regulations": [
        "rule", "regulation", "policy", "code of conduct", "attendance",
        "dress code", "disciplinary",
    ],
    "Notifications": [
        "notification", "notice", "circular", "announcement",
        "important", "news", "update",
    ],
}

QUESTION_WORDS = re.compile(
    r"^(what|when|where|who|how|why|which|can|is|are|does|do|will|should|"
    r"may|has|have|could|would|shall|did|was|were)\b",
    re.IGNORECASE,
)

NOISE_PATTERNS = re.compile(
    r"(cookie|privacy policy|terms of use|copyright|skip to|back to top|"
    r"menu|search|\blogin\b|\bsign in\b|subscribe|follow us|social media)",
    re.IGNORECASE,
)

MIN_ANSWER_LEN = 20
MIN_QUESTION_LEN = 10


def _clean_text(text: str) -> str:
    """Collapse whitespace and strip."""
    return re.sub(r"\s+", " ", text).strip()


def _is_question(text: str) -> bool:
    """Heuristic: does this look like a question a student would ask?"""
    t = text.strip()
    if len(t) < MIN_QUESTION_LEN or len(t) > 300:
        return False
    if t.endswith("?"):
        return True
    if QUESTION_WORDS.match(t):
        return True
    return False


def _is_noise(text: str) -> bool:
    return bool(NOISE_PATTERNS.search(text))


def _normalise_question(q: str) -> str:
    """Create a stable fingerprint for deduplication."""
    q = q.lower()
    q = re.sub(r"[^a-z0-9 ]", "", q)
    q = re.sub(r"\s+", " ", q).strip()
    return q


def _fingerprint(q: str) -> str:
    return hashlib.md5(_normalise_question(q).encode()).hexdigest()


def _categorise(question: str, answer: str) -> str:
    combined = (question + " " + answer).lower()
    for category, keywords in UNIVERSITY_CATEGORY_KEYWORDS.items():
        for kw in keywords:
            if kw in combined:
                return category
    return "General"


def _make_faq(question: str, answer: str, source_url: str) -> dict[str, Any]:
    q = _clean_text(question)
    a = _clean_text(answer)
    if len(q) < MIN_QUESTION_LEN or len(a) < MIN_ANSWER_LEN:
        return {}
    if _is_noise(q) or _is_noise(a):
        return {}
    return {
        "question": q,
        "answer": a,
        "category": _categorise(q, a),
        "source_url": source_url,
        "keywords": _extract_keywords(q + " " + a),
    }


def _extract_keywords(text: str) -> list[str]:
    """Simple keyword extraction: pick significant words (len > 4, not stopwords)."""
    STOPWORDS = {
        "about", "above", "after", "also", "that", "this", "with", "from",
        "have", "will", "been", "which", "when", "what", "where", "their",
        "there", "these", "those", "would", "could", "should", "shall",
        "were", "does", "more", "some", "into", "than", "then", "them",
        "they", "your", "students", "university", "college", "please",
    }
    words = re.findall(r"[a-zA-Z]{5,}", text.lower())
    seen: set[str] = set()
    keywords: list[str] = []
    for w in words:
        if w not in STOPWORDS and w not in seen:
            seen.add(w)
            keywords.append(w)
        if len(keywords) >= 8:
            break
    return keywords


# ---------------------------------------------------------------------------
# HTML fetching
# ---------------------------------------------------------------------------

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/122.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "en-US,en;q=0.9",
}


def _fetch_html(url: str, timeout: int = 20) -> str | None:
    try:
        resp = requests.get(url, headers=HEADERS, timeout=timeout, verify=False)
        resp.raise_for_status()
        return resp.text
    except requests.RequestException as exc:
        logger.warning(f"[FAQ-EXTRACTOR] Failed to fetch {url}: {exc}")
        return None


# ---------------------------------------------------------------------------
# Extraction strategies
# ---------------------------------------------------------------------------

def _extract_dt_dd(soup: BeautifulSoup, url: str) -> list[dict]:
    """Strategy 1: <dl><dt>question</dt><dd>answer</dd></dl>"""
    faqs: list[dict] = []
    for dl in soup.find_all("dl"):
        dts = dl.find_all("dt")
        dds = dl.find_all("dd")
        for dt, dd in zip(dts, dds):
            q = _clean_text(dt.get_text())
            a = _clean_text(dd.get_text())
            faq = _make_faq(q, a, url)
            if faq:
                faqs.append(faq)
    return faqs


def _extract_accordion(soup: BeautifulSoup, url: str) -> list[dict]:
    """Strategy 2: HTML5 <details>/<summary> and ARIA accordion patterns."""
    faqs: list[dict] = []

    # <details><summary>Q</summary>A</details>
    for details in soup.find_all("details"):
        summary = details.find("summary")
        if not summary:
            continue
        q = _clean_text(summary.get_text())
        # Answer = everything in details except the summary
        answer_parts = []
        for child in details.children:
            if child == summary:
                continue
            if isinstance(child, (Tag, NavigableString)):
                text = _clean_text(
                    child.get_text() if isinstance(child, Tag) else str(child)
                )
                if text:
                    answer_parts.append(text)
        a = " ".join(answer_parts)
        faq = _make_faq(q, a, url)
        if faq:
            faqs.append(faq)

    # Bootstrap / generic accordion: data-toggle="collapse", aria-controls, etc.
    for btn in soup.find_all(
        True,
        attrs={"data-toggle": "collapse"},
    ):
        q = _clean_text(btn.get_text())
        target_id = btn.get("data-target", btn.get("href", "")).lstrip("#")
        if not target_id:
            continue
        target = soup.find(id=target_id)
        if not target:
            continue
        a = _clean_text(target.get_text())
        faq = _make_faq(q, a, url)
        if faq:
            faqs.append(faq)

    return faqs


def _extract_heading_paragraph(soup: BeautifulSoup, url: str) -> list[dict]:
    """Strategy 3: H2/H3/H4 immediately followed by <p> or <ul>/<ol>."""
    faqs: list[dict] = []
    heading_tags = {"h2", "h3", "h4"}
    for tag in soup.find_all(heading_tags):
        q = _clean_text(tag.get_text())
        if not _is_question(q):
            continue
        # Collect sibling paragraphs / lists until next heading
        answer_parts: list[str] = []
        sib = tag.find_next_sibling()
        while sib and sib.name not in heading_tags:
            if sib.name in ("p", "ul", "ol", "div", "table"):
                part = _clean_text(sib.get_text())
                if part:
                    answer_parts.append(part)
                if len(answer_parts) >= 3:
                    break
            sib = sib.find_next_sibling()
        a = " ".join(answer_parts)
        faq = _make_faq(q, a, url)
        if faq:
            faqs.append(faq)
    return faqs


def _extract_question_sentences(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Strategy 4: Scan every <p> and <li>.
    If a paragraph ends with '?' and is short, it's a question;
    the NEXT sibling is the answer.
    """
    faqs: list[dict] = []
    for tag in soup.find_all(["p", "li"]):
        q = _clean_text(tag.get_text())
        if not _is_question(q):
            continue
        # Try next sibling
        sib = tag.find_next_sibling()
        if sib:
            a = _clean_text(sib.get_text())
            faq = _make_faq(q, a, url)
            if faq:
                faqs.append(faq)
    return faqs


def _extract_bold_label_pairs(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Strategy 5: <p><strong>Question</strong>: answer text</p>
    or <b>Label</b> followed by answer in the same block.
    """
    faqs: list[dict] = []
    for p in soup.find_all("p"):
        strong = p.find(["strong", "b"])
        if not strong:
            continue
        q = _clean_text(strong.get_text())
        # Remove the strong element text from the parent p text to get the answer
        strong_text = strong.get_text()
        full_text = _clean_text(p.get_text())
        a = full_text.replace(strong_text, "", 1).lstrip(":– -").strip()
        if not a or a == full_text:
            # Try next sibling
            sib = p.find_next_sibling()
            if sib:
                a = _clean_text(sib.get_text())
        faq = _make_faq(q, a, url)
        if faq:
            faqs.append(faq)
    return faqs


def _extract_table_rows(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Strategy 6: Tables where the first column is a question/label
    and the second column is the answer.
    """
    faqs: list[dict] = []
    for table in soup.find_all("table"):
        rows = table.find_all("tr")
        for row in rows:
            cells = row.find_all(["td", "th"])
            if len(cells) < 2:
                continue
            q = _clean_text(cells[0].get_text())
            a = " | ".join(_clean_text(c.get_text()) for c in cells[1:])
            faq = _make_faq(q, a, url)
            if faq:
                faqs.append(faq)
    return faqs


def _extract_list_items(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Strategy 7: Ordered/unordered lists that follow a heading.
    Convert as: heading = question, each li = a separate answer bullet.
    """
    faqs: list[dict] = []
    heading_tags = {"h1", "h2", "h3", "h4", "h5"}
    for ul in soup.find_all(["ul", "ol"]):
        prev = ul.find_previous_sibling()
        if not prev or prev.name not in heading_tags:
            continue
        q = _clean_text(prev.get_text())
        items = [_clean_text(li.get_text()) for li in ul.find_all("li") if _clean_text(li.get_text())]
        if not items:
            continue
        a = "; ".join(items)
        faq = _make_faq(q, a, url)
        if faq:
            faqs.append(faq)
    return faqs


def _heading_to_question(heading: str, page_context: str = "") -> str:
    """Convert a section heading into a student-style question."""
    h = heading.strip().rstrip(":")
    # Already a question
    if h.endswith("?"):
        return h
    # Map common section titles to question forms
    HEADING_QUESTION_MAP = {
        "about": "What is {} about?",
        "overview": "What is the overview of {}?",
        "vision": "What is the vision of {}?",
        "mission": "What is the mission of {}?",
        "vision & mission": "What is the vision and mission of {}?",
        "contact": "How can I contact {}?",
        "contact us": "How can I contact {}?",
        "facilities": "What facilities are available at {}?",
        "courses": "What courses are offered at {}?",
        "programmes": "What programmes are offered?",
        "programmes offered": "What programmes are offered at {}?",
        "departments": "What departments are in {}?",
        "faculty": "Who are the faculty members of {}?",
        "staff": "Who are the staff members of {}?",
        "administration": "Who handles the administration of {}?",
        "research": "What research is done at {}?",
        "achievements": "What are the achievements of {}?",
        "events": "What events does {} organise?",
        "eligibility": "What is the eligibility for {}?",
        "fee": "What are the fees for {}?",
        "fees": "What are the fees for {}?",
        "hostel": "What hostel facilities are available?",
        "library": "What library facilities are available?",
        "placement": "What are the placement details?",
        "placements": "What are the placement details at {}?",
        "admission": "How can I get admission to {}?",
        "admissions": "How can I get admission to {}?",
        "examination": "What are the examination rules?",
        "results": "How can I check results?",
        "scholarship": "What scholarships are available?",
        "scholarships": "What scholarships are available at {}?",
        "history": "What is the history of {}?",
        "infrastructure": "What infrastructure is available at {}?",
        "labs": "What labs are available?",
        "activities": "What activities are conducted at {}?",
        "ncc": "What is NCC at SVU?",
        "nss": "What is NSS at SVU?",
        "sports": "What sports facilities are available?",
        "canteen": "What canteen facilities are available?",
        "bank": "What banking facilities are available on campus?",
        "post office": "Is there a post office on campus?",
        "health": "What health facilities are available?",
        "health center": "What healthcare is available at SVU?",
        "guest house": "Is there a guest house at SVU?",
        "internet": "What internet facilities are available?",
    }
    h_lower = h.lower()
    for key, template in HEADING_QUESTION_MAP.items():
        if key in h_lower:
            context = page_context or "SVU"
            return template.format(context)

    # Generic fallback: "Tell me about {heading}"
    return f"What is {h} at Sri Venkateswara University?"


def _extract_semantic_content_blocks(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Strategy 8 (SVU-specific): Extract ## H2 / H3 section headings followed
    by substantive paragraph / list content. Converts each content block into a
    factual FAQ pair:  heading → question,  body text → answer.

    This is the primary strategy for the SVU WordPress site because most content
    pages use the pattern:
        <h2>Section Title</h2>
        <p>Rich descriptive paragraph...</p>
        <p>More details...</p>
    """
    faqs: list[dict] = []
    heading_tags = ["h1", "h2", "h3"]

    # Attempt to detect the page subject from <title> or first <h1>
    page_title = ""
    title_tag = soup.find("title")
    if title_tag:
        page_title = _clean_text(title_tag.get_text()).split("–")[0].strip()
    if not page_title:
        h1 = soup.find("h1")
        if h1:
            page_title = _clean_text(h1.get_text())

    for heading in soup.find_all(heading_tags):
        heading_text = _clean_text(heading.get_text())
        if not heading_text or len(heading_text) < 3:
            continue
        if _is_noise(heading_text):
            continue
        # Skip headings that are just nav items (very short or all-caps nav labels)
        if heading_text.upper() in {"ABOUT", "CONTACT", "HOME", "MENU",
                                     "SEARCH", "GALLERY", "EVENTS"}:
            continue

        # Collect the body content following this heading until the next heading
        body_parts: list[str] = []
        sib = heading.find_next_sibling()
        while sib and sib.name not in heading_tags:
            if sib.name in ("p", "div", "section"):
                part = _clean_text(sib.get_text())
                if part and len(part) > 30 and not _is_noise(part):
                    body_parts.append(part)
            elif sib.name in ("ul", "ol"):
                items = [
                    _clean_text(li.get_text())
                    for li in sib.find_all("li")
                    if _clean_text(li.get_text()) and len(_clean_text(li.get_text())) > 5
                ]
                if items:
                    body_parts.append("; ".join(items[:20]))
            elif sib.name == "table":
                rows = []
                for tr in sib.find_all("tr"):
                    cells = [_clean_text(td.get_text()) for td in tr.find_all(["td", "th"])]
                    row_text = " | ".join(c for c in cells if c)
                    if row_text:
                        rows.append(row_text)
                if rows:
                    body_parts.append(". ".join(rows[:15]))
            if len(body_parts) >= 4:
                break
            sib = sib.find_next_sibling()

        if not body_parts:
            continue

        answer = " ".join(body_parts)
        if len(answer) < MIN_ANSWER_LEN:
            continue

        question = _heading_to_question(heading_text, page_title)
        faq = _make_faq(question, answer, url)
        if faq:
            faqs.append(faq)

    return faqs


def _extract_contact_info(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Strategy 9: Detect contact information blocks (address, phone, email)
    and synthesise FAQ pairs for them.
    """
    faqs: list[dict] = []
    full_text = soup.get_text(" ", strip=True)

    # Phone numbers
    phones = re.findall(r"(?:\+91[-\s]?)?(?:\(0\d{2,4}\)|0\d{2,4})[-\s]?\d{6,8}", full_text)
    if phones:
        faq = _make_faq(
            "What is the contact phone number of Sri Venkateswara University?",
            f"The contact phone number(s) are: {', '.join(set(phones))}",
            url,
        )
        if faq:
            faqs.append(faq)

    # Emails
    emails = re.findall(r"[\w.+-]+@[\w.-]+\.[a-zA-Z]{2,}", full_text)
    edu_emails = [e for e in emails if "svu" in e.lower() or "registrar" in e.lower()]
    if edu_emails:
        faq = _make_faq(
            "What is the official email address of Sri Venkateswara University?",
            f"The official email address(es) are: {', '.join(set(edu_emails[:5]))}",
            url,
        )
        if faq:
            faqs.append(faq)

    # Address block
    if "517502" in full_text or "tirupati" in full_text.lower():
        addr_match = re.search(
            r"Sri Venkateswara University[^\.]{0,150}Tirupati[^\.]{0,80}",
            full_text, re.IGNORECASE
        )
        if addr_match:
            faq = _make_faq(
                "Where is Sri Venkateswara University located?",
                addr_match.group(0).strip(),
                url,
            )
            if faq:
                faqs.append(faq)

    return faqs


def _extract_elementor_blocks(soup: BeautifulSoup, url: str) -> list[dict]:
    """
    Strategy 10 (Elementor / WordPress page builder):
    SVU uses Elementor, so content lives inside deeply nested .elementor-*
    widget divs. This strategy:
    A) Collects all <p> paragraph text from the page body that is substantive
       (> 40 chars, not nav/menu noise) and synthesises one master FAQ per page.
    B) For each Elementor column, tries to find a heading+text widget pair.
    """
    faqs: list[dict] = []

    # Detect page title
    page_title = ""
    title_tag = soup.find("title")
    if title_tag:
        raw = _clean_text(title_tag.get_text())
        page_title = raw.split("\u2013")[0].split("|")[0].split("-")[0].strip()

    # -- Strategy A: Elementor heading+text widget column pairs --
    for col in soup.find_all(
        class_=lambda c: isinstance(c, list) and "elementor-column" in " ".join(c)
    ):
        heading = col.find(["h1", "h2", "h3", "h4"])
        if not heading:
            continue
        heading_text = _clean_text(heading.get_text())
        if not heading_text or _is_noise(heading_text) or len(heading_text) < 4:
            continue
        # Skip nav headings
        if heading_text.upper() in {"ABOUT", "CONTACT", "HOME", "MENU",
                                     "SEARCH", "GALLERY", "EVENTS", "ADMINISTRATION",
                                     "RESOURCES", "IMPORTANT LINKS", "ABOUT US"}:
            continue

        paras = col.find_all("p")
        answer_parts = []
        for p in paras:
            txt = _clean_text(p.get_text())
            if txt and len(txt) > 30 and not _is_noise(txt):
                answer_parts.append(txt)
            if len(answer_parts) >= 5:
                break

        if not answer_parts:
            # Also try lists inside this column
            for li in col.find_all("li"):
                txt = _clean_text(li.get_text())
                if txt and len(txt) > 10:
                    answer_parts.append(txt)
                if len(answer_parts) >= 10:
                    break

        if not answer_parts:
            continue

        answer = " ".join(answer_parts)
        question = _heading_to_question(heading_text, page_title)
        faq = _make_faq(question, answer, url)
        if faq:
            faqs.append(faq)

    # -- Strategy B: All body paragraphs consolidated as a page FAQ --
    # Collect ALL paragraphs > 40 chars that aren't obvious nav/link text
    all_paras: list[str] = []
    for p in soup.find_all("p"):
        txt = _clean_text(p.get_text())
        if not txt or len(txt) < 40:
            continue
        if _is_noise(txt):
            continue
        # Skip if the paragraph is mostly links (navigation text)
        links = p.find_all("a")
        link_text_len = sum(len(_clean_text(a.get_text())) for a in links)
        total_len = len(txt)
        if total_len > 0 and link_text_len / total_len > 0.7:
            continue
        all_paras.append(txt)

    if all_paras and page_title:
        combined = " ".join(all_paras[:6])  # first 6 substantive paragraphs
        if len(combined) > 80:
            question = f"What is {page_title}?"
            faq = _make_faq(question, combined, url)
            if faq:
                faqs.append(faq)

    return faqs


# ---------------------------------------------------------------------------
# Main extractor
# ---------------------------------------------------------------------------

def extract_faqs_from_url(url: str) -> list[dict[str, Any]]:
    """
    Main entry point.
    Fetches the URL and runs all extraction strategies.
    Returns a deduplicated list of FAQ dicts:
        {question, answer, category, source_url, keywords}
    """
    logger.info(f"[FAQ-EXTRACTOR] Starting extraction: {url}")
    html = _fetch_html(url)
    if not html:
        logger.warning(f"[FAQ-EXTRACTOR] No HTML retrieved from {url}")
        return []

    soup = BeautifulSoup(html, "html.parser")

    # Remove boilerplate noise tags (keep footer for contact info)
    for tag in soup.find_all(["script", "style", "nav",
                               "noscript", "iframe", "form"]):
        tag.decompose()

    strategies = [
        _extract_dt_dd,
        _extract_accordion,
        _extract_elementor_blocks,          # Strategy 10 — Elementor page builder (SVU)
        _extract_semantic_content_blocks,   # Strategy 8  — standard h2+p
        _extract_contact_info,              # Strategy 9  — phone/email/address
        _extract_heading_paragraph,
        _extract_bold_label_pairs,
        _extract_table_rows,
        _extract_list_items,
        _extract_question_sentences,
    ]

    seen_fps: set[str] = set()
    all_faqs: list[dict] = []

    for strategy in strategies:
        try:
            results = strategy(soup, url)
            for faq in results:
                fp = _fingerprint(faq["question"])
                if fp not in seen_fps:
                    seen_fps.add(fp)
                    all_faqs.append(faq)
        except Exception as exc:
            logger.error(f"[FAQ-EXTRACTOR] Strategy {strategy.__name__} failed: {exc}")

    logger.info(
        f"[FAQ-EXTRACTOR] Extracted {len(all_faqs)} unique FAQs from {url}"
    )
    return all_faqs


def extract_faqs_from_urls(urls: list[str], delay_seconds: float = 1.0) -> list[dict[str, Any]]:
    """
    Batch extraction across multiple URLs.
    Returns all FAQs with global deduplication (cross-URL).
    """
    seen_fps: set[str] = set()
    all_faqs: list[dict] = []

    for url in urls:
        try:
            faqs = extract_faqs_from_url(url)
            for faq in faqs:
                fp = _fingerprint(faq["question"])
                if fp not in seen_fps:
                    seen_fps.add(fp)
                    all_faqs.append(faq)
            if delay_seconds > 0:
                time.sleep(delay_seconds)
        except Exception as exc:
            logger.error(f"[FAQ-EXTRACTOR] Error processing {url}: {exc}")

    logger.info(
        f"[FAQ-EXTRACTOR] Batch complete. Total unique FAQs: {len(all_faqs)} from {len(urls)} URLs"
    )
    return all_faqs
