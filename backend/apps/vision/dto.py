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
    # detection — used to build the in-memory padded crop for the CLIP species-naming
    # pass. Never written to storage; the original uncropped image stays the display image.
    best_box: tuple[float, float, float, float] | None = None


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
