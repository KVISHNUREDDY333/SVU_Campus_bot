import os
from fastapi import HTTPException, UploadFile

MAX_FILE_SIZE = 15 * 1024 * 1024  # 15 MB limit

async def save_and_validate_file(file: UploadFile, target_path: str, allowed_extensions=None):
    """
    Saves an uploaded file to the target path chunk by chunk,
    validating the file size and extension to secure the backend.
    Cleans up any partially written file on error.
    """
    if allowed_extensions is None:
        allowed_extensions = ['.pdf']
        
    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file format. Allowed: {', '.join(allowed_extensions)}"
        )

    size = 0
    try:
        # Seek to start
        await file.seek(0)
        with open(target_path, "wb") as buffer:
            while True:
                chunk = await file.read(1024 * 64)  # Read in 64KB chunks
                if not chunk:
                    break
                size += len(chunk)
                if size > MAX_FILE_SIZE:
                    raise HTTPException(
                        status_code=413,
                        detail=f"File size exceeds the maximum limit of {MAX_FILE_SIZE // (1024 * 1024)} MB."
                    )
                buffer.write(chunk)
    except Exception as e:
        # Clean up partial file on failure
        if os.path.exists(target_path):
            try:
                os.remove(target_path)
            except Exception:
                pass
        if isinstance(e, HTTPException):
            raise e
        raise HTTPException(status_code=500, detail=f"File saving error: {str(e)}")

    if size == 0:
        if os.path.exists(target_path):
            try:
                os.remove(target_path)
            except Exception:
                pass
        raise HTTPException(status_code=400, detail="Uploaded file is empty.")
