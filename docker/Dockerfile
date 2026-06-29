# ============================================
# SVU Campus Bot — Single Container Deployment
# ============================================
# Build context must be the project root (.)
# Usage:  docker build -f docker/Dockerfile -t svu-campus-bot .
# ============================================

FROM python:3.12-slim

WORKDIR /app

# ---- System dependencies ----
# cairo/pango for xhtml2pdf, pkg-config for pycairo build
RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        gcc build-essential pkg-config \
        libcairo2-dev libpango1.0-dev libgdk-pixbuf-2.0-dev libffi-dev && \
    rm -rf /var/lib/apt/lists/*

# ---- Python dependencies ----
# Install CPU-only PyTorch first to avoid downloading ~2GB of CUDA/Triton GPU libs
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# ---- Application source ----
COPY backend/  ./backend/
COPY frontend/ ./frontend/

# ---- Uploads directory ----
RUN mkdir -p /app/backend/uploads /app/uploads

# ---- Security: non-root user ----
# ---- Default port (overridable via env) ----
ENV PORT=8888
EXPOSE 8888
RUN adduser --uid 1001 --disabled-password --gecos "" appuser && \
    chown -R appuser:appuser /app
USER appuser

# ---- Entry point ----
CMD uvicorn backend.main:app --host 0.0.0.0 --port $PORT
