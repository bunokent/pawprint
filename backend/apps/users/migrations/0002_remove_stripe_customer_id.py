"""Remove the now-unused Stripe customer id from users."""

from django.db import migrations


class Migration(migrations.Migration):
    dependencies = [
        ("users", "0001_initial"),
    ]

    operations = [
        migrations.RemoveField(model_name="user", name="stripe_customer_id"),
    ]
