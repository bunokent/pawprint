"""Flyer views — thin (≤15 lines): validate → selector/service → respond."""

from __future__ import annotations

import uuid

from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.permissions import IsOwnerOrReadOnly

from .edit_rules import flyer_is_editable
from .models import Flyer
from .selectors import get_flyer_by_id, list_flyers_by_creator, list_map_flyers, list_public_flyers
from .serializers import FlyerCreateSerializer, FlyerSerializer, FlyerUpdateSerializer
from .services import FlyerError, FlyerService

MODE_PARAM = OpenApiParameter("mode", str, OpenApiParameter.QUERY, enum=Flyer.Mode.values)
Q_PARAM = OpenApiParameter("q", str, OpenApiParameter.QUERY)


class FlyerListView(generics.ListAPIView):
    """Public gallery — Guest Mode allowed. Cursor-paginated, FTS + mode filter."""

    permission_classes = [AllowAny]
    serializer_class = FlyerSerializer

    @extend_schema(parameters=[MODE_PARAM, Q_PARAM])
    def get_queryset(self):  # noqa: ANN201
        return list_public_flyers(
            mode=self.request.query_params.get("mode") or None,
            query=self.request.query_params.get("q") or None,
        )


class FlyerDetailView(APIView):
    """Public flyer detail — Guest Mode allowed (QR scanners land here)."""

    permission_classes = [AllowAny]

    def get(self, request: Request, pk: uuid.UUID) -> Response:
        flyer = get_flyer_by_id(pk)
        if flyer is None:
            return Response({"error": {"code": "not_found", "message": "Flyer not found."}}, status=404)
        return Response(FlyerSerializer(flyer).data)


class FlyerCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request: Request) -> Response:
        serializer = FlyerCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        try:
            flyer = FlyerService.create_flyer(request.user, **serializer.validated_data)
        except FlyerError as exc:
            return Response({"error": {"code": "flyer_error", "message": str(exc)}}, status=400)
        return Response(FlyerSerializer(flyer).data, status=status.HTTP_201_CREATED)


class FlyerDetailMutateView(APIView):
    """PATCH/DELETE restricted to the creator (IsOwnerOrReadOnly)."""

    permission_classes = [IsAuthenticated, IsOwnerOrReadOnly]

    def _get(self, pk: uuid.UUID):
        flyer = get_flyer_by_id(pk)
        if flyer is None:
            return None, Response({"error": {"code": "not_found", "message": "Flyer not found."}}, status=404)
        return flyer, None

    def patch(self, request: Request, pk: uuid.UUID) -> Response:
        flyer, err = self._get(pk)
        if err:
            return err
        self.check_object_permissions(request, flyer)
        if not flyer_is_editable(flyer.status):
            return Response(
                {"error": {"code": "flyer_resolved", "message": "Resolved flyers can no longer be edited."}},
                status=status.HTTP_409_CONFLICT,
            )
        serializer = FlyerUpdateSerializer(flyer, data=request.data, partial=True)
        serializer.is_valid(raise_exception=True)
        data = serializer.validated_data
        if "status" in data and data["status"] == Flyer.Status.RESOLVED:
            flyer = FlyerService.mark_resolved(flyer)
        else:
            data.pop("status", None)
            flyer = FlyerService.update_flyer(flyer, **data)
        return Response(FlyerSerializer(flyer).data)

    def delete(self, request: Request, pk: uuid.UUID) -> Response:
        flyer, err = self._get(pk)
        if err:
            return err
        self.check_object_permissions(request, flyer)
        FlyerService.delete_flyer(flyer)
        return Response(status=status.HTTP_204_NO_CONTENT)


class FlyerMapView(APIView):
    """Public pet-map pins — active lost/found flyers with coordinates. Guest allowed."""

    permission_classes = [AllowAny]

    def get(self, request: Request) -> Response:
        flyers = list(list_map_flyers())
        return Response(FlyerSerializer(flyers, many=True).data)


class MyFlyersView(generics.ListAPIView):
    """Authenticated user's own flyers (active + resolved)."""

    permission_classes = [IsAuthenticated]
    serializer_class = FlyerSerializer

    def get_queryset(self):  # noqa: ANN201
        return list_flyers_by_creator(self.request.user.pk)
