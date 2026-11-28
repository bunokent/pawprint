from django.urls import path

from .views import (
    FlyerCreateView,
    FlyerDeletedListView,
    FlyerDetailMutateView,
    FlyerDetailView,
    FlyerListView,
    FlyerMapView,
    FlyerPurgeView,
    FlyerRestoreView,
    MyFlyersView,
)

urlpatterns = [
    path("", FlyerListView.as_view(), name="flyer-list"),
    path("mine", MyFlyersView.as_view(), name="flyer-mine"),
    path("deleted", FlyerDeletedListView.as_view(), name="flyer-deleted"),
    path("new", FlyerCreateView.as_view(), name="flyer-create"),
    path("map", FlyerMapView.as_view(), name="flyer-map"),
    path("<uuid:pk>/restore", FlyerRestoreView.as_view(), name="flyer-restore"),
    path("<uuid:pk>/deleted", FlyerPurgeView.as_view(), name="flyer-purge"),
    path("<uuid:pk>", FlyerDetailView.as_view(), name="flyer-detail"),
    path("<uuid:pk>/edit", FlyerDetailMutateView.as_view(), name="flyer-mutate"),
]
