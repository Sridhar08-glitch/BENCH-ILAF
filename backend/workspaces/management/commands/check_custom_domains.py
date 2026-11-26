from django.core.management.base import BaseCommand

from workspaces import domains


class Command(BaseCommand):
    help = (
        "Custom domains: expire pending claims older than CARD_DOMAIN_PENDING_DAYS, re-check the open ones, re-verify verified "
        "ones (mark dns_broken and e-mail the owner when the DNS records stay missing, release the name after the grace days). "
        "Run hourly; a verified domain is only asked again every CARD_DOMAIN_RECHECK_HOURS."
    )

    def add_arguments(self, parser):
        parser.add_argument("--force", action="store_true", help="Re-verify verified domains now, whatever their last check time.")

    def handle(self, *args, **options):
        s = domains.run_checks(force=options["force"])
        self.stdout.write(
            f"Custom domains: checked {s['checked']}, newly verified {s['verified']}, expired {s['expired']}, "
            f"dns_broken {s['broken']}, released {s['released']}"
        )
