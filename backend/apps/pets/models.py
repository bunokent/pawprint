"""Pet model."""

import uuid

from django.contrib.postgres.indexes import GinIndex
from django.contrib.postgres.search import SearchVector, SearchVectorField
from django.db import models
from django.db.models import Index


class Pet(models.Model):
    class Species(models.TextChoices):
        DOG = "dog", "Dog"
        CAT = "cat", "Cat"
        BIRD = "bird", "Bird"
        HORSE = "horse", "Horse"
        OTHER = "other", "Other"

    class Status(models.TextChoices):
        LOST = "lost", "Lost"
        FOUND = "found", "Found"
        ADOPTABLE = "adoptable", "Adoptable"
        REUNITED = "reunited", "Reunited"
        ADOPTED = "adopted", "Adopted"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    owner = models.ForeignKey(
        "users.User", on_delete=models.CASCADE, related_name="pets"
    )
    name = models.CharField(max_length=120)
    species = models.CharField(max_length=16, choices=Species.choices, default=Species.DOG)
    breed = models.CharField(max_length=120, blank=True)
    color = models.CharField(max_length=120, blank=True)
    age = models.PositiveIntegerField(null=True, blank=True)
    temperament_tags = models.JSONField(default=list, blank=True)
    health_tags = models.JSONField(default=list, blank=True)
    photo_path = models.CharField(max_length=512, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.ADOPTABLE)
    # Materialized full-text search vector over (name, breed, color) — GIN indexed.
    search_vector = SearchVectorField(null=True, editable=False)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pets_pet"
        indexes = [
            # Gallery listings filter by status and order by recency.
            Index(fields=["status", "created_at"], name="pet_status_created_idx"),
            # GIN index for JSON tag filtering.
            GinIndex(fields=["temperament_tags"], name="pet_temperament_gin"),
            GinIndex(fields=["health_tags"], name="pet_health_gin"),
            # GIN index for PostgreSQL full-text search.
            GinIndex(fields=["search_vector"], name="pet_search_vector_gin"),
        ]

    def save(self, *args, **kwargs) -> None:  # type: ignore[no-untyped-def]
        super().save(*args, **kwargs)
        # Keep the materialized search vector in sync (single targeted UPDATE).
        type(self).objects.filter(pk=self.pk).update(
            search_vector=SearchVector("name", "breed", "color")
        )

    def __str__(self) -> str:
        return f"{self.name} ({self.species})"
