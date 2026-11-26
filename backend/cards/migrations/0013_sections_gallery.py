import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cards", "0012_bio_video"),
    ]

    operations = [
        migrations.CreateModel(
            name="CardSection",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("kind", models.CharField(max_length=20)),
                ("order", models.PositiveIntegerField(default=0)),
                ("on", models.BooleanField(default=True)),
                ("data", models.JSONField(blank=True, default=dict)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("card", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="sections", to="cards.card")),
            ],
            options={"ordering": ["order", "created_at"]},
        ),
        migrations.CreateModel(
            name="CardGalleryImage",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("image", models.ImageField(upload_to="gallery/")),
                ("caption", models.CharField(blank=True, default="", max_length=80)),
                ("order", models.PositiveIntegerField(default=0)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("card", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="gallery_images", to="cards.card")),
            ],
            options={"ordering": ["order", "created_at"]},
        ),
    ]
