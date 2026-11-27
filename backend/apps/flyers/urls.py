from django.urls import path

from .views import (
    FlyerCreateView,
    FlyerDetailMutateView,
    FlyerDetailView,
    FlyerExportView,
    FlyerListView,
    FlyerMapView,
    MyFlyersView,
)

urlpatterns = [
    path("", FlyerListView.as_view(), name="flyer-list"),
    path("mine", MyFlyersView.as_view(), name="flyer-mine"),
    path("new", FlyerCreateView.as_view(), name="flyer-create"),
    path("map", FlyerMapView.as_view(), name="flyer-map"),
    path("<uuid:pk>", FlyerDetailView.as_view(), name="flyer-detail"),
    path("<uuid:pk>/edit", FlyerDetailMutateView.as_view(), name="flyer-mutate"),
    path("<uuid:pk>/export-pdf", FlyerExportView.as_view(), name="flyer-export"),
]
