"""Shared set-up for the back office tests: three staff people (one per role), a customer company with a published card
and a lead, and a check after every test that no staff write went unlogged."""
from django.core import mail
from django.test import override_settings

from accounts.models import User
from leads.models import Lead
from staff.models import StaffAuditEvent

from .base import API, BIG_RATES
from .staff_base import StaffTestCase

STAFF = "staff/"


@override_settings(STAFF_AUDIT_STRICT=True, ILAF_THROTTLE_RATES={**BIG_RATES, "public_report": "100000/min", "public_company_lead": "100000/min"})
class BackOfficeCase(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.admin = self.make_staff("admin@ilaf.test", "admin")
        self.support = self.make_staff("support@ilaf.test", "support")
        self.ro = self.make_staff("ro@ilaf.test", "read_only")
        self.owner = self.company_with_owner("owner@acme.test", "Acme Ltd")
        self.ws = self.owner.company
        self.card = self.published_card(self.owner, ws=self.ws)
        self.lead = Lead.objects.create(
            workspace_id=self.ws, card_id=self.card["id"], card_name="Alice", name="Hannah Becker", email="hannah@mailbox.test", phone="+44 20 7946 0000",
            note="Wants a quote", source="qr",
        )
        mail.outbox.clear()

    def tearDown(self):
        stray = StaffAuditEvent.objects.filter(action="staff.unlabelled_write")
        self.assertFalse(stray.exists(), f"a staff write was not logged: {[e.target_label for e in stray]}")
        super().tearDown()

    # ---------------------------------------------------------------- helpers
    def url(self, path):
        return API + STAFF + path

    def person(self, role):
        return {"admin": self.admin, "support": self.support, "read_only": self.ro}[role]

    def audit_actions(self):
        return list(StaffAuditEvent.objects.order_by("created_at").values_list("action", flat=True))

    def user_of(self, email):
        return User.objects.get(email=email)
