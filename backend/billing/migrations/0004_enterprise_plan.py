from django.db import migrations


def add_enterprise_plan(apps, schema_editor):
    """Enterprise is sold by quote: price 0 means "no list price", the price is set per customer (EnterpriseRequest)."""
    Plan = apps.get_model("billing", "Plan")
    Plan.objects.get_or_create(
        code="enterprise",
        defaults={
            "name": "Enterprise", "kind": "company", "interval": "year", "price_minor": 0, "currency": "QAR",
            "max_cards": 1, "per_seat": True, "min_seats": 1, "active": True, "sort_order": 4,
            "features": ["Everything in Company", "Departments, teams and the company directory", "Field rules and approvals",
                         "Activity log", "Webhooks, API keys and CRM connectors", "Custom domain and sign-in rules"],
        },
    )


class Migration(migrations.Migration):
    dependencies = [("billing", "0003_auto_renew_enterprise")]

    operations = [migrations.RunPython(add_enterprise_plan, migrations.RunPython.noop)]
