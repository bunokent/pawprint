"""Pure validation for replacement photo keys (no Django imports, easy to test)."""

from __future__ import annotations

import re

# flyers/{user_id}/{losts|adoptions|found}/{uuid}.jpg — the exact shape written by
# PetPhotoService.upload. Rejecting anything else stops callers from swapping in
# another user's object; the flyer ownership check happens before the serializer.
PHOTO_KEY_RE = re.compile(
    r"^flyers/[0-9a-fA-F-]{36}/([a-z]+)/[0-9a-fA-F-]{36}\.jpg$"
)


def is_valid_photo_key(value: str, owner_id: object, category: str) -> bool:
    """True only for a full photo belonging to this owner and flyer category."""
    return bool(
        PHOTO_KEY_RE.fullmatch(value)
        and value.startswith(f"flyers/{owner_id}/{category}/")
    )
