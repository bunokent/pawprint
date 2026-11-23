"""Root URL configuration — NO django.contrib.admin (admin is fully removed)."""

from django.urls import include, path
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.common.views import HealthView, PrivateMediaView

urlpatterns = [
    path("api/health", HealthView.as_view(), name="health"),
    path("api/auth/", include("apps.users.urls")),
    path("api/auth", include("apps.users.urls")),
    path("api/pets/", include("apps.pets.urls")),
    path("api/pets", include("apps.pets.urls")),
    path("api/flyers/", include("apps.flyers.urls")),
    path("api/flyers", include("apps.flyers.urls")),
    path("api/schema", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
    # The ONLY way to read a private object: a short-lived signed URL issued by
    # storage.signed_url(). Files under PRIVATE_STORAGE_ROOT are never served statically.
    path("private-media/<path:key>", PrivateMediaView.as_view(), name="private-media"),
]
