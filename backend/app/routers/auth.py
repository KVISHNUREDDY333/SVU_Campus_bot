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
from ..models.user import User, Token, RegisterRequest, ForgotPasswordRequest, VerifyOTPRequest, VerifyOnlyOTPRequest, ProfileUpdateRequest
from ..services.email_service import send_otp_email
from jose import JWTError, jwt
from ..services.logging_service import log_event
from email_validator import validate_email, EmailNotValidError
from ..utils.email_validator import is_valid_email, verify_google_token, probe_google_email
import secrets

router = APIRouter()
logger = logging.getLogger("uvicorn")
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

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
    log_event("INFO", f"User login: {user['username']}")
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "role": user['role'], 
        "username": user['username'], 
        "full_name": user.get('full_name'),
        "first_name": user.get('first_name'),
        "last_name": user.get('last_name')
    }

@router.post("/register", response_model=Token)
async def register_user(user_data: RegisterRequest):
    if not is_valid_email(user_data.email):
        logger.warning(f"Registration blocked for non-Gmail address: {user_data.email}")
        raise HTTPException(
            status_code=400, 
            detail="Only verified Google accounts (@gmail.com) are accepted for registration."
        )

    try:
        # SMTP / DNS Authenticity Check
        verified, msg = probe_google_email(user_data.email)
        if verified is False:
             raise HTTPException(status_code=400, detail=msg)

        if database.users_db.find_one({"username": user_data.email}):
            raise HTTPException(status_code=400, detail="Email already registered")

        hashed_password = get_password_hash(user_data.password)
        full_name = f"{user_data.first_name} {user_data.last_name}".strip()
        user_dict = {
            "username": user_data.email,
            "password_hash": hashed_password,
            "first_name": user_data.first_name,
            "last_name": user_data.last_name,
            "full_name": full_name,
            "role": "student", 
            "created_at": datetime.utcnow()
        }
        database.users_db.insert_one(user_dict)
        log_event("SUCCESS", f"New user registered: {user_data.email}")
        
        access_token = create_access_token(data={"sub": user_data.email, "role": "student"})
        return {
            "access_token": access_token, 
            "token_type": "bearer", 
            "role": "student", 
            "username": user_data.email, 
            "full_name": full_name,
            "first_name": user_data.first_name,
            "last_name": user_data.last_name
        }
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
        raise HTTPException(status_code=404, detail="please enter registered email")
    
    otp = "{:06d}".format(random.randint(0, 999999))
    database.otps_db.update_one(
        {"email": request.email},
        {"$set": {"otp": otp, "created_at": datetime.utcnow()}},
        upsert=True
    )
    
    send_otp_email(request.email, otp)
    
    return {"status": "success", "message": "OTP sent to email"}

@router.post("/verify-otp-reset")
async def verify_otp_reset(request: VerifyOTPRequest):
    input_otp = request.otp.strip()
    input_email = request.email.strip()
    
    logger.info(f"Verifying OTP for {input_email}. Input: {input_otp}")
    
    record = database.otps_db.find_one({"email": input_email})
    if not record:
        logger.warning(f"No OTP record found for {input_email}")
        raise HTTPException(status_code=400, detail="Invalid request")
    
    if (datetime.utcnow() - record["created_at"]).total_seconds() > 600:
         logger.warning(f"OTP expired for {input_email}")
         raise HTTPException(status_code=400, detail="OTP expired")
         
    if str(record["otp"]).strip() != input_otp:
        logger.warning(f"Invalid OTP for {input_email}. Expected: {record['otp']}, Got: {input_otp}")
        raise HTTPException(status_code=400, detail="Invalid OTP")
        
    new_hash = get_password_hash(request.new_password[:72])
    database.users_db.update_one({"username": request.email}, {"$set": {"password_hash": new_hash}})
    database.otps_db.delete_one({"email": request.email})
    
    return {"status": "success", "message": "Password updated"}
    
@router.post("/verify-otp")
async def verify_otp_only(request: VerifyOnlyOTPRequest):
    input_otp = request.otp.strip()
    input_email = request.email.strip()
    
    record = database.otps_db.find_one({"email": input_email})
    if not record:
        raise HTTPException(status_code=400, detail="Invalid request")
    
    if (datetime.utcnow() - record["created_at"]).total_seconds() > 600:
         raise HTTPException(status_code=400, detail="OTP expired")
         
    if str(record["otp"]).strip() != input_otp:
        raise HTTPException(status_code=400, detail="Invalid OTP")
        
    return {"status": "success", "message": "OTP verified"}

@router.post("/auth/verify-google-email")
async def verify_google_email_endpoint(request: ForgotPasswordRequest):
    email = request.email.strip()
    if not is_valid_email(email):
        raise HTTPException(
            status_code=400, 
            detail="Only verified Google accounts (@gmail.com) are accepted."
        )
    
    verified, message = probe_google_email(email)
    if verified is False:
        raise HTTPException(status_code=400, detail=message)
        
    return {"verified": True, "message": message}

@router.post("/auth/google-id-token")
async def google_id_token_login(request: Request):
    """
    Direct Google ID token verification and auto-registration flow.
    """
    body = await request.json()
    id_token = body.get("id_token")
    if not id_token:
        raise HTTPException(status_code=400, detail="Missing Google ID token")
        
    id_info = verify_google_token(id_token)
    if not id_info:
        raise HTTPException(status_code=400, detail="Invalid Google Token")
        
    email = id_info.get("email")
    name = id_info.get("name")
    
    if not email or not is_valid_email(email):
        raise HTTPException(status_code=400, detail="Only Gmail accounts are allowed")
        
    db_user = database.users_db.find_one({"username": email})
    if not db_user:
        # Auto-create with random secure password
        random_pass = secrets.token_urlsafe(16)
        hashed_password = get_password_hash(random_pass)
        new_user = {
            "username": email,
            "password_hash": hashed_password,
            "full_name": name,
            "role": "student",
            "auth_provider": "google",
            "created_at": datetime.utcnow(),
            "last_login": datetime.utcnow()
        }
        database.users_db.insert_one(new_user)
        role = "student"
    else:
        role = db_user.get("role", "student")
        database.users_db.update_one({"username": email}, {"$set": {"last_login": datetime.utcnow()}})
        
    access_token = create_access_token(data={"sub": email, "role": role})
    return {
        "access_token": access_token, 
        "token_type": "bearer", 
        "role": role, 
        "username": email, 
        "full_name": name
    }

# Keeping legacy /verify-email-authenticity for compatibility but aliasing to the new logic
@router.post("/verify-email-authenticity")
async def verify_email_authenticity_legacy(request: ForgotPasswordRequest):
    return await verify_google_email_endpoint(request)

@router.get("/login/google")
async def login_google(request: Request):
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
        if not email or not is_valid_email(email):
             raise HTTPException(status_code=400, detail="Only verified Google accounts (@gmail.com) are accepted.")

        name = user.get("name")
        
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
        
        params = f"token={access_token}&role={role}&username={email}"
        if name:
             params += f"&name={name}"
             
        return RedirectResponse(url=f"/?{params}")
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.error(f"Google Auth Error: {e}")
        return RedirectResponse(url="/?error=GoogleAuthFailed")

@router.put("/update-profile")
async def update_profile(request: ProfileUpdateRequest, current_user: User = Depends(get_current_user)):
    try:
        full_name = f"{request.first_name} {request.last_name}".strip()
        result = database.users_db.update_one(
            {"username": current_user.username},
            {"$set": {
                "first_name": request.first_name,
                "last_name": request.last_name,
                "full_name": full_name
            }}
        )
        
        log_event("SUCCESS", f"Profile updated for user: {current_user.username}")
        return {
            "status": "success", 
            "message": "Profile updated successfully", 
            "full_name": full_name,
            "first_name": request.first_name,
            "last_name": request.last_name
        }
    except Exception as e:
        logger.error(f"Profile Update Error: {e}")
        raise HTTPException(status_code=500, detail=str(e))
