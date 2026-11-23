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
    YOLO_WEIGHTS_DIR=/opt/weights

# curl (weight download), libgl/libglib (OpenCV), pango (WeasyPrint A4 exports)
RUN apt-get update && apt-get install -y --no-install-recommends \
        curl ca-certificates git \
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
# ultralytics' CLIP text encoder imports the `clip` package from GitHub at runtime
# (its check_requirements would pip-install it on first use) — bake it in instead.
# Direct git URL: no Hugging Face involved.
RUN uv pip install --system "git+https://github.com/ultralytics/CLIP.git"
# Chromium for the A4@300dpi PNG flyer export (celery generate_flyer_assets ->
# apps.flyers.tasks.render_flyer_png imports playwright at runtime).
RUN python -m playwright install --with-deps chromium

# Bake the vision weights (direct download, sha256-verified, no HF token) into
# /opt/weights so the ./backend live-reload bind mount never shadows them.
COPY backend/scripts/download_weights.sh backend/scripts/download_weights.sh
RUN sh backend/scripts/download_weights.sh \
    && mkdir -p /opt/weights/clip \
    && mv backend/yolov8s-worldv2.pt /opt/weights/ \
    && mv weights/clip/ViT-B-32.pt /opt/weights/clip/ \
    && rm -rf /tmp/ultralytics /app/weights

# Application code.
COPY backend/ backend/

RUN chmod +x backend/docker-entrypoint.sh

WORKDIR /app/backend
EXPOSE 8000

# Waits for PostgreSQL, runs migrations, then execs the compose command
# (`python manage.py runserver ...` for web, `celery -A config worker ...` for celery).
ENTRYPOINT ["sh", "/app/backend/docker-entrypoint.sh"]
