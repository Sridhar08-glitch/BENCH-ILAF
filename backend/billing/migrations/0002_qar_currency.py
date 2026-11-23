from django.db import migrations, models


def plans_to_qar(apps, schema_editor):
    # Plans only: payments already taken keep the currency they were charged in.
    Plan = apps.get_model("billing", "Plan")
    Plan.objects.filter(currency="AED").update(currency="QAR")


class Migration(migrations.Migration):
    dependencies = [("billing", "0001_initial")]

    operations = [
        migrations.AlterField(
            model_name="plan",
            name="currency",
            field=models.CharField(default="QAR", max_length=3),
        ),
        migrations.AlterField(
            model_name="plan",
            name="price_minor",
            field=models.PositiveIntegerField(help_text="Price in minor units (dirhams for QAR). Per seat when per_seat."),
        ),
        migrations.RunPython(plans_to_qar, migrations.RunPython.noop),
    ]
