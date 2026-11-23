"""PetDetectionService — YOLO-World animal gate + CLIP species naming.

Every uploaded pet photo is validated BEFORE any private-storage write. YOLO-World proves an animal is
present; CLIP ViT-B/32 then names the actual species for `pet_classes` while raw YOLO labels stay in
`detected_classes`. Non-animal photos are discarded immediately and raise NoPetDetectedError
(HTTP 422). There are no strikes and no bans — the user can simply pick another photo.
"""

from __future__ import annotations

import io
import logging
from pathlib import Path
from threading import Lock
from typing import TYPE_CHECKING, Any

from django.conf import settings
from PIL import Image, ImageOps

from apps.common.exceptions import NoPetDetectedError

from .dto import AttributeDetection, DetectionResult

if TYPE_CHECKING:
    from ultralytics import YOLOWorld

logger = logging.getLogger(__name__)

# Open-vocabulary labels passed to YOLOWorld.set_classes(). The mapping keeps the
# model's specific output labels while grouping them into PawPrint animal categories.
ANIMAL_CATEGORY_BY_LABEL: dict[str, str] = {
    # Domestic pets
    "dog": "Domestic Pet",
    "cat": "Domestic Pet",
    # Zoo / exotic animals
    "lion": "Zoo / Exotic",
    "tiger": "Zoo / Exotic",
    "wolf": "Zoo / Exotic",
    "fox": "Zoo / Exotic",
    "bear": "Zoo / Exotic",
    "elephant": "Zoo / Exotic",
    "giraffe": "Zoo / Exotic",
    "zebra": "Zoo / Exotic",
    "kangaroo": "Zoo / Exotic",
    "koala": "Zoo / Exotic",
    "panda": "Zoo / Exotic",
    "monkey": "Zoo / Exotic",
    "deer": "Zoo / Exotic",
    # Reptiles
    "crocodile": "Reptile",
    "alligator": "Reptile",
    "snake": "Reptile",
    "lizard": "Reptile",
    "gecko": "Reptile",
    "iguana": "Reptile",
    "chameleon": "Reptile",
    "turtle": "Reptile",
    "tortoise": "Reptile",
    # Amphibians
    "frog": "Amphibian",
    "toad": "Amphibian",
    # Small mammals
    "hamster": "Small Mammal",
    "guinea pig": "Small Mammal",
    "ferret": "Small Mammal",
    "chinchilla": "Small Mammal",
    "mouse": "Small Mammal",
    "rat": "Small Mammal",
    "hedgehog": "Small Mammal",
    "sugar glider": "Small Mammal",
    "rabbit": "Small Mammal",
    # Farm animals, including farm birds
    "horse": "Farm Animal",
    "sheep": "Farm Animal",
    "cow": "Farm Animal",
    "goat": "Farm Animal",
    "pig": "Farm Animal",
    "donkey": "Farm Animal",
    "llama": "Farm Animal",
    "alpaca": "Farm Animal",
    "chicken": "Farm Animal",
    "duck": "Farm Animal",
    "goose": "Farm Animal",
    "turkey": "Farm Animal",
    # Birds
    "bird": "Bird",
    "parrot": "Bird",
    "cockatiel": "Bird",
    "parakeet": "Bird",
    "budgerigar": "Bird",
    "canary": "Bird",
    "finch": "Bird",
    "lovebird": "Bird",
    "macaw": "Bird",
    "cockatoo": "Bird",
    "pigeon": "Bird",
    "dove": "Bird",
    # Fish
    "fish": "Fish",
    "goldfish": "Fish",
    "betta fish": "Fish",
    "koi": "Fish",
    "guppy": "Fish",
    "angelfish": "Fish",
    "clownfish": "Fish",
}

ANIMAL_CLASSES: tuple[str, ...] = tuple(ANIMAL_CATEGORY_BY_LABEL)
DEFAULT_YOLO_WORLD_MODEL = "yolov8s-worldv2.pt"

# CLIP ViT-B/32 is the same text encoder YOLO-World uses for prompts. We reuse it as a
# second-stage zero-shot species classifier: YOLO-World stays the animal gate/boxer, and
# CLIP names the actual animal (fox, crocodile, frog, rabbit, dog, …) instead of a nearby
# COCO-ish label such as cat or bird.
CLIP_PROMPT_TEMPLATES: tuple[str, ...] = (
    "a photo of a {}",
    "a close-up photo of a {}",
    "a clear photo of a {} animal",
    "a photo of a pet {}",
)
SPECIES_PROMPT_OVERRIDES: dict[str, tuple[str, ...]] = {
    "dog": (
        "a domestic dog kept as a pet",
        "a pet dog looking at the camera",
        "a small pet dog next to a person, furniture or a household floor",
    ),
    "cat": (
        "a domestic house cat kept as a pet",
        "a pet cat looking at the camera",
        "a small pet tabby cat sitting on the ground or floor",
        "a house cat — small and tame, not a wild big cat",
    ),
    "tiger": (
        "a large wild tiger with orange fur and black stripes, much bigger than a house cat",
        "a tiger in the wild or in a zoo enclosure",
    ),
    "lion": (
        "a large wild lion with a mane, in the savanna or a zoo",
        "a big wild cat with a mane — not a house cat",
    ),
    "bear": ("a large wild bear in a forest",),
    "fox": (
        "a wild red fox with pointed ears and a bushy tail in nature",
        "a red fox in the wild — not a pet dog",
    ),
    "wolf": (
        "a large wild grey wolf in a forest, bigger than a pet dog",
        "a wild wolf with pointed ears — not a domestic dog",
    ),
    "deer": ("a wild deer with antlers in a forest",),
    "horse": ("a horse standing in a field or stable",),
    "hedgehog": (
        "a small hedgehog covered in short brown spines, curled into a ball",
        "a tiny hedgehog with a pointed snout and spiky back",
    ),
    "crocodile": (
        "a crocodile with a broad snout",
        "a crocodile in water",
        "a close-up of a crocodile's scaly skin",
    ),
    "alligator": ("an alligator with a rounded snout", "an alligator in water"),
    "lizard": ("a lizard",),
    "gecko": ("a gecko lizard",),
    "iguana": ("an iguana lizard",),
    "chameleon": ("a chameleon lizard",),
    "frog": ("a green frog", "a frog sitting on a leaf or rock", "a frog amphibian"),
    "toad": ("a toad with bumpy skin", "a toad amphibian"),
    "rabbit": (
        "a rabbit with long ears",
        "a bunny rabbit",
        "a cottontail rabbit",
        "a pet rabbit with long ears and a short tail",
    ),
    "mouse": ("a small mouse with small rounded ears",),
    "rat": ("a rat with a long tail",),
    "hamster": ("a small hamster with cheek pouches",),
    "guinea pig": ("a guinea pig with a round body",),
    "chinchilla": ("a chinchilla with soft grey fur",),
}
# Labels that CLIP/YOLO-World confuse on pet photos — a tabby cat reads as "tiger"
# (stripes) or even "hedgehog" (spiky-looking fur), a dog as "wolf"/"fox". When the top
# pick lands in one of these groups with a rival close behind, a focused contrast pass
# (GROUP_CONTRAST_PROMPTS on the cropped animal) decides the single winner.
CONFUSABLE_GROUPS: dict[str, tuple[str, ...]] = {
    "feline": ("cat", "tiger", "lion"),
    "canine": ("dog", "wolf", "fox"),
    "spiny": ("hedgehog", "porcupine"),
    "lagomorph": ("rabbit", "hare"),
    "rodent": ("mouse", "rat", "hamster", "guinea pig", "chinchilla"),
    "crocodilian": ("crocodile", "alligator"),
    "anuran": ("frog", "toad"),
}
GROUP_CONTRAST_PROMPTS: dict[str, dict[str, tuple[str, ...]]] = {
    "feline": {
        "cat": (
            "a small domestic house cat kept as a pet, with soft fur and no big-cat stripes",
            "a pet tabby cat sitting on concrete or a floor indoors or in a yard",
        ),
        "tiger": (
            "a large wild tiger with bold orange-and-black stripes, far bigger than any house cat",
            "a tiger in jungle or zoo surroundings",
        ),
        "lion": ("a large wild lion with a mane in the wild or a zoo",),
    },
    "canine": {
        "dog": (
            "a domestic pet dog, small or medium, next to people or household things",
            "a pet dog being held or sitting at home",
        ),
        "wolf": ("a large wild grey wolf in a forest, much bigger than a pet dog",),
        "fox": ("a wild red fox with a bushy tail in nature, not a pet",),
    },
    "spiny": {
        "hedgehog": ("a small hedgehog covered in spines, curled into a ball",),
        "porcupine": ("a porcupine with long quills on its back",),
    },
    "lagomorph": {
        "rabbit": ("a rabbit with long ears and a short fluffy tail",),
        "hare": ("a wild hare with very long ears in a field",),
    },
    "rodent": {
        "mouse": ("a tiny mouse with small rounded ears",),
        "rat": ("a rat with a long bare tail",),
        "hamster": ("a small hamster with cheek pouches",),
        "guinea pig": ("a round guinea pig",),
        "chinchilla": ("a chinchilla with soft grey fur",),
    },
    "crocodilian": {
        "crocodile": ("a crocodile with a long broad snout and scaly skin",),
        "alligator": ("an alligator with a short rounded snout",),
    },
    "anuran": {
        "frog": ("a green frog with smooth skin",),
        "toad": ("a toad with dry bumpy skin",),
    },
}
# A group rival within this probability margin of the top pick triggers the contrast pass.
GROUP_RIVAL_MARGIN = 0.20
CLIP_ANIMAL_PROMPTS: tuple[str, ...] = (
    "a photo of an animal",
    "a photo of a pet",
    "a photo of wildlife",
    "a close-up of an animal",
    "a photo of a reptile",
    "a photo of an amphibian",
    "a photo of a fish",
    "a photo of a farm animal",
)
CLIP_NON_ANIMAL_PROMPTS: tuple[str, ...] = (
    "a photo of a landscape with no animal",
    "a photo of scenery with no animal",
    "a photo of a person with no animal",
    "a photo of food with no animal",
    "a photo of an object with no animal",
    "a plain background with no animal",
)
CLIP_ANIMAL_GATE_MIN_PROBABILITY = 0.25
CLIP_SPECIES_MIN_PROBABILITY = 0.15
# Only CLIP labels within this fraction of the top probability stay selected — a tabby
# cat must not also be labelled "hedgehog" just because both cleared the absolute floor.
CLIP_SPECIES_RELATIVE_MARGIN = 0.9
# Padding (fraction of the box size per side) for the in-memory crop that is classified:
# naming the species from the cropped animal — not the full scene — keeps background
# clutter (concrete, leaves, walls) from tipping CLIP toward wild lookalikes.
SPECIES_CROP_PADDING = 0.25

# A flat logo can still read as "dog" to YOLO-World's open vocabulary (a stylized paw
# mark inside a map pin, a cartoon dog in a brand mark). A dedicated CLIP photo-vs-graphic
# pass over the FULL frame settles it: a graphic is rejected only when it clearly wins
# over every real-photo prompt. Real pet photos — including a small pet on a plain
# background — keep a photo prompt at least as likely, so they are never caught by it.
CLIP_PHOTO_PROMPTS: tuple[str, ...] = (
    "a photograph of a real living animal",
    "a camera photo of a pet with natural fur feathers or scales",
    "a real photo of a dog cat bird or other animal",
    "a person holding a real pet in a photograph",
)
CLIP_GRAPHIC_PROMPTS: tuple[str, ...] = (
    "a logo or app icon on a solid color background",
    "a flat vector illustration or graphic design",
    "a map location pin icon",
    "a stylized paw print symbol, not a real animal",
    "clipart or a brand mark",
    "a cartoon icon, not a photograph of a real animal",
)
GRAPHIC_REJECT_MIN_PROBABILITY = 0.50
GRAPHIC_REJECTION_MESSAGE = (
    "This looks like a logo or illustration, not a photo of a real pet. "
    "Please upload a clear photo of your pet."
)

_MODEL: YOLOWorld | None = None
_MODEL_LOCK = Lock()
_CLIP_MODEL: Any | None = None
_CLIP_LOCK = Lock()
_CLIP_TEXT_FEATS: Any | None = None
_CLIP_GATE_TEXT_FEATS: Any | None = None
_CLIP_GRAPHIC_TEXT_FEATS: Any | None = None
_CLIP_LABEL_RANGES: dict[str, tuple[int, int]] = {}


def load_image(image_bytes: bytes) -> Image.Image:
    """Open upload bytes EXIF-orientation-normalized and converted to RGB."""
    image = ImageOps.exif_transpose(Image.open(io.BytesIO(image_bytes)))
    image.load()
    if image.mode != "RGB":
        image = image.convert("RGB")
    return image


def _resolve_world_model_path(path: str) -> str:
    """Return a YOLO-World checkpoint path, replacing stale non-World paths."""
    if "world" not in Path(path).name.lower():
        logger.warning(
            "YOLO_MODEL_PATH=%r is not a YOLO-World checkpoint; using %r",
            path,
            DEFAULT_YOLO_WORLD_MODEL,
        )
        return DEFAULT_YOLO_WORLD_MODEL
    return path


def _get_model() -> YOLOWorld:
    """Lazily load, configure, and cache one YOLO-World model per process."""
    global _MODEL
    if _MODEL is None:
        with _MODEL_LOCK:
            if _MODEL is None:
                from ultralytics import YOLOWorld

                model_path = _resolve_world_model_path(settings.YOLO_MODEL_PATH)
                model = YOLOWorld(model_path)
                if not hasattr(getattr(model, "model", None), "set_classes"):
                    raise RuntimeError(
                        f"YOLO-World checkpoint required at {model_path!r}; "
                        f"loaded {type(getattr(model, 'model', model)).__name__}. "
                        f"Set YOLO_MODEL_PATH={DEFAULT_YOLO_WORLD_MODEL}."
                    )
                model.set_classes(list(ANIMAL_CLASSES))
                _MODEL = model
    return _MODEL


def _build_clip_prompts() -> tuple[list[str], dict[str, tuple[int, int]]]:
    """Build CLIP text prompts for every supported species label."""
    prompts: list[str] = []
    ranges: dict[str, tuple[int, int]] = {}
    for label in ANIMAL_CLASSES:
        start = len(prompts)
        prompts.extend(template.format(label) for template in CLIP_PROMPT_TEMPLATES)
        prompts.extend(SPECIES_PROMPT_OVERRIDES.get(label, ()))
        ranges[label] = (start, len(prompts))
    return prompts, ranges


def _normalize_torch(vector: Any) -> Any:
    return vector / vector.norm(p=2, dim=-1, keepdim=True)


def _prepare_clip_text_feats(clip_model: Any) -> tuple[Any, Any, dict[str, tuple[int, int]]]:
    import torch

    prompts, ranges = _build_clip_prompts()
    with torch.no_grad():
        text_feats = _normalize_torch(clip_model.encode_text(clip_model.tokenize(prompts)))
    gate_prompts = [*CLIP_ANIMAL_PROMPTS, *CLIP_NON_ANIMAL_PROMPTS]
    with torch.no_grad():
        gate_feats = _normalize_torch(clip_model.encode_text(clip_model.tokenize(gate_prompts)))
    return text_feats, gate_feats, ranges


def _get_clip_model() -> Any:
    """Lazily load/cache the CLIP ViT-B/32 encoder used for species naming."""
    global _CLIP_MODEL, _CLIP_TEXT_FEATS, _CLIP_GATE_TEXT_FEATS, _CLIP_LABEL_RANGES
    if _CLIP_MODEL is None:
        with _CLIP_LOCK:
            if _CLIP_MODEL is None:
                world_model = getattr(_get_model(), "model", None)
                clip_model = getattr(world_model, "clip_model", None)
                if clip_model is None:
                    import torch
                    from ultralytics.nn.text_model import build_text_model

                    device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
                    clip_model = build_text_model("clip:ViT-B/32", device=device)
                _CLIP_TEXT_FEATS, _CLIP_GATE_TEXT_FEATS, _CLIP_LABEL_RANGES = _prepare_clip_text_feats(clip_model)
                _CLIP_MODEL = clip_model
    return _CLIP_MODEL


def _clip_rank(image: Any, clip_model: Any | None = None) -> list[tuple[str, float]]:
    """Rank all supported species labels for an image with CLIP (probabilities)."""
    import torch

    model = clip_model or _get_clip_model()
    if clip_model is None:
        text_feats = _CLIP_TEXT_FEATS
        ranges = _CLIP_LABEL_RANGES
    else:
        text_feats, _, ranges = _prepare_clip_text_feats(model)
    assert text_feats is not None
    with torch.no_grad():
        image_feat = model.encode_image(image)
        logits = (100.0 * image_feat @ text_feats.T).squeeze(0)
    scores: list[tuple[str, float]] = []
    for label, (start, end) in ranges.items():
        scores.append((label, float(logits[start:end].mean().item())))
    probs = torch.softmax(torch.tensor([score for _, score in scores]), dim=0)
    ranked = sorted(zip([label for label, _ in scores], probs.tolist(), strict=True), key=lambda item: -item[1])
    return [(label, float(prob)) for label, prob in ranked]


def _clip_animal_gate(image: Any, clip_model: Any | None = None) -> bool:
    """CLIP fallback gate for clear animal photos that YOLO-World misses at 0.20."""
    import torch

    model = clip_model or _get_clip_model()
    if clip_model is None:
        gate_feats = _CLIP_GATE_TEXT_FEATS
    else:
        _, gate_feats, _ = _prepare_clip_text_feats(model)
    assert gate_feats is not None
    with torch.no_grad():
        image_feat = model.encode_image(image)
        logits = (100.0 * image_feat @ gate_feats.T).squeeze(0)
    probs = torch.softmax(logits, dim=0)
    animal_count = len(CLIP_ANIMAL_PROMPTS)
    animal_prob = float(probs[:animal_count].max().item())
    non_animal_prob = float(probs[animal_count:].max().item())
    return animal_prob >= CLIP_ANIMAL_GATE_MIN_PROBABILITY and animal_prob > non_animal_prob


def _graphic_text_feats(clip_model: Any, cached: bool) -> Any:
    """Encode the photo-vs-graphic prompts once for the process CLIP singleton."""
    global _CLIP_GRAPHIC_TEXT_FEATS
    if cached and _CLIP_GRAPHIC_TEXT_FEATS is not None:
        return _CLIP_GRAPHIC_TEXT_FEATS
    import torch

    prompts = [*CLIP_PHOTO_PROMPTS, *CLIP_GRAPHIC_PROMPTS]
    with torch.no_grad():
        feats = _normalize_torch(clip_model.encode_text(clip_model.tokenize(prompts)))
    if cached:
        _CLIP_GRAPHIC_TEXT_FEATS = feats
    return feats


def _clip_is_flat_graphic(image: Any, clip_model: Any | None = None) -> bool:
    """True when a logo/illustration prompt clearly beats every real-photo prompt.

    Runs on the FULL frame, not the animal crop: the point is to tell a flat brand
    mark from a camera photo. The asymmetric rule — graphic must be at least
    GRAPHIC_REJECT_MIN_PROBABILITY *and* strictly greater than the best photo prompt —
    keeps ambiguous real photos (a small pet on white, a dark coat, a busy yard)
    passing while rejecting a logo that YOLO-World mistook for a dog.
    """
    import torch

    model = clip_model or _get_clip_model()
    text_feats = _graphic_text_feats(model, cached=clip_model is None)
    with torch.no_grad():
        image_feat = model.encode_image(image)
        logits = (100.0 * image_feat @ text_feats.T).squeeze(0)
    probs = torch.softmax(logits, dim=0)
    photo_count = len(CLIP_PHOTO_PROMPTS)
    photo_prob = float(probs[:photo_count].max().item())
    graphic_prob = float(probs[photo_count:].max().item())
    logger.debug("Graphic gate: photo=%.3f graphic=%.3f", photo_prob, graphic_prob)
    return graphic_prob >= GRAPHIC_REJECT_MIN_PROBABILITY and graphic_prob > photo_prob


def _group_contrast_rank(
    image: Any, group: str, members: tuple[str, ...], clip_model: Any | None = None
) -> list[tuple[str, float]]:
    """Focused CLIP ranking of one confusable group with contrastive prompts.

    e.g. feline members compared as "small domestic house cat" vs "large wild tiger" —
    the prompts force CLIP to use size/domestication cues instead of just stripes.
    """
    import torch

    model = clip_model or _get_clip_model()
    prompts: list[str] = []
    ranges: dict[str, tuple[int, int]] = {}
    for label in members:
        start = len(prompts)
        prompts.extend(GROUP_CONTRAST_PROMPTS.get(group, {}).get(label, ()))
        prompts.extend(template.format(label) for template in CLIP_PROMPT_TEMPLATES)
        prompts.extend(SPECIES_PROMPT_OVERRIDES.get(label, ()))
        ranges[label] = (start, len(prompts))
    with torch.no_grad():
        text_feats = _normalize_torch(model.encode_text(model.tokenize(prompts)))
        image_feat = model.encode_image(image)
        logits = (100.0 * image_feat @ text_feats.T).squeeze(0)
    scores = [(label, float(logits[start:end].mean().item())) for label, (start, end) in ranges.items()]
    probs = torch.softmax(torch.tensor([score for _, score in scores]), dim=0)
    ranked = sorted(zip([label for label, _ in scores], probs.tolist(), strict=True), key=lambda item: -item[1])
    return [(label, float(prob)) for label, prob in ranked]


def _confusable_group_winner(
    image: Any, rank: list[tuple[str, float]], clip_model: Any | None = None
) -> str | None:
    """Single species when the top pick is a confusable lookalike of a rival.

    Returns the contrast-pass winner when the top label belongs to a multi-member
    confusable group and another member is within GROUP_RIVAL_MARGIN of it (e.g. a tabby
    cat ranked "tiger" with "cat" close behind); None otherwise.
    """
    top_label, top_prob = rank[0]
    if top_prob < CLIP_SPECIES_MIN_PROBABILITY:
        return None  # uniform/garbage ranking — no meaningful top pick to disambiguate
    group = next((name for name, labels in CONFUSABLE_GROUPS.items() if top_label in labels), None)
    if group is None:
        return None
    members = tuple(label for label in CONFUSABLE_GROUPS[group] if label in ANIMAL_CATEGORY_BY_LABEL)
    if len(members) < 2:
        return None
    rivals = [
        label
        for label, prob in rank
        if label in members and label != top_label and prob >= top_prob - GROUP_RIVAL_MARGIN
    ]
    if not rivals:
        return None
    contrast = _group_contrast_rank(image, group, members, clip_model)
    return contrast[0][0] if contrast else None


def _refine_species(image: Any, accepted_raw: list[str], clip_model: Any | None = None) -> list[str]:
    """Name the actual animal with CLIP; fall back to YOLO-World labels when unsure.

    Runs on the cropped animal region (see validate_pet_image). A confusable-group
    contrast pass resolves lookalikes (tabby cat vs tiger/wolf vs dog) to a single
    species; otherwise only labels within CLIP_SPECIES_RELATIVE_MARGIN of the top
    probability are kept.
    """
    rank = _clip_rank(image, clip_model)
    if not rank:
        return list(accepted_raw)
    winner = _confusable_group_winner(image, rank, clip_model)
    if winner is not None:
        return [winner]
    top_prob = rank[0][1]
    min_prob = max(CLIP_SPECIES_MIN_PROBABILITY, top_prob * CLIP_SPECIES_RELATIVE_MARGIN)
    selected = [label for label, prob in rank if prob >= min_prob and label in ANIMAL_CATEGORY_BY_LABEL]
    if selected:
        return selected
    if accepted_raw:
        return list(accepted_raw)
    return [rank[0][0]] if top_prob >= settings.YOLO_CONFIDENCE_THRESHOLD else []


Box = tuple[float, float, float, float]  # xyxy pixel box


def _run_detection(model: YOLOWorld, image: Image.Image) -> list[tuple[str, float, Box | None]]:
    """One YOLO-World predict pass → [(label, confidence, xyxy box), ...] for every box."""
    detections: list[tuple[str, float, Box | None]] = []
    for result in model.predict(image, conf=settings.YOLO_CONFIDENCE_THRESHOLD, verbose=False):
        if not hasattr(result, "names") or not hasattr(result, "boxes"):
            continue
        names = result.names
        boxes = result.boxes
        if boxes is None:
            continue
        xyxy = getattr(boxes, "xyxy", None)
        for index, (cls_id, conf) in enumerate(zip(boxes.cls.tolist(), boxes.conf.tolist(), strict=True)):
            label = str(names[int(cls_id)]).strip().lower()
            box: Box | None = None
            if xyxy is not None and index < len(xyxy):
                x1, y1, x2, y2 = (float(v) for v in xyxy[index].tolist())  # type: ignore[index]
                box = (x1, y1, x2, y2)
            detections.append((label, float(conf), box))
    return detections


def padded_crop(
    image: Image.Image,
    box: Box | None,
    padding: float,
) -> Image.Image:
    """In-memory crop of `box` (xyxy, absolute pixels) expanded by `padding` (a fraction of
    the box size on every side), clamped to the image bounds. Falls back to the full image
    when no box is given or the padded box degenerates — the stored display image is never
    modified; this crop exists only for the in-memory CLIP species-classification pass.
    """
    if box is None:
        return image
    width, height = image.size
    x1, y1, x2, y2 = box
    box_w = max(1.0, x2 - x1)
    box_h = max(1.0, y2 - y1)
    x1 = max(0.0, x1 - box_w * padding)
    y1 = max(0.0, y1 - box_h * padding)
    x2 = min(float(width), x2 + box_w * padding)
    y2 = min(float(height), y2 + box_h * padding)
    if x2 <= x1 or y2 <= y1:
        return image
    return image.crop((int(x1), int(y1), int(x2), int(y2)))


class PetDetectionService:
    """Validates that an image contains an animal from the configured categories."""

    def best_animal_box(self, image: Image.Image) -> Box | None:
        """xyxy box of the highest-confidence accepted animal detection (None if no box)."""
        best: Box | None = None
        best_conf = 0.0
        for label, confidence, box in _run_detection(_get_model(), image):
            if box is None or label not in ANIMAL_CATEGORY_BY_LABEL:
                continue
            if confidence >= settings.YOLO_CONFIDENCE_THRESHOLD and confidence > best_conf:
                best, best_conf = box, confidence
        return best

    def validate_pet_image(self, image_bytes: bytes) -> DetectionResult:
        """Gate with YOLO-World and name the species with CLIP.

        Returns pass/fail, refined `pet_classes`, raw `detected_classes`, and `best_box`
        (the highest-confidence accepted animal's xyxy box — the species-naming CLIP pass
        runs on a padded in-memory crop of it so background clutter cannot tip the
        classifier toward wild lookalikes like tiger/hedgehog). A final full-frame
        photo-vs-graphic CLIP pass vetoes flat logos/illustrations that an open-vocabulary
        detector may mistake for a pet. Raises NoPetDetectedError when no animal is found
        or the image reads as a graphic.
        """
        model = _get_model()
        image = load_image(image_bytes)
        detections = _run_detection(model, image)
        detected_classes: list[str] = []
        accepted_raw: list[str] = []
        max_confidence = 0.0
        best_box: Box | None = None
        best_box_conf = 0.0
        for label, confidence, box in detections:
            max_confidence = max(max_confidence, confidence)
            if label not in detected_classes:
                detected_classes.append(label)
            if (
                label in ANIMAL_CATEGORY_BY_LABEL
                and confidence >= settings.YOLO_CONFIDENCE_THRESHOLD
                and label not in accepted_raw
            ):
                accepted_raw.append(label)
                if box is not None and confidence > best_box_conf:
                    best_box, best_box_conf = box, confidence
        # Classify the cropped animal, not the full scene — precision against lookalikes.
        classify_image = padded_crop(image, best_box, SPECIES_CROP_PADDING) if best_box else image
        if accepted_raw:
            # YOLO-World proved an animal is present; CLIP names the actual species.
            pet_classes = _refine_species(classify_image, accepted_raw)
        elif _clip_animal_gate(image):
            # Clear animal photo that YOLO-World missed at the configured threshold
            # (e.g. a crocodile close-up): CLIP gate + CLIP species naming.
            pet_classes = _refine_species(image, [])
        else:
            pet_classes = []
        # Final veto: a flat logo (e.g. a stylized paw inside a map pin) can survive
        # both YOLO-World and the animal gate. The full-frame photo-vs-graphic pass
        # has the last word; the bytes are still discarded before any storage write.
        graphic = bool(pet_classes) and _clip_is_flat_graphic(image)
        if graphic:
            pet_classes = []
        passed = bool(pet_classes)
        detection = DetectionResult(
            passed=passed,
            pet_classes=pet_classes,
            detected_classes=detected_classes,
            max_confidence=max_confidence,
            best_box=best_box,
        )
        if not passed:
            raise NoPetDetectedError(
                detected_labels=detected_classes,
                detail=GRAPHIC_REJECTION_MESSAGE if graphic else None,
            )
        return detection

    @staticmethod
    def strip_exif(image_bytes: bytes) -> bytes:
        """Re-encode the image through Pillow, dropping all EXIF metadata."""
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
        if image.mode not in ("RGB", "L"):
            image = image.convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=90, optimize=True)
        return buffer.getvalue()

    @staticmethod
    def make_thumbnail(image_bytes: bytes, size: tuple[int, int] = (320, 320)) -> bytes:
        image = Image.open(io.BytesIO(image_bytes))
        image.load()
        image.thumbnail(size, Image.Resampling.LANCZOS)
        if image.mode != "RGB":
            image = image.convert("RGB")
        buffer = io.BytesIO()
        image.save(buffer, format="JPEG", quality=80, optimize=True)
        return buffer.getvalue()

    @staticmethod
    def record_detection(user, detection: DetectionResult, passed: bool):  # noqa: ANN001, ANN202
        """Persist a PetDetectionLog row (audit only — never a penalty)."""
        from .models import PetDetectionLog

        return PetDetectionLog.objects.create(
            user=user,
            detected_classes=detection.detected_classes,
            max_confidence=detection.max_confidence,
            passed=passed,
        )


# ---------------------------------------------------------------------------
# Breed & color attribute classifier — CLIP zero-shot over attribute label sets.
# YOLO-World handles detection only; these prompts name the breed (dog/cat) and
# the coat color. Confidence is the softmax probability of the top label; the
# caller decides whether it is high enough to prefill (never guess below it).
# ---------------------------------------------------------------------------
DOG_BREEDS: tuple[str, ...] = (
    "labrador retriever", "golden retriever", "german shepherd", "shiba inu",
    "poodle", "beagle", "french bulldog", "bulldog", "chihuahua", "dachshund",
    "siberian husky", "pomeranian", "welsh corgi", "pug", "rottweiler", "boxer",
    "aspin", "mixed breed",
)
CAT_BREEDS: tuple[str, ...] = (
    "persian", "siamese", "maine coon", "bengal", "ragdoll", "british shorthair",
    "scottish fold", "sphynx", "american shorthair", "domestic shorthair", "mixed breed",
)
ANIMAL_COLORS: tuple[str, ...] = (
    "black", "white", "brown", "tan", "cream", "orange", "gray", "golden",
    "red", "brindle", "tricolor", "calico",
)
# key -> (labels, prompt templates; {} is the label)
ATTRIBUTE_LABEL_SETS: dict[str, tuple[tuple[str, ...], tuple[str, ...]]] = {
    "dog_breed": (DOG_BREEDS, ("a photo of a {} dog", "a close-up photo of a {} dog", "a clear photo of a pet {} dog")),
    "cat_breed": (CAT_BREEDS, ("a photo of a {} cat", "a close-up photo of a {} cat", "a clear photo of a pet {} cat")),
    "color": (
        ANIMAL_COLORS,
        ("a photo of a {} animal", "a photo of a {} pet", "a close-up photo of a {} colored animal"),
    ),
}

_ATTR_TEXT_FEATS: dict[str, Any] = {}
_ATTR_RANGES: dict[str, dict[str, tuple[int, int]]] = {}
_ATTR_LOCK = Lock()


def _build_attr_text_feats(clip_model: Any) -> tuple[dict[str, Any], dict[str, dict[str, tuple[int, int]]]]:
    """Encode CLIP text features for every attribute label set (per label prompt ranges)."""
    import torch

    feats: dict[str, Any] = {}
    ranges: dict[str, dict[str, tuple[int, int]]] = {}
    for key, (labels, templates) in ATTRIBUTE_LABEL_SETS.items():
        prompts: list[str] = []
        label_ranges: dict[str, tuple[int, int]] = {}
        for label in labels:
            start = len(prompts)
            prompts.extend(template.format(label) for template in templates)
            label_ranges[label] = (start, len(prompts))
        with torch.no_grad():
            feats[key] = _normalize_torch(clip_model.encode_text(clip_model.tokenize(prompts)))
        ranges[key] = label_ranges
    return feats, ranges


def _get_attr_text_feats() -> tuple[dict[str, Any], dict[str, dict[str, tuple[int, int]]]]:
    """Lazily build and cache the attribute text features once per process."""
    global _ATTR_TEXT_FEATS, _ATTR_RANGES
    if not _ATTR_TEXT_FEATS:
        with _ATTR_LOCK:
            if not _ATTR_TEXT_FEATS:
                _ATTR_TEXT_FEATS, _ATTR_RANGES = _build_attr_text_feats(_get_clip_model())
    return _ATTR_TEXT_FEATS, _ATTR_RANGES


def _attr_clip_rank(image: Any, key: str, clip_model: Any | None = None) -> list[tuple[str, float]]:
    """Rank one attribute label set for an image with CLIP (probabilities)."""
    import torch

    model = clip_model or _get_clip_model()
    if clip_model is None:
        text_feats_all, ranges_all = _get_attr_text_feats()
    else:
        text_feats_all, ranges_all = _build_attr_text_feats(model)
    text_feats = text_feats_all[key]
    ranges = ranges_all[key]
    with torch.no_grad():
        image_feat = model.encode_image(image)
        logits = (100.0 * image_feat @ text_feats.T).squeeze(0)
    scores = [(label, float(logits[start:end].mean().item())) for label, (start, end) in ranges.items()]
    probs = torch.softmax(torch.tensor([score for _, score in scores]), dim=0)
    ranked = sorted(zip([label for label, _ in scores], probs.tolist(), strict=True), key=lambda item: -item[1])
    return [(label, float(prob)) for label, prob in ranked]


class PetAttributeService:
    """Zero-shot breed/color naming for an already-gated pet photo.

    Detection stays with YOLO-World (`PetDetectionService`); this second stage only
    reads attributes off the same CLIP encoder. Species without a breed list (rabbit,
    bird, fish, …) get `breed=""` with confidence 0.0 — we never guess a breed there.
    """

    @staticmethod
    def classify_attributes(
        image: Image.Image, pet_classes: list[str], clip_model: Any | None = None
    ) -> AttributeDetection:
        labels = {label.strip().lower() for label in pet_classes}
        if "dog" in labels:
            breed_key = "dog_breed"
        elif "cat" in labels:
            breed_key = "cat_breed"
        else:
            breed_key = None
        if breed_key is not None:
            breed, breed_confidence = _attr_clip_rank(image, breed_key, clip_model)[0]
        else:
            breed, breed_confidence = "", 0.0
        color, color_confidence = _attr_clip_rank(image, "color", clip_model)[0]
        return AttributeDetection(
            breed=breed,
            breed_confidence=breed_confidence,
            color=color,
            color_confidence=color_confidence,
        )

