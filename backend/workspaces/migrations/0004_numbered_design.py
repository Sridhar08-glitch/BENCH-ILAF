from django.db import migrations

from ilaf.legacy import convert_v2_design

KEYS = ("face", "colour", "below", "intro")


def is_numbered(design):
    return isinstance(design, dict) and all(isinstance(design.get(k), int) for k in KEYS)


def forwards(apps, schema_editor):
    Workspace = apps.get_model("workspaces", "Workspace")
    for ws in Workspace.objects.all().iterator():
        brand = ws.brand or {}
        if not is_numbered(brand.get("design")):
            if ws.legacy_brand_design is None:
                ws.legacy_brand_design = brand.get("design")
            brand["design"] = convert_v2_design(brand.get("design"))
            ws.brand = brand
            ws.save(update_fields=["legacy_brand_design", "brand"])


class Migration(migrations.Migration):
    dependencies = [("workspaces", "0003_design_v2_data")]
    operations = [migrations.RunPython(forwards, migrations.RunPython.noop)]
