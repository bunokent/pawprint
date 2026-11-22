"""WebSocket routing — flyer generation broadcasts (public 'flyers' group)."""

from django.urls import path

from apps.flyers.consumers import FlyerConsumer

websocket_urlpatterns = [
    path("ws/flyers/", FlyerConsumer.as_asgi()),
]
