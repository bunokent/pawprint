"""Pure rules shared by flyer/pet edit validation (no Django imports)."""

from __future__ import annotations

from collections.abc import Mapping


def pet_name_missing(mode: str, name: str | None) -> bool:
    """Found-pet reports are unnamed; every other flyer mode needs a pet name."""
    return mode != "found" and not (name or "").strip()


def flyer_is_editable(status: str | None) -> bool:
    """A resolved flyer is final: neither its details nor its pet may be changed."""
    return status != "resolved"


# Every field except `status` (resolve) and `photo_path` itself. A status-only
# PATCH must keep working; any other update must carry a cover photo.
EDIT_DETAIL_FIELDS = frozenset({
    "mode", "name", "species", "breed", "color", "age", "temperament_tags",
    "health_tags", "last_seen_location", "last_seen_date", "location_lat",
    "location_lng", "distinctive_markings", "contact_phone", "contact_email",
})


def update_missing_photo(fields: Mapping[str, object]) -> bool:
    """True when a detail update omits or clears the required cover photo."""
    if "photo_path" in fields:
        value = fields["photo_path"]
        return not isinstance(value, str) or not value.strip()
    return bool(EDIT_DETAIL_FIELDS.intersection(fields))
