"""Pet views — thin."""

from __future__ import annotations

from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.parsers import FormParser, MultiPartParser
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.common.throttles import UploadThrottle

from .serializers import (
    PetCreateSerializer,
    PetSerializer,
    PhotoUploadRequestSerializer,
    PhotoUploadResponseSerializer,
)
from .services import PetPhotoService, PetService


class PhotoUploadView(APIView):
    """POST /api/pets/photos — YOLO-World-gated upload into the user's flyer folder (10/min)."""

    permission_classes = [IsAuthenticated]
    throttle_classes = [UploadThrottle]
    throttle_scope = "upload"
    parser_classes = [MultiPartParser, FormParser]

    @extend_schema(request=PhotoUploadRequestSerializer, responses={201: PhotoUploadResponseSerializer})
    def post(self, request: Request) -> Response:
        serializer = PhotoUploadRequestSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        upload = serializer.validated_data["photo"]
        result = PetPhotoService.upload(
            request.user,
            upload.name or "photo.jpg",
            upload.read(),
            serializer.validated_data["category"],
        )
        return Response(PhotoUploadResponseSerializer(result).data, status=status.HTTP_201_CREATED)


class PetCreateView(APIView):
    permission_classes = [IsAuthenticated]

    @extend_schema(request=PetCreateSerializer, responses={201: PetSerializer})
    def post(self, request: Request) -> Response:
        serializer = PetCreateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        pet = PetService.create_pet(request.user, **serializer.validated_data)
        return Response(PetSerializer(pet).data, status=status.HTTP_201_CREATED)
