"""Soft-delete flyers: add `deleted_at`.

Deleting a flyer no longer hard-removes the row — `deleted_at` is stamped
instead, so the flyer survives in the creator's Recently Deleted page until
it is restored or permanently purged.
"""

from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [
        ("flyers", "0004_remove_reward_fields"),
    ]

    operations = [
        migrations.AddField(
            model_name="flyer",
            name="deleted_at",
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddIndex(
            model_name="flyer",
            index=models.Index(fields=["creator", "deleted_at"], name="flyer_creator_deleted_idx"),
        ),
    ]
