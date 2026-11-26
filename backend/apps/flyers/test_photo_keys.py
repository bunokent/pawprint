"""Unit tests for the pure replacement-photo key guard (no Django settings needed)."""

from __future__ import annotations

import unittest

from apps.flyers.photo_keys import is_valid_photo_key

OWNER = "11111111-1111-1111-1111-111111111111"
OTHER_OWNER = "99999999-9999-9999-9999-999999999999"
PHOTO = "22222222-2222-2222-2222-222222222222"


class ReplacementPhotoKeyTests(unittest.TestCase):
    def test_accepts_own_full_photo_in_the_expected_folder(self) -> None:
        key = f"flyers/{OWNER}/losts/{PHOTO}.jpg"
        self.assertTrue(is_valid_photo_key(key, OWNER, "losts"))

    def test_rejects_another_users_photo(self) -> None:
        key = f"flyers/{OTHER_OWNER}/losts/{PHOTO}.jpg"
        self.assertFalse(is_valid_photo_key(key, OWNER, "losts"))

    def test_rejects_wrong_folder(self) -> None:
        key = f"flyers/{OWNER}/adoptions/{PHOTO}.jpg"
        self.assertFalse(is_valid_photo_key(key, OWNER, "losts"))

    def test_rejects_thumbnails_and_path_tricks(self) -> None:
        owner_key = f"flyers/{OWNER}/losts/{PHOTO}"
        self.assertFalse(is_valid_photo_key(f"{owner_key}_thumb.jpg", OWNER, "losts"))
        self.assertFalse(is_valid_photo_key(f"{owner_key}/../../{PHOTO}.jpg", OWNER, "losts"))
        self.assertFalse(is_valid_photo_key("", OWNER, "losts"))


if __name__ == "__main__":
    unittest.main()
