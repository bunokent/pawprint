"""Unit tests for the pure pet-edit rule (no Django settings needed)."""

from __future__ import annotations

import unittest

from apps.flyers.edit_rules import flyer_is_editable, pet_name_missing, update_missing_photo


class PetNameRuleTests(unittest.TestCase):
    def test_found_pets_may_stay_unnamed(self) -> None:
        self.assertFalse(pet_name_missing("found", ""))
        self.assertFalse(pet_name_missing("found", None))

    def test_other_modes_need_a_name(self) -> None:
        for mode in ("emergency", "outreach"):
            with self.subTest(mode=mode):
                self.assertTrue(pet_name_missing(mode, ""))
                self.assertTrue(pet_name_missing(mode, None))
                self.assertTrue(pet_name_missing(mode, "   "))

    def test_a_real_name_satisfies_every_mode(self) -> None:
        self.assertFalse(pet_name_missing("emergency", "Milo"))
        self.assertFalse(pet_name_missing("found", "Milo"))


class FlyerEditabilityTests(unittest.TestCase):
    def test_resolved_flyers_are_final(self) -> None:
        self.assertFalse(flyer_is_editable("resolved"))

    def test_other_statuses_stay_editable(self) -> None:
        self.assertTrue(flyer_is_editable("active"))
        self.assertTrue(flyer_is_editable("generating"))
        self.assertTrue(flyer_is_editable(None))


class RequiredPhotoRuleTests(unittest.TestCase):
    def test_status_only_patches_do_not_need_a_photo(self) -> None:
        self.assertFalse(update_missing_photo({"status": "resolved"}))
        self.assertFalse(update_missing_photo({}))

    def test_detail_updates_need_a_photo_key(self) -> None:
        for patch in ({"name": "Milo"}, {"photo_path": ""}, {"photo_path": "  "}):
            with self.subTest(patch=patch):
                self.assertTrue(update_missing_photo(patch))

    def test_a_real_photo_key_satisfies_detail_updates(self) -> None:
        self.assertFalse(update_missing_photo({"name": "Milo", "photo_path": "flyers/o/losts/p.jpg"}))


if __name__ == "__main__":
    unittest.main()
