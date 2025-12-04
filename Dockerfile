# Dockerfile (multi-stage)
FROM python:3.11-slim AS build
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1

# Install build deps
RUN apt-get update && apt-get install -y build-essential ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy backend and install
COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install --upgrade pip
RUN pip install -r /app/backend/requirements.txt

# Copy full project
COPY . /app

# Final image
FROM python:3.11-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PORT=8080

# Runtime deps
RUN apt-get update && apt-get install -y ffmpeg && rm -rf /var/lib/apt/lists/*

# Copy installed packages from build stage (optional) and app files
COPY --from=build /usr/local/lib/python3.11/site-packages /usr/local/lib/python3.11/site-packages
COPY --from=build /app /app

WORKDIR /app/backend
EXPOSE 8080

# Ensure sw.js is served at root by copying it to backend static root if needed
# (If you serve frontend via Flask static, ensure path is correct)

CMD ["gunicorn", "app:app", "--bind", "0.0.0.0:8080", "--workers", "2", "--timeout", "120"]
