"""Unit: factories produce valid model rows."""

import pytest

from apps.flyers.factories import FlyerFactory
from apps.pets.factories import PetFactory, PetPhotoFactory
from apps.users.factories import UserFactory

pytestmark = pytest.mark.django_db


def test_user_factory():
    user = UserFactory()
    assert user.pk is not None
    assert user.email.endswith("@example.com")
    assert user.check_password("testpass123")


def test_pet_factory():
    pet = PetFactory()
    assert pet.pk is not None
    assert pet.owner is not None
    # search_vector is maintained on save
    pet.refresh_from_db()
    assert pet.search_vector is not None


def test_pet_photo_factory():
    photo = PetPhotoFactory()
    assert photo.pk is not None
    assert photo.pet is not None
    assert photo.photo_path.startswith("flyers/test-user/losts/")


def test_flyer_factory():
    flyer = FlyerFactory()
    assert flyer.pet is not None
    assert flyer.creator == flyer.pet.owner
