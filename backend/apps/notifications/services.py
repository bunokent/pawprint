"""Notification service — create + realtime push, mark-read."""

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
