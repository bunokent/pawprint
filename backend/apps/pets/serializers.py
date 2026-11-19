"""Pet serializers."""

from __future__ import annotations

from rest_framework import serializers

from apps.common import storage

from .models import Pet


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
    name = serializers.CharField(max_length=120)
    species = serializers.ChoiceField(choices=Pet.Species.choices, default=Pet.Species.DOG)
    breed = serializers.CharField(max_length=120, required=False, allow_blank=True)
    color = serializers.CharField(max_length=120, required=False, allow_blank=True)
    age = serializers.IntegerField(min_value=0, max_value=50, required=False, allow_null=True)
    temperament_tags = serializers.ListField(child=serializers.CharField(max_length=40), required=False)
    health_tags = serializers.ListField(child=serializers.CharField(max_length=40), required=False)
    photo_path = serializers.CharField(max_length=512, required=False, allow_blank=True)
    status = serializers.ChoiceField(choices=Pet.Status.choices, default=Pet.Status.ADOPTABLE)


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
