"""Storage helpers — every object is PRIVATE; access only via signed expiring URLs."""

from __future__ import annotations

from django.core.files.base import ContentFile
from django.core.files.storage import Storage, default_storage

# One folder per flyer kind, under flyers/{user_id}/.
FLYER_CATEGORIES: tuple[str, ...] = ("losts", "adoptions", "found")
MODE_TO_CATEGORY: dict[str, str] = {
    "emergency": "losts",
    "outreach": "adoptions",
    "found": "found",
}


def flyer_category(mode: str) -> str:
    """Map a flyer mode (or an already-correct folder name) to its storage folder."""
    if mode in FLYER_CATEGORIES:
        return mode
    return MODE_TO_CATEGORY.get(mode, "losts")


def pet_photo_key(user_id: object, category: str, photo_id: object, *, thumb: bool = False) -> str:
    """Build flyers/{user_id}/{category}/{uuid}.jpg (or {uuid}_thumb.jpg)."""
    folder = flyer_category(category)
    name = f"{photo_id}_thumb.jpg" if thumb else f"{photo_id}.jpg"
    return f"flyers/{user_id}/{folder}/{name}"


def flyer_export_key(user_id: object, category: str, flyer_id: object, extension: str, design: str = "classic") -> str:
    """Build flyers/{user_id}/{category}/{flyer_id}/flyer[-{design}].{pdf|png}.

    The Classic design keeps the original ``flyer.{ext}`` name for backward
    compatibility; the Modern design (and any future designs) get a
    ``flyer-{design}.{ext}`` name so multiple designs can coexist per flyer.
    """
    suffix = f"-{design}" if design != "classic" else ""
    return f"flyers/{user_id}/{flyer_category(category)}/{flyer_id}/flyer{suffix}.{extension}"


def get_storage() -> Storage:
    return default_storage


def upload_bytes(key: str, data: bytes, content_type: str = "application/octet-stream") -> str:
    """Upload bytes to private storage and return the storage key."""
    del content_type  # MIME type is derived from the validated extension by the backend
    storage = get_storage()
    if storage.exists(key):
        storage.delete(key)
    storage.save(key, ContentFile(data, name=key))
    return key


def read_bytes(key: str) -> bytes:
    with get_storage().open(key, "rb") as fh:
        return fh.read()


def signed_url(key: str, expires: int = 3600) -> str:
    """Short-lived HMAC-signed URL for a private object."""
    storage = get_storage()
    url = getattr(storage, "url", None)
    if url is None:
        raise RuntimeError("Storage backend has no url()")
    return url(key, expire=expires)  # type: ignore[call-arg]
