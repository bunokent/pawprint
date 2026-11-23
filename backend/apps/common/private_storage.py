"""PRIVATE local storage with short-lived, HMAC-signed URLs.

Objects live under ``settings.PRIVATE_STORAGE_ROOT`` — outside MEDIA_ROOT and
STATIC_ROOT, and never mapped to a public URL. Django's ``Storage`` API is kept so
services do not care where the bytes land; every read goes through
``apps.common.views.PrivateMediaView``, which verifies the signature before
streaming a single object.

Hardening:
- keys are relative POSIX paths from a small allow-list of extensions; absolute
  paths, ``..``, backslashes, dotfiles and null bytes are rejected;
- every path is resolved and checked to stay inside the private root;
- directories are 0700 and files 0600, written atomically via a temp file;
- URLs carry an expiry timestamp and an HMAC-SHA256 signature compared in
  constant time, using a dedicated signing key (``SECRET_KEY`` by default).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import tempfile
import time
from pathlib import Path, PurePosixPath
from typing import IO

from django.conf import settings
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import File
from django.core.files.storage import Storage
from django.urls import reverse

# The only file types PawPrint writes: pet photos, thumbnails and A4 exports.
CONTENT_TYPES: dict[str, str] = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".pdf": "application/pdf",
}
MAX_KEY_LENGTH = 512


class InvalidStorageKeyError(ValueError):
    """A caller supplied an unsafe or unsupported storage key."""


class StorageUnavailableError(Exception):
    """A filesystem failure that the API maps to a JSON 502, never an HTML 500."""


def validate_key(key: str, *, require_extension: bool = True) -> str:
    """Return a normalized relative key or raise ``InvalidStorageKeyError``."""
    if not isinstance(key, str) or not key or len(key) > MAX_KEY_LENGTH:
        raise InvalidStorageKeyError("A storage key is required.")
    if "\x00" in key or "\\" in key or key.startswith("/"):
        raise InvalidStorageKeyError("Invalid storage key.")
    parts = key.split("/")
    if any(part in ("", ".", "..") or part.startswith(".") for part in parts):
        raise InvalidStorageKeyError("Invalid storage key.")
    if require_extension and PurePosixPath(key).suffix.lower() not in CONTENT_TYPES:
        raise InvalidStorageKeyError("Unsupported file type.")
    return key


def content_type_for(key: str) -> str:
    """MIME type for an already-validated object key."""
    return CONTENT_TYPES[PurePosixPath(validate_key(key)).suffix.lower()]


def signing_key() -> bytes:
    key = getattr(settings, "PRIVATE_MEDIA_SIGNING_KEY", "") or settings.SECRET_KEY
    return key.encode("utf-8")


def signature_for(key: str, expires: int) -> str:
    payload = f"{key}:{expires}".encode()
    return hmac.new(signing_key(), payload, hashlib.sha256).hexdigest()


def verify_signature(key: str, expires: str, signature: str) -> bool:
    """Constant-time check that a URL is unexpired and bound to this exact key."""
    try:
        expiry = int(expires)
    except (TypeError, ValueError):
        return False
    if expiry <= int(time.time()) or not signature:
        return False
    try:
        validate_key(key)
    except InvalidStorageKeyError:
        return False
    return hmac.compare_digest(signature, signature_for(key, expiry))


class PrivateLocalStorage(Storage):
    """Filesystem backend for private objects; never exposed as a static file."""

    def root(self) -> Path:
        return Path(settings.PRIVATE_STORAGE_ROOT).resolve()

    def full_path(self, key: str, *, require_extension: bool = True) -> Path:
        """Resolve a key to an absolute path, refusing anything outside the root."""
        normalized = validate_key(key, require_extension=require_extension)
        root = self.root()
        candidate = (root / normalized).resolve()
        if candidate == root or not candidate.is_relative_to(root):
            raise SuspiciousFileOperation(f"Storage key escapes the private root: {key}")
        return candidate

    def get_available_name(self, name: str, max_length: int | None = None) -> str:
        # Services delete before replacing; mirrors the old overwrite=True behaviour.
        del max_length
        return name

    def _save(self, name: str, content: IO[bytes]) -> str:
        key = validate_key(name)
        target = self.full_path(key)
        try:
            # Lock down every directory we create, including intermediate ones.
            root = self.root()
            root.mkdir(mode=0o700, parents=True, exist_ok=True)
            os.chmod(root, 0o700)
            current = root
            for part in target.parent.relative_to(root).parts:
                current = current / part
                current.mkdir(mode=0o700, exist_ok=True)
                os.chmod(current, 0o700)
            fd, tmp_name = tempfile.mkstemp(prefix=".upload-", dir=target.parent)
            try:
                with os.fdopen(fd, "wb") as handle:
                    if hasattr(content, "chunks"):
                        for chunk in content.chunks():
                            handle.write(chunk)
                    else:
                        handle.write(content.read())
                    handle.flush()
                    os.fsync(handle.fileno())
                os.replace(tmp_name, target)
                os.chmod(target, 0o600)
            except Exception:
                Path(tmp_name).unlink(missing_ok=True)
                raise
        except OSError as exc:
            raise StorageUnavailableError("Could not write to private storage.") from exc
        return key

    def _open(self, name: str, mode: str = "rb") -> File:
        if mode != "rb":
            raise ValueError("Private storage is read-only through the Storage API.")
        try:
            return File(self.full_path(name).open("rb"), name=name)
        except FileNotFoundError:
            raise
        except OSError as exc:
            raise StorageUnavailableError("Could not read from private storage.") from exc

    def delete(self, name: str) -> None:
        try:
            self.full_path(name).unlink(missing_ok=True)
        except OSError as exc:
            raise StorageUnavailableError("Could not delete from private storage.") from exc

    def exists(self, name: str) -> bool:
        try:
            return self.full_path(name).is_file()
        except (InvalidStorageKeyError, SuspiciousFileOperation):
            return False

    def size(self, name: str) -> int:
        try:
            return self.full_path(name).stat().st_size
        except OSError as exc:
            raise StorageUnavailableError("Could not stat private storage.") from exc

    def listdir(self, path: str = "") -> tuple[list[str], list[str]]:
        directory = self.full_path(path, require_extension=False) if path else self.root()
        if not directory.is_dir():
            return [], []
        directories: list[str] = []
        files: list[str] = []
        for entry in directory.iterdir():
            (directories if entry.is_dir() else files).append(entry.name)
        return directories, files

    def url(self, name: str | None, expire: int | None = None) -> str:
        """Build a signed, expiring URL for one private object."""
        if not name:
            raise ValueError("A storage name is required to build a signed URL.")
        key = validate_key(name)
        ttl = int(expire if expire is not None else settings.PRIVATE_MEDIA_URL_EXPIRY)
        expiry = int(time.time()) + ttl
        signature = signature_for(key, expiry)
        return f"{reverse('private-media', kwargs={'key': key})}?expires={expiry}&signature={signature}"

    # Kept for the storage helper's compatibility with the old driver.
    def signed_url(self, name: str, expires: int = 3600) -> str:
        return self.url(name, expire=expires)
