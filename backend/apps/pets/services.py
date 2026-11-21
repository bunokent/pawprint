"""Pet services — writes and the photo-upload pipeline."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from django.db import transaction

from apps.common import storage
from apps.common.exceptions import NoPetDetectedError
from apps.vision.services import PetAttributeService, PetDetectionService, load_image

from .models import Pet, PetPhoto

# A lost/found report can carry up to this many photos (different angles of the
# same pet) — the frontend PhotoUpload caps at the same number.
MAX_PET_PHOTOS = 4


@dataclass(frozen=True)
class UploadedPhoto:
    key: str
    url: str
    thumb_key: str
    thumb_url: str
    pet_classes: list[str]
    detected_classes: list[str]
    max_confidence: float
    breed: str = ""
    breed_confidence: float = 0.0
    color: str = ""
    color_confidence: float = 0.0


class PetService:
    """Pet writes."""

    @staticmethod
    @transaction.atomic
    def create_pet(owner, *, name: str = "", species: str = "dog", breed: str = "", color: str = "",
                   age: int | None = None, temperament_tags: list[str] | None = None,
                   health_tags: list[str] | None = None, photo_path: str = "",
                   photo_paths: list[str] | None = None,
                   status: str = Pet.Status.ADOPTABLE) -> Pet:
        # Cover photo first, then any extra angles — deduped, capped at MAX_PET_PHOTOS.
        paths = list(dict.fromkeys(p for p in [photo_path, *(photo_paths or [])] if p))[:MAX_PET_PHOTOS]
        pet = Pet.objects.create(
            owner=owner, name=name, species=species, breed=breed, color=color, age=age,
            temperament_tags=temperament_tags or [], health_tags=health_tags or [],
            photo_path=paths[0] if paths else "", status=status,
        )
        if paths:
            # Cache the MegaDescriptor re-ID embedding of every photo now (computed from
            # the in-memory padded crop of the best detection box — the stored files stay
            # full and uncropped), so lost/found matching never has to re-download photos
            # mid-task (no-op under PAWPRINT_TESTING, and never raises — see
            # PetMatchService.ensure_embedding).
            from apps.vision.services import PetMatchService

            primary_embedding = PetMatchService.ensure_embedding(pet)
            for index, path in enumerate(paths):
                photo = PetPhoto.objects.create(pet=pet, photo_path=path)
                if index == 0 and primary_embedding:
                    # Reuse the cover photo's embedding instead of re-reading storage.
                    photo.photo_embedding = primary_embedding
                    photo.save(update_fields=["photo_embedding"])
                else:
                    PetMatchService.ensure_embedding(photo)
        return pet


class PetPhotoService:
    """Photo upload pipeline: YOLO-World gate → EXIF strip → private S3 → thumbnail task."""

    detection = PetDetectionService()

    @classmethod
    def upload(cls, user, filename: str, image_bytes: bytes) -> UploadedPhoto:
        """NOT wrapped in a transaction: a rejected photo must still leave its audit log."""
        """Validate + store a pet photo. Raises NoPetDetectedError (422) for non-pet images.

        The bytes are NEVER written to S3 when detection fails.
        """
        try:
            detection = cls.detection.validate_pet_image(image_bytes)
        except NoPetDetectedError as exc:
            cls.detection.record_detection(user, _as_result(exc), passed=False)
            raise
        cls.detection.record_detection(user, detection, passed=True)

        clean = cls.detection.strip_exif(image_bytes)
        # Breed/color attributes come from the separate CLIP classifier (YOLO handles
        # detection only); the UI blanks anything below its confidence threshold.
        attributes = PetAttributeService.classify_attributes(load_image(image_bytes), detection.pet_classes)
        photo_id = uuid.uuid4()
        key = f"pets/photos/{user.pk}/{photo_id}.jpg"
        thumb_key = f"pets/photos/{user.pk}/{photo_id}_thumb.jpg"
        storage.upload_bytes(key, clean, content_type="image/jpeg")
        from .tasks import generate_thumbnail

        generate_thumbnail.delay(key, thumb_key)
        return UploadedPhoto(
            key=key,
            url=storage.signed_url(key),
            thumb_key=thumb_key,
            thumb_url=storage.signed_url(thumb_key),
            pet_classes=detection.pet_classes,
            detected_classes=detection.detected_classes,
            max_confidence=detection.max_confidence,
            breed=attributes.breed,
            breed_confidence=attributes.breed_confidence,
            color=attributes.color,
            color_confidence=attributes.color_confidence,
        )


def _as_result(exc: NoPetDetectedError):
    from apps.vision.dto import DetectionResult

    return DetectionResult(
        passed=False,
        pet_classes=[],
        detected_classes=exc.detected_labels,
        max_confidence=0.0,
    )
