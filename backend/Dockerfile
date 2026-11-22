# PawPrint backend image — Django API + Celery worker.
# Build context is the REPO ROOT (docker-compose.yml sets `context: .`).
#
# Vision weights are baked in by scripts/download_weights.sh, which downloads
# YOLO-World + CLIP DIRECTLY from GitHub/OpenAI — no Hugging Face token.
# HF_HUB_OFFLINE=1 / TRANSFORMERS_OFFLINE=1 make that a hard runtime guarantee.
FROM python:3.12-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    HF_HUB_OFFLINE=1 \
    TRANSFORMERS_OFFLINE=1 \
    YOLO_CONFIG_DIR=/tmp/ultralytics \
    YOLO_WEIGHTS_DIR=/app/weights

# curl (weight download), libgl/libglib (OpenCV), pango (WeasyPrint A4 exports)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates \
        libgl1 libglib2.0-0 \
        libpango-1.0-0 libpangoft2-1.0-0 libharfbuzz0b libfontconfig1 \
    && rm -rf /var/lib/apt/lists/*

RUN pip install --no-cache-dir uv

WORKDIR /app

# Dependency layer (cached): install the backend package with CPU-only torch
# via pyproject's [tool.uv.sources] pytorch-cpu index.
COPY backend/pyproject.toml backend/pyproject.toml
COPY backend/apps backend/apps
COPY backend/config backend/config
COPY backend/manage.py backend/manage.py
COPY backend/templates backend/templates
RUN uv pip install --system ./backend

# Bake the vision weights (direct download, sha256-verified, no HF token).
COPY backend/scripts/download_weights.sh backend/scripts/download_weights.sh
RUN sh backend/scripts/download_weights.sh \
    && rm -rf /tmp/ultralytics

# Application code.
COPY backend/ backend/

RUN chmod +x backend/docker-entrypoint.sh

WORKDIR /app/backend
EXPOSE 8000

# Waits for PostgreSQL, runs migrations, then execs the compose command
# (`python manage.py runserver ...` for web, `celery -A config worker ...` for celery).
ENTRYPOINT ["sh", "/app/backend/docker-entrypoint.sh"]
