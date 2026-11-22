"""Root URL configuration — NO django.contrib.admin (admin is fully removed)."""

from django.conf import settings
from django.urls import include, path, re_path
from django.views.static import serve
from drf_spectacular.views import SpectacularAPIView, SpectacularSwaggerView

from apps.common.views import HealthView

urlpatterns = [
    path("api/health", HealthView.as_view(), name="health"),
    path("api/auth/", include("apps.users.urls")),
    path("api/auth", include("apps.users.urls")),
    path("api/pets/", include("apps.pets.urls")),
    path("api/pets", include("apps.pets.urls")),
    path("api/flyers/", include("apps.flyers.urls")),
    path("api/flyers", include("apps.flyers.urls")),
    path("api/rewards/", include("apps.rewards.urls")),
    path("api/rewards", include("apps.rewards.urls")),
    path("api/webhooks/", include("apps.webhooks.urls")),
    path("api/webhooks", include("apps.webhooks.urls")),
    path("api/schema", SpectacularAPIView.as_view(), name="schema"),
    path("api/docs", SpectacularSwaggerView.as_view(url_name="schema"), name="docs"),
]

# Serve filesystem media when PAWPRINT_TESTING=1 (DEBUG=0 there) so Playwright e2e can
# load signed /media/ URLs from local storage; in production Cloudinary serves them.
if settings.TESTING:
    urlpatterns += [
        re_path(r"^media/(?P<path>.*)$", serve, {"document_root": settings.MEDIA_ROOT}),
    ]
