from django.urls import path

from .views import (
    FlyerCreateView,
    FlyerDetailMutateView,
    FlyerDetailView,
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
]
