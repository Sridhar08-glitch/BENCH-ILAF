"""Give or take away a staff role from the command line (the way to name the first staff admin).

    python manage.py grant_staff person@company.com admin
    python manage.py grant_staff person@company.com none

A role can be removed or lowered only while another staff admin remains."""
from django.core.management.base import BaseCommand, CommandError

from accounts.models import User
from staff import services


class Command(BaseCommand):
    help = "Set the staff role (none, read_only, support, admin) of an existing account."

    def add_arguments(self, parser):
        parser.add_argument("email")
        parser.add_argument("role", choices=["none", "read_only", "support", "admin"])

    def handle(self, *args, **options):
        user = User.objects.filter(email__iexact=options["email"].strip()).first()
        if user is None:
            raise CommandError("No account has that email address.")
        role = options["role"]
        if user.staff_role == "admin" and role != "admin" and services.count_admins(exclude=user) == 0:
            raise CommandError("At least one staff admin is required.")
        user.staff_role = role
        user.save(update_fields=["staff_role"])
        if role == "none":
            services.end_sessions(user)
        self.stdout.write(f"{user.email} is now: {role}")
