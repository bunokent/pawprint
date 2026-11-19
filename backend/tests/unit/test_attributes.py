"""Unit: PetAttributeService (CLIP breed/color classifier) with a fake CLIP model.

YOLO-World handles detection only; these tests cover the separate zero-shot
breed/color stage that runs on an already-gated pet photo.
"""

import io

import pytest
from PIL import Image

import apps.vision.services as svc
from apps.vision.dto import AttributeDetection
from apps.vision.services import PetAttributeService


def _img() -> Image.Image:
    return Image.new("RGB", (8, 8))


class _FakeClip:
    """Each text prompt becomes its own axis; encode_image lights one axis."""

    def __init__(self, image_index: int = 0):
        self.image_index = image_index
        self.encode_text_calls = 0

    def tokenize(self, texts):
        return list(texts)

    def encode_text(self, tokens):
        import torch

        self.encode_text_calls += 1
        return torch.eye(len(tokens), 512)

    def encode_image(self, image):
        import torch

        feat = torch.zeros(512)
        feat[self.image_index % 512] = 1.0
        return feat


def _label_index(fake: _FakeClip, key: str, label: str) -> int:
    """First prompt row of `label` inside the attribute set `key` (for the fake)."""
    _, ranges = svc._build_attr_text_feats(fake)
    return ranges[key][label][0]


def test_dog_photo_gets_dog_breed_and_color():
    fake = _FakeClip(_label_index(_FakeClip(), "dog_breed", "shiba inu"))
    result = PetAttributeService.classify_attributes(_img(), ["dog"], fake)
    assert isinstance(result, AttributeDetection)
    assert result.breed == "shiba inu"
    assert result.breed_confidence > 0.99
    # The same image axis lands inside the color set too (prompt row < color set size).
    assert result.color_confidence > 0.99
    assert result.color in svc.ANIMAL_COLORS


def test_cat_photo_gets_cat_breed():
    fake = _FakeClip(_label_index(_FakeClip(), "cat_breed", "siamese"))
    result = PetAttributeService.classify_attributes(_img(), ["cat"], fake)
    assert result.breed == "siamese"
    assert result.breed_confidence > 0.99


def test_non_dog_cat_species_never_guesses_a_breed():
    fake = _FakeClip(_label_index(_FakeClip(), "color", "orange"))
    result = PetAttributeService.classify_attributes(_img(), ["rabbit"], fake)
    assert result.breed == ""
    assert result.breed_confidence == 0.0
    assert result.color == "orange"
    assert result.color_confidence > 0.99


def test_ambiguous_multi_species_prefers_dog_breed_list():
    fake = _FakeClip(_label_index(_FakeClip(), "dog_breed", "beagle"))
    result = PetAttributeService.classify_attributes(_img(), ["cat", "dog"], fake)
    assert result.breed == "beagle"


def test_attr_feats_are_cached_per_process(monkeypatch):
    fake = _FakeClip(_label_index(_FakeClip(), "color", "black"))
    monkeypatch.setattr(svc, "_get_clip_model", lambda: fake)
    monkeypatch.setattr(svc, "_ATTR_TEXT_FEATS", {})
    monkeypatch.setattr(svc, "_ATTR_RANGES", {})
    first = svc._attr_clip_rank(_img(), "color")
    calls_after_first = fake.encode_text_calls
    second = svc._attr_clip_rank(_img(), "color")
    assert first == second == [("black", pytest.approx(1.0, abs=1e-6))] or first[0][0] == "black"
    assert fake.encode_text_calls == calls_after_first  # second call reused the cache
    assert svc._ATTR_TEXT_FEATS  # globals populated once


def test_load_image_normalizes_exif_and_mode():
    img = Image.new("RGBA", (40, 20), (200, 30, 30, 255))
    exif = Image.Exif()
    exif[274] = 6
    buf = io.BytesIO()
    img.save(buf, format="PNG", exif=exif)
    loaded = svc.load_image(buf.getvalue())
    assert loaded.mode == "RGB"
    assert loaded.size == (20, 40)  # orientation 6 transposed
