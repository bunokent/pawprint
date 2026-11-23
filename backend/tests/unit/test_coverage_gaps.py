"""Unit tests targeting 100% coverage on services, drivers and PetDetectionService."""

import base64
import hashlib
import hmac
import io
import json
import uuid

import httpx
import pytest
from PIL import Image

from apps.flyers.factories import FlyerFactory
from apps.flyers.models import Flyer
from apps.rewards.drivers import PayMongoDriver, StripeDriver, get_driver
from apps.rewards.models import RewardTransaction
from apps.users.factories import UserFactory
from apps.vision.dto import DetectionResult
from apps.vision.models import PetDetectionLog
from apps.vision.services import PetDetectionService

pytestmark = pytest.mark.django_db


def _img() -> bytes:
    buf = io.BytesIO()
    Image.new("RGB", (16, 16), (1, 2, 3)).save(buf, format="JPEG")
    return buf.getvalue()


# ---------------------------------------------------------------- drivers
def test_get_driver_dispatch_and_unknown():
    assert isinstance(get_driver("stripe"), StripeDriver)
    assert isinstance(get_driver("gcash"), PayMongoDriver)
    with pytest.raises(ValueError):
        get_driver("nope")


def test_paymongo_qrph_flow(settings):
    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/v1/payment_intents":
            return httpx.Response(200, json={"data": {"id": "pi_1", "attributes": {"client_key": "ck"}}})
        if request.url.path == "/v1/payment_methods":
            return httpx.Response(200, json={"data": {"id": "pm_1"}})
        if request.url.path == "/v1/payment_intents/pi_1/attach":
            return httpx.Response(200, json={"data": {"id": "pi_1", "attributes": {"qr_code_string": "qrph-payload"}}})
        raise AssertionError(request.url.path)

    client = httpx.Client(
        transport=httpx.MockTransport(handler),
        base_url=settings.PAYMONGO_BASE_URL,
        headers={"Authorization": "Basic " + base64.b64encode(b"sk:").decode()},
    )
    driver = PayMongoDriver(client=client)
    flyer = FlyerFactory()
    tx = RewardTransaction.objects.create(
        flyer=flyer, user=flyer.creator, provider="gcash",
        provider_reference="pi_1", amount_cents=1000, currency="PHP",
    )
    result = driver.create_qrph_payment(tx)
    assert result.provider_reference == "pi_1"
    assert result.qr_payload == "qrph-payload"


def test_paymongo_create_payment_unsupported_provider(settings):
    driver = PayMongoDriver(client=httpx.Client(base_url=settings.PAYMONGO_BASE_URL))
    flyer = FlyerFactory()
    tx = RewardTransaction.objects.create(
        flyer=flyer, user=flyer.creator, provider="stripe",
        provider_reference="x", amount_cents=1000,
    )
    with pytest.raises(ValueError):
        driver.create_payment(tx, "http://ok", "http://cancel")


def test_paymongo_verify_webhook_ok_and_bad(settings):
    settings.PAYMONGO_WEBHOOK_SECRET = "whsec_x"
    driver = PayMongoDriver(client=httpx.Client(base_url=settings.PAYMONGO_BASE_URL))
    payload = json.dumps({"id": "evt", "data": {}}).encode()
    sig = hmac.new(b"whsec_x", f"1.{payload.decode()}".encode(), hashlib.sha256).hexdigest()
    parsed = driver.verify_webhook(payload, f"t=1,te={sig}")
    assert parsed["id"] == "evt"
    with pytest.raises(ValueError):
        driver.verify_webhook(payload, None)
    with pytest.raises(ValueError):
        driver.verify_webhook(payload, "t=1,te=wrong")


def test_stripe_driver_verify_webhook(monkeypatch, settings):
    settings.STRIPE_WEBHOOK_SECRET = "whsec_s"
    monkeypatch.setattr("stripe.Webhook.construct_event", lambda p, s, sec: {"id": "evt_9", "type": "x"})
    assert StripeDriver().verify_webhook(b"{}", "sig")["id"] == "evt_9"


# ---------------------------------------------------------------- vision
def test_vision_selectors_and_tasks(user):
    from apps.vision.selectors import get_log_by_id, list_logs_for_user
    from apps.vision.tasks import recheck_photo

    log = PetDetectionService.record_detection(
        user, DetectionResult(passed=False, detected_classes=["car"], max_confidence=0.7), False
    )
    assert get_log_by_id(log.pk) is not None
    assert get_log_by_id(uuid.uuid4()) is None
    assert list_logs_for_user(user.pk).count() == 1
    assert recheck_photo(str(log.pk)) is False
    assert recheck_photo(str(uuid.uuid4())) is False


def test_vision_model_str_and_max_conf_empty(monkeypatch):
    log = PetDetectionLog(detected_classes=["x"], max_confidence=0.1, passed=True)
    assert "PASS" in str(log)

    class FakeModel:
        def predict(self, image, conf=None, verbose=False):
            class R:
                names = {}
                boxes = None
            return [R()]

    monkeypatch.setattr("apps.vision.services._get_model", lambda: FakeModel())
    monkeypatch.setattr("apps.vision.services._clip_animal_gate", lambda image: False)
    monkeypatch.setattr("apps.vision.services._clip_is_flat_graphic", lambda image: False)
    monkeypatch.setattr("apps.vision.services._refine_species", lambda image, accepted: list(accepted))
    from apps.common.exceptions import NoPetDetectedError

    with pytest.raises(NoPetDetectedError):
        PetDetectionService().validate_pet_image(_img())


def test_vision_singleton_model_loader(monkeypatch, settings):
    import apps.vision.services as svc

    class FakeYOLOWorld:
        def __init__(self, path):
            self.path = path
            self.model = self
            self.class_calls = []

        def set_classes(self, classes):
            self.class_calls.append(classes)

    monkeypatch.setattr(svc, "_MODEL", None)
    import types

    fake_ultra = types.ModuleType("ultralytics")
    fake_ultra.YOLOWorld = FakeYOLOWorld
    monkeypatch.setitem(__import__("sys").modules, "ultralytics", fake_ultra)
    model = svc._get_model()
    assert isinstance(model, FakeYOLOWorld)
    assert model.path == settings.YOLO_MODEL_PATH
    assert model.class_calls == [list(svc.ANIMAL_CLASSES)]
    assert svc._get_model() is model  # singleton: no second load or set_classes call
    assert model.class_calls == [list(svc.ANIMAL_CLASSES)]


def test_vision_loader_falls_back_from_stale_non_world_path(monkeypatch, settings):
    import types

    import apps.vision.services as svc

    class FakeYOLOWorld:
        def __init__(self, path):
            self.path = path
            self.model = self
            self.class_calls = []

        def set_classes(self, classes):
            self.class_calls.append(classes)

    settings.YOLO_MODEL_PATH = "yolov8n.pt"
    monkeypatch.setattr(svc, "_MODEL", None)
    fake_ultra = types.ModuleType("ultralytics")
    fake_ultra.YOLOWorld = FakeYOLOWorld
    monkeypatch.setitem(__import__("sys").modules, "ultralytics", fake_ultra)

    model = svc._get_model()
    assert model.path == svc.DEFAULT_YOLO_WORLD_MODEL
    assert model.class_calls == [list(svc.ANIMAL_CLASSES)]


def test_vision_loader_rejects_checkpoint_without_world_head(monkeypatch, settings):
    import types

    import apps.vision.services as svc

    class NonWorldYOLOWorld:
        def __init__(self, path):
            self.path = path
            self.model = object()

    settings.YOLO_MODEL_PATH = svc.DEFAULT_YOLO_WORLD_MODEL
    monkeypatch.setattr(svc, "_MODEL", None)
    fake_ultra = types.ModuleType("ultralytics")
    fake_ultra.YOLOWorld = NonWorldYOLOWorld
    monkeypatch.setitem(__import__("sys").modules, "ultralytics", fake_ultra)

    with pytest.raises(RuntimeError, match="YOLO-World checkpoint required"):
        svc._get_model()


# ---------------------------------------------------------------- flyers services gaps
def test_flyer_service_gaps(auth_client, user):
    from apps.flyers.services import FlyerError, FlyerService

    with pytest.raises(FlyerError):
        FlyerService.get_or_404(uuid.uuid4())
    flyer = FlyerFactory(creator=user, status=Flyer.Status.ACTIVE)
    FlyerService.delete_flyer(flyer)
    assert not Flyer.objects.filter(pk=flyer.pk).exists()


# ---------------------------------------------------------------- rewards service gaps
def test_reward_service_gaps(user):
    from apps.rewards.services import RewardError, RewardService

    with pytest.raises(RewardError):
        RewardService.create_reward(user, uuid.uuid4(), "stripe")
    flyer = FlyerFactory(creator=user, reward_amount_cents=0)
    with pytest.raises(RewardError):
        RewardService.create_reward(user, flyer.pk, "stripe")


def test_rewards_task():
    from apps.rewards.tasks import sync_transaction_status

    flyer = FlyerFactory()
    tx = RewardTransaction.objects.create(
        flyer=flyer, user=flyer.creator, provider="stripe",
        provider_reference="pi_z", amount_cents=100,
    )
    assert sync_transaction_status(str(tx.pk), "pi_z", "checkout.session.completed") == "succeeded"
    assert sync_transaction_status(str(tx.pk), "missing", "checkout.session.completed") == "missing"


# ---------------------------------------------------------------- users services gaps
def test_google_authorize_url_and_exchange(monkeypatch, settings):
    from apps.users.services import _exchange_google_code, google_authorize_url

    url = google_authorize_url("http://localhost:5173/cb")
    assert "accounts.google.com" in url and "redirect_uri=" in url

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.host == "oauth2.googleapis.com":
            return httpx.Response(200, json={"access_token": "at"})
        return httpx.Response(200, json={
            "sub": "s1", "email": "a@b.com", "email_verified": True, "name": "A", "picture": ""
        })

    real_client = httpx.Client

    class FakeClient:
        def __init__(self, *a, **k):
            self._c = real_client(transport=httpx.MockTransport(handler))

        def __enter__(self):
            return self._c

        def __exit__(self, *a):
            return False

    monkeypatch.setattr("apps.users.services.httpx.Client", FakeClient)
    profile = _exchange_google_code("code", "http://localhost:5173/cb")
    assert profile.sub == "s1" and profile.email == "a@b.com"


def test_users_views_gap(api_client, user):
    # logout requires auth
    assert api_client.post("/api/auth/logout").status_code == 401


def test_pet_service_create_pet(user):
    from apps.pets.models import Pet
    from apps.pets.services import PetService

    pet = PetService.create_pet(user, name="Rex", species=Pet.Species.DOG, breed="Lab", color="black")
    assert pet.pk is not None and pet.owner == user


def test_apply_provider_event_failed_and_unknown(user):
    from apps.rewards.services import RewardService

    flyer = FlyerFactory(creator=user)
    RewardTransaction.objects.create(
        flyer=flyer, user=user, provider="stripe", provider_reference="pi_f", amount_cents=100
    )
    out = RewardService.apply_provider_event("stripe", "pi_f", "payment_intent.payment_failed", {})
    assert out is not None and out.status == "failed"
    out = RewardService.apply_provider_event("stripe", "pi_f", "some.other.event", {})
    assert out is not None and out.status == "failed"  # unchanged


def test_flyer_get_or_404_hit(user):
    from apps.flyers.services import FlyerService

    flyer = FlyerFactory(creator=user)
    assert FlyerService.get_or_404(flyer.pk).pk == flyer.pk


def test_google_link_sets_display_name(api_client, monkeypatch):
    from apps.users.dto import GoogleProfile

    existing = UserFactory(email="noname@example.com", display_name="")
    profile = GoogleProfile(sub="g-1", email="noname@example.com", email_verified=False, name="Full Name", picture="")
    monkeypatch.setattr("apps.users.services._exchange_google_code", lambda c, r: profile)
    resp = api_client.post(
        "/api/auth/google/callback", {"code": "c", "redirect_uri": "http://localhost:5173/cb"}, format="json"
    )
    assert resp.status_code == 200
    existing.refresh_from_db()
    assert existing.display_name == "Full Name"


def test_strip_exif_converts_palette_mode_and_thumb_rgb():
    buf = io.BytesIO()
    Image.new("P", (16, 16)).save(buf, format="PNG")
    cleaned = PetDetectionService.strip_exif(buf.getvalue())
    assert Image.open(io.BytesIO(cleaned)).mode == "RGB"
    buf2 = io.BytesIO()
    Image.new("L", (16, 16)).save(buf2, format="PNG")
    thumb = PetDetectionService.make_thumbnail(buf2.getvalue())
    assert Image.open(io.BytesIO(thumb)).mode == "RGB"


# ---------------------------------------------------------------- flyer HTML rendering (photo fallback)
def test_render_flyer_html_with_photo(monkeypatch):
    """When the pet has a photo_path, photo_url is an <img> and no fallback div appears."""
    from apps.flyers.factories import FlyerFactory as _FF
    from apps.flyers.models import Flyer as _Flyer
    from apps.flyers.tasks import render_flyer_html
    from apps.pets.factories import PetFactory as _PF

    monkeypatch.setattr("apps.common.storage.signed_url", lambda path: f"https://cdn.example.com/{path}")
    pet = _PF(photo_path="pets/photos/rex.jpg")
    flyer = _FF(pet=pet, mode=_Flyer.Mode.EMERGENCY)

    html = render_flyer_html(flyer)

    assert 'src="https://cdn.example.com/pets/photos/rex.jpg"' in html
    # The fallback <div> should not be present when a real photo URL exists
    assert '<div class="photo-fallback"' not in html


def test_render_flyer_html_without_photo_emergency(monkeypatch):
    """When the pet has no photo, the emergency template renders the SVG fallback."""
    from apps.flyers.factories import FlyerFactory as _FF
    from apps.flyers.models import Flyer as _Flyer
    from apps.flyers.tasks import render_flyer_html
    from apps.pets.factories import PetFactory as _PF

    monkeypatch.setattr("apps.common.storage.signed_url", lambda path: f"https://cdn.example.com/{path}")
    pet = _PF(photo_path="")
    flyer = _FF(pet=pet, mode=_Flyer.Mode.EMERGENCY)

    html = render_flyer_html(flyer)

    assert "<img" not in html.split('<div class="photo">')[1].split("</div>")[0]
    assert "photo-fallback" in html
    assert "<svg" in html


def test_render_flyer_html_without_photo_outreach(monkeypatch):
    """When the pet has no photo, the outreach template renders the SVG fallback."""
    from apps.flyers.factories import FlyerFactory as _FF
    from apps.flyers.models import Flyer as _Flyer
    from apps.flyers.tasks import render_flyer_html
    from apps.pets.factories import PetFactory as _PF

    monkeypatch.setattr("apps.common.storage.signed_url", lambda path: f"https://cdn.example.com/{path}")
    pet = _PF(photo_path="")
    flyer = _FF(pet=pet, mode=_Flyer.Mode.OUTREACH)

    html = render_flyer_html(flyer)

    assert "<img" not in html.split('<div class="photo">')[1].split("</div>")[0]
    assert "photo-fallback" in html
    assert "<svg" in html
