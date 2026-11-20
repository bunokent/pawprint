import factory

from apps.users.factories import UserFactory

from .models import Pet, PetPhoto


class PetFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = Pet

    owner = factory.SubFactory(UserFactory)
    name = factory.Faker("first_name")
    species = Pet.Species.DOG
    breed = factory.Faker("word")
    color = factory.Faker("color_name")
    temperament_tags = ["friendly"]
    health_tags = ["vaccinated"]
    status = Pet.Status.ADOPTABLE


class PetPhotoFactory(factory.django.DjangoModelFactory):
    class Meta:
        model = PetPhoto

    pet = factory.SubFactory(PetFactory)
    photo_path = factory.Sequence(lambda n: f"pets/photos/angle-{n}.jpg")
    photo_embedding = None
