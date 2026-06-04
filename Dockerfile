# ============================================
# SVU Campus Bot - Single Container Deployment
# ============================================
FROM python:3.12-slim

WORKDIR /app

# Install build dependencies
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc build-essential pkg-config \
        libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python dependencies
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# Copy the entire project
COPY backend/ ./backend/
COPY frontend/ ./frontend/

# Expose the application port
EXPOSE 8000

# Create non-root user for security
RUN adduser --uid 1001 --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app
USER appuser

# Start FastAPI via uvicorn
CMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]
