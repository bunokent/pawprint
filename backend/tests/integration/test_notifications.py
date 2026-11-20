"""Integration: notifications API + end-to-end lost/found photo match via flyer create."""

import pytest

from apps.flyers.models import Flyer
from apps.notifications.models import Notification
from apps.pets.factories import PetFactory
from apps.users.factories import UserFactory

pytestmark = pytest.mark.django_db

EMB_A = [1.0, 0.0, 0.0, 0.0]
EMB_A_CLOSE = [0.99, 0.14, 0.0, 0.0]


@pytest.fixture(autouse=True)
def _mock_asset_rendering(monkeypatch):
    """Asset rendering (WeasyPrint/Playwright) is mocked; matching runs eagerly."""
    monkeypatch.setattr("apps.flyers.tasks.render_flyer_pdf", lambda html: b"%PDF-1.4 fake")
    monkeypatch.setattr("apps.flyers.tasks.render_flyer_png", lambda html: b"\x89PNG fake")


def test_notifications_require_auth(api_client):
    resp = api_client.get("/api/notifications")
    assert resp.status_code == 401
    resp = api_client.post("/api/notifications/read", {}, format="json")
    assert resp.status_code == 401


def test_list_and_mark_read(auth_client, user):
    from apps.notifications.services import NotificationService

    NotificationService.create(user, kind=Notification.Kind.SYSTEM, title="Welcome", link="/")
    NotificationService.create(user, kind=Notification.Kind.MATCH_FOUND, title="Possible match", link="/flyers/x")

    resp = auth_client.get("/api/notifications")
    assert resp.status_code == 200
    body = resp.json()
    assert body["unread_count"] == 2
    assert len(body["results"]) == 2
    assert {r["kind"] for r in body["results"]} == {"system", "match_found"}
    assert all(r["read_at"] is None for r in body["results"])

    resp = auth_client.post("/api/notifications/read", {}, format="json")
    assert resp.status_code == 200
    assert resp.json()["marked_read"] == 2
    assert resp.json()["unread_count"] == 0
    assert auth_client.get("/api/notifications").json()["unread_count"] == 0


def test_mark_read_specific_ids_only(auth_client, user):
    from apps.notifications.services import NotificationService

    n1 = NotificationService.create(user, kind="system", title="one")
    NotificationService.create(user, kind="system", title="two")

    resp = auth_client.post("/api/notifications/read", {"ids": [str(n1.pk)]}, format="json")
    assert resp.status_code == 200
    assert resp.json()["marked_read"] == 1
    assert resp.json()["unread_count"] == 1
    n1.refresh_from_db()
    assert n1.read_at is not None


def test_found_flyer_matching_a_lost_photo_notifies_both_sides(auth_client, api_client, user):
    """Creating a found flyer whose photo matches an active lost flyer alerts both users."""
    lost_pet = PetFactory(owner=user, photo_embedding=EMB_A)
    resp = auth_client.post(
        "/api/flyers/new",
        {"pet_id": str(lost_pet.pk), "mode": "emergency", "location_lat": 14.55, "location_lng": 121.02},
        format="json",
    )
    assert resp.status_code == 201
    lost_id = resp.json()["id"]

    finder = UserFactory()
    api_client.force_authenticate(user=finder)
    found_pet = PetFactory(owner=finder, photo_embedding=EMB_A_CLOSE)
    resp = api_client.post(
        "/api/flyers/new",
        {"pet_id": str(found_pet.pk), "mode": "found", "location_lat": 14.60, "location_lng": 121.00},
        format="json",
    )
    assert resp.status_code == 201
    found_id = resp.json()["id"]

    # Both sides were notified (eager celery ran the match task inline).
    assert Notification.objects.filter(user=user, kind=Notification.Kind.MATCH_FOUND).count() == 1
    assert Notification.objects.filter(user=finder, kind=Notification.Kind.MATCH_LOST).count() == 1

    # The public map exposes the match on both pins.
    api_client.force_authenticate(user=None)
    body = api_client.get("/api/flyers/map").json()
    by_id = {f["id"]: f for f in body}
    assert by_id[lost_id]["match"]["flyer_id"] == found_id
    assert by_id[lost_id]["match"]["pet_name"] == found_pet.name
    assert by_id[found_id]["match"]["flyer_id"] == lost_id
    assert by_id[lost_id]["match"]["score"] == pytest.approx(0.99, abs=0.01)


def test_map_match_is_null_without_match(api_client):
    from apps.flyers.factories import FlyerFactory

    FlyerFactory(mode=Flyer.Mode.EMERGENCY, location_lat=14.5, location_lng=121.0)
    body = api_client.get("/api/flyers/map").json()
    assert body[0]["match"] is None
    assert Flyer.objects.count() == 1
