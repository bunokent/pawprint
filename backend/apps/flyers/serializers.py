"""Flyer serializers."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone
from rest_framework import serializers

from apps.common import storage
from apps.common.validation import clean_phone
from apps.pets.serializers import PetSerializer

from .models import Flyer


class FlyerSerializer(serializers.ModelSerializer[Flyer]):
    pet = PetSerializer(read_only=True)
    creator_display_name = serializers.CharField(source="creator.display_name", read_only=True)
    creator_avatar_url = serializers.SerializerMethodField()
    photo_url = serializers.SerializerMethodField()
    photo_urls = serializers.SerializerMethodField()
    export_png_url = serializers.SerializerMethodField()
    export_pdf_url = serializers.SerializerMethodField()

    class Meta:
        model = Flyer
        fields = [
            "id", "mode", "status", "pet", "creator", "creator_display_name", "creator_avatar_url",
            "last_seen_location", "last_seen_date", "location_lat", "location_lng",
            "distinctive_markings",
            "contact_phone", "contact_email", "qr_target_type", "qr_target_value",
            "photo_url", "photo_urls", "export_png_url", "export_pdf_url", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "creator", "status", "created_at", "updated_at",
                            "export_png_url", "export_pdf_url", "photo_url", "photo_urls"]

    def get_photo_url(self, obj: Flyer) -> str:
        if obj.pet and obj.pet.photo_path:
            return storage.signed_url(obj.pet.photo_path)
        return ""

    def get_creator_avatar_url(self, obj: Flyer) -> str:
        return storage.signed_url(obj.creator.avatar_path) if obj.creator.avatar_path else ""

    def get_photo_urls(self, obj: Flyer) -> list[str]:
        """Signed URL of the pet's single photo (pet.photos is prefetched)."""
        pet = obj.pet
        if not pet:
            return []
        # Use prefetched PetPhoto rows when present; fall back to the legacy cover
        # path for pets created before PetPhoto rows existed.
        photos = getattr(pet, "_prefetched_objects_cache", {}).get("photos")
        if photos:
            return [storage.signed_url(p.photo_path) for p in photos]
        if pet.photo_path:
            return [storage.signed_url(pet.photo_path)]
        return []

    def get_export_png_url(self, obj: Flyer) -> str:
        return storage.signed_url(obj.export_png_path) if obj.export_png_path else ""

    def get_export_pdf_url(self, obj: Flyer) -> str:
        return storage.signed_url(obj.export_pdf_path) if obj.export_pdf_path else ""


FUTURE_TOLERANCE = timedelta(minutes=5)


def validate_seen_date(value: datetime | None) -> datetime | None:
    """Reject future timestamps (typo'ed years and impossible 'future sightings')."""
    if value is not None and value > timezone.now() + FUTURE_TOLERANCE:
        raise serializers.ValidationError("The last seen date and time cannot be in the future.")
    return value


def validate_details(mode: str, attrs: dict[str, Any], *, instance: Flyer | None) -> None:
    """Lost/found flyers need a location and date.

    PATCH normally checks only supplied fields so legacy rows stay editable, but a
    mode change into lost/found must validate the final combined state.
    """
    if mode not in (Flyer.Mode.EMERGENCY, Flyer.Mode.FOUND):
        return
    errors: dict[str, str] = {}
    # Only a real mode change into lost/found demands a full combined-state check;
    # resending the current mode keeps legacy rows editable.
    full_check = instance is None or instance.mode != mode
    for field, message in (
        ("last_seen_location", "Add the location."),
        ("last_seen_date", "Add the date and time."),
    ):
        if not full_check and field not in attrs:
            continue
        value = attrs.get(field) if field in attrs else getattr(instance, field, None)
        value = value.strip() if isinstance(value, str) else value
        if value is None or value == "":
            errors[field] = message
    if errors:
        raise serializers.ValidationError(errors)


class FlyerCreateSerializer(serializers.Serializer):
    pet_id = serializers.UUIDField()
    mode = serializers.ChoiceField(choices=Flyer.Mode.choices)
    last_seen_location = serializers.CharField(max_length=255, required=False, allow_blank=True)
    last_seen_date = serializers.DateTimeField(required=False, allow_null=True)
    location_lat = serializers.FloatField(min_value=-90, max_value=90, required=False, allow_null=True)
    location_lng = serializers.FloatField(min_value=-180, max_value=180, required=False, allow_null=True)
    distinctive_markings = serializers.CharField(required=False, allow_blank=True)
    contact_phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    contact_email = serializers.EmailField(required=False, allow_blank=True)

    def validate_last_seen_location(self, value: str) -> str:
        return value.strip()

    def validate_last_seen_date(self, value: datetime | None) -> datetime | None:
        return validate_seen_date(value)

    def validate_distinctive_markings(self, value: str) -> str:
        value = value.strip()
        if len(value) > 1000:
            raise serializers.ValidationError("Keep the description under 1000 characters.")
        return value

    def validate_contact_phone(self, value: str) -> str:
        return clean_phone(value)

    def validate_contact_email(self, value: str) -> str:
        return value.strip()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        validate_details(attrs.get("mode", ""), attrs, instance=None)
        return attrs


class FlyerUpdateSerializer(serializers.Serializer):
    mode = serializers.ChoiceField(choices=Flyer.Mode.choices, required=False)
    last_seen_location = serializers.CharField(max_length=255, required=False, allow_blank=True)
    last_seen_date = serializers.DateTimeField(required=False, allow_null=True)
    location_lat = serializers.FloatField(min_value=-90, max_value=90, required=False, allow_null=True)
    location_lng = serializers.FloatField(min_value=-180, max_value=180, required=False, allow_null=True)
    distinctive_markings = serializers.CharField(required=False, allow_blank=True)
    contact_phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    contact_email = serializers.EmailField(required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=[Flyer.Status.ACTIVE, Flyer.Status.RESOLVED], required=False)

    def validate_last_seen_location(self, value: str) -> str:
        return value.strip()

    def validate_last_seen_date(self, value: datetime | None) -> datetime | None:
        return validate_seen_date(value)

    def validate_distinctive_markings(self, value: str) -> str:
        value = value.strip()
        if len(value) > 1000:
            raise serializers.ValidationError("Keep the description under 1000 characters.")
        return value

    def validate_contact_phone(self, value: str) -> str:
        return clean_phone(value)

    def validate_contact_email(self, value: str) -> str:
        return value.strip()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        mode = attrs.get("mode", self.instance.mode if self.instance else "")
        validate_details(mode, attrs, instance=self.instance)
        return attrs
