"""Enterprise by request: the central "paid plan" rule, the Enterprise-only features and who keeps them (including Company
periods bought before Enterprise existed), and the quote flow from the owner's request to the paid plan."""
import json
from datetime import timedelta
from io import StringIO
from types import SimpleNamespace
from unittest import mock

import stripe
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone

from accounts.models import User
from billing.models import EnterpriseRequest, Payment, Plan, Subscription
from billing.services import (
    ENTERPRISE_GRANDFATHER_BEFORE, enterprise_allowed, grace_for, is_free_plan, is_live, plan_is_paid, require_enterprise,
)
from cards.features import rich_pages_allowed
from ilaf.errors import ApiError
from operations.models import Department
from workspaces.models import Member, Workspace

from .base import API, ApiTestCase
from .bo_base import BackOfficeCase
from .test_billing import SECRET, signed

LOCK = "This is part of the Enterprise plan. Ask us for a quote."


def put_on(ws, plan_code, seats=5, **extra):
    """Give a company a subscription row of `plan_code` right now (no payment)."""
    now = timezone.now()
    Subscription.objects.update_or_create(
        workspace_id=ws,
        defaults={"plan": Plan.objects.get(code=plan_code), "status": "active", "seats_total": seats, "starts_at": now,
                  "ends_at": now + timedelta(days=300), **extra},
    )


class PlanIsPaidTests(ApiTestCase):
    def test_the_rule(self):
        plans = {p.code: p for p in Plan.objects.all()}
        self.assertFalse(plan_is_paid(plans["free"]))
        self.assertFalse(plan_is_paid(None))
        for code in ("personal", "business", "company"):
            self.assertTrue(plan_is_paid(plans[code]), code)
        # Enterprise has no list price (price_minor 0) and is still a paid plan.
        self.assertEqual(plans["enterprise"].price_minor, 0)
        self.assertTrue(plan_is_paid(plans["enterprise"]))

    def test_enterprise_company_is_treated_as_paid_everywhere(self):
        owner = self.signup()
        ws = self.company(owner)
        workspace = Workspace.objects.get(pk=ws)
        sub = Subscription.objects.get(workspace=workspace)
        self.assertEqual(sub.plan_id, "enterprise")
        self.assertEqual(grace_for(sub).days, 7)  # not 0 like the free week
        self.assertTrue(rich_pages_allowed(workspace))
        self.assertFalse(is_free_plan(workspace))  # a company is never "free" anyway
        sub.ends_at = timezone.now() - timedelta(days=3)
        sub.save()
        self.assertTrue(is_live(workspace))  # inside the grace days
        sub.ends_at = timezone.now() - timedelta(days=9)
        sub.save()
        self.assertFalse(is_live(workspace))

    def test_free_week_is_still_not_paid(self):
        person = self.signup()
        self.published_card(person)
        sub = Subscription.objects.get(workspace_id=person.ws)
        self.assertEqual(sub.plan_id, "free")
        self.assertEqual(grace_for(sub).days, 0)
        self.assertTrue(is_free_plan(Workspace.objects.get(pk=person.ws)))
        self.assertFalse(rich_pages_allowed(Workspace.objects.get(pk=person.ws)))

    def test_enterprise_period_gets_renewal_reminders(self):
        owner = self.signup("boss@example.com")
        ws = self.company(owner)
        Subscription.objects.filter(workspace_id=ws).update(ends_at=timezone.now() + timedelta(days=5))
        call_command("send_renewal_reminders", stdout=StringIO())
        self.assertEqual([m.to for m in mail.outbox], [["boss@example.com"]])

    def test_a_paid_enterprise_company_keeps_page_styles(self):
        owner = self.signup()
        ws = self.company(owner)
        card = self.make_card(owner, ws)
        res = owner.client.patch(f"{API}cards/{card['id']}", {"design": {"top": 3}}, format="json")
        self.assertNotEqual(res.data.get("error", {}).get("code"), "plan_limit", res.data)


class GatingTests(ApiTestCase):
    """Company keeps its own features; the Enterprise-only ones answer 403 plan_limit."""

    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@example.com")
        self.plain = self.company(self.owner, "Plain Co", plan="company")
        self.ent_owner = self.signup("boss@example.com")
        self.ent = self.company(self.ent_owner, "Big Co")

    def assertLocked(self, res):
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(res.data["error"]["code"], "plan_limit")
        self.assertEqual(res.data["error"]["message"], LOCK)

    def url(self, ws, path):
        return f"{API}workspaces/{ws}/{path}"

    # ------------------------------------------------------------ the flags the web app reads
    def test_subscription_carries_the_enterprise_flags(self):
        sub = self.owner.client.get(self.url(self.plain, "subscription")).data
        self.assertFalse(sub["enterprise"])
        self.assertFalse(sub["grandfathered"])
        self.assertEqual(set(sub["features"]), {"departments", "directory", "field_rules", "activity_log", "integrations", "custom_domain", "sign_in_rules"})
        self.assertFalse(any(sub["features"].values()))
        sub = self.ent_owner.client.get(self.url(self.ent, "subscription")).data
        self.assertTrue(sub["enterprise"])
        self.assertTrue(all(sub["features"].values()))
        listed = next(w for w in self.ent_owner.client.get(API + "me/workspaces").data if w["id"] == self.ent)
        self.assertTrue(listed["subscription"]["enterprise"])
        detail = self.owner.client.get(f"{API}workspaces/{self.plain}").data
        self.assertFalse(detail["subscription"]["enterprise"])

    def test_personal_workspace_has_no_enterprise_features(self):
        person = self.signup("solo@example.com")
        self.buy(person, "personal")
        sub = person.client.get(self.url(person.ws, "subscription")).data
        self.assertFalse(sub["enterprise"])
        self.assertFalse(any(sub["features"].values()))
        self.assertFalse(enterprise_allowed(Workspace.objects.get(pk=person.ws)))

    def test_helper_raises_the_registered_error(self):
        with self.assertRaises(ApiError) as caught:
            require_enterprise(Workspace.objects.get(pk=self.plain))
        self.assertEqual((caught.exception.code, caught.exception.status_code), ("plan_limit", 403))
        require_enterprise(Workspace.objects.get(pk=self.ent))

    # ------------------------------------------------------------ departments and the directory
    def test_departments_are_enterprise_only(self):
        c = self.owner.client
        self.assertLocked(c.post(self.url(self.plain, "departments"), {"name": "Sales"}, format="json"))
        self.assertEqual(c.get(self.url(self.plain, "departments")).status_code, 200)  # reading is harmless
        dept = Department.objects.create(workspace_id=self.plain, name="Old")
        self.assertLocked(c.patch(self.url(self.plain, f"departments/{dept.id}"), {"name": "New"}, format="json"))
        self.assertLocked(c.delete(self.url(self.plain, f"departments/{dept.id}")))
        self.assertLocked(c.post(self.url(self.plain, f"departments/{dept.id}/assign"), {"member_ids": []}, format="json"))
        e = self.ent_owner.client
        self.assertEqual(e.post(self.url(self.ent, "departments"), {"name": "Sales"}, format="json").status_code, 201)

    def test_putting_people_into_departments_is_enterprise_only(self):
        dept = Department.objects.create(workspace_id=self.plain, name="Old")
        c = self.owner.client
        # invite with a department
        res = c.post(self.url(self.plain, "invites"), {"invites": [{"email": "a@example.com", "department_id": str(dept.id)}]}, format="json")
        self.assertLocked(res)
        invited = self.invite(self.owner, self.plain, "b@example.com")
        res = c.patch(self.url(self.plain, f"members/{invited['id']}"), {"department_id": str(dept.id)}, format="json")
        self.assertLocked(res)
        # taking someone out stays possible; so does a plain invite
        Member.objects.filter(pk=invited["id"]).update(department=dept)
        res = c.patch(self.url(self.plain, f"members/{invited['id']}"), {"department_id": None}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_csv_import_ignores_departments_on_company(self):
        csv = b"email,full_name,title,department\nc@example.com,Cy,Dev,Sales\nd@example.com,Di,Dev,\n"
        from django.core.files.uploadedfile import SimpleUploadedFile

        res = self.owner.client.post(
            self.url(self.plain, "members/import"), {"file": SimpleUploadedFile("t.csv", csv, content_type="text/csv")}, format="multipart"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["created"], 1)
        self.assertEqual(len(res.data["skipped"]), 1)
        self.assertIn("Enterprise", res.data["skipped"][0]["reason"])

    def test_directory_cannot_be_switched_on_but_can_be_switched_off(self):
        c = self.owner.client
        res = c.patch(f"{API}workspaces/{self.plain}", {"brand": {"directory_enabled": True, "directory_slug": "plain-co"}}, format="json")
        self.assertLocked(res)
        Workspace.objects.filter(pk=self.plain).update(directory_enabled=True, directory_slug="plain-co")
        res = c.patch(f"{API}workspaces/{self.plain}", {"brand": {"directory_enabled": False}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        res = self.ent_owner.client.patch(f"{API}workspaces/{self.ent}", {"brand": {"directory_enabled": True, "directory_slug": "big-co"}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_an_existing_directory_still_renders(self):
        Workspace.objects.filter(pk=self.plain).update(directory_enabled=True, directory_slug="plain-co")
        res = self.client_for().get(f"{API}public/directory/plain-co")
        self.assertEqual(res.status_code, 200)

    # ------------------------------------------------------------ field rules and approvals
    def test_field_rules_and_approvals_are_enterprise_only(self):
        c = self.owner.client
        self.assertEqual(c.get(self.url(self.plain, "field-rules")).status_code, 200)
        self.assertLocked(c.patch(self.url(self.plain, "field-rules"), {"name": "locked"}, format="json"))
        self.assertEqual(c.get(self.url(self.plain, "change-requests")).status_code, 200)
        self.assertLocked(c.post(self.url(self.plain, "change-requests/bulk"), {"action": "approve", "ids": []}, format="json"))
        self.assertLocked(c.post(self.url(self.plain, "change-requests/00000000-0000-0000-0000-000000000001/approve"), {}, format="json"))
        self.assertLocked(c.post(self.url(self.plain, "change-requests/00000000-0000-0000-0000-000000000001/reject"), {}, format="json"))
        e = self.ent_owner.client
        self.assertEqual(e.patch(self.url(self.ent, "field-rules"), {"name": "locked"}, format="json").status_code, 200)

    def test_saved_field_rules_are_not_enforced_on_company(self):
        Workspace.objects.filter(pk=self.plain).update(field_rules={"name": "locked"})
        eve = self.join(self.invite(self.owner, self.plain, "eve@example.com"))
        card = eve.client.get(f"{API}workspaces/{self.plain}/cards").data[0]
        res = eve.client.patch(f"{API}cards/{card['id']}", {"name": "Eve Changed"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        # and the same rule holds on Enterprise
        Workspace.objects.filter(pk=self.ent).update(field_rules={"name": "locked"})
        zed = self.join(self.invite(self.ent_owner, self.ent, "zed@example.com"), full_name="Zed")
        card = zed.client.get(f"{API}workspaces/{self.ent}/cards").data[0]
        res = zed.client.patch(f"{API}cards/{card['id']}", {"name": "Zed Changed"}, format="json")
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(res.data["error"]["code"], "field_locked")

    # ------------------------------------------------------------ the activity log
    def test_activity_log_is_enterprise_only(self):
        self.assertLocked(self.owner.client.get(self.url(self.plain, "audit")))
        self.assertLocked(self.owner.client.get(self.url(self.plain, "audit.csv")))
        self.assertEqual(self.ent_owner.client.get(self.url(self.ent, "audit")).status_code, 200)
        self.assertEqual(self.ent_owner.client.get(self.url(self.ent, "audit.csv")).status_code, 200)

    # ------------------------------------------------------------ integrations
    def test_webhooks_are_enterprise_only(self):
        c = self.owner.client
        self.assertEqual(c.get(self.url(self.plain, "webhooks")).status_code, 200)  # looking at the list is harmless
        body = {"name": "Hook", "url": "https://example.com/hook", "events": ["lead.created"]}
        self.assertLocked(c.post(self.url(self.plain, "webhooks"), body, format="json"))
        with mock.patch("ilaf.netsafety.is_public_ip", return_value=True):
            res = self.ent_owner.client.post(self.url(self.ent, "webhooks"), body, format="json")
        self.assertEqual(res.status_code, 201, res.content)

    def test_webhook_events_are_not_sent_for_a_company_plan(self):
        from leads.models import Lead, WebhookDelivery, WebhookEndpoint
        from leads.webhooks import enqueue

        for ws in (self.plain, self.ent):
            WebhookEndpoint.objects.create(workspace_id=ws, name="h", url="https://example.com/h", events=["lead.created"], secret="s" * 32)
        card = self.published_card(self.owner, self.plain)
        lead = Lead.objects.create(workspace_id=self.plain, card_id=card["id"], card_name="c", name="N", email="n@example.com", source="qr")
        self.assertEqual(enqueue(Workspace.objects.get(pk=self.plain), "lead.created", lead), 0)
        self.assertFalse(WebhookDelivery.objects.exists())

    def test_api_keys_are_enterprise_only(self):
        c = self.owner.client
        body = {"name": "Key", "scopes": ["leads:read"]}
        self.assertLocked(c.post(self.url(self.plain, "api-keys"), body, format="json"))
        self.assertEqual(c.get(self.url(self.plain, "api-keys")).status_code, 200)  # listing (and revoking) stay possible
        res = self.ent_owner.client.post(self.url(self.ent, "api-keys"), body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        secret = res.data["secret"]
        # an existing key stops working when the company is no longer on Enterprise
        public = self.client_for()
        public.credentials(HTTP_AUTHORIZATION=f"Bearer {secret}")
        self.assertEqual(public.get("/api/public/v1/leads").status_code, 200)
        put_on(self.ent, "company")
        res = public.get("/api/public/v1/leads")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")

    def test_crm_connectors_are_enterprise_only(self):
        c = self.owner.client
        self.assertEqual(c.get(self.url(self.plain, "crm")).status_code, 200)  # the page may be looked at
        self.assertLocked(c.post(self.url(self.plain, "crm/hubspot/connect"), {}, format="json"))
        self.assertLocked(c.post(self.url(self.plain, "crm/hubspot/test"), {}, format="json"))
        self.assertLocked(c.post(self.url(self.plain, "crm/hubspot/backfill"), {}, format="json"))
        self.assertLocked(c.patch(self.url(self.plain, "crm/hubspot"), {"settings": {}}, format="json"))

    # ------------------------------------------------------------ custom domain and sign-in rules
    def test_custom_domain_is_enterprise_only(self):
        res = self.owner.client.patch(f"{API}workspaces/{self.plain}", {"custom_domain": "cards.plain.test"}, format="json")
        self.assertLocked(res)
        res = self.ent_owner.client.patch(f"{API}workspaces/{self.ent}", {"custom_domain": "cards.big.test"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.data["custom_domain"])  # a claim is pending until DNS proves it (see test_custom_domains.py)
        self.assertEqual(res.data["custom_domain_info"]["status"], "pending")
        # clearing one stays possible
        res = self.ent_owner.client.patch(f"{API}workspaces/{self.ent}", {"custom_domain": ""}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_sign_in_rules_are_enterprise_only(self):
        c = self.owner.client
        self.assertLocked(c.patch(f"{API}workspaces/{self.plain}", {"security": {"allowed_email_domains": ["plain.test"]}}, format="json"))
        self.assertLocked(c.patch(f"{API}workspaces/{self.plain}", {"security": {"require_google_signin": True}}, format="json"))
        # sending the rules unchanged (nothing set) is not a change
        res = c.patch(f"{API}workspaces/{self.plain}", {"security": {"allowed_email_domains": [], "require_google_signin": False}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        res = self.ent_owner.client.patch(f"{API}workspaces/{self.ent}", {"security": {"allowed_email_domains": ["big.test"]}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_saved_sign_in_rules_are_not_enforced_on_company(self):
        Workspace.objects.filter(pk=self.plain).update(allowed_email_domains=["plain.test"], require_google_signin=True)
        res = self.owner.client.post(self.url(self.plain, "invites"), {"invites": [{"email": "anyone@elsewhere.test"}]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        Workspace.objects.filter(pk=self.ent).update(allowed_email_domains=["big.test"])
        res = self.ent_owner.client.post(self.url(self.ent, "invites"), {"invites": [{"email": "anyone@elsewhere.test"}]}, format="json")
        self.assertEqual(res.status_code, 400)  # the same rule holds on Enterprise

    # ------------------------------------------------------------ what Company keeps
    def test_company_keeps_its_own_features(self):
        c = self.owner.client
        invited = self.invite(self.owner, self.plain, "team@example.com")
        eve = self.join(invited)
        self.assertEqual(c.get(self.url(self.plain, "members")).status_code, 200)
        res = c.patch(self.url(self.plain, f"members/{invited['id']}"), {"role": "admin"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)  # owner and admin roles
        res = c.patch(f"{API}workspaces/{self.plain}", {"brand": {"lock_design": True, "company_name": "Plain"}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)  # brand and design lock
        self.assertEqual(c.post(self.url(self.plain, "company-card")).status_code, 201)  # company card
        self.assertEqual(c.get(self.url(self.plain, "leads")).status_code, 200)  # shared contacts
        self.assertEqual(c.get(self.url(self.plain, "analytics")).status_code, 200)  # analytics
        self.assertEqual(eve.client.get(f"{API}workspaces/{self.plain}/cards").status_code, 200)  # an employee's own card
        res = c.patch(f"{API}workspaces/{self.plain}", {"security": {"require_2fa": False}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)


class GrandfatherTests(ApiTestCase):
    """A live Company period that began before 2026-11-25 keeps the Enterprise-only features until it ends."""

    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@example.com")
        self.ws = self.company(self.owner, "Old Co", plan="company")
        self.workspace = Workspace.objects.get(pk=self.ws)

    def sub(self):
        return self.owner.client.get(f"{API}workspaces/{self.ws}/subscription").data

    def test_a_company_period_bought_today_is_not_grandfathered(self):
        self.assertFalse(enterprise_allowed(self.workspace))
        self.assertFalse(self.sub()["grandfathered"])

    def test_a_period_that_began_before_the_cut_off_keeps_the_features(self):
        self.age_company_plan(self.ws)
        self.assertTrue(enterprise_allowed(self.workspace))
        sub = self.sub()
        self.assertTrue(sub["enterprise"])
        self.assertTrue(sub["grandfathered"])
        self.assertTrue(all(sub["features"].values()))
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/departments", {"name": "Sales"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}/audit").status_code, 200)

    def test_it_ends_with_the_period(self):
        self.age_company_plan(self.ws)
        Subscription.objects.filter(workspace_id=self.ws).update(ends_at=timezone.now() - timedelta(days=2))
        self.assertTrue(enterprise_allowed(self.workspace))  # still in the grace days: the plan is live
        Subscription.objects.filter(workspace_id=self.ws).update(ends_at=timezone.now() - timedelta(days=9))
        self.assertFalse(enterprise_allowed(self.workspace))
        res = self.owner.client.get(f"{API}workspaces/{self.ws}/audit")
        self.assertEqual(res.status_code, 403)

    def test_renewing_after_the_cut_off_does_not_keep_them(self):
        self.age_company_plan(self.ws)
        self.assertTrue(enterprise_allowed(self.workspace))
        self.buy(self.owner, "company", ws=self.ws, seats=5)  # a renewal, paid now
        self.assertFalse(enterprise_allowed(self.workspace))
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/departments", {"name": "Sales"}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_a_payment_after_the_cut_off_ends_the_exception_even_when_dated_from_the_old_end(self):
        self.age_company_plan(self.ws)
        Payment.objects.create(
            number="X-1", workspace_id=self.ws, plan_id="company", seats=5, amount_minor=100, currency="QAR", source="stripe",
            period_start=ENTERPRISE_GRANDFATHER_BEFORE - timedelta(days=5), period_end=timezone.now() + timedelta(days=360),
            paid_at=timezone.now(),
        )
        # The period row still says "started before": the payment is what shows it was paid for again.
        self.assertTrue(Subscription.objects.get(workspace_id=self.ws).starts_at < ENTERPRISE_GRANDFATHER_BEFORE)
        self.assertFalse(enterprise_allowed(self.workspace))

    def test_only_the_company_plan_is_grandfathered(self):
        person = self.signup("p@example.com")
        ws = self.company(person, "Other", plan="company")
        put_on(ws, "business")
        Subscription.objects.filter(workspace_id=ws).update(starts_at=ENTERPRISE_GRANDFATHER_BEFORE - timedelta(days=30))
        self.assertFalse(enterprise_allowed(Workspace.objects.get(pk=ws)))

    def test_enterprise_needs_no_exception(self):
        ent = self.company(self.signup("e@example.com"), "Ent")
        self.assertTrue(enterprise_allowed(Workspace.objects.get(pk=ent)))
        self.assertFalse(self.owner.client.get(f"{API}workspaces/{self.ws}/subscription").data["grandfathered"])


class QuoteFlowTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@example.com", "Olga Owner")
        self.ws = self.company(self.owner, "Acme Ltd", plan="company")
        self.url = f"{API}workspaces/{self.ws}/enterprise-request"

    def ask(self, seats=20, **extra):
        return self.owner.client.post(self.url, {"seats_wanted": seats, "message": "We have three offices.", **extra}, format="json")

    def quote(self, req_id, seats=20, price=2500, note=""):
        """What staff do (the staff API is tested in StaffEnterpriseTests): quote straight through the service."""
        from billing import enterprise

        req = EnterpriseRequest.objects.get(pk=req_id)
        staff = SimpleNamespace(email="staff@ilaf.test")
        return enterprise.quote_request(req, staff, {"seats": seats, "price_per_seat_minor": price, "note": note})

    # ------------------------------------------------------------ asking
    def test_owner_asks_and_reads_the_request(self):
        res = self.ask(phone="+974 5555 1234")
        self.assertEqual(res.status_code, 201, res.content)
        data = res.data["request"]
        self.assertEqual((data["status"], data["seats_wanted"], data["phone"]), ("requested", 20, "+974 5555 1234"))
        self.assertIsNone(data["quoted_total_minor"])
        got = self.owner.client.get(self.url).data["request"]
        self.assertEqual(got["id"], data["id"])
        row = EnterpriseRequest.objects.get()
        self.assertEqual((row.workspace_id.hex, row.requested_by.email), (self.ws.replace("-", ""), "owner@example.com"))

    def test_no_request_yet(self):
        self.assertIsNone(self.owner.client.get(self.url).data["request"])

    def test_only_one_open_request(self):
        self.assertEqual(self.ask().status_code, 201)
        res = self.ask()
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "enterprise_request_open"))
        self.assertEqual(EnterpriseRequest.objects.count(), 1)

    def test_seats_can_never_be_below_the_seats_in_use(self):
        for index in range(3):
            self.invite(self.owner, self.ws, f"p{index}@example.com")
        res = self.ask(seats=3)  # the owner and three invited people use 4 seats
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn("4 seats", res.data["error"]["message"])
        self.assertEqual(self.ask(seats=4).status_code, 201)

    def test_bad_input(self):
        for bad in (0, -1, 10001, "ten", None, True):
            self.assertEqual(self.ask(seats=bad).status_code, 400, bad)
        self.assertEqual(self.ask(seats=5, message="x" * 1001).status_code, 400)
        self.assertEqual(EnterpriseRequest.objects.count(), 0)

    def test_only_the_owner_asks(self):
        admin = self.join(self.invite(self.owner, self.ws, "admin@example.com", role="admin"))
        eve = self.join(self.invite(self.owner, self.ws, "eve@example.com"))
        for who in (admin, eve):
            self.assertEqual(who.client.get(self.url).status_code, 403)
            self.assertEqual(who.client.post(self.url, {"seats_wanted": 9}, format="json").status_code, 403)
            self.assertEqual(who.client.post(self.url + "/accept").status_code, 403)
            self.assertEqual(who.client.delete(self.url).status_code, 403)
        stranger = self.signup("stranger@example.com")
        self.assertEqual(stranger.client.get(self.url).status_code, 404)

    def test_a_personal_workspace_cannot_ask(self):
        res = self.owner.client.post(f"{API}workspaces/{self.owner.ws}/enterprise-request", {"seats_wanted": 9}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_the_owner_can_cancel_and_ask_again(self):
        self.ask()
        res = self.owner.client.delete(self.url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["request"]["status"], "cancelled")
        self.assertEqual(self.owner.client.delete(self.url).data["error"]["code"], "enterprise_request_closed")
        self.assertEqual(self.ask().status_code, 201)
        self.assertEqual(EnterpriseRequest.objects.count(), 2)

    # ------------------------------------------------------------ the quote
    def test_a_quote_is_e_mailed_to_the_owner_in_english(self):
        req = self.ask().data["request"]
        mail.outbox.clear()
        quoted = self.quote(req["id"], seats=20, price=2500, note="Includes onboarding")
        self.assertEqual((quoted.status, quoted.quoted_total_minor), ("quoted", 50000))
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["owner@example.com"])
        self.assertIn("Enterprise quote", msg.subject)
        self.assertIn("20 seats", msg.body)
        self.assertIn("25.00 QAR", msg.body)
        self.assertIn("500.00 QAR", msg.body)
        self.assertIn("Includes onboarding", msg.body)
        self.assertIn("https://web.test/app/billing", msg.body)
        got = self.owner.client.get(self.url).data["request"]
        self.assertEqual((got["status"], got["quoted_seats"], got["quoted_price_per_seat_minor"], got["quoted_total_minor"]), ("quoted", 20, 2500, 50000))
        self.assertEqual((got["currency"], got["interval"]), ("QAR", "year"))

    def test_a_quote_is_e_mailed_in_arabic_to_an_arabic_owner(self):
        User.objects.filter(email="owner@example.com").update(language="ar")
        req = self.ask().data["request"]
        mail.outbox.clear()
        self.quote(req["id"])
        msg = mail.outbox[0]
        self.assertIn("جاهز", msg.subject)
        self.assertRegex(msg.body, "[؀-ۿ]")
        self.assertIn('dir="rtl"', msg.alternatives[0][0])

    def test_the_quote_can_be_changed_while_open(self):
        req = self.ask().data["request"]
        self.quote(req["id"], seats=20, price=2500)
        again = self.quote(req["id"], seats=30, price=2000)
        self.assertEqual(again.quoted_total_minor, 60000)
        self.assertEqual(len(mail.outbox), 2)

    def test_staff_cannot_quote_below_the_seats_in_use(self):
        for index in range(3):
            self.invite(self.owner, self.ws, f"p{index}@example.com")
        req = self.ask(seats=4).data["request"]
        with self.assertRaises(Exception) as caught:
            self.quote(req["id"], seats=3)
        self.assertEqual(caught.exception.status_code, 400)
        for bad in (0, "x", 10001, True, None):
            with self.assertRaises(Exception):
                self.quote(req["id"], seats=bad)
        for bad in (0, -5, "x", True, None, 10 ** 9):
            with self.assertRaises(Exception):
                self.quote(req["id"], price=bad)
        self.assertEqual(EnterpriseRequest.objects.get().status, "requested")

    def test_a_closed_request_cannot_be_quoted(self):
        req = self.ask().data["request"]
        self.owner.client.delete(self.url)
        with self.assertRaises(ApiError) as caught:
            self.quote(req["id"])
        self.assertEqual(caught.exception.code, "enterprise_request_closed")

    # ------------------------------------------------------------ accepting
    def test_nothing_to_accept_before_a_quote(self):
        res = self.owner.client.post(self.url + "/accept")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "enterprise_not_quoted"))
        self.ask()
        res = self.owner.client.post(self.url + "/accept")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "enterprise_not_quoted"))
        self.assertEqual(Subscription.objects.get(workspace_id=self.ws).plan_id, "company")

    def test_accepting_starts_enterprise_with_the_quoted_seats_and_amount(self):
        req = self.ask().data["request"]
        self.quote(req["id"], seats=20, price=2500)
        res = self.owner.client.post(self.url + "/accept")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["checkout_url"], "https://web.test/app/billing?paid=1")
        sub = self.owner.client.get(f"{API}workspaces/{self.ws}/subscription").data
        self.assertEqual((sub["plan_code"], sub["seats_total"], sub["live"], sub["enterprise"]), ("enterprise", 20, True, True))
        payment = Payment.objects.filter(workspace_id=self.ws).order_by("-paid_at").first()
        self.assertEqual((payment.plan_id, payment.seats, payment.amount_minor, payment.currency, payment.source), ("enterprise", 20, 50000, "QAR", "dev"))
        invoice = self.owner.client.get(f"{API}workspaces/{self.ws}/invoices").data[0]
        self.assertEqual((invoice["plan_code"], invoice["amount_minor"]), ("enterprise", 50000))
        self.assertEqual(EnterpriseRequest.objects.get().status, "accepted")
        # the Enterprise features work now, and the seats are the quoted ones
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/departments", {"name": "Sales"}, format="json")
        self.assertEqual(res.status_code, 201)
        invited = self.owner.client.post(
            f"{API}workspaces/{self.ws}/invites", {"invites": [{"email": f"n{i}@example.com"} for i in range(12)]}, format="json"
        )
        self.assertEqual(invited.status_code, 201, invited.content)  # more than the 5 seats of Company
        self.assertEqual(self.owner.client.get(self.url).data["request"]["status"], "accepted")

    def test_accepting_twice_does_not_charge_twice(self):
        req = self.ask().data["request"]
        self.quote(req["id"])
        self.assertEqual(self.owner.client.post(self.url + "/accept").status_code, 200)
        res = self.owner.client.post(self.url + "/accept")
        self.assertEqual(res.data["error"]["code"], "enterprise_not_quoted")
        self.assertEqual(Payment.objects.filter(plan_id="enterprise").count(), 1)

    def test_accepting_needs_seats_for_everyone_already_in(self):
        req = self.ask(seats=1).data["request"]
        self.quote(req["id"], seats=2)
        for index in range(3):  # three more people join after the quote: 4 in use, 2 quoted
            Member.objects.create(workspace_id=self.ws, email=f"late{index}@example.com", status="invited", role="employee")
        res = self.owner.client.post(self.url + "/accept")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn("4 seats", res.data["error"]["message"])
        self.assertEqual(Subscription.objects.get(workspace_id=self.ws).plan_id, "company")
        self.assertFalse(Payment.objects.filter(plan_id="enterprise").exists())

    def test_declining_is_cancelling(self):
        req = self.ask().data["request"]
        self.quote(req["id"])
        res = self.owner.client.delete(self.url)
        self.assertEqual(res.data["request"]["status"], "cancelled")
        self.assertEqual(self.owner.client.post(self.url + "/accept").data["error"]["code"], "enterprise_not_quoted")

    def test_an_enterprise_company_can_ask_for_a_different_size(self):
        req = self.ask().data["request"]
        self.quote(req["id"], seats=20)
        self.owner.client.post(self.url + "/accept")
        res = self.ask(seats=40)
        self.assertEqual(res.status_code, 201, res.content)
        self.quote(res.data["request"]["id"], seats=40, price=2200)
        self.assertEqual(self.owner.client.post(self.url + "/accept").status_code, 200)
        sub = Subscription.objects.get(workspace_id=self.ws)
        self.assertEqual(sub.seats_total, 40)
        self.assertEqual(Payment.objects.filter(plan_id="enterprise").count(), 2)
        self.assertEqual(Payment.objects.filter(plan_id="enterprise").order_by("-paid_at").first().amount_minor, 88000)

    def test_enterprise_cannot_be_bought_from_the_price_list(self):
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/checkout", {"plan_code": "enterprise", "seats": 10}, format="json")
        self.assertEqual(res.status_code, 400, res.content)
        self.assertIn("quote", res.data["error"]["message"])
        self.assertEqual(Subscription.objects.get(workspace_id=self.ws).plan_id, "company")

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
    def test_accepting_with_stripe_makes_a_yearly_subscription_checkout_for_the_quote(self):
        req = self.ask().data["request"]
        self.quote(req["id"], seats=20, price=2500)
        fake = SimpleNamespace(url="https://checkout.stripe.test/pay/cs_ent")
        with mock.patch.object(stripe.checkout.Session, "create", return_value=fake) as create:
            res = self.owner.client.post(self.url + "/accept")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["checkout_url"], fake.url)
        kwargs = create.call_args.kwargs
        self.assertEqual(kwargs["mode"], "subscription")
        item = kwargs["line_items"][0]
        self.assertEqual((item["quantity"], item["price_data"]["unit_amount"]), (20, 2500))
        self.assertEqual(item["price_data"]["recurring"], {"interval": "year"})
        self.assertEqual(kwargs["metadata"]["plan_code"], "enterprise")
        self.assertEqual(kwargs["metadata"]["seats"], "20")
        self.assertEqual(kwargs["metadata"]["enterprise_request_id"], req["id"])
        self.assertEqual(kwargs["subscription_data"]["metadata"]["enterprise_request_id"], req["id"])
        # nothing is granted until Stripe says it was paid
        self.assertEqual(Subscription.objects.get(workspace_id=self.ws).plan_id, "company")
        self.assertEqual(EnterpriseRequest.objects.get().status, "quoted")
        # the paid invoice grants Enterprise with the quoted seats and amount, and closes the request
        event = {
            "id": "evt_ent", "type": "invoice.paid", "data": {"object": {
                "id": "in_ent_1", "subscription": "sub_ent", "customer": "cus_ent", "amount_paid": 50000, "currency": "qar",
                "billing_reason": "subscription_create",
                "lines": {"data": [{"period": {"start": int(timezone.now().timestamp()), "end": int((timezone.now() + timedelta(days=365)).timestamp())}}]},
                "subscription_details": {"metadata": kwargs["subscription_data"]["metadata"]},
            }},
        }
        payload, sig = signed(event)
        res = self.client_for().post(API + "stripe/webhook", data=payload, content_type="application/json", HTTP_STRIPE_SIGNATURE=sig)
        self.assertEqual(res.status_code, 200)
        sub = Subscription.objects.get(workspace_id=self.ws)
        self.assertEqual((sub.plan_id, sub.seats_total, sub.auto_renew, sub.stripe_subscription_id), ("enterprise", 20, True, "sub_ent"))
        payment = Payment.objects.get(stripe_invoice_id="in_ent_1")
        self.assertEqual((payment.amount_minor, payment.seats, payment.source), (50000, 20, "stripe"))
        self.assertEqual(EnterpriseRequest.objects.get().status, "accepted")


class StaffEnterpriseTests(BackOfficeCase):
    def setUp(self):
        super().setUp()
        self.asker = self.signup("asker@example.com", "Ada Asker")
        self.ask_ws = self.company(self.asker, "Askers Ltd", plan="company")
        self.req = self.asker.client.post(
            f"{API}workspaces/{self.ask_ws}/enterprise-request", {"seats_wanted": 25, "message": "Three offices", "phone": "+974 1"}, format="json"
        ).data["request"]
        mail.outbox.clear()

    def list(self, who, **params):
        return who.client.get(self.url("enterprise-requests"), params)

    def test_the_list_shows_the_open_requests_to_every_staff_role(self):
        for who in (self.admin, self.support, self.ro):
            res = self.list(who)
            self.assertEqual(res.status_code, 200, who.role)
            self.assertEqual(res.data["count"], 1)
            row = res.data["results"][0]
            self.assertEqual((row["company"], row["seats_wanted"], row["status"]), ("Askers Ltd", 25, "requested"))
            self.assertEqual(row["requested_by"]["email"], "asker@example.com")
            self.assertEqual(row["message"], "Three offices")
        self.assertEqual(self.list(self.admin).data["counts"]["requested"], 1)

    def test_filters(self):
        self.assertEqual(self.list(self.admin, status="accepted").data["count"], 0)
        self.assertEqual(self.list(self.admin, status="all").data["count"], 1)
        self.assertEqual(self.list(self.admin, q="askers").data["count"], 1)
        self.assertEqual(self.list(self.admin, q="nobody").data["count"], 0)

    def test_customers_cannot_see_the_staff_api(self):
        self.assertEqual(self.asker.client.get(self.url("enterprise-requests")).status_code, 404)

    def test_admin_quotes_the_owner_is_e_mailed_and_it_is_logged(self):
        res = self.admin.client.post(
            self.url(f"enterprise-requests/{self.req['id']}/quote"), {"seats": 30, "price_per_seat_minor": 2750, "note": "Welcome"}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["status"], res.data["quoted_total_minor"], res.data["quoted_by"]), ("quoted", 82500, "admin@ilaf.test"))
        self.assertEqual([m.to for m in mail.outbox], [["asker@example.com"]])
        self.assertIn("30 seats", mail.outbox[0].body)
        self.assertIn("enterprise.quoted", self.audit_actions())
        mine = self.asker.client.get(f"{API}workspaces/{self.ask_ws}/enterprise-request").data["request"]
        self.assertEqual((mine["status"], mine["quoted_seats"], mine["staff_note"]), ("quoted", 30, "Welcome"))

    def test_only_admin_quotes_or_declines(self):
        body = {"seats": 30, "price_per_seat_minor": 2750}
        for who in (self.support, self.ro):
            self.assertEqual(who.client.post(self.url(f"enterprise-requests/{self.req['id']}/quote"), body, format="json").status_code, 403)
            self.assertEqual(who.client.post(self.url(f"enterprise-requests/{self.req['id']}/decline"), {}, format="json").status_code, 403)
        self.assertEqual(EnterpriseRequest.objects.get().status, "requested")
        self.assertEqual(mail.outbox, [])

    def test_quote_validation(self):
        quote = self.url(f"enterprise-requests/{self.req['id']}/quote")
        for body in ({"seats": 0, "price_per_seat_minor": 100}, {"seats": 30}, {"price_per_seat_minor": 100}, {"seats": 30, "price_per_seat_minor": 0},
                     {"seats": "30", "price_per_seat_minor": 100}):
            self.assertEqual(self.admin.client.post(quote, body, format="json").status_code, 400, body)
        self.assertEqual(self.admin.client.post(self.url("enterprise-requests/00000000-0000-0000-0000-000000000009/quote"), {}, format="json").status_code, 404)

    def test_the_seat_floor_counts_the_people_in_the_company(self):
        for index in range(4):
            Member.objects.create(workspace_id=self.ask_ws, email=f"m{index}@example.com", status="invited", role="employee")
        quote = self.url(f"enterprise-requests/{self.req['id']}/quote")
        res = self.admin.client.post(quote, {"seats": 4, "price_per_seat_minor": 2000}, format="json")  # 5 people in the company
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.admin.client.post(quote, {"seats": 5, "price_per_seat_minor": 2000}, format="json").status_code, 200)

    def test_admin_declines_the_owner_is_told(self):
        res = self.admin.client.post(self.url(f"enterprise-requests/{self.req['id']}/decline"), {"note": "Not in your region yet"}, format="json")
        self.assertEqual((res.status_code, res.data["status"]), (200, "declined"))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Not in your region yet", mail.outbox[0].body)
        self.assertIn("enterprise.declined", self.audit_actions())
        mine = self.asker.client.get(f"{API}workspaces/{self.ask_ws}/enterprise-request").data["request"]
        self.assertEqual(mine["status"], "declined")
        again = self.admin.client.post(self.url(f"enterprise-requests/{self.req['id']}/quote"), {"seats": 30, "price_per_seat_minor": 100}, format="json")
        self.assertEqual((again.status_code, again.data["error"]["code"]), (409, "enterprise_request_closed"))
        # the owner may ask again after a decline
        res = self.asker.client.post(f"{API}workspaces/{self.ask_ws}/enterprise-request", {"seats_wanted": 25}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_staff_billing_lists_enterprise_without_a_price(self):
        plans = {p["code"]: p for p in self.admin.client.get(self.url("billing")).data["plans"]}
        self.assertEqual(plans["enterprise"]["price_minor"], 0)

    def test_staff_can_hand_out_an_enterprise_period(self):
        body = {"company_id": self.ask_ws, "plan_code": "enterprise", "seats": 12, "reason": "Pilot agreed by phone"}
        res = self.admin.client.post(self.url("billing/grant"), body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(enterprise_allowed(Workspace.objects.get(pk=self.ask_ws)))
        self.assertEqual(Subscription.objects.get(workspace_id=self.ask_ws).seats_total, 12)


class SeedAndMigrationTests(ApiTestCase):
    def test_seed_plans_creates_enterprise_and_keeps_edits(self):
        Plan.objects.filter(code="enterprise").delete()
        call_command("seed_plans", verbosity=0)
        plan = Plan.objects.get(code="enterprise")
        self.assertEqual((plan.kind, plan.per_seat, plan.price_minor, plan.active, plan.interval), ("company", True, 0, True, "year"))
        Plan.objects.filter(code="enterprise").update(name="Enterprise Plus")
        call_command("seed_plans", verbosity=0)
        self.assertEqual(Plan.objects.get(code="enterprise").name, "Enterprise Plus")

    def test_enterprise_is_listed_but_not_for_sale(self):
        plans = {p["code"]: p for p in self.client_for().get(API + "plans").data}
        self.assertFalse(plans["enterprise"]["purchasable"])
        self.assertTrue(plans["enterprise"]["by_quote"])
        self.assertEqual(plans["enterprise"]["price_minor"], 0)

    def test_the_data_migration_adds_the_plan_to_an_existing_database(self):
        import importlib

        migration = importlib.import_module("billing.migrations.0004_enterprise_plan")
        from django.apps import apps

        Plan.objects.filter(code="enterprise").delete()
        migration.add_enterprise_plan(apps, None)
        self.assertEqual(Plan.objects.get(code="enterprise").price_minor, 0)
        migration.add_enterprise_plan(apps, None)  # running it again changes nothing
        self.assertEqual(Plan.objects.filter(code="enterprise").count(), 1)
