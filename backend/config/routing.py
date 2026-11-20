"""WebSocket routing — flyer generation + per-user notifications."""

from django.urls import path

from apps.flyers.consumers import FlyerConsumer
from apps.notifications.consumers import NotificationConsumer

websocket_urlpatterns = [
    path("ws/flyers/", FlyerConsumer.as_asgi()),
    path("ws/notifications/", NotificationConsumer.as_asgi()),
]
