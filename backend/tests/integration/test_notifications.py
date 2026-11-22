"""Integration: notifications API (list, mark-read, auth)."""

import pytest

from apps.notifications.models import Notification

pytestmark = pytest.mark.django_db


@pytest.fixture(autouse=True)
def _mock_asset_rendering(monkeypatch):
    """Asset rendering (WeasyPrint/Playwright) is mocked."""
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
    NotificationService.create(user, kind=Notification.Kind.SYSTEM, title="Profile updated", link="/settings")

    resp = auth_client.get("/api/notifications")
    assert resp.status_code == 200
    body = resp.json()
    assert body["unread_count"] == 2
    assert len(body["results"]) == 2
    assert {r["kind"] for r in body["results"]} == {"system"}
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


def test_ws_broadcast_failure_does_not_break_create(user, monkeypatch):
    """A failing websocket push is logged and swallowed — the row is still created."""
    from apps.notifications.services import NotificationService

    def _down():
        raise RuntimeError("channel layer down")

    monkeypatch.setattr("channels.layers.get_channel_layer", _down)
    n = NotificationService.create(user, kind=Notification.Kind.SYSTEM, title="still created")
    assert n.pk is not None
    assert Notification.objects.filter(pk=n.pk).exists()
