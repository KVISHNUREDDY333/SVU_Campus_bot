import pytest
from unittest.mock import patch, MagicMock
from app.utils.email_validator import is_valid_email, probe_google_email
import smtplib

def test_is_valid_email():
    # Valid Gmails
    assert is_valid_email("test@gmail.com") is True
    assert is_valid_email("john.doe@gmail.com") is True
    assert is_valid_email("user+tag@gmail.com") is True
    assert is_valid_email("a1.b2_c3-d4@gmail.com") is True
    
    # Invalid Domains
    assert is_valid_email("test@outlook.com") is False
    assert is_valid_email("test@yahoo.com") is False
    assert is_valid_email("test@svu.edu") is False
    
    # Invalid Local Parts
    assert is_valid_email("@gmail.com") is False
    assert is_valid_email("test!email@gmail.com") is False
    assert is_valid_email("test email@gmail.com") is False
    assert is_valid_email("test#email@gmail.com") is False
    
    # Case sensitivity & Whitespace
    assert is_valid_email("TEST@GMAIL.COM") is True
    assert is_valid_email(" test@gmail.com ") is True

@patch("smtplib.SMTP")
def test_probe_google_email_success(mock_smtp):
    instance = mock_smtp.return_value
    instance.connect.return_value = (220, b"Ready")
    instance.rcpt.return_value = (250, b"OK")
    
    verified, message = probe_google_email("real@gmail.com")
    assert verified is True
    assert message == "Google Identity Verified"

@patch("smtplib.SMTP")
def test_probe_google_email_failure(mock_smtp):
    instance = mock_smtp.return_value
    instance.connect.return_value = (220, b"Ready")
    instance.rcpt.return_value = (550, b"No such user")
    
    verified, message = probe_google_email("fake@gmail.com")
    assert verified is False
    assert "not a registered Google account" in message

@patch("smtplib.SMTP")
def test_probe_google_email_unreachable_fallback(mock_smtp):
    instance = mock_smtp.return_value
    instance.connect.side_effect = smtplib.SMTPConnectError(123, "Connection failed")
    
    verified, message = probe_google_email("maybe@gmail.com")
    assert verified is None
    assert "offline MX unreachable" in message
