import logging
import os
import re
import smtplib
import socket
from typing import Optional, Tuple

try:
    import dns.resolver
except ImportError:
    dns = None

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")
ALLOWED_DOMAINS = [
    "gmail.com",
    "outlook.com",
    "hotmail.com",
    "yahoo.com",
    "zoho.com",
    "zoho.in",
]


def is_valid_email(email: str) -> bool:
    """
    Validates if the email is from an allowed provider and has a valid format.
    """
    if not email:
        return False

    email = email.lower().strip()
    domain = email.split("@")[-1] if "@" in email else None

    if domain not in ALLOWED_DOMAINS:
        return False

    # Standard email regex: letters, digits, . _ + -
    regex = r"^[a-z0-9+._-]+@[a-z0-9.-]+\.[a-z]{2,}$"
    return re.match(regex, email) is not None


def verify_google_token(token: str) -> Optional[dict]:
    """
    Verifies a Google ID token and returns the decoded info.
    """
    if not GOOGLE_CLIENT_ID:
        logger.error("GOOGLE_CLIENT_ID not configured in environment")
        return None

    try:
        from google.auth.transport import requests as google_requests
        from google.oauth2 import id_token
    except ImportError:
        logger.error("google-auth package not installed. Run: pip install google-auth")
        return None

    try:
        id_info = id_token.verify_oauth2_token(
            token, google_requests.Request(), GOOGLE_CLIENT_ID
        )
        return id_info
    except ValueError as e:
        logger.warning(f"Google Token Verification Failed: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error in verify_google_token: {str(e)}")
        return None


def probe_email_authenticity(
    email: str, timeout: int = 5
) -> Tuple[Optional[bool], str]:
    """
    Attempts a minimal SMTP handshake against the domain's MX to verify email existence.
    Returns (Success, Message)
    """
    if not email or "@" not in email:
        return False, "Invalid email format"

    domain = email.split("@")[-1].lower()

    try:
        # 1. Get MX Record using dnspython
        if dns:
            try:
                records = dns.resolver.resolve(domain, "MX")
                mx_host = str(records[0].exchange).rstrip(".")
            except Exception as e:
                logger.warning(f"DNS MX lookup failed for {domain}: {e}")
                mx_host = domain  # Fallback
        else:
            # Hardcoded fallbacks for major providers if dns is missing
            fallbacks = {
                "gmail.com": "gmail-smtp-in.l.google.com",
                "outlook.com": "outlook-com.olc.protection.outlook.com",
                "hotmail.com": "hotmail-com.olc.protection.outlook.com",
                "yahoo.com": "mta5.am0.yahoodns.net",
                "zoho.com": "mx.zoho.com",
                "zoho.in": "mx.zoho.in",
            }
            mx_host = fallbacks.get(domain, domain)

        # 2. SMTP Handshake
        server = smtplib.SMTP(timeout=timeout)
        server.connect(mx_host)
        server.helo()

        mail_from = os.getenv("MAIL_USER", "verify@svu-campus-bot.com")
        server.mail(mail_from)

        code, _ = server.rcpt(email)
        server.quit()

        if code == 250:
            return True, f"Identity Verified ({domain.capitalize()})"
        elif code == 550:
            return (
                False,
                f"This email address does not seem to exist on {domain.capitalize()}.",
            )
        else:
            # Some servers give 4xx or other 5xx for various reasons (greylisting, etc.)
            # We treat ambiguous responses as "format verified" to avoid false negatives
            return None, f"Identity format verified (Server responded with code {code})"

    except (smtplib.SMTPConnectError, socket.error, socket.timeout, Exception) as e:
        logger.warning(f"MX unreachable or error for {email}: {str(e)}")
        return None, "Identity format verified (Service check skipped)"
