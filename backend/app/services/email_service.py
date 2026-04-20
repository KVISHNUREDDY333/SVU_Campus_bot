import logging
import smtplib
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

from ..core.config import Config

logger = logging.getLogger("uvicorn")

def send_otp_email(to_email: str, otp: str):
    if not Config.EMAIL_ADDRESS or not Config.EMAIL_PASSWORD:
        logger.warning(f"Email credentials not set. DEV MODE OTP: {otp}")
        return True                                               

    try:
        msg = MIMEMultipart()
        msg["From"] = Config.EMAIL_ADDRESS
        msg["To"] = to_email
        msg["Subject"] = "Your OTP for SVU CampusConnect Password Reset"

        body = f"Your OTP is: {otp}\n\nThis OTP is valid for 10 minutes."
        msg.attach(MIMEText(body, "plain"))

        server = smtplib.SMTP("smtp.gmail.com", 587)
        server.starttls()
        server.login(Config.EMAIL_ADDRESS, Config.EMAIL_PASSWORD)
        text = msg.as_string()
        server.sendmail(Config.EMAIL_ADDRESS, to_email, text)
        server.quit()
        logger.info(f"OTP sent to {to_email}")
        return True
    except Exception as e:
        logger.error(f"Failed to send email: {e}")
        return False
