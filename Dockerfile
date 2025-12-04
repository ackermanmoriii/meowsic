# Dockerfile (place at repo root)
FROM python:3.11-slim AS build
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1

# Install system deps needed by yt-dlp and ffmpeg
RUN apt-get update && \
    apt-get install -y --no-install-recommends build-essential ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy and install Python deps
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip
RUN pip install -r /app/backend/requirements.txt

# Copy project files
COPY . /app

# Final image
FROM python:3.11-slim
WORKDIR /app

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PORT=8080

RUN apt-get update && \
    apt-get install -y --no-install-recommends ffmpeg && \
    rm -rf /var/lib/apt/lists/*

# Copy installed packages and app files from build stage
COPY --from=build /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build /app /app

# Ensure we run from backend where app.py lives
WORKDIR /app/backend

# Expose the port used by Gunicorn
EXPOSE 8080

# Use gunicorn to run the Flask app. Ensure backend/app.py defines `app`.
CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120"]
