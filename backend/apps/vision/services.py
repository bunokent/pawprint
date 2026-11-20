"""PetDetectionService — YOLO-World animal gate + CLIP species naming.

Every uploaded pet photo is validated BEFORE any Cloudinary write. YOLO-World proves an animal is
present; CLIP ViT-B/32 then names the actual species for `pet_classes` while raw YOLO labels stay in
`detected_classes`. Non-animal photos are discarded immediately and raise NoPetDetectedError
(HTTP 422). There are no strikes and no bans — the user can simply pick another photo.
"""

from __future__ import annotations

import io
import logging
import math
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
    "dog": ("a domestic dog", "a pet dog looking at the camera"),
    "cat": ("a domestic cat", "a pet cat looking at the camera"),
    "fox": ("a red fox", "a wild fox with pointed ears and a bushy tail", "a fox in the wild"),
    "wolf": ("a wild wolf with pointed ears",),
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

_MODEL: YOLOWorld | None = None
_MODEL_LOCK = Lock()
_CLIP_MODEL: Any | None = None
_CLIP_LOCK = Lock()
_CLIP_TEXT_FEATS: Any | None = None
_CLIP_GATE_TEXT_FEATS: Any | None = None
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


def _refine_species(image: Any, accepted_raw: list[str], clip_model: Any | None = None) -> list[str]:
    """Name the actual animal with CLIP; fall back to YOLO-World labels when unsure."""
    rank = _clip_rank(image, clip_model)
    if not rank:
        return list(accepted_raw)
    top_prob = rank[0][1]
    min_prob = max(CLIP_SPECIES_MIN_PROBABILITY, top_prob * 0.5)
    selected = [label for label, prob in rank if prob >= min_prob and label in ANIMAL_CATEGORY_BY_LABEL]
    if selected:
        return selected
    if accepted_raw:
        return list(accepted_raw)
    return [rank[0][0]] if top_prob >= settings.YOLO_CONFIDENCE_THRESHOLD else []


class PetDetectionService:
    """Validates that an image contains an animal from the configured categories."""

    def validate_pet_image(self, image_bytes: bytes) -> DetectionResult:
        """Gate with YOLO-World and name the species with CLIP.

        Returns pass/fail, refined `pet_classes`, and raw `detected_classes`. Raises
        NoPetDetectedError when neither YOLO-World nor the CLIP animal gate finds an animal.
        """
        model = _get_model()
        image = load_image(image_bytes)
        results = model.predict(
            image,
            conf=settings.YOLO_CONFIDENCE_THRESHOLD,
            verbose=False,
        )
        detected_classes: list[str] = []
        accepted_raw: list[str] = []
        max_confidence = 0.0
        for result in results:
            if not hasattr(result, "names") or not hasattr(result, "boxes"):
                continue
            names = result.names
            boxes = result.boxes
            if boxes is None:
                continue
            for cls_id, conf in zip(boxes.cls.tolist(), boxes.conf.tolist(), strict=True):
                label = str(names[int(cls_id)]).strip().lower()
                confidence = float(conf)
                max_confidence = max(max_confidence, confidence)
                if label not in detected_classes:
                    detected_classes.append(label)
                if (
                    label in ANIMAL_CATEGORY_BY_LABEL
                    and confidence >= settings.YOLO_CONFIDENCE_THRESHOLD
                    and label not in accepted_raw
                ):
                    accepted_raw.append(label)
        if accepted_raw:
            # YOLO-World proved an animal is present; CLIP names the actual species.
            pet_classes = _refine_species(image, accepted_raw)
        elif _clip_animal_gate(image):
            # Clear animal photo that YOLO-World missed at the configured threshold
            # (e.g. a crocodile close-up): CLIP gate + CLIP species naming.
            pet_classes = _refine_species(image, [])
        else:
            pet_classes = []
        passed = bool(pet_classes)
        detection = DetectionResult(
            passed=passed,
            pet_classes=pet_classes,
            detected_classes=detected_classes,
            max_confidence=max_confidence,
        )
        if not passed:
            raise NoPetDetectedError(detected_labels=detected_classes)
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


# ---------------------------------------------------------------------------
# Photo embeddings + lost/found matching — the same CLIP encoder, used
# image-to-image: the BEST cosine similarity over every cross-photo pair
# (found photo × lost photo) decides "possible match" (notifications + map
# halo), so the same pet shown from different angles still matches — not just
# literally the same picture. Embeddings are cached per photo on
# PetPhoto.photo_embedding (legacy single-photo pets: Pet.photo_embedding).
# ---------------------------------------------------------------------------


def clip_image_embedding(image: Image.Image, clip_model: Any | None = None) -> list[float]:
    """Normalized CLIP ViT-B/32 image embedding as a plain list of floats."""
    import torch

    model = clip_model or _get_clip_model()
    with torch.no_grad():
        feat = _normalize_torch(model.encode_image(image)).squeeze(0)
    return [round(float(v), 6) for v in feat.tolist()]


def cosine_similarity(a: list[float], b: list[float]) -> float:
    """Cosine similarity of two equal-length vectors (pure Python — no torch)."""
    if len(a) != len(b) or not a:
        return 0.0
    dot = sum(x * y for x, y in zip(a, b, strict=True))
    norm_a = math.sqrt(sum(x * x for x in a))
    norm_b = math.sqrt(sum(y * y for y in b))
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return dot / (norm_a * norm_b)


class PetMatchService:
    """Compares a flyer's pet photo against the opposite mode's active flyers."""

    @staticmethod
    def ensure_embedding(photo) -> list[float] | None:  # noqa: ANN001, ANN202
        """Return the CLIP embedding of a Pet or PetPhoto, computing + caching it.

        Under PAWPRINT_TESTING the storage/CLIP path is skipped (tests set
        photo_embedding explicitly) so the suite stays hermetic and fast.
        A photo that cannot be read or embedded (missing object, network error,
        model failure) is logged and treated as "no embedding" — one broken
        photo must never abort matching for every other lost/found pair.
        """
        if photo.photo_embedding:
            return photo.photo_embedding
        if not photo.photo_path or settings.TESTING:
            return None
        from apps.common import storage

        try:
            raw = storage.read_bytes(photo.photo_path)
            embedding = clip_image_embedding(load_image(raw))
            photo.photo_embedding = embedding
            photo.save(update_fields=["photo_embedding"])
        except Exception:  # noqa: BLE001 — resilience over strictness here
            logger.exception(
                "ensure_embedding failed for %s %s (photo %s)",
                type(photo).__name__, photo.pk, photo.photo_path,
            )
            return None
        return embedding

    @staticmethod
    def pet_embeddings(pet) -> list[list[float]]:  # noqa: ANN001, ANN202
        """All photo embeddings of a pet — one per PetPhoto row (each angle of the
        pet), falling back to the legacy single Pet.photo_embedding for pets that
        predate PetPhoto rows. Callers should prefetch ``pet__photos``.
        """
        embeddings: list[list[float]] = []
        for photo in pet.photos.all():
            embedding = PetMatchService.ensure_embedding(photo)
            if embedding:
                embeddings.append(embedding)
        if not embeddings:
            embedding = PetMatchService.ensure_embedding(pet)
            if embedding:
                embeddings.append(embedding)
        return embeddings

    @staticmethod
    def match_flyer(flyer_id: str) -> list:  # noqa: ANN401
        """Match one flyer's pet photos against active flyers of the opposite mode.

        Creates PetMatch rows (and notifications, once per pair) for every pair
        whose BEST cross-photo cosine similarity (any photo of one pet × any
        photo of the other) is >= PET_MATCH_SIMILARITY_THRESHOLD. The max-over-
        pairs score is what makes the same pet photographed from different
        angles match, not just identical pictures.
        """
        import uuid as _uuid

        from apps.flyers.models import Flyer
        from apps.notifications.services import NotificationService

        from .models import PetMatch

        flyer = (
            Flyer.objects.select_related("pet")
            .prefetch_related("pet__photos")
            .filter(pk=_uuid.UUID(str(flyer_id)))
            .first()
        )
        if flyer is None or flyer.mode not in (Flyer.Mode.EMERGENCY, Flyer.Mode.FOUND):
            return []
        embeddings = PetMatchService.pet_embeddings(flyer.pet)
        if not embeddings:
            return []
        counterpart_mode = Flyer.Mode.FOUND if flyer.mode == Flyer.Mode.EMERGENCY else Flyer.Mode.EMERGENCY
        counterparts = (
            Flyer.objects.select_related("pet", "pet__owner", "creator")
            .prefetch_related("pet__photos")
            .filter(status=Flyer.Status.ACTIVE, mode=counterpart_mode)
            .exclude(pet_id=flyer.pet_id)
        )
        matches = []
        for other in counterparts:
            other_embeddings = PetMatchService.pet_embeddings(other.pet)
            if not other_embeddings:
                continue
            score = max(
                (cosine_similarity(a, b) for a in embeddings for b in other_embeddings),
                default=0.0,
            )
            if score < settings.PET_MATCH_SIMILARITY_THRESHOLD:
                continue
            lost, found = (other, flyer) if flyer.mode == Flyer.Mode.FOUND else (flyer, other)
            match, created = PetMatch.objects.get_or_create(
                lost_flyer=lost, found_flyer=found, defaults={"score": score}
            )
            if not created and match.score != score:
                match.score = score
                match.save(update_fields=["score"])
            if created:
                NotificationService.notify_match(match)
            matches.append(match)
        return matches

    @staticmethod
    def match_all_active_flyers() -> int:
        """Re-run matching for every active lost/found flyer (backfill/maintenance).

        Pairs are deduplicated by the PetMatch unique constraint and notified only
        on first creation, so re-running is always safe. Returns the number of
        flyer evaluations that produced at least one match.
        """
        from apps.flyers.models import Flyer

        flyer_ids = (
            Flyer.objects.filter(
                status=Flyer.Status.ACTIVE,
                mode__in=[Flyer.Mode.EMERGENCY, Flyer.Mode.FOUND],
            )
            .values_list("pk", flat=True)
        )
        matched = sum(1 for flyer_id in flyer_ids if PetMatchService.match_flyer(str(flyer_id)))
        return matched
