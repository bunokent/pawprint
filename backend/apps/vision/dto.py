"""DTOs for the vision gatekeeper."""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass(frozen=True)
class DetectionResult:
    passed: bool
    pet_classes: list[str] = field(default_factory=list)
    detected_classes: list[str] = field(default_factory=list)
    max_confidence: float = 0.0
    # xyxy pixel box (absolute coordinates) of the highest-confidence accepted animal
    # detection — used to build the in-memory padded crop for re-identification.
    # Never written to storage; the original uncropped image stays the display image.
    best_box: tuple[float, float, float, float] | None = None


@dataclass(frozen=True)
class PairScore:
    """Max cosine similarity over every cross-photo embedding pair, plus the winning pair.

    `best_a_index`/`best_b_index` are the positions in the two embedding lists that
    produced `max_similarity` (-1 when either side is empty).
    """

    max_similarity: float
    best_a_index: int = -1
    best_b_index: int = -1


@dataclass(frozen=True)
class CandidateMatch:
    """One ranked counterpart flyer for a lost/found report (see PetMatchService.rank_candidates)."""

    flyer_id: str
    mode: str
    max_similarity: float
    best_a_index: int = -1
    best_b_index: int = -1
    is_match: bool = False  # max_similarity >= PET_MATCH_SIMILARITY_THRESHOLD


@dataclass(frozen=True)
class AttributeDetection:
    """CLIP zero-shot breed/color readout for an already-gated pet photo.

    YOLO-World handles detection only — breed and color come from this separate
    classifier. `breed` is empty with confidence 0.0 for species without a breed
    list (we never guess a breed for a rabbit or a fish).
    """

    breed: str = ""
    breed_confidence: float = 0.0
    color: str = ""
    color_confidence: float = 0.0
