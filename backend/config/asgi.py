"""ASGI entrypoint — HTTP + WebSocket (Django Channels) routing."""

import os

from channels.routing import ProtocolTypeRouter, URLRouter
from django.core.asgi import get_asgi_application

os.environ.setdefault("DJANGO_SETTINGS_MODULE", "config.settings")

django_asgi_app = get_asgi_application()

from config.routing import websocket_urlpatterns  # noqa: E402

application = ProtocolTypeRouter(
    {
        "http": django_asgi_app,
        # The only websocket route (ws/flyers/) is a public broadcast group,
        # so no AuthMiddlewareStack is needed.
        "websocket": URLRouter(websocket_urlpatterns),
    }
)
