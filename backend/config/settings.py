"""PawPrint Django settings.

Environment-driven with dev defaults. When running under pytest (or with
PAWPRINT_TESTING=1, e.g. for Playwright E2E) the settings switch to
in-memory channel layer, eager Celery, local filesystem storage and locmem cache so the
suite never needs Redis/Cloudinary.
"""

import os
import sys
from pathlib import Path

try:
    from dotenv import load_dotenv
except ImportError:  # pragma: no cover — python-dotenv not installed
    load_dotenv = None  # type: ignore[assignment]

BASE_DIR = Path(__file__).resolve().parent.parent

# Host-side convenience: `python manage.py ...` picks up the root .env automatically.
# Real environment variables always win — load_dotenv never overrides existing vars.
if load_dotenv is not None:
    load_dotenv(BASE_DIR.parent / ".env")

TESTING = "pytest" in sys.modules or os.environ.get("PAWPRINT_TESTING") == "1"

SECRET_KEY = os.environ.get("DJANGO_SECRET_KEY", "dev-insecure-secret-key-change-me")
DEBUG = os.environ.get("DJANGO_DEBUG", "1" if not TESTING else "0") == "1"

ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "*").split(",")

# ---------------------------------------------------------------------------
# Apps — NOTE: django.contrib.admin is intentionally NOT installed (no admin UI).
# ---------------------------------------------------------------------------
INSTALLED_APPS = [
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    # needed for SearchVectorField / GinIndex / SearchQuery on pets.Pet + flyers
    "django.contrib.postgres",
    # allauth (email + Google/Gmail OAuth 2.0)
    "allauth",
    "allauth.account",
    "allauth.socialaccount",
    "allauth.socialaccount.providers.google",
    # third-party
    "rest_framework",
    "drf_spectacular",
    "corsheaders",
    "channels",
    # local apps
    "apps.common",
    "apps.users",
    "apps.pets",
    "apps.flyers",
    "apps.rewards",
    "apps.webhooks",
    "apps.vision",
    "apps.notifications",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "allauth.account.middleware.AccountMiddleware",
]

ROOT_URLCONF = "config.urls"
WSGI_APPLICATION = "config.wsgi.application"
ASGI_APPLICATION = "config.asgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ]
        },
    }
]

# ---------------------------------------------------------------------------
# Database — local PostgreSQL cluster (127.0.0.1:5433 by default, see .env.example)
# ---------------------------------------------------------------------------
DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "pawprint"),
        "USER": os.environ.get("POSTGRES_USER", "kent"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", ""),
        "HOST": os.environ.get("POSTGRES_HOST", "127.0.0.1"),
        "PORT": os.environ.get("POSTGRES_PORT", "5433"),
    }
}

AUTH_USER_MODEL = "users.User"

AUTHENTICATION_BACKENDS = [
    "django.contrib.auth.backends.ModelBackend",
    "allauth.account.auth_backends.AuthenticationBackend",
]

# ---------------------------------------------------------------------------
# Auth / allauth (email + Google OAuth 2.0, headless API)
# ---------------------------------------------------------------------------
ACCOUNT_LOGIN_METHODS = {"email"}
ACCOUNT_SIGNUP_FIELDS = ["email*", "password1*", "password2*"]
ACCOUNT_EMAIL_VERIFICATION = "none"
ACCOUNT_UNIQUE_EMAIL = True
ACCOUNT_USER_MODEL_USERNAME_FIELD = None
SOCIALACCOUNT_AUTO_SIGNUP = True
SOCIALACCOUNT_EMAIL_VERIFICATION = "none"
SOCIALACCOUNT_PROVIDERS = {
    "google": {
        "APP": {
            "client_id": os.environ.get("GOOGLE_CLIENT_ID", "dev-google-client-id"),
            "secret": os.environ.get("GOOGLE_CLIENT_SECRET", "dev-google-client-secret"),
        },
        "SCOPE": ["openid", "email", "profile"],
        "AUTH_PARAMS": {"access_type": "offline", "prompt": "consent"},
    }
}

# ---------------------------------------------------------------------------
# DRF + OpenAPI
# ---------------------------------------------------------------------------
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "apps.common.authentication.SessionAuthenticationWith401",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.AllowAny",
    ],
    "DEFAULT_SCHEMA_CLASS": "drf_spectacular.openapi.AutoSchema",
    "DEFAULT_PAGINATION_CLASS": "apps.common.pagination.StandardCursorPagination",
    "EXCEPTION_HANDLER": "apps.common.exceptions.exception_handler",
    "DEFAULT_THROTTLE_RATES": {
        "auth_write": "20/min",
        "upload": "10/min",
    },
}

SPECTACULAR_SETTINGS = {
    "TITLE": "PawPrint API",
    "DESCRIPTION": "Dual-mode lost-pet alert + adoption flyer generator",
    "VERSION": "0.1.0",
    "SERVE_INCLUDE_SCHEMA": False,
}

# ---------------------------------------------------------------------------
# CORS / CSRF
# ---------------------------------------------------------------------------
CORS_ALLOWED_ORIGINS = os.environ.get(
    "CORS_ALLOWED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
CORS_ALLOW_CREDENTIALS = True
CSRF_TRUSTED_ORIGINS = os.environ.get(
    "CSRF_TRUSTED_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
).split(",")
SESSION_COOKIE_HTTPONLY = True
SESSION_COOKIE_SAMESITE = "Lax"
CSRF_COOKIE_SAMESITE = "Lax"

# ---------------------------------------------------------------------------
# Cache / channels / celery
# ---------------------------------------------------------------------------
REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")
# In-memory cache only — no Redis caching (project is small, single-instance).
CACHES = {"default": {"BACKEND": "django.core.cache.backends.locmem.LocMemCache"}}
if TESTING:
    channel_layers: dict = {"default": {"BACKEND": "channels.layers.InMemoryChannelLayer"}}
    CELERY_TASK_ALWAYS_EAGER = True
    CELERY_TASK_EAGER_PROPAGATES = False
    CELERY_BROKER_URL = "memory://"
    CELERY_RESULT_BACKEND = "cache+memory://"
else:
    channel_layers = {
        "default": {
            "BACKEND": "channels_redis.core.RedisChannelLayer",
            "CONFIG": {"hosts": [REDIS_URL]},
        }
    }
    CELERY_BROKER_URL = REDIS_URL
    CELERY_RESULT_BACKEND = REDIS_URL
CHANNEL_LAYERS = channel_layers

CELERY_TASK_ROUTES = {
    "apps.flyers.tasks.*": {"queue": "flyers"},
    "apps.webhooks.tasks.*": {"queue": "webhooks"},
    "apps.vision.tasks.*": {"queue": "images"},
    "apps.pets.tasks.*": {"queue": "images"},
    "apps.rewards.tasks.*": {"queue": "webhooks"},
}
CELERY_TASK_DEFAULT_QUEUE = "default"

# ---------------------------------------------------------------------------
# Storage — Cloudinary private delivery (signed URLs). Filesystem under TESTING.
# ---------------------------------------------------------------------------
CLOUDINARY_URL = os.environ.get("CLOUDINARY_URL", "")  # cloudinary://<key>:<secret>@<cloud_name>
CLOUDINARY_CLOUD_NAME = os.environ.get("CLOUDINARY_CLOUD_NAME", "")
CLOUDINARY_API_KEY = os.environ.get("CLOUDINARY_API_KEY", "")
CLOUDINARY_API_SECRET = os.environ.get("CLOUDINARY_API_SECRET", "")

if TESTING:
    STORAGES = {
        "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }
    MEDIA_ROOT = BASE_DIR / ".test-media"
else:
    STORAGES = {
        "default": {"BACKEND": "apps.common.cloudinary_storage.CloudinaryStorage"},
        "staticfiles": {"BACKEND": "django.contrib.staticfiles.storage.StaticFilesStorage"},
    }

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"
MEDIA_URL = "/media/"

# ---------------------------------------------------------------------------
# Payments (test mode)
# ---------------------------------------------------------------------------
STRIPE_SECRET_KEY = os.environ.get("STRIPE_SECRET_KEY", "sk_test_dev")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "whsec_dev")
PAYMONGO_SECRET_KEY = os.environ.get("PAYMONGO_SECRET_KEY", "sk_test_dev")
PAYMONGO_WEBHOOK_SECRET = os.environ.get("PAYMONGO_WEBHOOK_SECRET", "whsec_dev")
PAYMONGO_BASE_URL = os.environ.get("PAYMONGO_BASE_URL", "https://api.paymongo.com")
FRONTEND_BASE_URL = os.environ.get("FRONTEND_BASE_URL", "http://localhost:5173")

# ---------------------------------------------------------------------------
# AI vision gatekeeper
# ---------------------------------------------------------------------------
YOLO_MODEL_PATH = os.environ.get("YOLO_MODEL_PATH", "yolov8s-worldv2.pt")
YOLO_CONFIDENCE_THRESHOLD = float(os.environ.get("YOLO_CONFIDENCE_THRESHOLD", "0.20"))

# MegaDescriptor re-identification embeddings (pet re-ID matching). One L2-normalized
# embedding is cached per photo (PetPhoto.photo_embedding / legacy Pet.photo_embedding),
# computed from the in-memory padded crop of YOLO-World's best animal box — the stored,
# uncropped original stays the display image. CLIP ViT-B/32 remains the species-naming
# and breed/color stage only.
MEGA_DESCRIPTOR_MODEL = os.environ.get(
    "MEGA_DESCRIPTOR_MODEL", "hf-hub:BVRA/MegaDescriptor-L-384"
)  # or "hf-hub:BVRA/MegaDescriptor-DINOv2-518"
MEGA_DESCRIPTOR_DEVICE = os.environ.get("MEGA_DESCRIPTOR_DEVICE", "")  # "" = cuda if available else cpu
# Fraction of the detection box size added as padding on every side of the in-memory crop.
PET_CROP_PADDING = float(os.environ.get("PET_CROP_PADDING", "0.20"))

# Max cross-photo MegaDescriptor cosine similarity at/above which a found report is
# considered a possible match for a lost report of the same species (notifications +
# map halo). MegaDescriptor re-ID scores sit well below CLIP full-frame scores, so this
# starts lower than the old 0.80 CLIP threshold — tune against real test pairs.
PET_MATCH_SIMILARITY_THRESHOLD = float(os.environ.get("PET_MATCH_SIMILARITY_THRESHOLD", "0.60"))

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "handlers": {"console": {"class": "logging.StreamHandler"}},
    "root": {"handlers": ["console"], "level": os.environ.get("LOG_LEVEL", "WARNING")},
}
