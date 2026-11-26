from django.db import migrations, models


class Migration(migrations.Migration):
    dependencies = [("cards", "0013_sections_gallery")]

    operations = [
        migrations.AddField(model_name="card", name="is_company", field=models.BooleanField(default=False)),
        migrations.AddConstraint(
            model_name="card",
            constraint=models.UniqueConstraint(fields=("workspace",), condition=models.Q(is_company=True), name="one_company_card_per_workspace"),
        ),
    ]
