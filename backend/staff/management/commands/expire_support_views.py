from django.core.management.base import BaseCommand

from staff.views_supportview import expire_due


class Command(BaseCommand):
    help = "End support views whose 30 minutes ran out (and write the end to the company's Activity log). Run every 5 minutes."

    def handle(self, *args, **options):
        self.stdout.write(f"Support views ended: {expire_due()}")
