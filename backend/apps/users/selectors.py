"""User selectors — all DB reads for users live here."""

from __future__ import annotations

import uuid

from django.db.models import QuerySet

from .models import User


def select_user_queryset() -> QuerySet[User]:
    return User.objects.all().only(
        "id", "email", "display_name", "phone", "avatar_path", "google_id",
        "email_verified", "is_active", "date_joined",
    )


def get_user_by_id(user_id: uuid.UUID) -> User | None:
    return select_user_queryset().filter(pk=user_id).first()


def get_user_by_email(email: str) -> User | None:
    return select_user_queryset().filter(email__iexact=email).first()


def get_user_by_google_id(google_id: str) -> User | None:
    return select_user_queryset().filter(google_id=google_id).first()
