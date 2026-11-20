"""Notification model — in-app alerts (e.g. lost/found photo matches)."""

import uuid

from django.db import models
from django.db.models import Index


class Notification(models.Model):
    class Kind(models.TextChoices):
        MATCH_FOUND = "match_found", "Possible match for your lost pet"
        MATCH_LOST = "match_lost", "Your found pet may be someone's lost pet"
        SYSTEM = "system", "System"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="notifications")
    kind = models.CharField(max_length=32, choices=Kind.choices, default=Kind.SYSTEM)
    title = models.CharField(max_length=200)
    body = models.TextField(blank=True)
    link = models.CharField(max_length=512, blank=True)
    read_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "notifications_notification"
        ordering = ["-created_at"]
        indexes = [
            Index(fields=["user", "-created_at"], name="notif_user_created_idx"),
            Index(fields=["user", "read_at"], name="notif_user_read_idx"),
        ]

    def __str__(self) -> str:
        return f"{self.kind} -> {self.user_id}"
