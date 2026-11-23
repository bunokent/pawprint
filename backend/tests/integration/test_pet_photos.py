"""Integration: YOLO-World-gated photo upload endpoint."""

import io

import pytest
from PIL import Image

from apps.vision.dto import AttributeDetection, DetectionResult
from apps.vision.models import PetDetectionLog

pytestmark = pytest.mark.django_db


def _png_bytes(color=(200, 30, 30)) -> bytes:
    img = Image.new("RGB", (64, 64), color)
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    return buf.getvalue()


def _mock_detection_pass(monkeypatch):
    result = DetectionResult(
        passed=True, pet_classes=["dog"], detected_classes=["dog"], max_confidence=0.91
    )
    monkeypatch.setattr(
        "apps.pets.services.PetPhotoService.detection.validate_pet_image", lambda b: result
    )
    attributes = AttributeDetection(breed="shiba inu", breed_confidence=0.93, color="tan", color_confidence=0.88)
    monkeypatch.setattr(
        "apps.vision.services.PetAttributeService.classify_attributes",
        lambda image, pet_classes: attributes,
    )
    return result


def test_upload_pet_photo_success(auth_client, user, monkeypatch):
    _mock_detection_pass(monkeypatch)
    resp = auth_client.post(
        "/api/pets/photos", {"photo": io.BytesIO(_png_bytes()), "name": "pet.png"},
        format="multipart",
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["pet_classes"] == ["dog"]
    assert body["key"].startswith(f"flyers/{user.pk}/losts/")
    assert body["key"].endswith(".jpg")
    assert body["thumb_key"].startswith(f"flyers/{user.pk}/losts/")
    assert body["thumb_key"].endswith("_thumb.jpg")
    assert body["url"]
    # Breed/color classifier readout is included for the auto-fill fields.
    assert body["breed"] == "shiba inu"
    assert body["breed_confidence"] == pytest.approx(0.93)
    assert body["color"] == "tan"
    assert body["color_confidence"] == pytest.approx(0.88)
    # detection logged as passed
    assert PetDetectionLog.objects.filter(passed=True).count() == 1


@pytest.mark.parametrize("category", ["losts", "found", "adoptions"])
def test_upload_stores_in_requested_private_folder(auth_client, user, monkeypatch, category):
    _mock_detection_pass(monkeypatch)
    resp = auth_client.post(
        "/api/pets/photos",
        {"photo": io.BytesIO(_png_bytes()), "name": "pet.png", "category": category},
        format="multipart",
    )
    assert resp.status_code == 201, resp.content
    assert resp.json()["key"].startswith(f"flyers/{user.pk}/{category}/")


def test_upload_rejects_unknown_folder(auth_client, monkeypatch):
    _mock_detection_pass(monkeypatch)
    resp = auth_client.post(
        "/api/pets/photos",
        {"photo": io.BytesIO(_png_bytes()), "name": "pet.png", "category": "../../etc"},
        format="multipart",
    )
    assert resp.status_code == 400
    assert resp.json()["error"]["code"] == "validation_error"


def test_upload_non_pet_photo_422(auth_client, monkeypatch):
    from apps.common.exceptions import NoPetDetectedError

    def fail(b):
        raise NoPetDetectedError(detected_labels=["person", "car"])

    monkeypatch.setattr(
        "apps.pets.services.PetPhotoService.detection.validate_pet_image", fail
    )
    # The breed/color classifier must NOT run for a rejected (non-pet) photo.
    monkeypatch.setattr(
        "apps.vision.services.PetAttributeService.classify_attributes",
        lambda *a, **k: (_ for _ in ()).throw(AssertionError("classifier ran on rejected photo")),
    )
    resp = auth_client.post(
        "/api/pets/photos", {"photo": io.BytesIO(_png_bytes((30, 30, 200))), "name": "car.png"},
        format="multipart",
    )
    assert resp.status_code == 422
    body = resp.json()
    assert body["error"]["code"] == "no_pet_detected"
    # The message is exactly this sentence — shown once, not duplicated.
    assert body["error"]["message"] == "No pet detected in the photo. Please upload a clear photo of your pet."
    assert body["error"]["detected_labels"] == ["person", "car"]
    # logged as failed, and no storage object was written (zero penalties, just a log)
    assert PetDetectionLog.objects.filter(passed=False).count() == 1
    from django.core.files.storage import default_storage

    assert not any(default_storage.listdir("flyers")[0]) if default_storage.exists("flyers") else True


def test_upload_storage_failure_returns_json_502_not_html(auth_client, monkeypatch):
    """A private-storage filesystem failure must be a JSON 502, never an HTML 500."""
    from apps.common.private_storage import StorageUnavailableError

    _mock_detection_pass(monkeypatch)

    def boom(key, data, content_type="application/octet-stream"):
        raise StorageUnavailableError("Disk is read-only")

    monkeypatch.setattr("apps.common.storage.upload_bytes", boom)
    resp = auth_client.post(
        "/api/pets/photos", {"photo": io.BytesIO(_png_bytes()), "name": "pet.png"}, format="multipart"
    )
    assert resp.status_code == 502
    body = resp.json()
    assert body["error"]["code"] == "storage_unavailable"
    assert "storage" in body["error"]["message"].lower()
    # Detection was still logged as passed (the gate ran before storage).
    assert PetDetectionLog.objects.filter(passed=True).count() == 1


def test_upload_requires_auth(api_client):
    resp = api_client.post(
        "/api/pets/photos", {"photo": io.BytesIO(_png_bytes()), "name": "x.png"}, format="multipart"
    )
    assert resp.status_code == 401


def test_upload_missing_file_400(auth_client):
    resp = auth_client.post("/api/pets/photos", {}, format="multipart")
    assert resp.status_code == 400


def test_upload_throttle_10_per_min(auth_client, monkeypatch):
    _mock_detection_pass(monkeypatch)
    for _ in range(10):
        resp = auth_client.post(
            "/api/pets/photos", {"photo": io.BytesIO(_png_bytes()), "name": "p.png"}, format="multipart"
        )
        assert resp.status_code == 201
    resp = auth_client.post(
        "/api/pets/photos", {"photo": io.BytesIO(_png_bytes()), "name": "p.png"}, format="multipart"
    )
    assert resp.status_code == 429
