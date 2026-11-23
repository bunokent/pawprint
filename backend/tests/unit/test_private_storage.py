"""Unit + view tests for the PRIVATE local storage driver.

No cloud SDK: files stay on disk under PRIVATE_STORAGE_ROOT and can only be read
through a short-lived HMAC-signed URL.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest
from django.core.exceptions import SuspiciousFileOperation
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.urls import reverse

from apps.common.private_storage import (
    CONTENT_TYPES,
    InvalidStorageKeyError,
    PrivateLocalStorage,
    StorageUnavailableError,
    content_type_for,
    signature_for,
    validate_key,
    verify_signature,
)

pytestmark = pytest.mark.django_db


@pytest.fixture
def private_root(settings, tmp_path: Path) -> Path:
    settings.PRIVATE_STORAGE_ROOT = tmp_path / "private"
    return settings.PRIVATE_STORAGE_ROOT


def _put(key: str, data: bytes = b"jpeg-bytes") -> str:
    return default_storage.save(key, ContentFile(data, name=key))


# --- key validation ---------------------------------------------------------


@pytest.mark.parametrize(
    "key",
    [
        "",
        None,
        "/etc/passwd",
        "../escape.jpg",
        "flyers/../secret.jpg",
        "flyers\\user\\photo.jpg",
        "flyers/.hidden.jpg",
        "flyers/photo.exe",
        "flyers/photo\x00.jpg",
        "a" * 513,
    ],
)
def test_validate_key_rejects_unsafe_keys(key):
    with pytest.raises(InvalidStorageKeyError):
        validate_key(key)


def test_validate_key_allows_directory_paths_without_extension():
    assert validate_key("flyers/user-id/losts", require_extension=False) == "flyers/user-id/losts"
    assert content_type_for("flyers/u/losts/photo.JPG") == "image/jpeg"
    assert set(CONTENT_TYPES.values()) >= {"image/jpeg", "image/png", "application/pdf"}


def test_path_refuses_to_escape_the_private_root(private_root: Path, tmp_path: Path):
    store = PrivateLocalStorage()
    outside = tmp_path / "outside.jpg"
    outside.write_bytes(b"secret")
    (private_root / "link.jpg").parent.mkdir(parents=True, exist_ok=True)
    (private_root / "link.jpg").symlink_to(outside)
    with pytest.raises(SuspiciousFileOperation):
        store.full_path("link.jpg")
    with pytest.raises(InvalidStorageKeyError):
        store.full_path("../outside.jpg")


def test_get_available_name_keeps_the_key_for_overwrite():
    assert PrivateLocalStorage().get_available_name("flyers/u/losts/a.jpg") == "flyers/u/losts/a.jpg"


# --- writes / reads ---------------------------------------------------------


def test_save_creates_private_dirs_and_files_with_locked_permissions(private_root: Path):
    key = _put("flyers/user-1/losts/photo.jpg")
    target = private_root / key
    assert key == "flyers/user-1/losts/photo.jpg"
    assert target.read_bytes() == b"jpeg-bytes"
    assert target.stat().st_mode & 0o777 == 0o600
    assert (private_root / "flyers").stat().st_mode & 0o777 == 0o700
    assert default_storage.exists(key)
    assert default_storage.size(key) == len(b"jpeg-bytes")

    _put(key, b"replacement")
    assert target.read_bytes() == b"replacement"
    assert not list((private_root / "flyers" / "user-1" / "losts").glob(".upload-*"))


def test_open_and_list_directory(private_root: Path):
    _put("flyers/u/found/a.png")
    _put("flyers/u/found/b.pdf")
    with default_storage.open("flyers/u/found/a.png", "rb") as handle:
        assert handle.read() == b"jpeg-bytes"
    directories, files = default_storage.listdir("flyers/u")
    assert directories == ["found"]
    assert sorted(files) == []
    assert sorted(default_storage.listdir("flyers/u/found")[1]) == ["a.png", "b.pdf"]
    assert default_storage.listdir("missing") == ([], [])
    with pytest.raises(ValueError):
        default_storage._open("flyers/u/found/a.png", "wb")


def test_delete_removes_only_the_named_object(private_root: Path):
    key = _put("flyers/u/adoptions/a.jpg")
    _put("flyers/u/adoptions/b.jpg")
    default_storage.delete(key)
    assert not default_storage.exists(key)
    assert default_storage.exists("flyers/u/adoptions/b.jpg")


def test_missing_key_is_false_and_missing_file_raises():
    assert not default_storage.exists("flyers/u/losts/missing.jpg")
    with pytest.raises(FileNotFoundError):
        default_storage.open("flyers/u/losts/missing.jpg", "rb")


def test_filesystem_failures_become_storage_unavailable(private_root: Path, monkeypatch):
    def boom(*args, **kwargs):
        raise OSError("read-only filesystem")

    monkeypatch.setattr(Path, "mkdir", boom)
    with pytest.raises(StorageUnavailableError):
        default_storage.save("flyers/u/losts/a.jpg", ContentFile(b"x"))


# --- signed URLs ------------------------------------------------------------


def test_signed_url_is_bound_to_key_and_expiry(settings):
    key = "flyers/u/losts/a.jpg"
    url = default_storage.url(key, expire=120)
    path, query = url.split("?", 1)
    assert path == reverse("private-media", kwargs={"key": key})
    expires = query.split("&")[0].split("=")[1]
    assert query.split("&")[1] == f"signature={signature_for(key, int(expires))}"
    assert int(expires) - int(time.time()) <= 120
    with pytest.raises(ValueError):
        default_storage.url(None)


def test_verify_signature_rejects_tampering_and_expiry(settings):
    key = "flyers/u/found/a.jpg"
    assert verify_signature(key, "4102444800", signature_for(key, 4102444800))
    assert not verify_signature(key, "not-a-number", signature_for(key, 4102444800))
    assert not verify_signature(key, "1", signature_for(key, 1))
    assert not verify_signature(key, "4102444800", "bad")
    assert not verify_signature(key, "4102444800", "")
    assert not verify_signature("../escape.jpg", "4102444800", signature_for("../escape.jpg", 4102444800))


def test_verify_signature_uses_the_dedicated_signing_key(settings):
    key = "flyers/u/losts/a.jpg"
    old_signature = signature_for(key, 4102444800)
    assert verify_signature(key, "4102444800", old_signature)
    settings.PRIVATE_MEDIA_SIGNING_KEY = "rotate-me"
    assert not verify_signature(key, "4102444800", old_signature)
    assert verify_signature(key, "4102444800", signature_for(key, 4102444800))


# --- private media view -----------------------------------------------------


def test_private_media_view_streams_only_signed_objects(client, private_root: Path):
    key = _put("flyers/u/losts/a.png", b"png-data")
    url = default_storage.url(key)
    response = client.get(url)
    assert response.status_code == 200
    assert b"".join(response.streaming_content) == b"png-data"
    assert response["Content-Type"] == "image/png"
    assert response["X-Content-Type-Options"] == "nosniff"
    assert response["Cache-Control"] == "private, max-age=60"


def test_private_media_view_404s_without_a_valid_signature(client, private_root: Path):
    key = _put("flyers/u/losts/a.png")
    base = reverse("private-media", kwargs={"key": key})
    assert client.get(base).status_code == 404
    assert client.get(f"{base}?expires=4102444800&signature=bad").status_code == 404
    # Signed but deleted or never-written object is still a 404.
    missing = "flyers/u/losts/missing.png"
    signed = default_storage.url(missing)
    assert client.get(signed).status_code == 404
    # Unsafe keys are refused even with a matching signature.
    unsafe = reverse("private-media", kwargs={"key": "../etc/passwd.jpg"})
    unsafe_signed = f"{unsafe}?expires=4102444800&signature={signature_for('../etc/passwd.jpg', 4102444800)}"
    assert client.get(unsafe_signed).status_code == 404


def test_private_media_view_404s_when_storage_is_unavailable(client, monkeypatch):
    def boom(self, key, mode="rb"):
        raise StorageUnavailableError("disk is gone")

    monkeypatch.setattr(PrivateLocalStorage, "open", boom)
    key = "flyers/u/losts/a.png"
    url = default_storage.url(key)
    assert client.get(url).status_code == 404


def test_private_media_view_is_the_only_read_route(settings):
    from django.urls import Resolver404, resolve

    assert resolve("/private-media/flyers/u/losts/a.jpg").url_name == "private-media"
    with pytest.raises(Resolver404):
        resolve("/media/flyers/u/losts/a.jpg")
    assert os.path.basename(str(settings.PRIVATE_STORAGE_ROOT)) in ("private", ".test-media")
