"""Notification selectors — per-user reads."""

from __future__ import annotations

from .models import Notification


def list_notifications(user, *, limit: int = 50) -> list[Notification]:
    return list(Notification.objects.filter(user=user)[:limit])


def unread_count(user) -> int:
    return Notification.objects.filter(user=user, read_at__isnull=True).count()
