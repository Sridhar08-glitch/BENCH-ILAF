from django.db import migrations, models


def number_existing_reports(apps, schema_editor):
    """Give the reports that already exist their short numbers, oldest first."""
    AbuseReport = apps.get_model("staff", "AbuseReport")
    for n, pk in enumerate(AbuseReport.objects.order_by("created_at", "id").values_list("pk", flat=True), start=1):
        AbuseReport.objects.filter(pk=pk).update(number=n)


class Migration(migrations.Migration):

    dependencies = [
        ("staff", "0002_back_office"),
    ]

    operations = [
        migrations.AddField(
            model_name="abusereport",
            name="number",
            field=models.PositiveIntegerField(blank=True, null=True, unique=True),
        ),
        migrations.RunPython(number_existing_reports, migrations.RunPython.noop),
    ]
