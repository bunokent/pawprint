"""Integration: public pet-map endpoint + found-mode flyers + geo fields."""

import uuid

import pytest

from apps.flyers.factories import FlyerFactory
from apps.flyers.models import Flyer
from apps.pets.factories import PetFactory

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _mock_asset_rendering(monkeypatch):
    monkeypatch.setattr("apps.flyers.tasks.render_flyer_pdf", lambda html: b"%PDF-1.4 fake")
    monkeypatch.setattr("apps.flyers.tasks.render_flyer_png", lambda html: b"\x89PNG fake")


def test_map_endpoint_guest_allowed_with_query_ceiling(api_client, django_assert_max_num_queries):
    FlyerFactory(status=Flyer.Status.ACTIVE, mode=Flyer.Mode.EMERGENCY, location_lat=14.55, location_lng=121.02)
    FlyerFactory(status=Flyer.Status.ACTIVE, mode=Flyer.Mode.FOUND, location_lat=14.60, location_lng=121.00)
    with django_assert_max_num_queries(7):  # +1 query for vision matches on the pins
        resp = api_client.get("/api/flyers/map")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 2
    assert {f["mode"] for f in body} == {"emergency", "found"}
    for flyer in body:
        assert flyer["location_lat"] is not None
        assert flyer["location_lng"] is not None
        assert flyer["pet"]["name"]
        assert flyer["photo_url"] is not None or flyer["pet"]["photo_path"] == ""
        assert flyer["match"] is None  # no vision matches in this fixture


def test_map_endpoint_excludes_unlocated_draft_and_outreach(api_client):
    FlyerFactory(status=Flyer.Status.ACTIVE, mode=Flyer.Mode.EMERGENCY)  # no coords
    FlyerFactory(status=Flyer.Status.DRAFT, mode=Flyer.Mode.EMERGENCY, location_lat=14.5, location_lng=121.0)
    FlyerFactory(status=Flyer.Status.ACTIVE, mode=Flyer.Mode.OUTREACH, location_lat=14.5, location_lng=121.0)
    FlyerFactory(status=Flyer.Status.ACTIVE, mode=Flyer.Mode.FOUND, location_lat=14.6, location_lng=121.0)
    FlyerFactory(status=Flyer.Status.ACTIVE, mode=Flyer.Mode.FOUND, location_lat=14.7, location_lng=None)
    resp = api_client.get("/api/flyers/map")
    assert resp.status_code == 200
    body = resp.json()
    assert len(body) == 1
    assert body[0]["mode"] == "found"


def test_create_found_flyer_with_coordinates(auth_client, api_client, user):
    pet = PetFactory(owner=user, status="found")
    resp = auth_client.post(
        "/api/flyers/new",
        {
            "pet_id": str(pet.pk),
            "mode": "found",
            "last_seen_location": "Brgy. Bel-Air, Makati",
            "last_seen_date": "2026-11-18T09:30:00Z",
            "location_lat": 14.5647,
            "location_lng": 120.9989,
            "distinctive_markings": "Gray shorthair, friendly",
            "contact_phone": "09170000000",
        },
        format="json",
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["mode"] == "found"
    assert body["location_lat"] == pytest.approx(14.5647)
    assert body["location_lng"] == pytest.approx(120.9989)
    assert body["last_seen_location"] == "Brgy. Bel-Air, Makati"
    flyer = Flyer.objects.get(pk=body["id"])
    assert flyer.location_lat == pytest.approx(14.5647)
    # A found flyer now appears on the public map.
    assert any(f["id"] == body["id"] for f in api_client.get("/api/flyers/map").json())


def test_create_flyer_rejects_out_of_range_coordinates(auth_client, user):
    pet = PetFactory(owner=user)
    resp = auth_client.post(
        "/api/flyers/new",
        {"pet_id": str(pet.pk), "mode": "emergency", "location_lat": 91.0, "location_lng": 121.0},
        format="json",
    )
    assert resp.status_code == 400
    resp = auth_client.post(
        "/api/flyers/new",
        {"pet_id": str(pet.pk), "mode": "emergency", "location_lat": 14.5, "location_lng": -181.0},
        format="json",
    )
    assert resp.status_code == 400


def test_patch_updates_coordinates(auth_client, user):
    flyer = FlyerFactory(creator=user, location_lat=None, location_lng=None)
    resp = auth_client.patch(
        f"/api/flyers/{flyer.pk}/edit",
        {"location_lat": 14.5995, "location_lng": 120.9842, "last_seen_location": "Quezon City"},
        format="json",
    )
    assert resp.status_code == 200
    assert resp.json()["location_lat"] == pytest.approx(14.5995)
    assert resp.json()["location_lng"] == pytest.approx(120.9842)


def test_create_pet_with_found_status(auth_client, user):
    resp = auth_client.post(
        "/api/pets",
        {"name": "Miso", "species": "cat", "status": "found", "breed": "Domestic shorthair", "color": "gray"},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.json()["status"] == "found"


def test_create_pet_with_photo_paths_stores_every_angle(auth_client, user):
    """Multi-angle upload: each photo becomes a PetPhoto row; the first is the cover."""
    from apps.pets.models import PetPhoto

    resp = auth_client.post(
        "/api/pets",
        {
            "species": "dog",
            "status": "found",
            "photo_paths": ["pets/photos/front.jpg", "pets/photos/side.jpg", "pets/photos/back.jpg"],
        },
        format="json",
    )
    assert resp.status_code == 201
    body = resp.json()
    assert body["photo_path"] == "pets/photos/front.jpg"  # cover = first photo
    photos = PetPhoto.objects.filter(pet_id=body["id"]).order_by("created_at")
    assert [p.photo_path for p in photos] == [
        "pets/photos/front.jpg",
        "pets/photos/side.jpg",
        "pets/photos/back.jpg",
    ]
    # Legacy single photo_path still works and merges with photo_paths.
    resp = auth_client.post(
        "/api/pets",
        {"species": "dog", "photo_path": "pets/photos/a.jpg", "photo_paths": ["pets/photos/b.jpg"]},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.json()["photo_path"] == "pets/photos/a.jpg"
    assert PetPhoto.objects.filter(pet_id=resp.json()["id"]).count() == 2
    # More than 6 photos are rejected.
    resp = auth_client.post(
        "/api/pets",
        {"species": "dog", "photo_paths": [f"pets/photos/p{i}.jpg" for i in range(7)]},
        format="json",
    )
    assert resp.status_code == 400


def test_create_found_pet_without_name(auth_client, user):
    """Found-pet reports have no name — the finder doesn't know the owner's pet."""
    resp = auth_client.post(
        "/api/pets",
        {"species": "dog", "status": "found", "color": "brown", "photo_path": "pets/photos/x.jpg"},
        format="json",
    )
    assert resp.status_code == 201
    assert resp.json()["name"] == ""
    assert resp.json()["status"] == "found"
    # An explicit blank name is also accepted.
    resp = auth_client.post("/api/pets", {"name": "", "species": "cat"}, format="json")
    assert resp.status_code == 201
    assert resp.json()["name"] == ""


def test_gallery_includes_found_mode(api_client):
    FlyerFactory(mode=Flyer.Mode.FOUND, status=Flyer.Status.ACTIVE)
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, status=Flyer.Status.ACTIVE)
    resp = api_client.get("/api/flyers", {"mode": "found"})
    assert resp.status_code == 200
    results = resp.json()["results"]
    assert len(results) == 1
    assert results[0]["mode"] == "found"


def test_detail_404_still_works_for_random_uuid(api_client):
    resp = api_client.get(f"/api/flyers/{uuid.uuid4()}")
    assert resp.status_code == 404
