"""Reusable input validation shared by API serializers."""

from __future__ import annotations

import re

from rest_framework import serializers

_PHONE_CHARACTERS = re.compile(r"[+()\d\s.-]")
_NON_DIGITS = re.compile(r"\D")


def clean_phone(value: str) -> str:
    """Trim a phone number and enforce 7–15 digits (the E.164 digit limit)."""
    phone = value.strip()
    if phone and (
        not all(_PHONE_CHARACTERS.fullmatch(char) for char in phone)
        or not 7 <= len(_NON_DIGITS.sub("", phone)) <= 15
    ):
        raise serializers.ValidationError("Enter a valid phone number (7–15 digits).")
    return phone
