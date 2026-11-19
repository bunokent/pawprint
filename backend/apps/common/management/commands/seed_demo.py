"""seed_demo — populate a realistic demo dataset (users, pets, flyers, rewards)."""

from __future__ import annotations

from django.core.management.base import BaseCommand
from django.utils import timezone

from apps.flyers.models import Flyer
from apps.pets.models import Pet
from apps.users.models import User

DEMO_PASSWORD = "demo1234"


class Command(BaseCommand):
    help = "Seed demo users, pets, flyers and a reward transaction."

    def handle(self, *args: object, **options: object) -> None:
        owner, _ = User.objects.get_or_create(
            email="mia@example.com",
            defaults={"display_name": "Mia Santos", "phone": "+63 917 000 0001"},
        )
        owner.set_password(DEMO_PASSWORD)
        owner.save()
        shelter, _ = User.objects.get_or_create(
            email="shelter@example.com",
            defaults={"display_name": "Happy Tails Shelter", "phone": "+63 917 000 0002"},
        )
        shelter.set_password(DEMO_PASSWORD)
        shelter.save()

        bruno = Pet.objects.create(
            owner=owner, name="Bruno", species=Pet.Species.DOG, breed="Aspin",
            color="Brown brindle", age=3, temperament_tags=["playful", "gentle"],
            health_tags=["vaccinated", "neutered"], status=Pet.Status.LOST,
        )
        luna = Pet.objects.create(
            owner=shelter, name="Luna", species=Pet.Species.CAT, breed="Domestic shorthair",
            color="Orange tabby", age=1, temperament_tags=["cuddly", "calm"],
            health_tags=["vaccinated", "spayed"], status=Pet.Status.ADOPTABLE,
        )

        emergency = Flyer.objects.create(
            pet=bruno, creator=owner, mode=Flyer.Mode.EMERGENCY,
            last_seen_location="Brgy. Poblacion, Makati", last_seen_date=timezone.now(),
            location_lat=14.5547, location_lng=121.0244,
            distinctive_markings="White patch on chest, torn left ear",
            contact_phone=owner.phone, contact_email=owner.email,
            reward_enabled=True, reward_amount_cents=500000, reward_currency="PHP",
            status=Flyer.Status.ACTIVE,
        )
        miso = Pet.objects.create(
            owner=shelter, name="Miso", species=Pet.Species.CAT, breed="Domestic shorthair",
            color="Gray", age=2, temperament_tags=["shy", "gentle"],
            health_tags=["vaccinated"], status=Pet.Status.FOUND,
        )
        found = Flyer.objects.create(
            pet=miso, creator=shelter, mode=Flyer.Mode.FOUND,
            last_seen_location="Brgy. Bel-Air, Makati", last_seen_date=timezone.now(),
            location_lat=14.5647, location_lng=120.9989,
            distinctive_markings="Gray shorthair, one torn ear, very friendly",
            contact_phone=shelter.phone, contact_email=shelter.email,
            status=Flyer.Status.ACTIVE,
        )
        outreach = Flyer.objects.create(
            pet=luna, creator=shelter, mode=Flyer.Mode.OUTREACH,
            distinctive_markings="Loves window perches and slow blinks",
            contact_phone=shelter.phone, contact_email=shelter.email,
            status=Flyer.Status.ACTIVE,
        )
        from django.conf import settings

        from apps.flyers.qr import QrService

        for flyer in (emergency, found, outreach):
            flyer.qr_target_value = QrService.target_url(str(flyer.pk), settings.FRONTEND_BASE_URL)
            flyer.save(update_fields=["qr_target_value"])
        self.stdout.write(self.style.SUCCESS("Seeded demo data (login: mia@example.com / demo1234)"))
