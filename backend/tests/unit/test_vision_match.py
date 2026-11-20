"""Unit: CLIP embedding cosine similarity + PetMatchService lost/found matching."""

import pytest

from apps.flyers.factories import FlyerFactory
from apps.flyers.models import Flyer
from apps.notifications.models import Notification
from apps.pets.factories import PetFactory
from apps.vision.models import PetMatch
from apps.vision.services import PetMatchService, cosine_similarity

pytestmark = pytest.mark.django_db

# Tiny 4-dim stand-in embeddings (the real ones are 512-dim CLIP vectors).
EMB_A = [1.0, 0.0, 0.0, 0.0]
EMB_A_CLOSE = [0.99, 0.14, 0.0, 0.0]  # cosine ~0.99 with EMB_A
EMB_OTHER = [0.0, 1.0, 0.0, 0.0]  # cosine 0.0 with EMB_A


def test_cosine_similarity():
    assert cosine_similarity(EMB_A, EMB_A) == pytest.approx(1.0)
    assert cosine_similarity(EMB_A, EMB_A_CLOSE) == pytest.approx(0.99, abs=0.01)
    assert cosine_similarity(EMB_A, EMB_OTHER) == pytest.approx(0.0)
    assert cosine_similarity([], EMB_A) == 0.0
    assert cosine_similarity(EMB_A, [1.0, 0.0]) == 0.0  # length mismatch
    assert cosine_similarity([0.0, 0.0], [1.0, 0.0]) == 0.0  # zero norm


def test_match_flyer_creates_match_and_notifications_for_similar_photos():
    lost_pet = PetFactory(photo_embedding=EMB_A)
    lost_flyer = FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=lost_pet, location_lat=14.5, location_lng=121.0)
    found_pet = PetFactory(photo_embedding=EMB_A_CLOSE)
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=found_pet, location_lat=14.6, location_lng=121.0)

    matches = PetMatchService.match_flyer(str(found_flyer.pk))

    assert len(matches) == 1
    match = PetMatch.objects.get()
    assert match.lost_flyer == lost_flyer
    assert match.found_flyer == found_flyer
    assert match.score == pytest.approx(0.99, abs=0.01)
    # Both sides get a notification: lost owner (match_found) + finder (match_lost).
    kinds = set(Notification.objects.values_list("kind", flat=True))
    assert kinds == {Notification.Kind.MATCH_FOUND, Notification.Kind.MATCH_LOST}
    notif = Notification.objects.get(kind=Notification.Kind.MATCH_FOUND)
    assert notif.user == lost_flyer.creator
    assert str(found_flyer.pk) in notif.link
    assert found_pet.name in notif.title


def test_match_flyer_ignores_dissimilar_photos():
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_OTHER))

    assert PetMatchService.match_flyer(str(found_flyer.pk)) == []
    assert PetMatch.objects.count() == 0
    assert Notification.objects.count() == 0


def test_match_flyer_is_bidirectional_and_deduplicated():
    lost_flyer = FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_A_CLOSE))

    assert len(PetMatchService.match_flyer(str(found_flyer.pk))) == 1
    # Running from the lost side finds the same pair — no duplicate match/notification.
    assert len(PetMatchService.match_flyer(str(lost_flyer.pk))) == 1
    assert PetMatch.objects.count() == 1
    assert Notification.objects.count() == 2


def test_match_flyer_skips_pets_without_photo_or_embedding():
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    no_photo = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory())  # no photo_path, no embedding
    assert PetMatchService.match_flyer(str(no_photo.pk)) == []
    assert PetMatch.objects.count() == 0


def test_match_flyer_ignores_outreach_and_missing_flyers():
    outreach = FlyerFactory(mode=Flyer.Mode.OUTREACH, pet=PetFactory(photo_embedding=EMB_A))
    assert PetMatchService.match_flyer(str(outreach.pk)) == []
    import uuid

    assert PetMatchService.match_flyer(str(uuid.uuid4())) == []


def test_ensure_embedding_uses_cache_and_skips_storage_in_testing(settings):
    pet = PetFactory(photo_embedding=EMB_A)
    assert PetMatchService.ensure_embedding(pet) == EMB_A
    # Under PAWPRINT_TESTING a photo without a cached embedding is NOT recomputed.
    pet2 = PetFactory(photo_path="pets/photos/x.jpg")
    assert PetMatchService.ensure_embedding(pet2) is None
