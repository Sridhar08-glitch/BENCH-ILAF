"""The staff card list (GET staff/cards), the card drawer extras, the e-mail to the owner of a suspended card, and the
companies list additions (cards column, search by country and owner name, CSV export)."""
import csv
import io
from datetime import timedelta

from django.core import mail
from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from cards.models import Card, CardItem
from cards.slugs import generate_public_code
from staff.models import AbuseReport, StaffAuditEvent
from workspaces.models import Workspace

from .base import API
from .staff_base import StaffTestCase


def add_card(person, ws=None, status="published", **fields):
    """A card made straight in the database (the plan limits of the API do not matter for these lists)."""
    return Card.objects.create(workspace_id=ws or person.ws, owner_id=person.user["id"], status=status, public_code=generate_public_code(), **fields)


class CardsListTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.reader = self.make_staff("reader@ilaf.test", "read_only")

    def get(self, person=None, **params):
        res = (person or self.reader).client.get(API + "staff/cards", params)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def names(self, **params):
        return [r["name"] for r in self.get(**params)["results"]]

    def seed(self):
        alice = self.signup("alice@example.com", "Alice Anderson")
        self.buy(alice, "personal")
        live = add_card(alice, name="Alice Live", title="Founder", company="Anderson Co")
        draft = add_card(alice, status="draft", name="Alice Draft")
        owner = self.company_with_owner("owner@acme.test", "Acme Ltd")
        sus = add_card(owner, ws=owner.company, status="suspended", name="Bob Suspended", staff_hold=True, status_before_suspend="published")
        rep = add_card(owner, ws=owner.company, name="Carol Reported")
        AbuseReport.objects.create(card_id=rep.id, workspace_id=owner.company, card_name="Carol Reported", reason="spam", due_at=timezone.now() + timedelta(hours=48))
        return alice, owner, live, draft, sus, rep

    def test_lists_every_card_newest_first_without_a_search(self):
        self.seed()
        body = self.get()
        self.assertEqual((body["count"], body["offset"]), (Card.objects.count(), 0))
        self.assertEqual([r["id"] for r in body["results"]], [str(c.id) for c in Card.objects.order_by("-created_at", "id")])

    def test_row_fields(self):
        _a, _o, live, *_ = self.seed()
        row = next(r for r in self.get()["results"] if r["id"] == str(live.id))
        for key in ("name", "title", "company", "status", "public_url", "workspace_name", "owner", "stats", "design", "items", "created_at", "open_reports"):
            self.assertIn(key, row)
        self.assertEqual(row["owner"]["email"], "alice@example.com")
        self.assertEqual(row["open_reports"], 0)

    def test_status_chips_and_counts(self):
        self.seed()
        self.assertEqual(sorted(self.names(status="active")), ["Alice Live", "Carol Reported"])
        self.assertEqual(self.names(status="suspended"), ["Bob Suspended"])
        self.assertEqual(self.names(status="draft"), ["Alice Draft"])
        self.assertEqual(self.names(status="reported"), ["Carol Reported"])
        counts = self.get(status="suspended")["status_counts"]
        self.assertEqual(counts, {"all": 4, "active": 2, "reported": 1, "suspended": 1, "draft": 1})
        self.assertEqual(self.get(status="suspended")["count"], 1)
        self.assertEqual(self.get(status="nonsense")["count"], 4)

    def test_a_resolved_report_is_not_reported(self):
        self.seed()
        AbuseReport.objects.update(status="dismissed")
        self.assertEqual(self.names(status="reported"), [])
        self.assertEqual(self.get()["status_counts"]["reported"], 0)

    def test_search_narrows_the_list_and_the_counts(self):
        self.seed()
        self.assertEqual(sorted(self.names(q="alice")), ["Alice Draft", "Alice Live"])
        self.assertEqual(self.get(q="alice")["status_counts"]["all"], 2)
        self.assertEqual(self.names(q="founder"), ["Alice Live"])
        self.assertEqual(sorted(self.names(q="acme")), ["Bob Suspended", "Carol Reported"])
        self.assertEqual(sorted(self.names(q="owner@acme")), ["Bob Suspended", "Carol Reported"])
        self.assertEqual(self.get(q="no-such-card")["count"], 0)

    def test_company_filter_and_sort_and_paging(self):
        _a, owner, *_ = self.seed()
        self.assertEqual(sorted(self.names(company=owner.company)), ["Bob Suspended", "Carol Reported"])
        self.assertEqual(self.get(company="not-an-id")["count"], 0)
        names = [n.lower() for n in self.names(sort="name")]
        self.assertEqual(names, sorted(names))
        first, second = self.get(limit=2), self.get(limit=2, offset=2)
        self.assertEqual((len(first["results"]), first["count"]), (2, 4))
        self.assertFalse({r["id"] for r in first["results"]} & {r["id"] for r in second["results"]})
        self.assertEqual(self.get(limit=500)["limit"], 100)
        self.assertEqual(self.get(offset=1000)["results"], [])

    def test_who_may_call_it(self):
        from rest_framework.test import APIClient

        customer = self.signup("cust@example.com")
        self.assertEqual(customer.client.get(API + "staff/cards").status_code, 404)
        self.assertEqual(APIClient().get(API + "staff/cards").status_code, 401)
        unverified = self.make_staff("u@ilaf.test", "admin", verified=False)
        res = unverified.client.get(API + "staff/cards")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "staff_verification_required"))
        for role in ("support", "admin"):
            self.assertEqual(self.get(self.make_staff(f"{role}@ilaf.test", role))["count"], 0)
        self.assertEqual(self.reader.client.post(API + "staff/cards", {}, format="json").status_code, 403)

    def test_query_count_does_not_grow_with_the_page(self):
        alice, *_ = self.seed()
        self.get()
        with CaptureQueriesContext(connection) as ctx:
            self.get(limit=1)
        small = len(ctx)
        for i in range(10):
            add_card(alice, name=f"Extra {i}")
        with CaptureQueriesContext(connection) as ctx:
            self.get(limit=100)
        self.assertEqual(small, len(ctx))
        self.assertLessEqual(len(ctx), 10)


class CardDrawerAndMailTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.support = self.make_staff("support@ilaf.test", "support")
        self.owner = self.signup("holder@example.com", "Holly Holder")
        self.buy(self.owner, "personal")
        self.card = self.published_card(self.owner, name="Holly Card")
        CardItem.objects.create(card_id=self.card["id"], kind="Email", value="holly@work.test", order=1)

    def test_drawer_shows_the_holder_the_card_address_and_the_created_date(self):
        res = self.support.client.get(f"{API}staff/cards/{self.card['id']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["details"]["holder_email"], "holder@example.com")
        self.assertEqual(res.data["details"]["card_email"], "holly@work.test")
        self.assertTrue(res.data["details"]["created_at"])

    def test_suspending_a_card_e_mails_its_holder_with_the_reason(self):
        mail.outbox.clear()
        res = self.support.client.post(f"{API}staff/cards/{self.card['id']}/suspend", {"reason": "Fake person"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        sent = [m for m in mail.outbox if m.to == ["holder@example.com"]]
        self.assertEqual(len(sent), 1)
        self.assertIn("Holly Card", sent[0].subject)
        body = sent[0].body
        self.assertIn("Fake person", body)
        self.assertIn("not available", body)

    def test_the_mail_follows_the_holders_language(self):
        from accounts.models import User

        User.objects.filter(email="holder@example.com").update(language="ar")
        mail.outbox.clear()
        self.support.client.post(f"{API}staff/cards/{self.card['id']}/suspend", {"reason": "Fake person"}, format="json")
        sent = [m for m in mail.outbox if m.to == ["holder@example.com"]]
        self.assertEqual(len(sent), 1)
        self.assertRegex(sent[0].subject, "[؀-ۿ]")

    def test_a_refused_suspend_sends_nothing(self):
        Card.objects.filter(pk=self.card["id"]).update(status="suspended")
        mail.outbox.clear()
        res = self.support.client.post(f"{API}staff/cards/{self.card['id']}/suspend", {"reason": "Fake person"}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(mail.outbox, [])


class CompaniesListAdditionsTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.admin = self.make_staff("admin@ilaf.test", "admin")
        self.support = self.make_staff("support@ilaf.test", "support")
        self.reader = self.make_staff("reader@ilaf.test", "read_only")
        self.acme = self.company_with_owner("owner@acme.test", "Acme Ltd")
        self.beta = self.company_with_owner("boss@beta.test", "Beta GmbH")
        Workspace.objects.filter(pk=self.acme.company).update(country="PL")
        Workspace.objects.filter(pk=self.beta.company).update(country="DE")
        add_card(self.acme, ws=self.acme.company, name="One")
        add_card(self.acme, ws=self.acme.company, name="Two")

    def listing(self, **params):
        res = self.reader.client.get(API + "staff/companies", params)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def test_every_row_has_a_card_count(self):
        rows = {r["name"]: r for r in self.listing()["results"]}
        self.assertEqual(rows["Acme Ltd"]["cards"], 2)
        self.assertEqual(rows["Beta GmbH"]["cards"], 0)
        self.assertEqual([r["name"] for r in self.listing(sort="cards")["results"]][0], "Acme Ltd")

    def test_search_by_country_name_code_and_owner_name(self):
        self.assertEqual([r["name"] for r in self.listing(q="Poland")["results"]], ["Acme Ltd"])
        self.assertEqual([r["name"] for r in self.listing(q="germ")["results"]], ["Beta GmbH"])
        self.assertEqual([r["name"] for r in self.listing(q="pl")["results"]], ["Acme Ltd"])
        self.assertEqual(self.listing(q="Olivia")["count"], 2)  # both owners are called Olivia Owner
        self.assertEqual(self.listing(q="owner@acme")["count"], 1)
        self.assertEqual(self.listing(q="nowhere-land")["count"], 0)

    def export(self, person=None, **params):
        return (person or self.admin).client.get(API + "staff/companies/export", params)

    def rows(self, res):
        text = res.content.decode("utf-8-sig")
        return list(csv.reader(io.StringIO(text)))

    def test_export_of_the_picked_companies(self):
        res = self.export(ids=self.acme.company)
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res["Content-Type"])
        rows = self.rows(res)
        self.assertEqual(rows[0][:5], ["Company", "Plan", "Seats used", "Seats", "Cards"])
        self.assertEqual(len(rows), 2)
        self.assertEqual((rows[1][0], rows[1][4], rows[1][7], rows[1][9]), ("Acme Ltd", "2", "Poland", "owner@acme.test"))
        entry = StaffAuditEvent.objects.get(action="company.exported")
        self.assertEqual((entry.actor_email, entry.details["rows"], entry.details["picked"]), ("admin@ilaf.test", 1, True))

    def test_export_without_ids_follows_the_filters(self):
        self.assertEqual(len(self.rows(self.export())), 3)
        self.assertEqual(len(self.rows(self.export(q="Poland"))), 2)

    def test_export_roles_and_bad_ids(self):
        self.assertEqual(self.export(self.support).status_code, 200)
        self.assertEqual(self.export(self.reader).status_code, 403)
        self.assertEqual(self.export(ids="not-an-id").status_code, 400)

    def test_spreadsheet_formulas_are_neutralised(self):
        Workspace.objects.filter(pk=self.beta.company).update(name="=SUM(A1)")
        rows = self.rows(self.export(ids=self.beta.company))
        self.assertEqual(rows[1][0], "'=SUM(A1)")
