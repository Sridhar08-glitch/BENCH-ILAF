from django.db import migrations

from ilaf.legacy import convert_legacy_design, is_legacy


def forwards(apps, schema_editor):
    Card = apps.get_model("cards", "Card")
    for card in Card.objects.all().iterator():
        if is_legacy(card.design):
            card.legacy_design = card.design
            card.design = convert_legacy_design(card.design)
            card.save(update_fields=["legacy_design", "design"])


def backwards(apps, schema_editor):
    Card = apps.get_model("cards", "Card")
    for card in Card.objects.exclude(legacy_design=None).iterator():
        card.design = card.legacy_design
        card.legacy_design = None
        card.save(update_fields=["legacy_design", "design"])


class Migration(migrations.Migration):
    dependencies = [("cards", "0002_design_v2_fields")]
    operations = [migrations.RunPython(forwards, backwards)]
