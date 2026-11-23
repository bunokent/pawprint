"""Unified user model — one account acts as owner, shelter volunteer or foster.

There is deliberately NO admin surface: `django.contrib.admin` is not installed and
`is_staff`/`is_superuser` carry no product meaning.
"""

import uuid

from django.contrib.auth.models import AbstractUser
from django.db import models

from .managers import UserManager


class User(AbstractUser):
    """Single unified account. Email is the login identifier."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    username = None  # type: ignore[assignment, misc]
    email = models.EmailField(unique=True)
    display_name = models.CharField(max_length=120, blank=True)
    phone = models.CharField(max_length=32, blank=True)
    avatar_path = models.CharField(max_length=512, blank=True)
    google_id = models.CharField(max_length=64, unique=True, null=True, blank=True)
    email_verified = models.BooleanField(default=False)

    USERNAME_FIELD = "email"
    REQUIRED_FIELDS: list[str] = []  # type: ignore[misc]

    objects = UserManager()  # type: ignore[assignment,misc]

    class Meta:
        db_table = "users_user"
        indexes = [models.Index(fields=["email"], name="user_email_idx")]

    def __str__(self) -> str:
        return self.email
