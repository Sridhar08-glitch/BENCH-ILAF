import uuid

import django.db.models.deletion
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    initial = True

    dependencies = [
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.CreateModel(
            name="GuideProgress",
            fields=[
                ("id", models.UUIDField(default=uuid.uuid4, editable=False, primary_key=True, serialize=False)),
                ("guide_id", models.CharField(max_length=64)),
                ("step_id", models.CharField(max_length=64)),
                ("state", models.CharField(choices=[("done", "done"), ("skipped", "skipped"), ("dismissed", "dismissed"), ("shown", "shown"), ("up", "up"), ("down", "down")], max_length=10)),
                ("updated", models.DateTimeField(auto_now=True)),
                ("user", models.ForeignKey(on_delete=django.db.models.deletion.CASCADE, related_name="guide_progress", to=settings.AUTH_USER_MODEL)),
            ],
            options={
                "ordering": ["guide_id", "step_id"],
            },
        ),
        migrations.AddConstraint(
            model_name="guideprogress",
            constraint=models.UniqueConstraint(fields=("user", "guide_id", "step_id"), name="guide_progress_unique"),
        ),
    ]
