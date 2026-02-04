from fastapi import APIRouter, HTTPException, Depends, status, Request
from fastapi.responses import RedirectResponse
from fastapi.security import OAuth2PasswordBearer, OAuth2PasswordRequestForm
from datetime import timedelta, datetime
import random
import logging
from bson.objectid import ObjectId
from authlib.integrations.starlette_client import OAuth

from ..core.security import verify_password, get_password_hash, create_access_token
from ..core.config import Config
from ..core import database
from ..models.user import User, Token, RegisterRequest, ForgotPasswordRequest, VerifyOTPRequest
from ..services.email_service import send_otp_email
from jose import JWTError, jwt

router = APIRouter()
logger = logging.getLogger("uvicorn")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

# Google OAuth Setup
oauth = OAuth()
oauth.register(
    name='google',
    client_id=Config.GOOGLE_CLIENT_ID,
    client_secret=Config.GOOGLE_CLIENT_SECRET,
    server_metadata_url='https://accounts.google.com/.well-known/openid-configuration',
    client_kwargs={'scope': 'openid email profile'}
)

async def get_current_user(token: str = Depends(oauth2_scheme)):
    credentials_exception = HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )
    try:
        payload = jwt.decode(token, Config.SECRET_KEY, algorithms=[Config.ALGORITHM])
        username: str = payload.get("sub")
        role: str = payload.get("role")
        if username is None:
            raise credentials_exception
    except JWTError:
        raise credentials_exception
        
    user = database.users_db.find_one({"username": username})
    if user is None:
        raise credentials_exception
    return User(**user)

async def get_current_admin_user(current_user: User = Depends(get_current_user)):
    if current_user.role != "admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="The user doesn't have enough privileges"
        )
    return current_user

@router.post("/token", response_model=Token)
async def login_for_access_token(form_data: OAuth2PasswordRequestForm = Depends()):
    user = database.users_db.find_one({"username": form_data.username})
    
    # Truncate password to 72 bytes to prevent bcrypt errors/DoS
    pwd_check = form_data.password[:72]
    
    if not user:
         raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
        
    stored_hash = user.get('password_hash')
    if not stored_hash or not verify_password(pwd_check, stored_hash):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Incorrect username or password",
            headers={"WWW-Authenticate": "Bearer"},
        )
    access_token_expires = timedelta(minutes=Config.ACCESS_TOKEN_EXPIRE_MINUTES)
    access_token = create_access_token(
        data={"sub": user['username'], "role": user['role']}, expires_delta=access_token_expires
    )
    return {"access_token": access_token, "token_type": "bearer", "role": user['role'], "username": user['username']}

@router.post("/register", response_model=Token)
async def register_user(user_data: RegisterRequest):
    try:

        
        if database.users_db.find_one({"username": user_data.email}):
            raise HTTPException(status_code=400, detail="Email already registered")

        # Truncate to 70 bytes safely for bcrypt
        pwd_bytes = user_data.password.encode('utf-8')
        if len(pwd_bytes) > 70:
            truncated = pwd_bytes[:70].decode('utf-8', 'ignore')
        else:
            truncated = user_data.password
        hashed_password = get_password_hash(truncated)
        user_dict = {
            "username": user_data.email,
            "password_hash": hashed_password,
            "full_name": user_data.full_name,
            "role": user_data.role, 
            "created_at": datetime.utcnow()
        }
        database.users_db.insert_one(user_dict)
        
        access_token = create_access_token(data={"sub": user_data.email, "role": user_data.role})
        return {"access_token": access_token, "token_type": "bearer", "role": user_data.role, "username": user_data.email}
    except HTTPException:
        raise
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Registration Error: {e}")
        raise HTTPException(status_code=500, detail="Internal Server Error during registration")

@router.post("/forgot-password")
async def forgot_password(request: ForgotPasswordRequest):
    user = database.users_db.find_one({"username": request.email})
    if not user:
        # Don't reveal user existence
        return {"status": "success", "message": "If email exists, OTP sent."}
    
    otp = "{:06d}".format(random.randint(0, 999999))
    database.otps_db.update_one(
        {"email": request.email},
        {"$set": {"otp": otp, "created_at": datetime.utcnow()}},
        upsert=True
    )
    
    # Send Email
    send_otp_email(request.email, otp)
    
    return {"status": "success", "message": "OTP sent to email"}

@router.post("/verify-otp-reset")
async def verify_otp_reset(request: VerifyOTPRequest):
    # Normalize input
    input_otp = request.otp.strip()
    input_email = request.email.strip()
    
    logger.info(f"Verifying OTP for {input_email}. Input: {input_otp}")
    
    record = database.otps_db.find_one({"email": input_email})
    if not record:
        logger.warning(f"No OTP record found for {input_email}")
        raise HTTPException(status_code=400, detail="Invalid request")
    
    # Check expiry (10 mins)
    if (datetime.utcnow() - record["created_at"]).total_seconds() > 600:
         logger.warning(f"OTP expired for {input_email}")
         raise HTTPException(status_code=400, detail="OTP expired")
         
    if str(record["otp"]).strip() != input_otp:
        logger.warning(f"Invalid OTP for {input_email}. Expected: {record['otp']}, Got: {input_otp}")
        raise HTTPException(status_code=400, detail="Invalid OTP")
        
    # Reset Password
    new_hash = get_password_hash(request.new_password[:72])
    database.users_db.update_one({"username": request.email}, {"$set": {"password_hash": new_hash}})
    database.otps_db.delete_one({"email": request.email})
    
    return {"status": "success", "message": "Password updated"}

# Google Auth Endpoints
@router.get("/login/google")
async def login_google(request: Request):
    # Dynamic redirect URI based on the request URL
    redirect_uri = request.url_for('auth_google')
    logger.info(f"Initiating Google OAuth with redirect_uri: {redirect_uri}")
    return await oauth.google.authorize_redirect(request, redirect_uri)

@router.get("/auth/callback")
async def auth_google(request: Request):
    try:
        token = await oauth.google.authorize_access_token(request)
        user = token.get('userinfo')
        if not user:
            user = await oauth.google.userinfo(token=token)
        
        email = user.get("email")
        name = user.get("name")
        
        if not email:
            raise HTTPException(status_code=400, detail="Google authentication failed: No email provided")
        
        db_user = database.users_db.find_one({"username": email})
        if not db_user:
            new_user = {
                "username": email,
                "password_hash": "GOOGLE_OAUTH",
                "full_name": name,
                "role": "student",
                "created_at": datetime.utcnow()
            }
            database.users_db.insert_one(new_user)
            role = "student"
        else:
            role = db_user.get("role", "student")
            
        access_token = create_access_token(data={"sub": email, "role": role})
        
        # Redirect to frontend
        # Assuming frontend is at root. We pass token as query param to be picked up by JS
        params = f"token={access_token}&role={role}&username={email}"
        if name:
             params += f"&name={name}"
             
        return RedirectResponse(url=f"/?{params}")
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Google Auth Error: {e}")
        return RedirectResponse(url="/?error=GoogleAuthFailed")
