from django.db import migrations

from ilaf.legacy import convert_legacy_design, is_legacy


def forwards(apps, schema_editor):
    Workspace = apps.get_model("workspaces", "Workspace")
    for ws in Workspace.objects.all().iterator():
        brand = ws.brand or {}
        if is_legacy(brand.get("design")):
            ws.legacy_brand_design = brand["design"]
            brand["design"] = convert_legacy_design(brand["design"])
            ws.brand = brand
            ws.save(update_fields=["legacy_brand_design", "brand"])


def backwards(apps, schema_editor):
    Workspace = apps.get_model("workspaces", "Workspace")
    for ws in Workspace.objects.exclude(legacy_brand_design=None).iterator():
        brand = ws.brand or {}
        brand["design"] = ws.legacy_brand_design
        ws.brand = brand
        ws.legacy_brand_design = None
        ws.save(update_fields=["legacy_brand_design", "brand"])


class Migration(migrations.Migration):
    dependencies = [("workspaces", "0002_design_v2_fields")]
    operations = [migrations.RunPython(forwards, backwards)]
