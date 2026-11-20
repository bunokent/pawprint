"""Unit: CLIP embedding cosine similarity + PetMatchService lost/found matching."""

import pytest

from apps.flyers.factories import FlyerFactory
from apps.flyers.models import Flyer
from apps.notifications.models import Notification
from apps.pets.factories import PetFactory, PetPhotoFactory
from apps.pets.models import PetPhoto
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


def test_pet_embeddings_prefers_pet_photo_rows_over_pet_embedding():
    """With PetPhoto rows present, matching uses one embedding per photo (angle)."""
    pet = PetFactory(photo_embedding=EMB_A)  # legacy cover embedding
    PetPhotoFactory(pet=pet, photo_embedding=EMB_A_CLOSE)
    PetPhotoFactory(pet=pet, photo_embedding=EMB_OTHER)

    embeddings = PetMatchService.pet_embeddings(pet)

    assert embeddings == [EMB_A_CLOSE, EMB_OTHER]


def test_pet_embeddings_falls_back_to_legacy_pet_embedding():
    """Pets without PetPhoto rows (legacy data) still match via Pet.photo_embedding."""
    pet = PetFactory(photo_embedding=EMB_A)
    assert PetMatchService.pet_embeddings(pet) == [EMB_A]
    # PetPhoto rows that cannot be embedded (no cache under TESTING) fall back too.
    PetPhotoFactory(pet=pet, photo_path="pets/photos/gone.jpg")
    assert PetMatchService.pet_embeddings(pet) == [EMB_A]


def test_match_flyer_matches_same_pet_across_different_angles():
    """The reference case: one pet, several angle photos — the BEST cross-photo
    pair decides, so a found photo that matches only one of the lost pet's angles
    still produces a match (and notifications)."""
    lost_pet = PetFactory(photo_embedding=EMB_OTHER)  # cover angle is dissimilar…
    PetPhotoFactory(pet=lost_pet, photo_embedding=EMB_OTHER)
    PetPhotoFactory(pet=lost_pet, photo_embedding=EMB_A)  # …but this angle matches
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=lost_pet, location_lat=14.5, location_lng=121.0)
    # Found pet photographed from yet another angle — similar to EMB_A only.
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_A_CLOSE))

    matches = PetMatchService.match_flyer(str(found_flyer.pk))

    assert len(matches) == 1
    assert matches[0].score == pytest.approx(0.99, abs=0.01)
    assert set(Notification.objects.values_list("kind", flat=True)) == {
        Notification.Kind.MATCH_FOUND,
        Notification.Kind.MATCH_LOST,
    }


def test_match_flyer_ignores_pairs_where_no_photo_pair_is_similar():
    """Multi-photo only helps when at least ONE pair clears the threshold."""
    lost_pet = PetFactory()
    PetPhotoFactory(pet=lost_pet, photo_embedding=EMB_A)
    PetPhotoFactory(pet=lost_pet, photo_embedding=EMB_A_CLOSE)
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=lost_pet)
    # Found pet has two angles too — both dissimilar to every lost angle.
    found_pet = PetFactory()
    PetPhotoFactory(pet=found_pet, photo_embedding=EMB_OTHER)
    PetPhotoFactory(pet=found_pet, photo_embedding=[0.0, 0.0, 1.0, 0.0])
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=found_pet)

    assert PetMatchService.match_flyer(str(found_flyer.pk)) == []
    assert PetMatch.objects.count() == 0


def test_match_flyer_skips_embedless_counterparts_and_updates_score_on_rematch():
    # A counterpart with no photo/embedding at all is skipped (line: continue).
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory())
    lost_flyer = FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    found_pet = PetFactory(photo_embedding=EMB_A_CLOSE)
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=found_pet)

    matches = PetMatchService.match_flyer(str(found_flyer.pk))
    assert len(matches) == 1
    assert matches[0].lost_flyer == lost_flyer

    # Re-matching the same pair with a better-scoring photo updates the stored
    # score but does NOT re-notify (the PetMatch row already exists).
    found_pet.photo_embedding = EMB_A
    found_pet.save(update_fields=["photo_embedding"])
    matches = PetMatchService.match_flyer(str(found_flyer.pk))
    assert len(matches) == 1
    assert PetMatch.objects.get().score == pytest.approx(1.0)
    assert Notification.objects.count() == 2


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
    reads: list[str] = []

    def _read(key):
        reads.append(key)
        return b"raw-bytes"

    monkeypatch.setattr("apps.common.storage.read_bytes", _read)
    monkeypatch.setattr("apps.vision.services.load_image", lambda raw: object())
    monkeypatch.setattr("apps.vision.services.clip_image_embedding", lambda img: EMB_A)

    pet = PetService.create_pet(UserFactory(), name="Rex", photo_path="pets/photos/x.jpg")
    assert pet.photo_embedding == EMB_A
    # A PetPhoto row is created for the cover photo and reuses its embedding
    # (storage is read once, not once per row).
    assert PetPhoto.objects.filter(pet=pet).count() == 1
    assert PetPhoto.objects.get(pet=pet).photo_embedding == EMB_A
    assert reads == ["pets/photos/x.jpg"]


def test_create_pet_stores_every_angle_as_a_petphoto(settings, monkeypatch):
    """photo_paths: each angle gets its own PetPhoto row + cached embedding."""
    from apps.pets.services import MAX_PET_PHOTOS, PetService
    from apps.users.factories import UserFactory

    settings.TESTING = False
    monkeypatch.setattr("apps.common.storage.read_bytes", lambda key: b"raw-bytes")
    monkeypatch.setattr("apps.vision.services.load_image", lambda raw: object())
    monkeypatch.setattr("apps.vision.services.clip_image_embedding", lambda img: EMB_A_CLOSE)

    pet = PetService.create_pet(
        UserFactory(),
        name="Gab",
        photo_paths=["pets/photos/front.jpg", "pets/photos/side.jpg", "pets/photos/back.jpg"],
    )

    assert pet.photo_path == "pets/photos/front.jpg"  # first photo is the cover
    photos = list(PetPhoto.objects.filter(pet=pet).order_by("created_at"))
    assert [p.photo_path for p in photos] == [
        "pets/photos/front.jpg",
        "pets/photos/side.jpg",
        "pets/photos/back.jpg",
    ]
    assert all(p.photo_embedding == EMB_A_CLOSE for p in photos)
    # photo_path (legacy single field) is merged ahead of photo_paths and deduped.
    pet2 = PetService.create_pet(
        UserFactory(),
        photo_path="pets/photos/cover.jpg",
        photo_paths=["pets/photos/cover.jpg", "pets/photos/extra.jpg"],
    )
    assert PetPhoto.objects.filter(pet=pet2).count() == 2
    # …and capped at MAX_PET_PHOTOS.
    pet3 = PetService.create_pet(
        UserFactory(), photo_paths=[f"pets/photos/p{i}.jpg" for i in range(MAX_PET_PHOTOS + 3)]
    )
    assert PetPhoto.objects.filter(pet=pet3).count() == MAX_PET_PHOTOS
