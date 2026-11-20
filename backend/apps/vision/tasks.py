"""Vision tasks (queue: images)."""

from __future__ import annotations

import logging

from celery import shared_task

logger = logging.getLogger(__name__)


@shared_task(name="apps.vision.tasks.recheck_photo")
def recheck_photo(log_id: str) -> bool:
    """Re-run detection for an existing log (admin-free maintenance hook)."""
    import uuid

    from .selectors import get_log_by_id

    log = get_log_by_id(uuid.UUID(log_id))
    if log is None:
        return False
    logger.info("recheck_photo log=%s passed=%s", log_id, log.passed)
    return log.passed


@shared_task(name="apps.vision.tasks.match_flyer")
def match_flyer(flyer_id: str) -> int:
    """Compare a flyer's pet photo against the opposite mode's active flyers.

    Creates PetMatch rows + notifications for pairs whose CLIP embedding cosine
    similarity >= PET_MATCH_SIMILARITY_THRESHOLD. Returns the match count.
    """
    from .services import PetMatchService

    matches = PetMatchService.match_flyer(flyer_id)
    logger.info("match_flyer flyer=%s matches=%d", flyer_id, len(matches))
    return len(matches)
