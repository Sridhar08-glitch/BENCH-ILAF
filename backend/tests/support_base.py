"""Shared set-up for the support tests."""
import hashlib
from datetime import timedelta

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings
from django.utils import timezone

from support import services
from support.models import SupportSettings

from .base import API, BIG_RATES
from .staff_base import StaffTestCase

PNG = b"\x89PNG\r\n\x1a\n" + b"\x00" * 64
PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"
ALWAYS_OPEN = {d: [["00:00", "23:59"]] for d in ("mon", "tue", "wed", "thu", "fri", "sat", "sun")}


def pow_solve(challenge, difficulty=3):
    counter = 0
    prefix = "0" * difficulty
    while not hashlib.sha256(f"{challenge}:{counter}".encode()).hexdigest().startswith(prefix):
        counter += 1
    return counter


@override_settings(
    SUPPORT_REPLY_TO="support@ilaf.test", SUPPORT_INBOUND_SECRET="inbound-secret", SUPPORT_MIN_FILL_SECONDS=0,
    SUPPORT_POW_DIFFICULTY=2, SUPPORT_TICKET_PREFIX="BNC", SUPPORT_IMAP_HOST="", SUPPORT_IMAP_USER="",
)
class SupportTestCase(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.alice = self.signup("alice@example.com", "Alice Anderson")
        self.bob = self.signup("bob@example.com", "Bob Brown")
        self.admin = self.make_staff("admin@ilaf.test", "admin")
        self.agent = self.make_staff("agent@ilaf.test", "support")
        self.viewer = self.make_staff("viewer@ilaf.test", "read_only")

    # ---------------------------------------------------------------- helpers
    def open_hours(self):
        c = services.cfg()
        c.business_hours = ALWAYS_OPEN
        c.holidays = []
        c.save()

    def new_ticket(self, person=None, **extra):
        person = person or self.alice
        body = {"category": "bug", "subject": "My card will not save", "body": "When I press save nothing happens."}
        body.update(extra)
        res = person.client.post(API + "support/tickets", body, format="json")
        assert res.status_code == 201, res.content
        return res.data

    def staff_url(self, ticket_id, tail=""):
        return f"{API}staff/support/tickets/{ticket_id}{tail}"

    def upload(self, name, data):
        return SimpleUploadedFile(name, data)
