"""Notification service — create + realtime push, match alerts, mark-read."""

from __future__ import annotations

import logging

from django.utils import timezone

from .models import Notification
from .serializers import NotificationSerializer

logger = logging.getLogger(__name__)


def broadcast_notification(user_id, notification: Notification) -> None:
    """Push a notification to the user's websocket group (best-effort)."""
    try:
        from asgiref.sync import async_to_sync
        from channels.layers import get_channel_layer

        async_to_sync(get_channel_layer().group_send)(
            f"user_{user_id}",
            {
                "type": "notification.created",
                "payload": {"type": "notification.created", **NotificationSerializer(notification).data},
            },
        )
    except Exception:  # noqa: BLE001 — realtime push must never break the write path
        logger.exception("ws broadcast failed for notification %s", notification.pk)


class NotificationService:
    @staticmethod
    def create(user, *, kind: str, title: str, body: str = "", link: str = "") -> Notification:
        notification = Notification.objects.create(
            user=user, kind=kind, title=title, body=body, link=link
        )
        broadcast_notification(user.pk, notification)
        return notification

    @staticmethod
    def mark_read(user, ids: list | None = None) -> int:
        """Mark all of the user's unread notifications read (or only the given ids)."""
        qs = Notification.objects.filter(user=user, read_at__isnull=True)
        if ids:
            qs = qs.filter(pk__in=ids)
        return qs.update(read_at=timezone.now())

    @staticmethod
    def notify_match(match) -> None:
        """Alert both sides of a PetMatch: the lost pet's owner + the finder."""
        lost, found = match.lost_flyer, match.found_flyer
        # Found pets are often unnamed — fall back to a readable label.
        lost_name = lost.pet.name or "your lost pet"
        found_name = found.pet.name or "a found pet"
        score_pct = f"{match.score:.0%}"
        notified = set()
        for recipient in (lost.creator, lost.pet.owner):
            if recipient is None or recipient.pk in notified:
                continue
            notified.add(recipient.pk)
            NotificationService.create(
                recipient,
                kind=Notification.Kind.MATCH_FOUND,
                title=f"Possible match: {found_name} was found",
                body=(
                    f"A found pet photo matches your lost pet {lost_name} "
                    f"(match confidence {score_pct}). See the found report."
                ),
                link=f"/flyers/{found.pk}",
            )
        if found.creator_id not in notified:
            NotificationService.create(
                found.creator,
                kind=Notification.Kind.MATCH_LOST,
                title="Your found pet may match a lost report",
                body=(
                    f"Your found pet photo matches a lost report for {lost_name} "
                    f"(match confidence {score_pct}). See the lost flyer."
                ),
                link=f"/flyers/{lost.pk}",
            )
