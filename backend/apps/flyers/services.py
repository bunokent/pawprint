"""FlyerService — transactional writes + Celery dispatch for asset generation."""

from __future__ import annotations

import uuid
from contextlib import suppress
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from apps.common import storage
from apps.pets.models import PetPhoto
from apps.pets.selectors import get_pet_by_id
from apps.pets.services import PET_UPDATE_FIELDS, PetService

from .models import Flyer
from .qr import QrService
from .selectors import get_flyer_by_id


class FlyerError(Exception):
    pass


@dataclass(frozen=True)
class FlyerDTO:
    id: uuid.UUID
    mode: str
    status: str


def _thumb_key(photo_key: str) -> str:
    """Full photo key → the thumbnail key created by PetPhotoService."""
    return f"{photo_key[:-4]}_thumb.jpg" if photo_key.endswith(".jpg") else f"{photo_key}_thumb.jpg"


class FlyerService:
    @staticmethod
    @transaction.atomic
    def create_flyer(creator, *, pet_id: uuid.UUID, mode: str, last_seen_location: str = "",
                     last_seen_date=None, location_lat: float | None = None,
                     location_lng: float | None = None, distinctive_markings: str = "",
                     contact_phone: str = "", contact_email: str = "") -> Flyer:
        pet = get_pet_by_id(pet_id)
        if pet is None:
            raise FlyerError("Pet not found.")
        # Any registered user may post (owner, foster or shelter volunteer);
        # flyer ownership belongs to the creator.
        flyer = Flyer.objects.create(
            pet=pet,
            creator=creator,
            mode=mode,
            last_seen_location=last_seen_location,
            last_seen_date=last_seen_date,
            location_lat=location_lat,
            location_lng=location_lng,
            distinctive_markings=distinctive_markings,
            contact_phone=contact_phone,
            contact_email=contact_email or creator.email,
            qr_target_type="flyer_url",
            qr_target_value="",
            status=Flyer.Status.ACTIVE,
        )
        # Public immediately: show in the lost/adoption gallery while assets
        # (PDF/PNG exports) generate in the background. Set the real QR target
        # now that we have the flyer id.
        flyer.qr_target_value = QrService.target_url(str(flyer.pk), settings.FRONTEND_BASE_URL)
        flyer.save(update_fields=["qr_target_value"])
        from .tasks import generate_flyer_assets

        generate_flyer_assets.delay(str(flyer.pk))
        flyer.refresh_from_db()  # reflects eager execution in tests; stays 'active' in async prod
        return flyer

    @staticmethod
    @transaction.atomic
    def update_flyer(flyer: Flyer, **fields) -> Flyer:
        photo_path = fields.pop("photo_path", None)
        pet_fields = {key: fields.pop(key) for key in tuple(fields) if key in PET_UPDATE_FIELDS}
        if photo_path is not None:
            FlyerService.replace_pet_photo(flyer, photo_path)
        if pet_fields:
            PetService.update_pet(flyer.pet, **pet_fields)
        for key, value in fields.items():
            setattr(flyer, key, value)
        # Stay ACTIVE so the flyer remains public while assets regenerate.
        flyer.status = Flyer.Status.ACTIVE
        flyer.save()
        from .tasks import generate_flyer_assets

        generate_flyer_assets.delay(str(flyer.pk))
        flyer.refresh_from_db()
        return flyer

    @staticmethod
    def replace_pet_photo(flyer: Flyer, photo_path: str) -> None:
        """Swap the pet's single cover photo and clean up the superseded object."""
        pet = flyer.pet
        old_paths = {pet.photo_path, *pet.photos.values_list("photo_path", flat=True)}
        old_paths.discard("")

        pet.photo_path = photo_path
        pet.save(update_fields=["photo_path"])
        if photo_path:
            first = pet.photos.first()
            if first:
                first.photo_path = photo_path
                first.save(update_fields=["photo_path"])
                pet.photos.exclude(pk=first.pk).delete()
            else:
                PetPhoto.objects.create(pet=pet, photo_path=photo_path)
        else:
            pet.photos.all().delete()

        # Only remove objects no other pet still references. Storage deletion is
        # best-effort: losing a cleanup must not fail the already-saved edit.
        backend = storage.get_storage()
        still_used = set(PetPhoto.objects.filter(photo_path__in=old_paths).values_list("photo_path", flat=True))
        for old in old_paths - still_used - {photo_path}:
            with suppress(Exception):
                if backend.exists(old):
                    backend.delete(old)
                thumb = _thumb_key(old)
                if backend.exists(thumb):
                    backend.delete(thumb)

    @staticmethod
    @transaction.atomic
    def delete_flyer(flyer: Flyer) -> Flyer:
        """Soft delete: the flyer survives in the creator's Recently Deleted page
        until it is restored or permanently purged."""
        flyer.deleted_at = timezone.now()
        flyer.save(update_fields=["deleted_at", "updated_at"])
        flyer.refresh_from_db()
        return flyer

    @staticmethod
    @transaction.atomic
    def restore_flyer(flyer: Flyer) -> Flyer:
        """Undelete a soft-deleted flyer: back to My Flyers (and the public
        gallery if it is active). Its original status is preserved."""
        if flyer.deleted_at is None:
            raise FlyerError("Flyer is not deleted.")
        flyer.deleted_at = None
        flyer.save(update_fields=["deleted_at", "updated_at"])
        flyer.refresh_from_db()
        return flyer

    @staticmethod
    @transaction.atomic
    def purge_flyer(flyer: Flyer) -> None:
        """Permanently delete a soft-deleted flyer (row + its assets)."""
        if flyer.deleted_at is None:
            raise FlyerError("Flyer is not deleted.")
        flyer.delete()

    @staticmethod
    @transaction.atomic
    def mark_resolved(flyer: Flyer) -> Flyer:
        flyer.status = Flyer.Status.RESOLVED
        flyer.save(update_fields=["status", "updated_at"])
        return flyer

    @staticmethod
    def get_or_404(flyer_id: uuid.UUID) -> Flyer:
        flyer = get_flyer_by_id(flyer_id)
        if flyer is None:
            raise FlyerError("Flyer not found.")
        return flyer
