"""Unit: MegaDescriptor re-ID embeddings, cosine similarity + PetMatchService lost/found matching."""

import pytest

from apps.flyers.factories import FlyerFactory
from apps.flyers.models import Flyer
from apps.notifications.models import Notification
from apps.pets.factories import PetFactory, PetPhotoFactory
from apps.pets.models import PetPhoto
from apps.vision.models import PetMatch
from apps.vision.services import (
    MegaDescriptorService,
    PetMatchService,
    cosine_similarity,
    mega_model_id,
    padded_crop,
    score_embedding_pairs,
)

pytestmark = pytest.mark.django_db

# Tiny 4-dim stand-in embeddings (the real ones are MegaDescriptor vectors).
EMB_A = [1.0, 0.0, 0.0, 0.0]
EMB_A_CLOSE = [0.99, 0.14, 0.0, 0.0]  # cosine ~0.99 with EMB_A
EMB_OTHER = [0.0, 1.0, 0.0, 0.0]  # cosine 0.0 with EMB_A
EMB_Z = [0.0, 0.0, 1.0, 0.0]  # cosine 0.0 with all of the above


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
    """Prod path: read the stored photo, embed its padded crop, cache it on the pet."""
    settings.TESTING = False
    monkeypatch.setattr("apps.common.storage.read_bytes", lambda key: b"raw-bytes")
    monkeypatch.setattr(
        "apps.vision.services.MegaDescriptorService.embed_photo_bytes", lambda raw: EMB_A
    )
    pet = PetFactory(photo_path="pets/photos/x.jpg")
    assert PetMatchService.ensure_embedding(pet) == EMB_A
    pet.refresh_from_db()
    assert pet.photo_embedding == EMB_A
    assert pet.embedding_model == mega_model_id()


def test_ensure_embedding_recomputes_when_embedding_model_tag_differs(settings, monkeypatch):
    """A cached embedding from another model (e.g. legacy CLIP, tag "") is re-embedded."""
    settings.TESTING = False
    monkeypatch.setattr("apps.common.storage.read_bytes", lambda key: b"raw-bytes")
    monkeypatch.setattr(
        "apps.vision.services.MegaDescriptorService.embed_photo_bytes", lambda raw: EMB_A
    )
    pet = PetFactory(photo_path="pets/photos/x.jpg", photo_embedding=EMB_OTHER, embedding_model="clip-vit-b-32")
    assert PetMatchService.ensure_embedding(pet) == EMB_A
    pet.refresh_from_db()
    assert pet.photo_embedding == EMB_A
    assert pet.embedding_model == mega_model_id()


def test_ensure_embedding_keeps_cache_when_model_tag_matches(settings, monkeypatch):
    """A cached embedding tagged with the current model is NOT recomputed."""
    settings.TESTING = False

    def _boom(raw):
        raise AssertionError("embed ran despite a fresh cached embedding")

    monkeypatch.setattr("apps.vision.services.MegaDescriptorService.embed_photo_bytes", _boom)
    pet = PetFactory(photo_path="pets/photos/x.jpg", photo_embedding=EMB_A, embedding_model=mega_model_id())
    assert PetMatchService.ensure_embedding(pet) == EMB_A


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
    monkeypatch.setattr(
        "apps.vision.services.MegaDescriptorService.embed_photo_bytes", lambda raw: EMB_A_CLOSE
    )

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
    monkeypatch.setattr(
        "apps.vision.services.MegaDescriptorService.embed_photo_bytes", lambda raw: EMB_A
    )

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
    monkeypatch.setattr(
        "apps.vision.services.MegaDescriptorService.embed_photo_bytes", lambda raw: EMB_A_CLOSE
    )

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


def test_max_pet_photos_is_four():
    """A lost/found report supports up to 4 images (matching the frontend cap)."""
    from apps.pets.services import MAX_PET_PHOTOS

    assert MAX_PET_PHOTOS == 4


# ---------------------------------------------------------------------------
# Padded in-memory crop + max-pair scoring (MegaDescriptor re-ID pipeline)
# ---------------------------------------------------------------------------


def test_padded_crop_expands_and_clamps_to_bounds():
    from PIL import Image

    image = Image.new("RGB", (100, 80))
    # Box (40, 30)-(60, 50): w=20, h=20; padding 0.25 → expand by 5px each side.
    crop = padded_crop(image, (40.0, 30.0, 60.0, 50.0), 0.25)
    assert crop.size == (30, 30)  # (35,25)-(65,55)
    # A box at the corner clamps to the image bounds instead of going negative.
    crop = padded_crop(image, (0.0, 0.0, 10.0, 10.0), 0.5)
    assert crop.size == (15, 15)  # (0,0)-(15,15)
    assert crop.getpixel((0, 0)) == image.getpixel((0, 0))


def test_padded_crop_falls_back_to_full_image_without_box():
    from PIL import Image

    image = Image.new("RGB", (100, 80), (1, 2, 3))
    assert padded_crop(image, None, 0.2).size == (100, 80)
    # Degenerate box (zero area after clamping) also falls back to the full image.
    assert padded_crop(image, (50.0, 40.0, 50.0, 40.0), 0.0).size == (100, 80)
    # The original image object is never mutated (crop is in-memory only).
    assert image.size == (100, 80)


def test_score_embedding_pairs_returns_max_and_winning_pair():
    pair = score_embedding_pairs([EMB_OTHER, EMB_A], [EMB_A_CLOSE, EMB_Z])
    assert pair.max_similarity == pytest.approx(0.99, abs=0.01)
    assert (pair.best_a_index, pair.best_b_index) == (1, 0)  # EMB_A × EMB_A_CLOSE won
    assert score_embedding_pairs([], [EMB_A]).max_similarity == 0.0
    assert score_embedding_pairs([EMB_A], []).best_a_index == -1


def test_mega_descriptor_service_embed_crop_uses_padded_box(monkeypatch):
    """embed_crop pads the detection box in memory and embeds the crop (never the original)."""
    from PIL import Image

    seen: list[tuple[int, int]] = []

    def _fake_embed(image):
        seen.append(image.size)
        return EMB_A

    monkeypatch.setattr("apps.vision.services.megadescriptor_embedding", _fake_embed)
    image = Image.new("RGB", (100, 100))
    embedding = MegaDescriptorService.embed_crop(image, (40.0, 40.0, 60.0, 60.0), padding=0.25)
    assert embedding == EMB_A
    assert seen == [(30, 30)]  # crop of the padded box, not the 100×100 original
    assert image.size == (100, 100)  # display image untouched


def test_mega_model_id_is_short_tag():
    assert mega_model_id() == "MegaDescriptor-L-384"


def test_rank_candidates_scores_same_species_and_marks_matches():
    lost_flyer = FlyerFactory(
        mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A, species="dog")
    )
    close = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_A_CLOSE, species="dog"))
    far = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_OTHER, species="dog"))

    candidates = PetMatchService.rank_candidates(str(lost_flyer.pk), top_k=None)

    assert [c.flyer_id for c in candidates] == [str(close.pk), str(far.pk)]  # sorted desc
    assert candidates[0].is_match is True
    assert candidates[0].max_similarity == pytest.approx(0.99, abs=0.01)
    assert candidates[1].is_match is False


def test_rank_candidates_skips_other_species():
    """Matching is same-species only: a found cat never ranks against a lost dog."""
    lost_flyer = FlyerFactory(
        mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A, species="dog")
    )
    FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_A_CLOSE, species="cat"))

    assert PetMatchService.rank_candidates(str(lost_flyer.pk), top_k=None) == []
    assert PetMatchService.match_flyer(str(lost_flyer.pk)) == []


def test_rank_candidates_top_k_truncates():
    lost_flyer = FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    for _ in range(3):
        FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_A_CLOSE))

    assert len(PetMatchService.rank_candidates(str(lost_flyer.pk), top_k=2)) == 2
    assert len(PetMatchService.rank_candidates(str(lost_flyer.pk), top_k=None)) == 3


def test_match_flyer_stores_best_pair_on_petmatch():
    """The winning image pair indices land on PetMatch.best_pair ([lost idx, found idx])."""
    emb_w = [0.0, 0.0, 0.0, 1.0]  # orthogonal to every other stand-in vector
    lost_pet = PetFactory(photo_embedding=emb_w)
    PetPhotoFactory(pet=lost_pet, photo_embedding=EMB_Z)
    PetPhotoFactory(pet=lost_pet, photo_embedding=EMB_A)  # lost photo index 1 matches
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=lost_pet)
    found_pet = PetFactory()
    PetPhotoFactory(pet=found_pet, photo_embedding=emb_w)
    PetPhotoFactory(pet=found_pet, photo_embedding=EMB_A_CLOSE)  # found photo index 1
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=found_pet)

    matches = PetMatchService.match_flyer(str(found_flyer.pk))

    assert len(matches) == 1
    assert matches[0].best_pair == [1, 1]
    assert matches[0].score == pytest.approx(0.99, abs=0.01)


def test_match_threshold_is_configurable(settings):
    """PET_MATCH_SIMILARITY_THRESHOLD is tunable — a 0.99 bar rejects a 0.99-ish pair only above it."""
    FlyerFactory(mode=Flyer.Mode.EMERGENCY, pet=PetFactory(photo_embedding=EMB_A))
    found_flyer = FlyerFactory(mode=Flyer.Mode.FOUND, pet=PetFactory(photo_embedding=EMB_A_CLOSE))

    settings.PET_MATCH_SIMILARITY_THRESHOLD = 0.999
    assert PetMatchService.match_flyer(str(found_flyer.pk)) == []
    assert PetMatch.objects.count() == 0

    settings.PET_MATCH_SIMILARITY_THRESHOLD = 0.5
    assert len(PetMatchService.match_flyer(str(found_flyer.pk))) == 1
