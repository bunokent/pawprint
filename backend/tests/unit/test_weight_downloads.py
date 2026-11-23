"""Guard tests: vision weights download DIRECTLY (no Hugging Face token anywhere),
and the Docker stack runs the API server, Celery and the Vite dev server."""

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]  # backend/tests/unit -> repo root


def test_download_script_uses_direct_urls_with_pinned_checksums():
    script = (ROOT / "backend/scripts/download_weights.sh").read_text()
    # YOLO-World from the ultralytics GitHub release assets — not huggingface.co
    assert "github.com/ultralytics/assets/releases/download" in script
    assert "yolov8s-worldv2.pt" in script
    # CLIP ViT-B/32 from OpenAI's public blob — not huggingface.co
    assert "openaipublic.blob.core.windows.net/clip/models" in script
    assert "ViT-B-32.pt" in script
    # checksums are pinned and verified
    assert "9b2c17ab6124a913e9b3a5c170617920d91b0f01111a8479da69f00e2cf27792" in script
    assert "40d365715913c9da98579312b702a82c18be219cc2a73407c4526f58eba950af" in script
    assert "sha256sum -c" in script


def test_download_script_never_references_hugging_face_or_tokens():
    script = (ROOT / "backend/scripts/download_weights.sh").read_text().lower()
    assert "huggingface" not in script
    assert "hf_token" not in script
    assert "hf_hub" not in script
    assert "hf download" not in script


def test_env_files_have_no_hf_token_and_force_offline_hf():
    # .env.example is committed; .env is gitignored and only exists on dev machines.
    env_files = [ROOT / ".env.example"]
    if (ROOT / ".env").exists():
        env_files.append(ROOT / ".env")
    for path in env_files:
        text = path.read_text()
        assert not re.search(r"(?im)^\s*HF_TOKEN\s*=", text), f"{path.name} must not define HF_TOKEN"
        assert "huggingface.co" not in text.lower(), f"{path.name} must not reference huggingface.co"
        assert "hf_hub_download" not in text.lower()
    # .env pins HF offline mode so no library can phone home with a token
    if (ROOT / ".env").exists():
        assert re.search(r"(?im)^HF_HUB_OFFLINE=1$", (ROOT / ".env").read_text())


def test_docker_compose_runs_web_celery_and_frontend():
    compose = (ROOT / "docker-compose.yml").read_text()
    for service in ("postgres", "redis", "web", "celery", "frontend"):
        assert re.search(rf"(?m)^  {service}:$", compose), f"service {service} missing"
    # python run server
    assert "runserver 0.0.0.0:8000" in compose
    # celery worker on the routed queues
    assert re.search(r"celery -A config worker -Q flyers,webhooks,images,default", compose)
    # npm run dev (Vite) for the frontend service
    frontend_dockerfile = (ROOT / "frontend/Dockerfile").read_text()
    assert '"npm", "run", "dev"' in frontend_dockerfile
    assert "--host" in frontend_dockerfile and "0.0.0.0" in frontend_dockerfile


def test_ci_pins_uv_install_to_backend_venv_and_downloads_weights_directly():
    ci = (ROOT / ".github/workflows/ci.yml").read_text()
    # Runners preset VIRTUAL_ENV to a root .venv — without --python, uv pip install
    # lands there and backend/.venv/bin/{ruff,pytest,python} stay missing (exit 127).
    assert ci.count("uv pip install --python .venv/bin/python") >= 3
    # E2E downloads the vision weights directly (no HF token) before caching them.
    assert "download_weights.sh" in ci
    assert 'HF_HUB_OFFLINE: "1"' in ci


def test_playwright_is_a_declared_runtime_dep_and_ci_installs_its_browser():
    # apps.flyers.tasks.render_flyer_png imports playwright at runtime (celery PNG export);
    # E2E failed with "No module named 'playwright'" when it was missing from pyproject.
    pyproject = (ROOT / "backend/pyproject.toml").read_text()
    assert '"playwright>=' in pyproject
    ci = (ROOT / ".github/workflows/ci.yml").read_text()
    assert "python -m playwright install --with-deps chromium" in ci


def test_backend_dockerfile_bakes_weights_directly_and_disables_hf():
    dockerfile = (ROOT / "backend/Dockerfile").read_text()
    assert "download_weights.sh" in dockerfile  # baked at build time, direct download
    assert "HF_HUB_OFFLINE=1" in dockerfile  # hard guarantee: no HF token usage at runtime
    assert "TRANSFORMERS_OFFLINE=1" in dockerfile
    # celery renders A4 PNGs via python-playwright inside the container
    assert "playwright install" in dockerfile
    lowered = dockerfile.lower()
    assert "hf_token" not in lowered
