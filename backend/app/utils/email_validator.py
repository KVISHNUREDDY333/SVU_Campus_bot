import re
import smtplib
import socket
import logging
from typing import Tuple, Optional
import os

logger = logging.getLogger(__name__)

GOOGLE_CLIENT_ID = os.getenv("GOOGLE_CLIENT_ID")

def is_valid_email(email: str) -> bool:
    """
    Validates if the email is a real Gmail account with a specific format.
    - Ends with @gmail.com
    - Local part allows letters, digits, '.', '+', '-', '_'
    """
    if not email:
        return False
    
    email = email.lower().strip()
    if not email.endswith("@gmail.com"):
        return False
        
    # Regex for local part as per requirements: letters, digits, . _ + -
    # Local part must exist before @
    regex = r'^[a-z0-9+._-]+@gmail\.com$'
    return re.match(regex, email) is not None

def verify_google_token(token: str) -> Optional[dict]:
    """
    Verifies a Google ID token and returns the decoded info.
    """
    if not GOOGLE_CLIENT_ID:
        logger.error("GOOGLE_CLIENT_ID not configured in environment")
        return None
        
    try:
        from google.oauth2 import id_token
        from google.auth.transport import requests as google_requests
    except ImportError:
        logger.error("google-auth package not installed. Run: pip install google-auth")
        return None
        
    try:
        id_info = id_token.verify_oauth2_token(
            token, 
            google_requests.Request(), 
            GOOGLE_CLIENT_ID
        )
        return id_info
    except ValueError as e:
        logger.warning(f"Google Token Verification Failed: {str(e)}")
        return None
    except Exception as e:
        logger.error(f"Unexpected error in verify_google_token: {str(e)}")
        return None

def probe_google_email(email: str, timeout: int = 5) -> Tuple[Optional[bool], str]:
    """
    Attempts a minimal SMTP handshake against Google MX to verify email existence.
    Returns (Success, Message)
    Success can be:
    - True: 250 response (verified)
    - False: Non-250 response (fake/inactive)
    - None: Connection error (fallback to format verified)
    """
    try:
        # Standard Google MX for Gmail
        mx_host = "gmail-smtp-in.l.google.com"
        
        server = smtplib.SMTP(timeout=timeout)
        server.connect(mx_host)
        server.helo()
        # MAIL FROM can be a dummy or configured sender
        mail_from = os.getenv("MAIL_USER", "verify@svu-campus-bot.com")
        server.mail(mail_from)
        
        code, _ = server.rcpt(email)
        server.quit()
        
        if code == 250:
            return True, "Google Identity Verified"
        else:
            return False, "This email is not a registered Google account. Please use a valid, active Gmail."
            
    except (smtplib.SMTPConnectError, socket.error, socket.timeout) as e:
        logger.warning(f"Google MX unreachable for {email}: {str(e)}")
        return None, "Identity format verified (offline MX unreachable)"
    except Exception as e:
        logger.error(f"Unexpected error in probe_google_email: {str(e)}")
        return False, f"Verification service error: {str(e)}"
