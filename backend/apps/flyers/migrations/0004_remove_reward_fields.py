"""Remove the reward/payment feature and its legacy database objects."""

from django.db import migrations

# The old rewards/webhooks apps are gone; drop their tables (and their migration
# records) here so an already-migrated database does not keep orphaned schema.
DROP_LEGACY_PAYMENT_TABLES = """
DROP TABLE IF EXISTS rewards_rewardtransaction CASCADE;
DROP TABLE IF EXISTS webhooks_webhookevent CASCADE;
DELETE FROM django_migrations WHERE app IN ('rewards', 'webhooks');
"""


class Migration(migrations.Migration):
    dependencies = [
        ("flyers", "0003_flyer_location_lat_flyer_location_lng_and_more"),
    ]

    operations = [
        migrations.RunSQL(DROP_LEGACY_PAYMENT_TABLES, reverse_sql=migrations.RunSQL.noop),
        migrations.RemoveConstraint(
            model_name="flyer",
            name="flyer_reward_amount_positive",
        ),
        migrations.RemoveField(model_name="flyer", name="reward_currency"),
        migrations.RemoveField(model_name="flyer", name="reward_amount_cents"),
        migrations.RemoveField(model_name="flyer", name="reward_enabled"),
    ]
