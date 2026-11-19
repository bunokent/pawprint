"""FlyerService — transactional writes + Celery dispatch for asset generation."""

from __future__ import annotations

import uuid
from dataclasses import dataclass

from django.conf import settings
from django.db import transaction

from apps.pets.selectors import get_pet_by_id

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


class FlyerService:
    @staticmethod
    @transaction.atomic
    def create_flyer(creator, *, pet_id: uuid.UUID, mode: str, last_seen_location: str = "",
                     last_seen_date=None, location_lat: float | None = None,
                     location_lng: float | None = None, distinctive_markings: str = "",
                     contact_phone: str = "", contact_email: str = "", reward_enabled: bool = False,
                     reward_amount_cents: int = 0, reward_currency: str = "PHP") -> Flyer:
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
            reward_enabled=reward_enabled,
            reward_amount_cents=reward_amount_cents,
            reward_currency=reward_currency,
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
    @transaction.atomic
    def delete_flyer(flyer: Flyer) -> None:
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
