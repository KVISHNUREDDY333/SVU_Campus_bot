# Use official Python runtime as a parent image
FROM python:3.10-slim

# Set working directory
WORKDIR /app

# Install system dependencies if needed (e.g. for building chroma)
RUN apt-get update && apt-get install -y build-essential && rm -rf /var/lib/apt/lists/*

# Copy requirements
COPY requirements.txt .

# Install python dependencies
RUN pip install --no-cache-dir -r requirements.txt

# Copy the rest of the application
COPY . .

# Build the vector database
# This assumes svu_dataset.json is in backend/ and build_vector_db.py works relative to CWD /app
RUN python backend/build_vector_db.py

# Expose port
EXPOSE 8000

# Run the FastAPI app
CMD ["uvicorn", "backend.main_fastapi:app", "--host", "0.0.0.0", "--port", "8000"]
