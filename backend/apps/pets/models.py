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
    # Blank for found pets — the finder doesn't know the pet's name.
    name = models.CharField(max_length=120, blank=True, default="")
    species = models.CharField(max_length=16, choices=Species.choices, default=Species.DOG)
    breed = models.CharField(max_length=120, blank=True)
    color = models.CharField(max_length=120, blank=True)
    age = models.PositiveIntegerField(null=True, blank=True)
    temperament_tags = models.JSONField(default=list, blank=True)
    health_tags = models.JSONField(default=list, blank=True)
    photo_path = models.CharField(max_length=512, blank=True)
    # MegaDescriptor re-ID embedding of the pet photo (list of floats, L2-normalized),
    # cached at match time — computed from the in-memory padded crop of YOLO-World's
    # best animal box; the stored uncropped image stays the display image. Used to
    # compare found photos against lost ones (PetMatch). Legacy rows hold CLIP
    # full-frame vectors with embedding_model="" and are re-embedded on next match.
    photo_embedding = models.JSONField(null=True, blank=True)
    # Tag of the embedding model that produced photo_embedding (e.g. "MegaDescriptor-L-384").
    embedding_model = models.CharField(max_length=64, blank=True, default="")
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


class PetPhoto(models.Model):
    """One photo of a pet — a report can carry up to MAX_PET_PHOTOS of them (e.g.
    different angles of the same dog). Each photo gets its own cached MegaDescriptor
    re-ID embedding (from the in-memory padded crop of its detection box); lost/found
    matching takes the max cosine similarity over every cross-photo pair, so the same
    pet photographed from different angles still matches (see PetMatchService).
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pet = models.ForeignKey(Pet, on_delete=models.CASCADE, related_name="photos")
    photo_path = models.CharField(max_length=512)
    # MegaDescriptor re-ID embedding of THIS photo (list of floats, L2-normalized),
    # cached at match time — one entry per photo (up to MAX_PET_PHOTOS per report),
    # not just the cover photo. Computed from an in-memory padded crop of the
    # detection box; the stored file is the full, uncropped display image.
    photo_embedding = models.JSONField(null=True, blank=True)
    # Tag of the embedding model that produced photo_embedding.
    embedding_model = models.CharField(max_length=64, blank=True, default="")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "pets_petphoto"
        indexes = [Index(fields=["pet", "created_at"], name="petphoto_pet_created_idx")]

    def __str__(self) -> str:
        return f"photo {self.photo_path} of pet {self.pet_id}"
