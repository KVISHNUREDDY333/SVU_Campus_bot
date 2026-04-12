import pytest
from unittest.mock import patch, MagicMock
from app.utils.email_validator import is_valid_email, probe_email_authenticity
import smtplib

def test_is_valid_email():
    # Valid Providers
    assert is_valid_email("test@gmail.com") is True
    assert is_valid_email("test@outlook.com") is True
    assert is_valid_email("test@yahoo.com") is True
    assert is_valid_email("test@zoho.com") is True
    assert is_valid_email("john.doe@gmail.com") is True
    assert is_valid_email("user+tag@outlook.com") is True
    
    # Invalid Domains
    assert is_valid_email("test@svu.edu") is False
    assert is_valid_email("test@company.co") is False
    
    # Invalid Local Parts
    assert is_valid_email("@gmail.com") is False
    assert is_valid_email("test!email@gmail.com") is False
    assert is_valid_email("test email@yahoo.com") is False
    
    # Case sensitivity & Whitespace
    assert is_valid_email("TEST@OUTLOOK.COM") is True
    assert is_valid_email(" test@yahoo.com ") is True

@patch("smtplib.SMTP")
def test_probe_email_authenticity_success(mock_smtp):
    instance = mock_smtp.return_value
    instance.connect.return_value = (220, b"Ready")
    instance.rcpt.return_value = (250, b"OK")
    
    verified, message = probe_email_authenticity("real@gmail.com")
    assert verified is True
    assert "Identity Verified" in message

@patch("smtplib.SMTP")
def test_probe_email_authenticity_failure(mock_smtp):
    instance = mock_smtp.return_value
    instance.connect.return_value = (220, b"Ready")
    instance.rcpt.return_value = (550, b"No such user")
    
    verified, message = probe_email_authenticity("fake@outlook.com")
    assert verified is False
    assert "does not seem to exist" in message

@patch("smtplib.SMTP")
def test_probe_email_authenticity_unreachable_fallback(mock_smtp):
    instance = mock_smtp.return_value
    instance.connect.side_effect = smtplib.SMTPConnectError(123, "Connection failed")
    
    verified, message = probe_email_authenticity("maybe@yahoo.com")
    assert verified is None
    assert "Identity format verified" in message
