"""Unit: MegaDescriptorService — singleton timm loader, L2-normalized embed, crop pipeline."""

import io

import pytest
from PIL import Image

import apps.vision.services as svc
from apps.vision.services import (
    MegaDescriptorService,
    PetDetectionService,
    mega_model_id,
    megadescriptor_embedding,
    padded_crop,
)

pytestmark = pytest.mark.django_db


def _img_bytes(size=(32, 32)) -> bytes:
    img = Image.new("RGB", size, (10, 200, 10))
    buf = io.BytesIO()
    img.save(buf, format="JPEG")
    return buf.getvalue()


def test_mega_singleton_loader_caches_model_transform_device(monkeypatch, settings):
    """The timm model loads once per process (lock-protected singleton), like YOLO-World."""
    import types

    settings.MEGA_DESCRIPTOR_DEVICE = "cpu"
    created: list[str] = []

    fake_timm = types.ModuleType("timm")

    class FakeMega:
        def eval(self):
            return self

        def to(self, device):
            self.device = device
            return self

    def _create_model(name, pretrained=False):
        created.append(name)
        assert pretrained is True
        return FakeMega()

    fake_timm.create_model = _create_model
    fake_timm_data = types.ModuleType("timm.data")
    fake_timm_data.resolve_model_data_config = lambda model: {"input_size": (3, 384, 384)}
    fake_timm_transforms = types.ModuleType("timm.data.transforms_factory")
    fake_timm_transforms.create_transform = lambda **kwargs: (lambda img: img)
    monkeypatch.setitem(__import__("sys").modules, "timm", fake_timm)
    monkeypatch.setitem(__import__("sys").modules, "timm.data", fake_timm_data)
    monkeypatch.setitem(__import__("sys").modules, "timm.data.transforms_factory", fake_timm_transforms)
    monkeypatch.setattr(svc, "_MEGA_MODEL", None)
    monkeypatch.setattr(svc, "_MEGA_TRANSFORM", None)
    monkeypatch.setattr(svc, "_MEGA_DEVICE", None)

    model, transform, device = svc._get_mega_model()
    assert created == [settings.MEGA_DESCRIPTOR_MODEL]
    assert str(device) == "cpu"
    assert svc._get_mega_model() == (model, transform, device)  # cached: no second create
    assert created == [settings.MEGA_DESCRIPTOR_MODEL]


def test_mega_loader_defaults_to_cpu_without_cuda(monkeypatch, settings):
    import types

    settings.MEGA_DESCRIPTOR_DEVICE = ""
    fake_timm = types.ModuleType("timm")
    fake_timm.create_model = lambda name, pretrained=False: types.SimpleNamespace(
        eval=lambda: types.SimpleNamespace(to=lambda device: None)
    )
    fake_timm_data = types.ModuleType("timm.data")
    fake_timm_data.resolve_model_data_config = lambda model: {}
    fake_timm_transforms = types.ModuleType("timm.data.transforms_factory")
    fake_timm_transforms.create_transform = lambda **kwargs: None
    monkeypatch.setitem(__import__("sys").modules, "timm", fake_timm)
    monkeypatch.setitem(__import__("sys").modules, "timm.data", fake_timm_data)
    monkeypatch.setitem(__import__("sys").modules, "timm.data.transforms_factory", fake_timm_transforms)
    monkeypatch.setattr(svc, "_MEGA_MODEL", None)

    import torch

    monkeypatch.setattr(torch.cuda, "is_available", lambda: False)
    _, _, device = svc._get_mega_model()
    assert device.type == "cpu"


def test_megadescriptor_embedding_is_l2_normalized(monkeypatch):
    import torch

    class FakeModel:
        def __call__(self, tensor):
            assert tensor.shape == (1, 2)  # batch dim added
            return torch.tensor([[3.0, 4.0]])  # norm 5 → normalized [0.6, 0.8]

    def fake_transform(img):
        return torch.tensor([1.0, 1.0])

    monkeypatch.setattr(
        svc, "_get_mega_model", lambda: (FakeModel(), fake_transform, torch.device("cpu"))
    )
    embedding = megadescriptor_embedding(Image.new("RGB", (8, 8)))
    assert embedding == pytest.approx([0.6, 0.8], abs=1e-6)
    norm = sum(v * v for v in embedding) ** 0.5
    assert norm == pytest.approx(1.0, abs=1e-6)


def test_embed_photo_bytes_runs_load_box_crop_embed_pipeline(monkeypatch):
    """embed_photo_bytes: bytes → load_image → best_animal_box → padded crop → embed."""
    calls: list[str] = []
    image = Image.new("RGB", (100, 100))

    monkeypatch.setattr(svc, "load_image", lambda raw: calls.append("load") or image)
    monkeypatch.setattr(
        PetDetectionService, "best_animal_box", lambda self, img: calls.append("box") or (10.0, 10.0, 40.0, 40.0)
    )
    monkeypatch.setattr(
        svc, "megadescriptor_embedding", lambda crop: calls.append(f"embed:{crop.size}") or [1.0, 0.0]
    )

    embedding = MegaDescriptorService.embed_photo_bytes(b"raw")

    assert embedding == [1.0, 0.0]
    # box (10,10)-(40,40) with default 0.20 padding → 30×30 box expanded by 6px → 42×42 crop.
    assert calls == ["load", "box", "embed:(42, 42)"]
    assert image.size == (100, 100)  # original untouched


def test_embed_photo_bytes_falls_back_to_full_image_without_box(monkeypatch):
    image = Image.new("RGB", (64, 48))
    monkeypatch.setattr(svc, "load_image", lambda raw: image)
    monkeypatch.setattr(PetDetectionService, "best_animal_box", lambda self, img: None)
    monkeypatch.setattr(
        svc, "megadescriptor_embedding", lambda crop: [float(crop.size[0]), float(crop.size[1])]
    )
    assert MegaDescriptorService.embed_photo_bytes(b"raw") == [64.0, 48.0]


def test_best_animal_box_returns_highest_confidence_animal(monkeypatch, settings):
    import numpy as np

    settings.YOLO_CONFIDENCE_THRESHOLD = 0.20

    class _Boxes:
        cls = np.array([16, 15], dtype=float)
        conf = np.array([0.5, 0.9], dtype=float)
        xyxy = np.array([[1.0, 2.0, 3.0, 4.0], [10.0, 20.0, 30.0, 40.0]], dtype=float)

    class _Result:
        names = {16: "dog", 15: "cat"}
        boxes = _Boxes()

    class FakeModel:
        def predict(self, image, conf=None, verbose=False):
            return [_Result()]

    monkeypatch.setattr(svc, "_get_model", lambda: FakeModel())
    box = PetDetectionService().best_animal_box(Image.new("RGB", (32, 32)))
    assert box == (10.0, 20.0, 30.0, 40.0)  # cat @ 0.9 wins over dog @ 0.5


def test_padded_crop_uses_settings_padding_by_default(monkeypatch, settings):
    settings.PET_CROP_PADDING = 0.5
    image = Image.new("RGB", (100, 100))
    # box (40,40)-(60,60), w=h=20, padding 0.5 → expand 10px → (30,30)-(70,70) = 40×40.
    assert padded_crop(image, (40.0, 40.0, 60.0, 60.0), settings.PET_CROP_PADDING).size == (40, 40)


def test_mega_model_id_reflects_configured_model(settings):
    assert mega_model_id() == "MegaDescriptor-L-384"
    settings.MEGA_DESCRIPTOR_MODEL = "hf-hub:BVRA/MegaDescriptor-DINOv2-518"
    assert mega_model_id() == "MegaDescriptor-DINOv2-518"
