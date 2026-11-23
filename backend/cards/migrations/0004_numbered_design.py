from django.db import migrations

from ilaf.legacy import convert_v2_design

KEYS = ("face", "colour", "below", "intro")


def is_numbered(design):
    return isinstance(design, dict) and all(isinstance(design.get(k), int) for k in KEYS)


def forwards(apps, schema_editor):
    Card = apps.get_model("cards", "Card")
    for card in Card.objects.all().iterator():
        if not is_numbered(card.design):
            if card.legacy_design is None:
                card.legacy_design = card.design
            card.design = convert_v2_design(card.design)
            card.save(update_fields=["legacy_design", "design"])


class Migration(migrations.Migration):
    dependencies = [("cards", "0003_design_v2_data")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
