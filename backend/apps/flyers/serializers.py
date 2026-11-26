"""Flyer serializers."""

from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from django.utils import timezone
from rest_framework import serializers

from apps.common import storage
from apps.common.validation import clean_phone
from apps.pets.models import Pet
from apps.pets.serializers import PetSerializer

from .edit_rules import pet_name_missing, update_missing_photo
from .models import Flyer
from .photo_keys import is_valid_photo_key


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
    # The pet is edited in the same owner-only request as the flyer it belongs to.
    name = serializers.CharField(max_length=120, required=False, allow_blank=True)
    species = serializers.ChoiceField(choices=Pet.Species.choices, required=False)
    breed = serializers.CharField(max_length=120, required=False, allow_blank=True)
    color = serializers.CharField(max_length=120, required=False, allow_blank=True)
    age = serializers.IntegerField(min_value=0, max_value=50, required=False, allow_null=True)
    temperament_tags = serializers.ListField(
        child=serializers.CharField(max_length=40), max_length=12, required=False
    )
    health_tags = serializers.ListField(
        child=serializers.CharField(max_length=40), max_length=12, required=False
    )
    last_seen_location = serializers.CharField(max_length=255, required=False, allow_blank=True)
    last_seen_date = serializers.DateTimeField(required=False, allow_null=True)
    location_lat = serializers.FloatField(min_value=-90, max_value=90, required=False, allow_null=True)
    location_lng = serializers.FloatField(min_value=-180, max_value=180, required=False, allow_null=True)
    distinctive_markings = serializers.CharField(required=False, allow_blank=True)
    # Full photo key returned by POST /api/pets/photos; blank removes the cover.
    photo_path = serializers.CharField(max_length=512, required=False, allow_blank=True)
    contact_phone = serializers.CharField(max_length=32, required=False, allow_blank=True)
    contact_email = serializers.EmailField(required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=[Flyer.Status.ACTIVE, Flyer.Status.RESOLVED], required=False)

    def validate_name(self, value: str) -> str:
        return value.strip()

    def validate_breed(self, value: str) -> str:
        return value.strip()

    def validate_color(self, value: str) -> str:
        return value.strip()

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

    def validate_photo_path(self, value: str) -> str:
        return value.strip()

    def _validate_replacement_photo(self, value: str, mode: str) -> None:
        """Only accept a full photo this owner uploaded for this flyer's folder."""
        flyer = self.instance
        if flyer is None:
            raise serializers.ValidationError({"photo_path": "Upload a photo first."})
        category = storage.flyer_category(mode)
        if not is_valid_photo_key(value, flyer.creator_id, category):
            raise serializers.ValidationError({"photo_path": "Choose a photo uploaded for this flyer."})
        if not storage.get_storage().exists(value):
            raise serializers.ValidationError({"photo_path": "That photo is no longer available. Upload it again."})

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if update_missing_photo(attrs):
            raise serializers.ValidationError({"photo_path": "Upload a photo before saving."})
        mode = attrs.get("mode", self.instance.mode if self.instance else "")
        validate_details(mode, attrs, instance=self.instance)
        # A found flyer is unnamed; a name is required once a pet is edited into
        # any other mode. Existing flyers without a name only fail when touched.
        if "name" in attrs or "mode" in attrs:
            current_name = self.instance.pet.name if self.instance else ""
            if pet_name_missing(mode, attrs.get("name", current_name)):
                raise serializers.ValidationError({"name": "Give the pet a name."})
        if attrs.get("photo_path"):
            self._validate_replacement_photo(attrs["photo_path"], mode)
        return attrs
