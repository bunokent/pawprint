"""backfill_matches — re-run lost/found photo matching for every active flyer.

Repairs data created while the matcher was failing or before embeddings were
cached (including legacy CLIP full-frame embeddings — an `embedding_model` tag
mismatch forces a fresh MegaDescriptor embed): creates PetMatch rows and sends
match notifications for every lost/found pair whose photos now compare >=
PET_MATCH_SIMILARITY_THRESHOLD. Safe to re-run — pairs are unique and notified
only once.
"""

from __future__ import annotations

from django.core.management.base import BaseCommand

from apps.vision.models import PetMatch
from apps.vision.services import PetMatchService


class Command(BaseCommand):
    help = (
        "Re-run CLIP photo matching for all active lost/found flyers; "
        "creates PetMatch rows + notifications for newly matched pairs."
    )

    def handle(self, *args: object, **options: object) -> None:
        matched_flyers = PetMatchService.match_all_active_flyers()
        self.stdout.write(
            self.style.SUCCESS(
                f"backfill_matches: evaluated active lost/found flyers, "
                f"{matched_flyers} with matches, {PetMatch.objects.count()} PetMatch rows on record."
            )
        )
