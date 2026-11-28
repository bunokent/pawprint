"""Reusable input validation shared by API serializers."""

from __future__ import annotations

from django.conf import settings
from phonenumber_field.phonenumber import PhoneNumber, to_python
from rest_framework import serializers

PH_COUNTRY_CODE = 63
PHONE_ERROR = "Enter a valid Philippine phone number (e.g. 0917 123 4567)."


def clean_phone(value: str) -> str:
    """Validate a Philippine phone number and store it in E.164 form.

    `django-phonenumber-field` parses national input with the configured
    `PHONENUMBER_DEFAULT_REGION` ("PH"), so 0917…, 63917… and +63917… all resolve
    to the same number. Foreign numbers, short codes, extensions and invalid
    Philippine prefixes are rejected; blank remains allowed for optional fields.
    """
    phone = value.strip()
    if not phone:
        return ""
    number = to_python(phone, region=settings.PHONENUMBER_DEFAULT_REGION)
    if (
        not isinstance(number, PhoneNumber)
        or not number.is_valid()
        or number.country_code != PH_COUNTRY_CODE
        or number.extension
    ):
        raise serializers.ValidationError(PHONE_ERROR)
    return number.as_e164
