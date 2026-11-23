from django.db import migrations


def fill(apps, schema_editor):
    Lead = apps.get_model("leads", "Lead")
    for lead in Lead.objects.filter(workspace__isnull=True).select_related("card"):
        if lead.card_id:
            lead.workspace_id = lead.card.workspace_id
            lead.card_name = lead.card.name[:120]
            lead.save(update_fields=["workspace", "card_name"])


class Migration(migrations.Migration):
    dependencies = [("leads", "0002_company_operations")]
    operations = [migrations.RunPython(fill, migrations.RunPython.noop)]
