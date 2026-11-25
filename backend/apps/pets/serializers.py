"""Pet serializers."""

from __future__ import annotations

from typing import Any

from rest_framework import serializers

from apps.common import storage

from .models import Pet
from .services import MAX_PET_PHOTOS


class PetSerializer(serializers.ModelSerializer[Pet]):
    photo_url = serializers.SerializerMethodField()

    class Meta:
        model = Pet
        fields = [
            "id", "name", "species", "breed", "color", "age", "temperament_tags",
            "health_tags", "photo_path", "photo_url", "status", "created_at",
        ]
        read_only_fields = ["id", "created_at", "photo_url"]

    def get_photo_url(self, obj: Pet) -> str:
        if not obj.photo_path:
            return ""
        return storage.signed_url(obj.photo_path)


class PetCreateSerializer(serializers.Serializer):
    # Optional/blank: found-pet reports have no name (the owner is unknown).
    name = serializers.CharField(max_length=120, required=False, allow_blank=True, default="")
    species = serializers.ChoiceField(choices=Pet.Species.choices, default=Pet.Species.DOG)
    breed = serializers.CharField(max_length=120, required=False, allow_blank=True)
    color = serializers.CharField(max_length=120, required=False, allow_blank=True)
    age = serializers.IntegerField(min_value=0, max_value=50, required=False, allow_null=True)
    temperament_tags = serializers.ListField(
        child=serializers.CharField(max_length=40),
        max_length=12,
        required=False,
    )
    health_tags = serializers.ListField(
        child=serializers.CharField(max_length=40),
        max_length=12,
        required=False,
    )
    photo_path = serializers.CharField(max_length=512, required=False, allow_blank=True)
    # One photo per pet — the cover image used by the flyer and the detector readout.
    photo_paths = serializers.ListField(
        child=serializers.CharField(max_length=512),
        required=False,
        max_length=MAX_PET_PHOTOS,
        error_messages={"max_length": "One photo per pet is allowed. Please upload a single clear photo."},
    )
    status = serializers.ChoiceField(choices=Pet.Status.choices, default=Pet.Status.ADOPTABLE)

    def validate_name(self, value: str) -> str:
        return value.strip()

    def validate_breed(self, value: str) -> str:
        return value.strip()

    def validate_color(self, value: str) -> str:
        return value.strip()

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        # A found pet is unnamed by design; every other status needs a name.
        if attrs.get("status") != Pet.Status.FOUND and not attrs.get("name", "").strip():
            raise serializers.ValidationError({"name": "Give the pet a name."})
        return attrs


class PhotoUploadRequestSerializer(serializers.Serializer):
    photo = serializers.FileField()
    # Destination folder under flyers/{user_id}/ — never a free-form path.
    category = serializers.ChoiceField(choices=storage.FLYER_CATEGORIES, required=False, default="losts")


class PhotoUploadResponseSerializer(serializers.Serializer):
    key = serializers.CharField()
    url = serializers.CharField()
    thumb_key = serializers.CharField()
    thumb_url = serializers.CharField()
    pet_classes = serializers.ListField(child=serializers.CharField())
    detected_classes = serializers.ListField(child=serializers.CharField())
    max_confidence = serializers.FloatField()
    breed = serializers.CharField(allow_blank=True)
    breed_confidence = serializers.FloatField()
    color = serializers.CharField(allow_blank=True)
    color_confidence = serializers.FloatField()
