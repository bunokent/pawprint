"""Flyer selectors — optimized public gallery + detail reads."""

from __future__ import annotations

import uuid

from django.contrib.postgres.search import SearchQuery, SearchRank
from django.db.models import F, QuerySet

from .models import Flyer


def select_flyer_queryset() -> QuerySet[Flyer]:
    """Base queryset: FKs joined, payload trimmed with only()."""
    return (
        Flyer.objects.select_related("pet", "pet__owner", "creator")
        # Every angle of the pet (bounded by MAX_PET_PHOTOS) — one extra query for
        # the whole page, so the serializer never N+1s on pet.photos.
        .prefetch_related("pet__photos")
        .only(
            "id", "mode", "status", "last_seen_location", "last_seen_date",
            "location_lat", "location_lng",
            "distinctive_markings", "contact_phone", "contact_email",
            "reward_enabled", "reward_amount_cents", "reward_currency",
            "qr_target_type", "qr_target_value", "export_png_path", "export_pdf_path",
            "created_at", "updated_at",
            "pet__id", "pet__name", "pet__species", "pet__breed", "pet__color", "pet__age",
            "pet__temperament_tags", "pet__health_tags", "pet__photo_path", "pet__status",
            "pet__search_vector",
            "pet__owner__id", "pet__owner__display_name",
            "creator__id", "creator__display_name", "creator__avatar_path",
        )
    )


def list_public_flyers(*, mode: str | None = None, query: str | None = None,
                      status: str = Flyer.Status.ACTIVE) -> QuerySet[Flyer]:
    """Public gallery: active flyers, optional mode filter + full-text search on the pet."""
    qs = select_flyer_queryset().filter(status=status)
    if mode:
        qs = qs.filter(mode=mode)
    if query:
        search_query = SearchQuery(query, config="english")
        qs = (
            qs.filter(pet__search_vector=search_query)
            .annotate(rank=SearchRank(F("pet__search_vector"), search_query))
            .order_by("-rank", "-created_at")
        )
    else:
        qs = qs.order_by("-created_at")
    return qs


def get_flyer_by_id(flyer_id: uuid.UUID) -> Flyer | None:
    return select_flyer_queryset().filter(pk=flyer_id).first()


def list_flyers_by_creator(creator_id: uuid.UUID) -> QuerySet[Flyer]:
    return select_flyer_queryset().filter(creator_id=creator_id).order_by("-created_at")


def list_map_flyers() -> QuerySet[Flyer]:
    """Interactive pet map: active lost/found flyers that carry a pin (lat/lng)."""
    return (
        select_flyer_queryset()
        .filter(
            status=Flyer.Status.ACTIVE,
            mode__in=[Flyer.Mode.EMERGENCY, Flyer.Mode.FOUND],
        )
        .exclude(location_lat__isnull=True)
        .exclude(location_lng__isnull=True)
        .order_by("-created_at")
    )
