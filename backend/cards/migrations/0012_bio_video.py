from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("cards", "0011_commerce"),
    ]

    operations = [
        migrations.AddField(
            model_name="card",
            name="bio",
            field=models.TextField(blank=True, default=""),
        ),
        migrations.AddField(
            model_name="card",
            name="video",
            field=models.FileField(blank=True, null=True, upload_to="videos/"),
        ),
        migrations.AddField(
            model_name="card",
            name="video_poster",
            field=models.ImageField(blank=True, null=True, upload_to="videos/"),
        ),
    ]
