"""Integration: flyer gallery/detail/CRUD + query-count ceilings."""

import uuid

import pytest

from apps.flyers.factories import FlyerFactory
from apps.flyers.models import Flyer
from apps.pets.factories import PetFactory
from apps.users.factories import UserFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _mock_asset_rendering(monkeypatch):
    """Asset rendering (WeasyPrint/Playwright) is mocked; storage uses local FS in tests."""
    monkeypatch.setattr("apps.flyers.tasks.render_flyer_pdf", lambda html: b"%PDF-1.4 fake")
    monkeypatch.setattr("apps.flyers.tasks.render_flyer_png", lambda html: b"\x89PNG fake")


def test_public_gallery_guest_allowed(api_client, django_assert_max_num_queries):
    for _ in range(5):
        FlyerFactory(status=Flyer.Status.ACTIVE)
    with django_assert_max_num_queries(7):
        resp = api_client.get("/api/flyers")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body["results"]) == 5
    assert body["next"] is None
    # serialized shape
    first = body["results"][0]
    assert first["pet"]["name"]
    assert first["mode"] in ("emergency", "outreach")


def test_gallery_hides_non_active(api_client):
    FlyerFactory(status=Flyer.Status.DRAFT)
    FlyerFactory(status=Flyer.Status.ACTIVE)
    resp = api_client.get("/api/flyers")
    assert len(resp.json()["results"]) == 1


def test_gallery_mode_filter(api_client):
    FlyerFactory(mode=Flyer.Mode.EMERGENCY)
    FlyerFactory(mode=Flyer.Mode.OUTREACH)
    resp = api_client.get("/api/flyers", {"mode": "outreach"})
    assert len(resp.json()["results"]) == 1
    assert resp.json()["results"][0]["mode"] == "outreach"


def test_gallery_full_text_search(api_client):
    pet = PetFactory(name="Bruno", breed="Aspin", color="brown")
    FlyerFactory(pet=pet, status=Flyer.Status.ACTIVE)
    other = PetFactory(name="Luna", breed="Siamese", color="white")
    FlyerFactory(pet=other, status=Flyer.Status.ACTIVE)
    resp = api_client.get("/api/flyers", {"q": "bruno"})
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert len(results) == 1
    assert results[0]["pet"]["name"] == "Bruno"


def test_gallery_cursor_pagination(api_client):
    for _ in range(15):
        FlyerFactory(status=Flyer.Status.ACTIVE)
    page1 = api_client.get("/api/flyers")
    assert len(page1.json()["results"]) == 12
    assert page1.json()["next"] is not None
    page2 = api_client.get(page1.json()["next"].replace("http://testserver", ""))
    assert len(page2.json()["results"]) == 3


def test_flyer_detail_guest_allowed(api_client, django_assert_max_num_queries):
    flyer = FlyerFactory(status=Flyer.Status.ACTIVE)
    with django_assert_max_num_queries(6):
        resp = api_client.get(f"/api/flyers/{flyer.pk}")
    assert resp.status_code == 200
    body = resp.json()
    assert body["id"] == str(flyer.pk)
    assert body["qr_target_value"].startswith("http")


def test_flyer_detail_404(api_client):
    resp = api_client.get(f"/api/flyers/{uuid.uuid4()}")
    assert resp.status_code == 404


def test_flyer_detail_returns_all_photo_urls(api_client, django_assert_max_num_queries):
    """The public detail carries every uploaded angle (cover first) for the gallery."""
    from apps.pets.factories import PetPhotoFactory

    flyer = FlyerFactory(status=Flyer.Status.ACTIVE)
    flyer.pet.photo_path = "pets/photos/cover.jpg"
    flyer.pet.save(update_fields=["photo_path"])
    PetPhotoFactory(pet=flyer.pet, photo_path="pets/photos/cover.jpg")
    PetPhotoFactory(pet=flyer.pet, photo_path="pets/photos/side.jpg")
    PetPhotoFactory(pet=flyer.pet, photo_path="pets/photos/back.jpg")
    with django_assert_max_num_queries(6):
        resp = api_client.get(f"/api/flyers/{flyer.pk}")
    assert resp.status_code == 200
    body = resp.json()
    assert "pets/photos/cover.jpg?" in body["photo_url"]
    assert len(body["photo_urls"]) == 3
    assert "pets/photos/cover.jpg?" in body["photo_urls"][0]
    assert {u.split("?", 1)[0].rsplit("/", 1)[-1] for u in body["photo_urls"]} == {
        "cover.jpg", "side.jpg", "back.jpg",
    }


def test_flyer_detail_photo_urls_falls_back_to_cover(api_client):
    """Legacy pets (cover path only, no PetPhoto rows) still expose one photo URL."""
    flyer = FlyerFactory(status=Flyer.Status.ACTIVE)
    flyer.pet.photo_path = "pets/photos/legacy.jpg"
    flyer.pet.save(update_fields=["photo_path"])
    resp = api_client.get(f"/api/flyers/{flyer.pk}")
    body = resp.json()
    assert len(body["photo_urls"]) == 1
    assert "pets/photos/legacy.jpg?" in body["photo_urls"][0]


def test_create_requires_auth(api_client):
    pet = PetFactory()
    resp = api_client.post(
        "/api/flyers/new", {"pet_id": str(pet.pk), "mode": "emergency"}, format="json"
    )
    assert resp.status_code == 401


def test_create_flyer_dispatches_assets_and_activates(auth_client, user):
    pet = PetFactory(owner=user)
    resp = auth_client.post(
        "/api/flyers/new",
        {
            "pet_id": str(pet.pk),
            "mode": "emergency",
            "last_seen_location": "Makati",
        },
        format="json",
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["status"] == "active"  # eager celery ran generate_flyer_assets
    assert body["export_pdf_url"]
    assert body["export_png_url"]
    assert body["qr_target_value"].endswith(f"/flyers/{body['id']}")
    flyer = Flyer.objects.get(pk=body["id"])
    assert flyer.creator == user
    assert flyer.export_pdf_path.endswith(".pdf")


def test_create_flyer_unknown_pet_400(auth_client):
    resp = auth_client.post(
        "/api/flyers/new", {"pet_id": str(uuid.uuid4()), "mode": "emergency"}, format="json"
    )
    assert resp.status_code == 400


def test_patch_owner_only(auth_client, user):
    flyer = FlyerFactory(creator=user)
    resp = auth_client.patch(
        f"/api/flyers/{flyer.pk}/edit", {"last_seen_location": "BGC"}, format="json"
    )
    assert resp.status_code == 200
    assert resp.json()["last_seen_location"] == "BGC"


def test_patch_non_owner_forbidden(api_client, user):
    other = UserFactory()
    flyer = FlyerFactory(creator=other)
    api_client.force_authenticate(user=user)
    resp = api_client.patch(
        f"/api/flyers/{flyer.pk}/edit", {"last_seen_location": "X"}, format="json"
    )
    assert resp.status_code in (403, 404)


def test_delete_owner_only(auth_client, user):
    flyer = FlyerFactory(creator=user)
    resp = auth_client.delete(f"/api/flyers/{flyer.pk}/edit")
    assert resp.status_code == 204
    assert not Flyer.objects.filter(pk=flyer.pk).exists()


def test_resolve_flyer(auth_client, user):
    flyer = FlyerFactory(creator=user, status=Flyer.Status.ACTIVE)
    resp = auth_client.patch(f"/api/flyers/{flyer.pk}/edit", {"status": "resolved"}, format="json")
    assert resp.status_code == 200
    assert resp.json()["status"] == "resolved"


def test_my_flyers(auth_client, user):
    FlyerFactory(creator=user)
    FlyerFactory(creator=user)
    FlyerFactory()  # someone else's
    resp = auth_client.get("/api/flyers/mine")
    assert resp.status_code == 200
    assert len(resp.json()["results"]) == 2
