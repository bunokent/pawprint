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


class PetMatch(models.Model):
    """A vision-derived possible match between a lost and a found flyer.

    Created when the max cross-photo MegaDescriptor embedding cosine similarity of
    the two pets' photos (any lost photo × any found photo) is >=
    PET_MATCH_SIMILARITY_THRESHOLD. Drives notifications and the "possible match"
    halo on the interactive map pins.
    """

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    lost_flyer = models.ForeignKey("flyers.Flyer", on_delete=models.CASCADE, related_name="matches_as_lost")
    found_flyer = models.ForeignKey("flyers.Flyer", on_delete=models.CASCADE, related_name="matches_as_found")
    # Max cross-photo cosine similarity (the winning image pair is in best_pair).
    score = models.FloatField()
    # [index into the lost pet's photo embeddings, index into the found pet's] of the
    # image pair that produced `score` (-1 when a side had no embeddings).
    best_pair = models.JSONField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        db_table = "vision_petmatch"
        constraints = [
            models.UniqueConstraint(fields=["lost_flyer", "found_flyer"], name="petmatch_unique_pair"),
        ]
        indexes = [
            models.Index(fields=["lost_flyer"], name="petmatch_lost_idx"),
            models.Index(fields=["found_flyer"], name="petmatch_found_idx"),
        ]

    def __str__(self) -> str:
        return f"match {self.lost_flyer_id} <-> {self.found_flyer_id} ({self.score:.3f})"
