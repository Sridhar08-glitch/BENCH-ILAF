import uuid

import django.db.models.deletion
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        ("cards", "0011_commerce"),
        ("workspaces", "0011_company_country"),
    ]

    operations = [
        migrations.CreateModel(
            name="Order",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("number", models.CharField(editable=False, max_length=12, unique=True)),
                ("card_name", models.CharField(blank=True, default="", max_length=120)),
                ("customer_name", models.CharField(max_length=120)),
                ("customer_phone", models.CharField(max_length=40)),
                ("customer_email", models.EmailField(blank=True, default="", max_length=254)),
                ("note", models.CharField(blank=True, default="", max_length=500)),
                ("address", models.CharField(blank=True, default="", max_length=300)),
                ("items", models.JSONField(default=list)),
                ("subtotal", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("total", models.DecimalField(decimal_places=2, default=0, max_digits=12)),
                ("currency", models.CharField(max_length=3)),
                ("payment_method", models.CharField(choices=[("cod", "cash on delivery"), ("whatsapp", "whatsapp"), ("card_later", "card later")], default="cod", max_length=12)),
                ("payment_status", models.CharField(choices=[("unpaid", "unpaid"), ("paid", "paid"), ("refunded", "refunded")], default="unpaid", max_length=10)),
                ("pay_url", models.URLField(blank=True, default="", max_length=500)),
                ("status", models.CharField(choices=[("new", "new"), ("confirmed", "confirmed"), ("ready", "ready"), ("delivered", "delivered"), ("cancelled", "cancelled")], default="new", max_length=10)),
                ("consented_at", models.DateTimeField(blank=True, null=True)),
                ("created_at", models.DateTimeField(auto_now_add=True)),
                ("updated_at", models.DateTimeField(auto_now=True)),
                ("card", models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.SET_NULL, related_name="orders", to="cards.card")),
                ("workspace", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="orders", to="workspaces.workspace")),
            ],
            options={
                "ordering": ["-created_at"],
                "indexes": [
                    models.Index(fields=["workspace", "created_at"], name="orders_orde_workspa_1c7d3b_idx"),
                    models.Index(fields=["card", "created_at"], name="orders_orde_card_id_7a94e0_idx"),
                    models.Index(fields=["workspace", "status"], name="orders_orde_workspa_52be1f_idx"),
                ],
            },
        ),
    ]
