# VisionTrack Production Container Dockerfile
FROM python:3.10-slim

# Install system dependencies for OpenCV, Dlib & MTCNN
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    cmake \
    libgl1 \
    libglib2.0-0 \
    libsm6 \
    libxext6 \
    libxrender-dev \
    curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Copy requirements and install
COPY requirements.txt .
RUN pip install --no-cache-dir --upgrade pip && \
    pip install --no-cache-dir -r requirements.txt

# Copy source files
COPY . .

# Set default Render / Cloud Container port
ENV PORT=10000
EXPOSE 10000
ENV PYTHONUNBUFFERED=1
ENV TF_CPP_MIN_LOG_LEVEL=3

# Run FastAPI backend with uvicorn binding to dynamic PORT
CMD ["sh", "-c", "uvicorn fastapi_app:app --host 0.0.0.0 --port ${PORT:-10000}"]
