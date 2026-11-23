from django.core.management.base import BaseCommand

from billing.models import Plan

# Starting plans with placeholder prices (minor units, QAR). Edit prices in the admin afterwards.
PLANS = [
    {
        "code": "personal", "name": "Personal", "kind": "personal", "interval": "year",
        "price_minor": 4900, "currency": "QAR", "max_cards": 1, "per_seat": False, "min_seats": 1,
        "features": ["1 digital card", "QR code and NFC link", "Contact saving and leads", "Basic analytics"],
        "sort_order": 1,
    },
    {
        "code": "business", "name": "Business", "kind": "personal", "interval": "year",
        "price_minor": 9900, "currency": "QAR", "max_cards": 5, "per_seat": False, "min_seats": 1,
        "features": ["5 digital cards", "Everything in Personal", "Full analytics"],
        "sort_order": 2,
    },
    {
        "code": "company", "name": "Company", "kind": "company", "interval": "year",
        "price_minor": 3900, "currency": "QAR", "max_cards": 1, "per_seat": True, "min_seats": 5,
        "features": ["One card per team member", "Locked brand design", "Team management and CSV import",
                     "Company-wide analytics and leads"],
        "sort_order": 3,
    },
]


class Command(BaseCommand):
    help = "Create the starting plans. Existing plans keep their edited prices unless --reset is given."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true", help="Overwrite existing plans with the defaults.")

    def handle(self, *args, **options):
        created = updated = 0
        for data in PLANS:
            defaults = {k: v for k, v in data.items() if k != "code"}
            if options["reset"]:
                _, was_created = Plan.objects.update_or_create(code=data["code"], defaults=defaults)
            else:
                _, was_created = Plan.objects.get_or_create(code=data["code"], defaults=defaults)
            created += was_created
            updated += (not was_created) and options["reset"]
        if options["verbosity"] > 0:
            self.stdout.write(f"Plans created: {created}, reset: {updated}")
