"""Notification views — thin."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from .selectors import list_notifications, unread_count
from .serializers import NotificationListSerializer, NotificationReadSerializer
from .services import NotificationService


class NotificationListView(APIView):
    """GET /api/notifications — latest notifications + unread count (auth only)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: NotificationListSerializer})
    def get(self, request: Request) -> Response:
        payload = {
            "results": list_notifications(request.user),
            "unread_count": unread_count(request.user),
        }
        return Response(NotificationListSerializer(payload).data)


class NotificationReadView(APIView):
    """POST /api/notifications/read — mark all (or the given ids) as read."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=NotificationReadSerializer, responses={200: dict})
    def post(self, request: Request) -> Response:
        serializer = NotificationReadSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        marked = NotificationService.mark_read(request.user, serializer.validated_data.get("ids"))
        return Response({"marked_read": marked, "unread_count": unread_count(request.user)})
