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


def test_ensure_embedding_computes_and_caches_from_storage(settings, monkeypatch):
    """Prod path: read the stored photo, embed it, cache it on the pet."""
    settings.TESTING = False
    monkeypatch.setattr("apps.common.storage.read_bytes", lambda key: b"raw-bytes")
    monkeypatch.setattr("apps.vision.services.load_image", lambda raw: object())
    monkeypatch.setattr("apps.vision.services.clip_image_embedding", lambda img: EMB_A)
    pet = PetFactory(photo_path="pets/photos/x.jpg")
    assert PetMatchService.ensure_embedding(pet) == EMB_A
    pet.refresh_from_db()
    assert pet.photo_embedding == EMB_A


def test_ensure_embedding_swallows_storage_errors(settings, monkeypatch):
    """A photo that cannot be read must NOT raise — matching continues without it."""
    settings.TESTING = False

    def _boom(key):
        raise OSError("404 from storage")

    monkeypatch.setattr("apps.common.storage.read_bytes", _boom)
    pet = PetFactory(photo_path="pets/photos/gone.jpg")
    assert PetMatchService.ensure_embedding(pet) is None
    pet.refresh_from_db()
    assert pet.photo_embedding is None


def test_match_flyer_skips_unreadable_photos_but_still_matches(settings, monkeypatch):
    """One broken counterpart photo must not kill matching for the other pairs."""
    settings.TESTING = False

    def _read(key):
        if "gone" in key:
            raise OSError("404 from storage")
        return b"raw-bytes"

    monkeypatch.setattr("apps.common.storage.read_bytes", _read)
    monkeypatch.setattr("apps.vision.services.load_image", lambda raw: object())
    monkeypatch.setattr("apps.vision.services.clip_image_embedding", lambda img: EMB_A_CLOSE)

    lost_flyer = FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    # Unreadable photo — no cached embedding either.
    FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_path="pets/photos/gone.jpg"))
    # Readable photo that matches the lost one.
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_path="pets/photos/ok.jpg"))

    matches = PetMatchService.match_flyer(str(found_flyer.pk))

    assert len(matches) == 1
    assert matches[0].lost_flyer == lost_flyer
    assert matches[0].found_flyer == found_flyer
    assert Notification.objects.filter(kind=Notification.Kind.MATCH_FOUND).count() == 1


def test_backfill_matches_command_creates_matches_for_existing_flyers():
    from django.core.management import call_command

    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_A_CLOSE))

    assert PetMatch.objects.count() == 0
    call_command("backfill_matches")

    assert PetMatch.objects.count() == 1
    kinds = set(Notification.objects.values_list("kind", flat=True))
    assert kinds == {Notification.Kind.MATCH_FOUND, Notification.Kind.MATCH_LOST}
    # Re-running is idempotent: no duplicate matches or notifications.
    call_command("backfill_matches")
    assert PetMatch.objects.count() == 1
    assert Notification.objects.count() == 2


def test_create_pet_caches_photo_embedding_when_photo_attached(settings, monkeypatch):
    from apps.pets.services import PetService
    from apps.users.factories import UserFactory

    settings.TESTING = False
    monkeypatch.setattr("apps.common.storage.read_bytes", lambda key: b"raw-bytes")
    monkeypatch.setattr("apps.vision.services.load_image", lambda raw: object())
    monkeypatch.setattr("apps.vision.services.clip_image_embedding", lambda img: EMB_A)

    pet = PetService.create_pet(UserFactory(), name="Rex", photo_path="pets/photos/x.jpg")
    assert pet.photo_embedding == EMB_A
