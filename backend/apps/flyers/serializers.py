"""Flyer serializers."""

from __future__ import annotations

from rest_framework import serializers

from apps.common import storage
from apps.pets.serializers import PetSerializer

from .models import Flyer


class FlyerSerializer(serializers.ModelSerializer[Flyer]):
    pet = PetSerializer(read_only=True)
    creator_display_name = serializers.CharField(source="creator.display_name", read_only=True)
    photo_url = serializers.SerializerMethodField()
    export_png_url = serializers.SerializerMethodField()
    export_pdf_url = serializers.SerializerMethodField()

    class Meta:
        model = Flyer
        fields = [
            "id", "mode", "status", "pet", "creator", "creator_display_name",
            "last_seen_location", "last_seen_date", "location_lat", "location_lng",
            "distinctive_markings",
            "contact_phone", "contact_email", "reward_enabled", "reward_amount_cents",
            "reward_currency", "qr_target_type", "qr_target_value",
            "photo_url", "export_png_url", "export_pdf_url", "created_at", "updated_at",
        ]
        read_only_fields = ["id", "creator", "status", "created_at", "updated_at",
                            "export_png_url", "export_pdf_url", "photo_url"]

    def get_photo_url(self, obj: Flyer) -> str:
        if obj.pet and obj.pet.photo_path:
            return storage.signed_url(obj.pet.photo_path)
        return ""

    def get_export_png_url(self, obj: Flyer) -> str:
        return storage.signed_url(obj.export_png_path) if obj.export_png_path else ""

    def get_export_pdf_url(self, obj: Flyer) -> str:
        return storage.signed_url(obj.export_pdf_path) if obj.export_pdf_path else ""


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
    reward_enabled = serializers.BooleanField(required=False, default=False)
    reward_amount_cents = serializers.IntegerField(min_value=0, required=False, default=0)
    reward_currency = serializers.CharField(max_length=8, required=False, default="PHP")

    def validate(self, attrs: dict) -> dict:
        if attrs.get("reward_enabled") and not attrs.get("reward_amount_cents"):
            raise serializers.ValidationError("reward_amount_cents must be > 0 when reward_enabled.")
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
    reward_enabled = serializers.BooleanField(required=False)
    reward_amount_cents = serializers.IntegerField(min_value=0, required=False)
    reward_currency = serializers.CharField(max_length=8, required=False)
    status = serializers.ChoiceField(choices=[Flyer.Status.ACTIVE, Flyer.Status.RESOLVED], required=False)
