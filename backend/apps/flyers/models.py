"""Flyer model — one per pet, dual-mode (emergency | outreach)."""

import uuid

from django.db import models
from django.db.models import Index, UniqueConstraint


class Flyer(models.Model):
    class Mode(models.TextChoices):
        EMERGENCY = "emergency", "Emergency (lost pet)"
        FOUND = "found", "Found pet"
        OUTREACH = "outreach", "Outreach (adoption)"

    class Status(models.TextChoices):
        DRAFT = "draft", "Draft"
        GENERATING = "generating", "Generating assets"
        ACTIVE = "active", "Active"
        RESOLVED = "resolved", "Resolved"

    class Design(models.TextChoices):
        CLASSIC = "classic", "Classic"
        MODERN = "modern", "Modern"
        MINIMALIST = "minimalist", "Minimalist"
        VIBRANT = "vibrant", "Vibrant"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    pet = models.ForeignKey("pets.Pet", on_delete=models.CASCADE, related_name="flyers")
    creator = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="flyers")
    mode = models.CharField(max_length=16, choices=Mode.choices, default=Mode.EMERGENCY)
    last_seen_location = models.CharField(max_length=255, blank=True)
    last_seen_date = models.DateTimeField(null=True, blank=True)
    # Exact pin for the interactive pet map (reverse-geocoded address stays in
    # last_seen_location; for found flyers the fields mean location/date found).
    location_lat = models.FloatField(null=True, blank=True)
    location_lng = models.FloatField(null=True, blank=True)
    distinctive_markings = models.TextField(blank=True)
    contact_phone = models.CharField(max_length=32, blank=True)
    contact_email = models.EmailField(blank=True)
    # What the QR code points at (usually the public flyer URL).
    qr_target_type = models.CharField(max_length=32, default="flyer_url")
    qr_target_value = models.URLField(max_length=512, blank=True)
    export_png_path = models.CharField(max_length=512, blank=True)
    export_pdf_path = models.CharField(max_length=512, blank=True)
    status = models.CharField(max_length=16, choices=Status.choices, default=Status.DRAFT)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    # Soft delete: set instead of hard deletion so the flyer survives in the
    # creator's Recently Deleted page until it is restored or purged.
    deleted_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        db_table = "flyers_flyer"
        constraints = [
            # One active flyer per pet at a time is a product rule enforced in services;
            # here we keep the DB honest about unique QR targets per flyer row.
            UniqueConstraint(fields=["id"], name="flyer_unique_id"),
        ]
        indexes = [
            # Public gallery: filter by mode + status, order by recency.
            Index(fields=["mode", "status", "created_at"], name="flyer_mode_status_created_idx"),
            # "My flyers" dashboard (excludes soft-deleted flyers).
            Index(fields=["creator", "mode"], name="flyer_creator_mode_idx"),
            Index(fields=["status", "created_at"], name="flyer_status_created_idx"),
            # Recently Deleted: the creator's soft-deleted flyers, newest first.
            Index(fields=["creator", "deleted_at"], name="flyer_creator_deleted_idx"),
            # Interactive pet map: located active lost/found flyers.
            Index(fields=["status", "location_lat", "location_lng"], name="flyer_status_location_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.mode} flyer for {self.pet_id}"
