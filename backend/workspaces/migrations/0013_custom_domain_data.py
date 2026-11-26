"""Every company that had a free-text custom_domain gets a PENDING claim with a fresh token. Nothing is verified automatically:
the old value was never checked, and anyone could have typed google.com."""
import secrets

from django.db import migrations


def forwards(apps, schema_editor):
    Workspace = apps.get_model("workspaces", "Workspace")
    CustomDomain = apps.get_model("workspaces", "CustomDomain")
    for ws in Workspace.objects.exclude(custom_domain__isnull=True).exclude(custom_domain=""):
        domain = (ws.custom_domain or "").strip().lower().rstrip(".")
        if not domain or CustomDomain.objects.filter(workspace=ws).exists():
            continue
        CustomDomain.objects.create(workspace=ws, domain=domain, token=secrets.token_urlsafe(24), status="pending")


def backwards(apps, schema_editor):
    Workspace = apps.get_model("workspaces", "Workspace")
    CustomDomain = apps.get_model("workspaces", "CustomDomain")
    for row in CustomDomain.objects.all():
        Workspace.objects.filter(pk=row.workspace_id).update(custom_domain=row.domain)


class Migration(migrations.Migration):

    dependencies = [
        ('workspaces', '0012_customdomain'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
    ]
