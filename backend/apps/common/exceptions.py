"""Domain exceptions and the DRF exception handler that normalizes them."""

from typing import Any

from django.http import HttpRequest
from rest_framework import status
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.response import Response
from rest_framework.views import exception_handler as drf_exception_handler

from .private_storage import StorageUnavailableError

STORAGE_UNAVAILABLE_MESSAGE = "Photo storage is temporarily unavailable. Please try again."


class NoPetDetectedError(APIException):
    """Raised when YOLO-World finds no pet in an uploaded photo. Zero penalties — retry freely."""

    status_code = status.HTTP_422_UNPROCESSABLE_ENTITY
    default_detail = "No pet detected in the photo. Please upload a clear photo of your pet."
    default_code = "no_pet_detected"

    def __init__(self, detected_labels: list[str] | None = None, detail: str | None = None) -> None:
        super().__init__(detail=detail)
        self.detected_labels: list[str] = detected_labels or []


def exception_handler(exc: Exception, context: dict[str, Any]) -> Response | None:
    """Normalize all errors into {"error": {"code", "message", ...}} envelopes."""
    response = drf_exception_handler(exc, context)
    request: HttpRequest | None = context.get("request")
    if response is None:
        # Private-storage filesystem failures must surface as JSON, never as an
        # HTML 500 page — e.g. a read-only or full disk raises StorageUnavailableError.
        if isinstance(exc, StorageUnavailableError):
            return Response(
                {"error": {"code": "storage_unavailable", "message": STORAGE_UNAVAILABLE_MESSAGE}},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return None
    detail = response.data
    if isinstance(exc, NoPetDetectedError):
        body: dict[str, Any] = {
            "error": {
                "code": exc.default_code,
                "message": str(exc.detail),
                "detected_labels": exc.detected_labels,
            }
        }
    elif isinstance(detail, dict) and "detail" in detail:
        body = {"error": {"code": getattr(exc, "default_code", "error"), "message": detail["detail"]}}
    elif isinstance(detail, list) or (
        isinstance(detail, dict) and response.status_code == status.HTTP_400_BAD_REQUEST
    ):
        body = {"error": {"code": "validation_error", "message": "Validation failed.", "fields": detail}}
    else:
        body = {"error": {"code": "error", "message": str(detail)}}
    response.data = body
    if request is not None and response.status_code == status.HTTP_401_UNAUTHORIZED:
        response.data["error"]["session_expired"] = True
    if isinstance(exc, ValidationError) and isinstance(detail, dict):
        body["error"]["fields"] = detail
    return response
