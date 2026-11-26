"""The staff people list: GET staff/people (paging, filters, sort, who may call it, a fixed number of queries)."""
import json
from datetime import timedelta

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone

from accounts.models import User
from cards.models import Card

from .base import API
from .staff_base import StaffTestCase


class PeopleListTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.reader = self.make_staff("reader@ilaf.test", "read_only")

    def get(self, **params):
        res = self.reader.client.get(API + "staff/people", params)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def emails(self, **params):
        return [r["email"] for r in self.get(**params)["results"]]

    def seed(self):
        """alice: personal plan and a card; owner: a company; gone: disabled; leaving: deletion scheduled."""
        alice = self.signup("alice@example.com", "Alice Anderson")
        self.buy(alice, "personal")
        self.published_card(alice)
        Card.objects.create(workspace_id=alice.ws, owner_id=alice.user["id"], name="Second")
        owner = self.company_with_owner("owner@acme.test", "Acme Ltd")
        self.signup("free@example.com", "Zed Free")
        gone = self.signup("gone@example.com", "Gina Gone")
        leaving = self.signup("leaving@example.com", "Lee Leaving")
        User.objects.filter(email="gone@example.com").update(is_active=False)
        User.objects.filter(email="leaving@example.com").update(is_active=False, deletion_due_at=timezone.now() + timedelta(days=10))
        return alice, owner, gone, leaving

    def test_lists_everyone_newest_first_without_a_search(self):
        self.seed()
        body = self.get()
        self.assertEqual(body["offset"], 0)
        self.assertEqual(body["count"], User.objects.count())
        order = [r["email"] for r in body["results"]]
        self.assertEqual(order[0], "leaving@example.com")
        self.assertEqual(order, [u.email for u in User.objects.order_by("-created_at", "id")])

    def test_row_fields(self):
        self.seed()
        rows = {r["email"]: r for r in self.get()["results"]}
        alice = rows["alice@example.com"]
        self.assertEqual(alice["full_name"], "Alice Anderson")
        self.assertEqual((alice["cards"], alice["cards_published"]), (2, 1))
        self.assertEqual(alice["personal"]["state"], "live")
        self.assertTrue(alice["personal"]["plan"])
        self.assertEqual(alice["status"], "active")
        self.assertEqual(alice["staff_role"], "none")
        self.assertFalse(alice["two_step"])
        owner = rows["owner@acme.test"]
        self.assertEqual(owner["company_count"], 1)
        self.assertEqual(owner["companies"][0]["name"], "Acme Ltd")
        self.assertEqual(owner["companies"][0]["role"], "owner")
        self.assertEqual(owner["companies"][0]["state"], "live")
        self.assertEqual(rows["free@example.com"]["personal"]["state"], "none")
        self.assertEqual(rows["gone@example.com"]["status"], "disabled")
        self.assertEqual(rows["leaving@example.com"]["status"], "deletion_pending")
        self.assertTrue(rows["leaving@example.com"]["deletion_due_at"])
        staff = rows["reader@ilaf.test"]
        self.assertEqual(staff["staff_role"], "read_only")
        self.assertTrue(staff["two_step"])
        self.assertTrue(staff["last_sign_in"])

    def test_expired_plan_is_shown_as_expired(self):
        alice, *_ = self.seed()
        from billing.models import Subscription

        Subscription.objects.filter(workspace_id=alice.ws).update(ends_at=timezone.now() - timedelta(days=400))
        row = next(r for r in self.get()["results"] if r["email"] == "alice@example.com")
        self.assertEqual(row["personal"]["state"], "expired")

    def test_paging(self):
        self.seed()
        total = User.objects.count()
        first = self.get(limit=3)
        self.assertEqual((len(first["results"]), first["count"], first["limit"]), (3, total, 3))
        second = self.get(limit=3, offset=3)
        self.assertEqual(second["offset"], 3)
        self.assertFalse({r["id"] for r in first["results"]} & {r["id"] for r in second["results"]})
        self.assertEqual(self.get(limit=500)["limit"], 100)
        self.assertEqual(self.get(limit="x", offset="y")["limit"], 25)
        self.assertEqual(self.get(offset=1000)["results"], [])

    def test_search_filter(self):
        self.seed()
        self.assertEqual(self.emails(q="alice"), ["alice@example.com"])
        self.assertEqual(self.emails(q="Gina"), ["gone@example.com"])
        self.assertEqual(self.emails(q="acme"), ["owner@acme.test"])  # by company name, found once
        self.assertEqual(self.get(q="nobody-here")["count"], 0)
        self.assertEqual(self.emails(q="a"), self.emails(q="A"))

    def test_plan_filter(self):
        self.seed()
        self.assertEqual(self.emails(plan="personal"), ["alice@example.com"])
        self.assertEqual(self.emails(plan="enterprise"), ["owner@acme.test"])
        self.assertEqual(self.emails(plan="company"), [])
        none = set(self.emails(plan="none"))
        self.assertIn("free@example.com", none)
        self.assertNotIn("alice@example.com", none)
        self.assertNotIn("owner@acme.test", none)

    def test_status_role_company_and_date_filters(self):
        self.seed()
        self.assertEqual(self.emails(status="disabled"), ["gone@example.com"])
        self.assertEqual(self.emails(status="deletion_pending"), ["leaving@example.com"])
        self.assertNotIn("gone@example.com", self.emails(status="active"))
        self.assertEqual(self.emails(role="staff"), ["reader@ilaf.test"])
        self.assertNotIn("reader@ilaf.test", self.emails(role="customer"))
        self.assertEqual(self.emails(has_company="true"), ["owner@acme.test"])
        self.assertNotIn("owner@acme.test", self.emails(has_company="false"))
        today = timezone.now().date()
        self.assertEqual(self.get(joined_from=today.isoformat())["count"], User.objects.count())
        self.assertEqual(self.get(joined_from=(today + timedelta(days=1)).isoformat())["count"], 0)
        self.assertEqual(self.get(joined_to=(today - timedelta(days=1)).isoformat())["count"], 0)
        self.assertEqual(self.get(joined_from="not-a-date")["count"], User.objects.count())
        User.objects.filter(email="alice@example.com").update(created_at=timezone.now() - timedelta(days=60))
        old = self.emails(joined_to=(today - timedelta(days=30)).isoformat())
        self.assertEqual(old, ["alice@example.com"])

    def test_sort(self):
        self.seed()
        names = [r["full_name"].lower() for r in self.get(sort="name")["results"]]
        self.assertEqual(names, sorted(names))
        # nobody signed in more recently than the staff person who just called, and people who never signed in come last
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

        OutstandingToken.objects.filter(user__email="free@example.com").delete()
        rows = self.get(sort="last_active")["results"]
        self.assertEqual(rows[-1]["email"], "free@example.com")
        self.assertIsNone(rows[-1]["last_sign_in"])
        stamps = [r["last_sign_in"] for r in rows if r["last_sign_in"]]
        self.assertEqual(stamps, sorted(stamps, reverse=True))

    def test_who_may_call_it(self):
        customer = self.signup("cust@example.com")
        self.assertEqual(customer.client.get(API + "staff/people").status_code, 404)
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().get(API + "staff/people").status_code, 401)
        unverified = self.make_staff("u@ilaf.test", "admin", verified=False)
        res = unverified.client.get(API + "staff/people")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "staff_verification_required"))
        for role in ("support", "admin"):
            person = self.make_staff(f"{role}@ilaf.test", role)
            self.assertEqual(person.client.get(API + "staff/people").status_code, 200)
        self.assertEqual(self.reader.client.post(API + "staff/people", {}, format="json").status_code, 403)

    def test_no_secrets_in_the_response(self):
        self.seed()
        text = json.dumps(self.get(limit=100)).lower()
        for word in ("password", "pbkdf2", "token", "secret", "google_sub", "invite", "refresh", "recovery"):
            self.assertNotIn(word, text)

    def test_query_count_does_not_grow_with_the_page(self):
        def queries(limit):
            with CaptureQueriesContext(connection) as ctx:
                self.get(limit=limit)
            return len(ctx)

        self.seed()
        self.get()  # the first call of a staff session also records the session use
        small = queries(2)
        for i in range(12):
            self.signup(f"extra{i}@example.com", f"Extra {i}")
        self.company_with_owner("o9@beta.test", "Beta Ltd")
        big = queries(100)
        self.assertEqual(small, big)
        self.assertLessEqual(big, 14)
