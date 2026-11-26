from django.core.management.base import BaseCommand

from workspaces import domains


class Command(BaseCommand):
    help = "Print the custom domains that are served right now (verified, company Enterprise-live), one per line. Used by deploy/custom-domains/issue_certs.sh."

    def handle(self, *args, **options):
        for name in domains.active_domain_names():
            self.stdout.write(name)
