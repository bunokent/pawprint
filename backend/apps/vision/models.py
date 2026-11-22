"""PetDetectionLog — audit trail for the YOLO-World gatekeeper (no strikes, no bans)."""

import uuid

from django.db import models


class PetDetectionLog(models.Model):
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey("users.User", on_delete=models.CASCADE, related_name="detection_logs")
    detected_classes = models.JSONField(default=list)
    max_confidence = models.FloatField(default=0.0)
    passed = models.BooleanField()
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "vision_petdetectionlog"
        indexes = [models.Index(fields=["user", "created_at"], name="vdl_user_created_idx")]

    def __str__(self) -> str:
        return f"{'PASS' if self.passed else 'REJECT'} {self.max_confidence:.2f}"
