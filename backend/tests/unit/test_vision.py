"""Unit: PetDetectionService (YOLO-World gatekeeper) with a mocked model."""

import io

import pytest
from PIL import Image

from apps.common.exceptions import NoPetDetectedError
from apps.vision.dto import DetectionResult
from apps.vision.models import PetDetectionLog
from apps.vision.services import ANIMAL_CATEGORY_BY_LABEL, PetDetectionService

pytestmark = pytest.mark.django_db


def _img_bytes() -> bytes:
    img = Image.new("RGB", (32, 32), (10, 200, 10))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


class _FakeBoxes:
    def __init__(self, cls_ids, confs, xyxy=None):
        import numpy as np

        self.cls = np.array(cls_ids, dtype=float)
        self.conf = np.array(confs, dtype=float)
        # xyxy pixel boxes (one per detection); defaults to a fixed box per row.
        n = len(cls_ids)
        self.xyxy = np.array(
            xyxy if xyxy is not None else [(10.0 + i, 10.0, 30.0 + i, 30.0) for i in range(n)],
            dtype=float,
        )


class _FakeResult:
    def __init__(self, names, boxes):
        self.names = names
        self.boxes = boxes


def _mock_model(monkeypatch, detections, label_overrides=None, *, clip_rank=None, clip_gate=False, xyxy=None):
    """detections: list of (cls_id, conf); label_overrides maps ids to open-vocabulary labels."""
    names = {i: f"cls{i}" for i in range(80)}
    names.update({14: "bird", 15: "cat", 16: "dog", 17: "horse", 18: "sheep", 19: "cow", 0: "person"})
    names.update(label_overrides or {})
    boxes = _FakeBoxes([c for c, _ in detections], [f for _, f in detections], xyxy=xyxy)

    class FakeModel:
        def __init__(self):
            self.predict_calls = []

        def predict(self, image, conf=None, verbose=False):
            self.predict_calls.append({"conf": conf, "verbose": verbose, "image_size": image.size})
            return [_FakeResult(names, boxes)]

    model = FakeModel()
    monkeypatch.setattr("apps.vision.services._get_model", lambda: model)
    if clip_rank is None:
        refine = lambda image, accepted: list(accepted)  # noqa: E731
    else:
        refine = lambda image, accepted: _refine_from_rank(accepted, clip_rank)  # noqa: E731
    monkeypatch.setattr("apps.vision.services._refine_species", refine)
    monkeypatch.setattr("apps.vision.services._clip_animal_gate", lambda image: clip_gate)
    return model


def _refine_from_rank(accepted: list[str], rank: list[tuple[str, float]]) -> list[str]:
    from apps.vision.services import ANIMAL_CATEGORY_BY_LABEL, CLIP_SPECIES_MIN_PROBABILITY

    if not rank:
        return list(accepted)
    top_prob = rank[0][1]
    min_prob = max(CLIP_SPECIES_MIN_PROBABILITY, top_prob * 0.5)
    selected = [label for label, prob in rank if prob >= min_prob and label in ANIMAL_CATEGORY_BY_LABEL]
    if selected:
        return selected
    return list(accepted)


def test_detects_dog_passes(monkeypatch):
    _mock_model(monkeypatch, [(16, 0.92), (0, 0.5)])
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.passed is True
    assert result.pet_classes == ["dog"]
    assert "person" in result.detected_classes
    assert result.max_confidence == pytest.approx(0.92)


def test_validate_returns_best_box_of_highest_confidence_animal(monkeypatch):
    """best_box is the xyxy box of the strongest ACCEPTED animal detection (not a person's)."""
    _mock_model(
        monkeypatch,
        [(0, 0.99), (16, 0.60), (15, 0.80)],  # person, dog, cat
        xyxy=[(0.0, 0.0, 5.0, 5.0), (10.0, 10.0, 20.0, 20.0), (1.0, 1.0, 9.0, 9.0)],
    )
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.passed is True
    # cat @ 0.80 beats dog @ 0.60 — the cat box wins even though person @ 0.99 is highest overall.
    assert result.best_box == (1.0, 1.0, 9.0, 9.0)


def test_best_animal_box_ignores_subthreshold_and_non_animal_labels(monkeypatch, settings):
    settings.YOLO_CONFIDENCE_THRESHOLD = 0.20
    _mock_model(
        monkeypatch,
        [(0, 0.99), (16, 0.10)],  # person (not an animal), dog below threshold
        xyxy=[(0.0, 0.0, 5.0, 5.0), (10.0, 10.0, 20.0, 20.0)],
    )
    from PIL import Image

    assert PetDetectionService().best_animal_box(Image.new("RGB", (32, 32))) is None


def test_validate_without_boxes_yields_none_best_box(monkeypatch):
    class _NoXyxyBoxes:
        import numpy as np

        cls = np.array([16], dtype=float)
        conf = np.array([0.9], dtype=float)
        xyxy = None  # legacy/fake result without boxes

    class _Result:
        names = {16: "dog"}
        boxes = _NoXyxyBoxes()

    class FakeModel:
        def predict(self, image, conf=None, verbose=False):
            return [_Result()]

    monkeypatch.setattr("apps.vision.services._get_model", lambda: FakeModel())
    monkeypatch.setattr("apps.vision.services._refine_species", lambda image, accepted: list(accepted))
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.passed is True
    assert result.best_box is None  # crop falls back to the full image


def test_detects_cat_below_threshold_fails(monkeypatch, settings):
    settings.YOLO_CONFIDENCE_THRESHOLD = 0.45
    _mock_model(monkeypatch, [(15, 0.30)])
    with pytest.raises(NoPetDetectedError) as exc_info:
        PetDetectionService().validate_pet_image(_img_bytes())
    assert exc_info.value.status_code == 422
    assert exc_info.value.detected_labels == ["cat"]


def test_non_pet_rejected_with_labels(monkeypatch):
    _mock_model(monkeypatch, [(0, 0.99), (2, 0.8)])
    with pytest.raises(NoPetDetectedError):
        PetDetectionService().validate_pet_image(_img_bytes())


def test_malformed_model_result_is_ignored(monkeypatch):
    class FakeModel:
        def predict(self, image, conf=None, verbose=False):
            return [object()]

    monkeypatch.setattr("apps.vision.services._get_model", lambda: FakeModel())
    with pytest.raises(NoPetDetectedError):
        PetDetectionService().validate_pet_image(_img_bytes())


def test_bird_counts_as_pet(monkeypatch):
    _mock_model(monkeypatch, [(14, 0.6)])
    assert PetDetectionService().validate_pet_image(_img_bytes()).passed is True


@pytest.mark.parametrize(
    ("label", "category"),
    [
        ("lion", "Zoo / Exotic"),
        ("crocodile", "Reptile"),
        ("sugar glider", "Small Mammal"),
        ("rabbit", "Small Mammal"),
        ("goat", "Farm Animal"),
        ("cockatiel", "Bird"),
        ("goldfish", "Fish"),
        ("dog", "Domestic Pet"),
    ],
)
def test_expanded_animal_labels_pass_at_point_twenty(monkeypatch, settings, label, category):
    settings.YOLO_CONFIDENCE_THRESHOLD = 0.20
    model = _mock_model(monkeypatch, [(0, 0.20)], {0: label})
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.passed is True
    assert result.pet_classes == [label]
    assert ANIMAL_CATEGORY_BY_LABEL[label] == category
    assert model.predict_calls == [{"conf": 0.20, "verbose": False, "image_size": (32, 32)}]


def test_validate_applies_exif_orientation_and_rgb_before_predict(monkeypatch, settings):
    settings.YOLO_CONFIDENCE_THRESHOLD = 0.20
    img = Image.new("RGBA", (40, 20), (200, 30, 30, 255))
    exif = Image.Exif()
    exif[274] = 6  # Orientation: rotate 90° CW when displayed.
    buf = io.BytesIO()
    img.save(buf, format="PNG", exif=exif)

    model = _mock_model(monkeypatch, [(16, 0.20)], {16: "dog"})
    assert PetDetectionService().validate_pet_image(buf.getvalue()).passed is True
    assert model.predict_calls[0]["image_size"] == (20, 40)
    assert model.predict_calls[0]["conf"] == 0.20


@pytest.mark.parametrize(
    ("category", "labels"),
    [
        (
            "Zoo / Exotic",
            [
                "lion", "tiger", "wolf", "fox", "bear", "elephant", "giraffe",
                "zebra", "kangaroo", "koala", "panda", "monkey", "deer",
            ],
        ),
        (
            "Reptile",
            ["crocodile", "alligator", "snake", "lizard", "gecko", "iguana", "chameleon", "turtle", "tortoise"],
        ),
        (
            "Small Mammal",
            ["hamster", "guinea pig", "ferret", "chinchilla", "mouse", "rat", "hedgehog", "sugar glider", "rabbit"],
        ),
    ],
)
def test_required_animal_category_mapping(category, labels):
    assert {label: ANIMAL_CATEGORY_BY_LABEL[label] for label in labels} == dict.fromkeys(labels, category)


def test_domestic_farm_bird_and_fish_categories_are_configured():
    expected = {
        "cat": "Domestic Pet",
        "horse": "Farm Animal",
        "chicken": "Farm Animal",
        "parrot": "Bird",
        "bird": "Bird",
        "fish": "Fish",
        "koi": "Fish",
    }
    assert {label: ANIMAL_CATEGORY_BY_LABEL[label] for label in expected} == expected


def test_strip_exif_removes_metadata():
    img = Image.new("RGB", (16, 16))
    exif = Image.Exif()
    exif[0x010F] = "TestCamera"  # Make
    buf = io.BytesIO()
    img.save(buf, format="JPEG", exif=exif)
    raw = buf.getvalue()
    cleaned = PetDetectionService.strip_exif(raw)
    out = Image.open(io.BytesIO(cleaned))
    assert not out.getexif()


def test_make_thumbnail():
    thumb = PetDetectionService.make_thumbnail(_img_bytes(), size=(320, 320))
    out = Image.open(io.BytesIO(thumb))
    assert max(out.size) <= 320


def test_record_detection(user):
    log = PetDetectionService.record_detection(
        user, DetectionResult(passed=True, pet_classes=["dog"], detected_classes=["dog"], max_confidence=0.9), True
    )
    assert isinstance(log, PetDetectionLog)
    assert log.passed is True
    assert log.user == user


# ---------------------------------------------------------------------------
# CLIP second-stage species naming (YOLO-World stays the gate; CLIP names the animal)
# ---------------------------------------------------------------------------
class _FakeClip:
    def __init__(self, image_index: int = 0):
        self.image_index = image_index

    def tokenize(self, texts):
        return list(texts)

    def encode_text(self, tokens):
        import torch

        return torch.eye(len(tokens), 512)

    def encode_image(self, image):
        import torch

        feat = torch.zeros(512)
        feat[self.image_index % 512] = 1.0
        return feat


def test_clip_rank_names_rabbit_over_cat():
    import apps.vision.services as svc

    prompts, ranges = svc._build_clip_prompts()
    fake = _FakeClip(ranges["rabbit"][0])
    ranked = svc._clip_rank(Image.new("RGB", (8, 8)), fake)
    assert ranked[0][0] == "rabbit"
    assert ranked[0][1] > 0.99
    assert all(label in ANIMAL_CATEGORY_BY_LABEL for label, _ in ranked)


def test_clip_animal_gate_accepts_animal_and_rejects_non_animal():
    import apps.vision.services as svc

    image = Image.new("RGB", (8, 8))
    assert svc._clip_animal_gate(image, _FakeClip(0)) is True
    assert svc._clip_animal_gate(image, _FakeClip(len(svc.CLIP_ANIMAL_PROMPTS))) is False


class _ZeroClip(_FakeClip):
    def encode_image(self, image):
        import torch

        return torch.zeros(512)


def test_refine_species_uses_clip_labels_and_falls_back_to_yolo(monkeypatch):
    import apps.vision.services as svc

    image = Image.new("RGB", (8, 8))
    fake = _FakeClip(svc._build_clip_prompts()[1]["fox"][0])
    assert svc._refine_species(image, ["dog"], fake) == ["fox"]
    assert svc._refine_species(image, ["dog"], _ZeroClip(0)) == ["dog"]
    assert svc._refine_species(image, [], _ZeroClip(0)) == []


def test_clip_rank_uses_cached_singleton_features(monkeypatch):
    import apps.vision.services as svc

    fake = _FakeClip(svc._build_clip_prompts()[1]["dog"][0])
    text_feats, gate_feats, ranges = svc._prepare_clip_text_feats(fake)
    monkeypatch.setattr(svc, "_get_clip_model", lambda: fake)
    monkeypatch.setattr(svc, "_CLIP_TEXT_FEATS", text_feats)
    monkeypatch.setattr(svc, "_CLIP_GATE_TEXT_FEATS", gate_feats)
    monkeypatch.setattr(svc, "_CLIP_LABEL_RANGES", ranges)
    ranked = svc._clip_rank(Image.new("RGB", (8, 8)))
    assert ranked[0][0] == "dog"


def test_refine_species_empty_rank_returns_accepted(monkeypatch):
    import apps.vision.services as svc

    monkeypatch.setattr(svc, "_clip_rank", lambda image, clip_model=None: [])
    assert svc._refine_species(Image.new("RGB", (8, 8)), ["cat"]) == ["cat"]


def test_get_clip_model_reuses_world_clip_and_can_build(monkeypatch):
    import types

    import apps.vision.services as svc

    fake = _FakeClip(0)
    world = types.SimpleNamespace(model=types.SimpleNamespace(clip_model=fake))
    monkeypatch.setattr(svc, "_get_model", lambda: world)
    monkeypatch.setattr(svc, "_CLIP_MODEL", None)
    monkeypatch.setattr(svc, "_CLIP_TEXT_FEATS", None)
    monkeypatch.setattr(svc, "_CLIP_GATE_TEXT_FEATS", None)
    monkeypatch.setattr(svc, "_CLIP_LABEL_RANGES", {})
    assert svc._get_clip_model() is fake
    assert svc._CLIP_TEXT_FEATS is not None

    import ultralytics.nn.text_model as text_model

    built = _FakeClip(1)
    monkeypatch.setattr(svc, "_get_model", lambda: types.SimpleNamespace(model=types.SimpleNamespace(clip_model=None)))
    monkeypatch.setattr(svc, "_CLIP_MODEL", None)
    monkeypatch.setattr(svc, "_CLIP_TEXT_FEATS", None)
    monkeypatch.setattr(svc, "_CLIP_GATE_TEXT_FEATS", None)
    monkeypatch.setattr(svc, "_CLIP_LABEL_RANGES", {})
    monkeypatch.setattr(text_model, "build_text_model", lambda variant, device=None: built)
    assert svc._get_clip_model() is built


def test_rabbit_detected_as_cat_is_renamed_to_rabbit(monkeypatch):
    _mock_model(
        monkeypatch,
        [(15, 0.85)],
        {15: "cat"},
        clip_rank=[("rabbit", 0.95), ("cat", 0.02)],
    )
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.passed is True
    assert result.pet_classes == ["rabbit"]
    assert result.detected_classes == ["cat"]  # raw YOLO-World labels are preserved


def test_fox_detected_as_dog_is_renamed_to_fox(monkeypatch):
    _mock_model(
        monkeypatch,
        [(16, 0.63)],
        {16: "dog"},
        clip_rank=[("fox", 0.97), ("wolf", 0.01), ("dog", 0.005)],
    )
    assert PetDetectionService().validate_pet_image(_img_bytes()).pet_classes == ["fox"]


def test_frog_detected_as_bird_is_renamed_to_frog(monkeypatch):
    _mock_model(
        monkeypatch,
        [(14, 0.25)],
        {14: "bird"},
        clip_rank=[("frog", 0.71), ("toad", 0.25), ("lizard", 0.01)],
    )
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.pet_classes == ["frog"]
    assert result.detected_classes == ["bird"]


def test_crocodile_missed_by_yolo_passes_clip_gate_as_crocodile(monkeypatch):
    _mock_model(
        monkeypatch,
        [],
        clip_rank=[("crocodile", 0.80), ("alligator", 0.10)],
        clip_gate=True,
    )
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.passed is True
    assert result.pet_classes == ["crocodile"]
    assert result.detected_classes == []


def test_landscape_without_yolo_or_clip_animal_still_422(monkeypatch):
    _mock_model(monkeypatch, [], clip_gate=False)
    with pytest.raises(NoPetDetectedError) as exc_info:
        PetDetectionService().validate_pet_image(_img_bytes())
    assert exc_info.value.status_code == 422
    assert exc_info.value.detected_labels == []


def test_ambiguous_clip_top_labels_keep_multiple_species_editable(monkeypatch):
    _mock_model(
        monkeypatch,
        [(15, 0.70), (16, 0.66)],
        {15: "cat", 16: "dog"},
        clip_rank=[("cat", 0.50), ("dog", 0.45)],
    )
    assert PetDetectionService().validate_pet_image(_img_bytes()).pet_classes == ["cat", "dog"]


# ---------------------------------------------------------------------------
# Precision: cropped classification + confusable-group contrast pass. A tabby
# cat must not be named "tiger" (stripes) or "hedgehog" (spiky-looking fur).
# ---------------------------------------------------------------------------


def test_validate_classifies_the_padded_crop_not_the_full_image(monkeypatch):
    """The CLIP species pass runs on the padded best-box crop, not the full scene."""
    seen: list[tuple[int, int]] = []

    def _capture(image, accepted, clip_model=None):
        seen.append(image.size)
        return list(accepted)

    _mock_model(
        monkeypatch,
        [(15, 0.85)],
        {15: "cat"},
        xyxy=[(8.0, 8.0, 24.0, 24.0)],  # 16×16 box in a 32×32 image
    )
    monkeypatch.setattr("apps.vision.services._refine_species", _capture)
    result = PetDetectionService().validate_pet_image(_img_bytes())
    assert result.passed is True
    assert result.pet_classes == ["cat"]
    # 16×16 box + 25% padding per side → 8px wider/higher → 24×24 crop (clamped to 32×32).
    assert seen == [(24, 24)]


def test_refine_species_relative_margin_drops_distant_lookalikes(monkeypatch):
    """Only labels within CLIP_SPECIES_RELATIVE_MARGIN of the top stay — hedgehog at
    0.16 must not ride along with cat at 0.40."""
    import apps.vision.services as svc

    monkeypatch.setattr(
        svc, "_clip_rank", lambda image, clip_model=None: [("cat", 0.40), ("hedgehog", 0.16), ("dog", 0.05)]
    )
    image = Image.new("RGB", (8, 8))
    assert svc._refine_species(image, ["cat"]) == ["cat"]


def test_confusable_group_contrast_resolves_tabby_cat_vs_tiger(monkeypatch):
    """Top pick "tiger" with "cat" close behind → contrast pass picks the house cat."""
    import apps.vision.services as svc

    monkeypatch.setattr(
        svc,
        "_clip_rank",
        lambda image, clip_model=None: [("tiger", 0.30), ("hedgehog", 0.16), ("cat", 0.14)],
    )
    monkeypatch.setattr(
        svc,
        "_group_contrast_rank",
        lambda image, group, members, clip_model=None: [("cat", 0.91), ("tiger", 0.09)],
    )
    image = Image.new("RGB", (8, 8))
    assert svc._refine_species(image, ["tiger", "hedgehog"]) == ["cat"]


def test_confusable_group_not_triggered_without_close_rival(monkeypatch):
    """A clear tiger (cat far behind the rival margin) stays "tiger" — no contrast pass."""
    import apps.vision.services as svc

    monkeypatch.setattr(
        svc, "_clip_rank", lambda image, clip_model=None: [("tiger", 0.60), ("cat", 0.10)]
    )

    def _boom(image, group, members, clip_model=None):
        raise AssertionError("contrast pass ran despite no close rival")

    monkeypatch.setattr(svc, "_group_contrast_rank", _boom)
    image = Image.new("RGB", (8, 8))
    assert svc._refine_species(image, ["tiger"]) == ["tiger"]


def test_group_contrast_rank_uses_contrast_prompts_and_picks_winner():
    """The focused pass tokenizes the group's contrast prompts; the image feature
    aligned to the cat prompts wins the feline group."""
    import apps.vision.services as svc

    members = tuple(l for l in svc.CONFUSABLE_GROUPS["feline"] if l in svc.ANIMAL_CATEGORY_BY_LABEL)
    assert members == ("cat", "tiger", "lion")
    # "cat" contrast prompts come first in the focused prompt list (members order).
    fake = _FakeClip(0)
    image = Image.new("RGB", (8, 8))
    ranked = svc._group_contrast_rank(image, "feline", members, fake)
    assert ranked[0][0] == "cat"
    assert ranked[0][1] > 0.99
    assert {label for label, _ in ranked} == set(members)


def test_confusable_group_winner_none_for_ungrouped_top_label(monkeypatch):
    import apps.vision.services as svc

    assert svc._confusable_group_winner(Image.new("RGB", (8, 8)), [("elephant", 0.9), ("dog", 0.05)]) is None
    # Single known member in the group (porcupine/hare are not configured labels).
    assert svc._confusable_group_winner(Image.new("RGB", (8, 8)), [("hedgehog", 0.9)]) is None
