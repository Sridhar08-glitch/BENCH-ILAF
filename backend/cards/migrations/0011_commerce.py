import uuid

import django.db.models.deletion
from django.db import migrations, models

import cards.models_commerce


class Migration(migrations.Migration):

    dependencies = [
        ("cards", "0010_card_label_order_default"),
    ]

    operations = [
        migrations.CreateModel(
            name="Product",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("section_id", models.UUIDField(blank=True, null=True)),
                ("title", models.CharField(max_length=80)),
                ("description", models.CharField(blank=True, default="", max_length=300)),
                ("price", models.DecimalField(decimal_places=2, default=0, max_digits=10)),
                ("currency", models.CharField(default="QAR", max_length=3)),
                ("image", models.ImageField(blank=True, null=True, upload_to="products/")),
                ("badge", models.CharField(blank=True, default="", max_length=20)),
                ("meta", models.JSONField(blank=True, default=dict)),
                ("on", models.BooleanField(default=True)),
                ("order", models.PositiveIntegerField(default=0)),
                ("stock", models.PositiveIntegerField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("card", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="products", to="cards.card")),
            ],
            options={
                "ordering": ["order", "created_at"],
                "indexes": [models.Index(fields=["card", "order"], name="cards_produ_card_id_5b0d1e_idx")],
            },
        ),
        migrations.CreateModel(
            name="BookingSettings",
            fields=[
                ("id", models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name="ID")),
                ("enabled", models.BooleanField(default=False)),
                ("timezone", models.CharField(default="Asia/Qatar", max_length=64)),
                ("slot_minutes", models.PositiveSmallIntegerField(default=30)),
                ("buffer_minutes", models.PositiveSmallIntegerField(default=0)),
                ("days_ahead", models.PositiveSmallIntegerField(default=14)),
                ("weekly", models.JSONField(blank=True, default=cards.models_commerce.default_weekly)),
                ("location_note", models.CharField(blank=True, default="", max_length=120)),
                ("meet_link", models.URLField(blank=True, default="", max_length=500)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("card", models.OneToOneField(on_delete=django.db.models.deletion.CASCADE, related_name="booking_settings", to="cards.card")),
            ],
        ),
        migrations.CreateModel(
            name="Booking",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("start_at", models.DateTimeField()),
                ("end_at", models.DateTimeField()),
                ("name", models.CharField(max_length=120)),
                ("email", models.EmailField(max_length=254)),
                ("phone", models.CharField(blank=True, default="", max_length=40)),
                ("note", models.CharField(blank=True, default="", max_length=500)),
                ("status", models.CharField(choices=[("requested", "requested"), ("confirmed", "confirmed"), ("cancelled", "cancelled"), ("done", "done")], default="requested", max_length=10)),
                ("consented_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("card", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="bookings", to="cards.card")),
            ],
            options={
                "ordering": ["start_at"],
                "indexes": [
                    models.Index(fields=["card", "start_at"], name="cards_booki_card_id_9f2c47_idx"),
                    models.Index(fields=["card", "created_at"], name="cards_booki_card_id_3e81aa_idx"),
                ],
            },
        ),
    ]
