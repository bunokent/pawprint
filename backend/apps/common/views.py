"""Shared views."""

from django.core.exceptions import SuspiciousFileOperation
from django.http import FileResponse, Http404, HttpResponseBase
from django.views import View
from drf_spectacular.utils import extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from .private_storage import InvalidStorageKeyError, StorageUnavailableError, content_type_for, verify_signature
from .storage import get_storage


class PrivateMediaView(View):
    """Serve one private object only when its short-lived HMAC URL is valid.

    A signed URL is bound to the exact key and expiry; no directory listing,
    path traversal or unsigned direct-file access is possible.
    """

    def get(self, request, key: str) -> HttpResponseBase:  # noqa: ANN001
        if not verify_signature(key, request.GET.get("expires", ""), request.GET.get("signature", "")):
            raise Http404("Object not found.")
        try:
            handle = get_storage().open(key, "rb")
        except (FileNotFoundError, InvalidStorageKeyError, SuspiciousFileOperation, StorageUnavailableError):
            raise Http404("Object not found.") from None
        response = FileResponse(handle, content_type=content_type_for(key), as_attachment=False)
        response["X-Content-Type-Options"] = "nosniff"
        response["Cache-Control"] = "private, max-age=60"
        return response


class HealthView(APIView):
    """Liveness probe — public."""

    permission_classes = [AllowAny]
    authentication_classes: list = []

    @extend_schema(responses={200: dict})
    def get(self, request) -> Response:  # noqa: ANN001
        return Response({"status": "ok", "service": "pawprint"})
