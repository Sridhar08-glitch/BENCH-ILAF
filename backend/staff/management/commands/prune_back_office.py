from django.core.management.base import BaseCommand

from staff import errorlog, metrics, ops_services


class Command(BaseCommand):
    help = "Remove old staff metrics, e-mail log rows and saved bodies of failed mails, and trim the error list. Run daily."

    def handle(self, *args, **options):
        metrics.flush()
        ops_services.prune_back_office()
        errorlog.prune()
        self.stdout.write("Back office tables pruned.")
