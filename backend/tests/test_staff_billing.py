"""The staff Billing screens, the billing facts of the companies list and the company page, the funnel and the revenue, and who may
read or change them. Staff see plans, dates, counts and amounts; never what a contact, an order or a booking says."""
import csv
import io
import uuid
from datetime import timedelta

from django.test import override_settings
from django.utils import timezone

from billing import webhooks
from billing.models import EnterpriseRequest, Payment, Plan, Subscription
from billing.services import (
    ENTERPRISE_GRANDFATHER_BEFORE, enterprise_allowed, enterprise_grandfathered, ensure_trial,
)
from leads.models import Lead
from operations.audit import ACTIONS as COMPANY_ACTIONS
from operations.models import AuditEvent
from staff import billing_data
from staff.views import AUDIT_ACTIONS, AUDIT_CATEGORIES, category_of
from workspaces.models import CustomDomain, Member, Workspace

from .bo_base import BackOfficeCase


def set_plan(ws, code, seats=5, starts=None, ends=None, **extra):
    now = timezone.now()
    Subscription.objects.update_or_create(
        workspace_id=ws,
        defaults={"plan": Plan.objects.get(code=code), "status": "active", "seats_total": seats, "starts_at": starts or now - timedelta(days=10),
                  "ends_at": ends or now + timedelta(days=200), **extra},
    )


def new_card(person, status="published"):
    from cards.models import Card

    return Card.objects.create(workspace_id=person.ws, owner_id=person.user["id"], name=person.email, status=status, public_code=uuid.uuid4().hex[:10])


class BillingCase(BackOfficeCase):
    def setUp(self):
        super().setUp()
        self.now = timezone.now()

    def get(self, path, role="read_only", **params):
        res = self.person(role).client.get(self.url(path), params)
        self.assertEqual(res.status_code, 200, res.content[:300])
        return res.data

    def second_company(self, email="boss@beta.test", name="Beta Co"):
        owner = self.company_with_owner(email, name)
        return owner.company

    def personal_user(self, email, publish=True):
        person = self.signup(email, "Pat Personal")
        if publish:
            ensure_trial(Workspace.objects.get(pk=person.ws))
        return person


class SummaryTests(BillingCase):
    def test_tiles_count_plans_estimated_revenue_renewals_and_failures(self):
        beta = self.second_company()
        set_plan(self.ws, "enterprise", 5, ends=self.now + timedelta(days=5))            # last payment 12500 (dev), renews in 5 days, manual
        set_plan(beta, "company", 7, ends=self.now + timedelta(days=20), auto_renew=True, stripe_subscription_id="sub_1")
        Subscription.objects.filter(workspace_id=beta).update(payment_failed_at=self.now, failed_invoice_id="in_fail")
        data = self.get("billing")
        tiles = data["summary"]
        by = {r["plan_code"]: r for r in tiles["active_by_plan"]}
        self.assertEqual(by["company"]["subscriptions"], 1)
        self.assertEqual(by["company"]["arr_minor"], 3900 * 7)
        self.assertEqual(by["enterprise"]["arr_minor"], 12500)  # the last real payment: Enterprise has no list price
        self.assertEqual(tiles["arr_minor"], 3900 * 7 + 12500)
        self.assertTrue(tiles["arr_is_estimate"])
        self.assertEqual(tiles["currency"], "QAR")
        self.assertEqual(tiles["renewals"]["in_7_days"], {"auto": 0, "manual": 1})
        self.assertEqual(tiles["renewals"]["in_30_days"], {"auto": 1, "manual": 1})
        self.assertEqual(tiles["failed_payments"], 1)

    def test_manual_grants_and_expired_periods_are_not_revenue_or_active(self):
        set_plan(self.ws, "company", 5, ends=self.now - timedelta(days=30))  # long past the grace days
        tiles = self.get("billing")["summary"]
        self.assertEqual(tiles["active_total"], 0)
        self.assertEqual(tiles["arr_minor"], 0)

    def test_free_weeks_are_counted_by_stage(self):
        running = self.personal_user("run@x.test")
        soon = self.personal_user("soon@x.test")
        ended = self.personal_user("ended@x.test")
        self.personal_user("none@x.test", publish=False)
        paid = self.personal_user("paid@x.test")
        Subscription.objects.filter(workspace_id=soon.ws).update(ends_at=self.now + timedelta(hours=30))
        Subscription.objects.filter(workspace_id=ended.ws).update(starts_at=self.now - timedelta(days=9), ends_at=self.now - timedelta(days=2))
        set_plan(paid.ws, "personal", 1)
        free = self.get("billing")["summary"]["free_weeks"]
        self.assertEqual((free["running"], free["ending_soon"], free["ended_unpaid"], free["converted"]), (2, 1, 1, 1))
        self.assertIsNotNone(running)

    def test_enterprise_requests_waiting_are_counted(self):
        EnterpriseRequest.objects.create(workspace_id=self.ws, seats_wanted=40, status="requested")
        self.assertEqual(self.get("billing")["summary"]["enterprise_requests"], {"requested": 1, "quoted": 0})

    def test_the_plans_table_has_the_sales_facts(self):
        plans = {p["code"]: p for p in self.get("billing")["plans"]}
        self.assertEqual(set(plans), {"free", "personal", "business", "company", "enterprise"})
        self.assertTrue(plans["personal"]["purchasable"])
        self.assertFalse(plans["free"]["purchasable"])
        self.assertFalse(plans["business"]["purchasable"])
        self.assertTrue(plans["enterprise"]["by_quote"])
        self.assertEqual(plans["company"]["min_seats"], 5)
        self.assertTrue(plans["company"]["per_seat"])
        self.assertTrue(all(p["currency"] == "QAR" for p in plans.values()))
        self.assertNotIn("payments_parked", self.get("billing"))


class TableTests(BillingCase):
    def test_renewals_filter_by_window_and_mode_and_sort(self):
        beta = self.second_company()
        set_plan(self.ws, "company", 5, ends=self.now + timedelta(days=3), auto_renew=True)
        set_plan(beta, "company", 6, ends=self.now + timedelta(days=25))
        rows = self.get("billing/renewals", window="30")["results"]
        self.assertEqual([r["company"] for r in rows], ["Acme Ltd", "Beta Co"])
        self.assertEqual([r["renewal"] for r in rows], ["auto", "manual"])
        self.assertEqual(rows[0]["owner_email"], "owner@acme.test")
        self.assertEqual([r["company"] for r in self.get("billing/renewals", window="7")["results"]], ["Acme Ltd"])
        self.assertEqual([r["company"] for r in self.get("billing/renewals", renew="manual")["results"]], ["Beta Co"])
        self.assertEqual([r["company"] for r in self.get("billing/renewals", sort="company")["results"]], ["Acme Ltd", "Beta Co"])

    def test_failed_payments_show_company_owner_since_and_invoice(self):
        failed_at = self.now - timedelta(days=2)
        Subscription.objects.filter(workspace_id=self.ws).update(payment_failed_at=failed_at, failed_invoice_id="in_123")
        data = self.get("billing/failed-payments")
        self.assertEqual(data["count"], 1)
        row = data["results"][0]
        self.assertEqual((row["company"], row["owner_email"], row["invoice_id"]), ("Acme Ltd", "owner@acme.test", "in_123"))
        self.assertTrue(row["failed_at"].startswith(failed_at.strftime("%Y-%m-%d")))

    def test_free_weeks_list_owner_dates_and_whether_a_card_is_published(self):
        a = self.personal_user("a@x.test")
        b = self.personal_user("b@x.test")
        new_card(a)
        Subscription.objects.filter(workspace_id=b.ws).update(ends_at=self.now - timedelta(days=1))
        rows = {r["owner_email"]: r for r in self.get("billing/free-weeks")["results"]}
        self.assertTrue(rows["a@x.test"]["published"])
        self.assertFalse(rows["b@x.test"]["published"])
        self.assertEqual((rows["a@x.test"]["state"], rows["b@x.test"]["state"]), ("running", "ended"))
        self.assertEqual([r["owner_email"] for r in self.get("billing/free-weeks", state="ended")["results"]], ["b@x.test"])
        self.assertEqual([r["owner_email"] for r in self.get("billing/free-weeks", state="running")["results"]], ["a@x.test"])

    def test_payments_search_filter_sort_and_paging(self):
        beta = self.second_company()
        pay = Payment.objects.filter(workspace_id=beta).first()
        Payment.objects.filter(pk=pay.pk).update(stripe_invoice_id="in_beta_9", source="stripe", amount_minor=99900)
        data = self.get("billing/payments")
        self.assertEqual(data["count"], 2)
        self.assertEqual(self.get("billing/payments", q="in_beta_9")["results"][0]["company"], "Beta Co")
        self.assertEqual(self.get("billing/payments", q="acme")["count"], 1)
        self.assertEqual(self.get("billing/payments", source="stripe")["count"], 1)
        self.assertEqual(self.get("billing/payments", sort="amount")["results"][0]["amount_minor"], 99900)
        row = self.get("billing/payments", q="in_beta_9")["results"][0]
        self.assertEqual((row["currency"], row["plan"], row["seats"], row["stripe_invoice_id"]), ("QAR", "Enterprise", 5, "in_beta_9"))
        self.assertEqual(self.get("billing/payments", page_size="1")["pages"], 2)

    def test_payments_csv_is_logged_and_amounts_are_in_major_units(self):
        res = self.support.client.get(self.url("billing/payments/export"))
        self.assertEqual(res.status_code, 200)
        rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
        self.assertEqual(rows[0][:6], ["Invoice", "Company", "Plan", "Seats", "Amount", "Currency"])
        self.assertEqual(rows[1][1:6], ["Acme Ltd", "Enterprise", "5", "125.00", "QAR"])
        self.assertIn("billing.exported", self.audit_actions())

    def test_empty_tables_answer_with_no_rows(self):
        for path in ("billing/failed-payments", "billing/free-weeks"):
            data = self.get(path)
            self.assertEqual((data["count"], data["results"], data["pages"]), (0, [], 1))
        Subscription.objects.all().delete()
        self.assertEqual(self.get("billing/renewals")["results"], [])
        self.assertEqual(self.get("billing")["summary"]["active_total"], 0)


class PermissionTests(BillingCase):
    READ = ("billing", "billing/renewals", "billing/failed-payments", "billing/free-weeks", "billing/payments")

    def test_every_staff_role_may_read_the_billing_data(self):
        for role in ("admin", "support", "read_only"):
            for path in self.READ:
                self.assertEqual(self.person(role).client.get(self.url(path)).status_code, 200, f"{role} {path}")
            self.assertEqual(self.person(role).client.get(self.url(f"companies/{self.ws}/billing")).status_code, 200)

    def test_customers_do_not_see_the_staff_api_and_staff_need_the_second_step(self):
        for path in self.READ + ("billing/payments/export",):
            self.assertEqual(self.owner.client.get(self.url(path)).status_code, 404, path)
        fresh = self.make_staff("fresh2@ilaf.test", "admin", verified=False)
        for path in self.READ:
            self.assertEqual(fresh.client.get(self.url(path)).status_code, 403, path)

    def test_only_admin_grants_and_read_only_cannot_export(self):
        body = {"company_id": self.ws, "reason": "pilot customer"}
        self.assertEqual(self.ro.client.post(self.url("billing/grant"), body, format="json").status_code, 403)
        self.assertEqual(self.support.client.post(self.url("billing/grant"), body, format="json").status_code, 403)
        self.assertEqual(self.ro.client.get(self.url("billing/payments/export")).status_code, 403)
        self.assertEqual(self.admin.client.get(self.url("billing/payments/export")).status_code, 200)
        for role in ("read_only", "support"):
            self.assertEqual(self.person(role).client.post(self.url("billing/renewals"), {}, format="json").status_code, 403)

    def test_a_read_only_person_changes_nothing(self):
        before = Payment.objects.count()
        self.ro.client.post(self.url("billing/grant"), {"company_id": self.ws, "reason": "pilot customer"}, format="json")
        self.assertEqual(Payment.objects.count(), before)


class GrantTests(BillingCase):
    def test_grant_enterprise_needs_seats_and_works_with_them(self):
        bad = self.admin.client.post(self.url("billing/grant"), {"company_id": self.ws, "plan_code": "enterprise", "reason": "pilot customer"}, format="json")
        self.assertEqual(bad.status_code, 400)
        self.assertIn("seats", bad.data["error"]["fields"])
        ok = self.admin.client.post(self.url("billing/grant"), {"company_id": self.ws, "plan_code": "enterprise", "seats": 40, "reason": "pilot customer"}, format="json")
        self.assertEqual(ok.status_code, 201)
        self.assertEqual((ok.data["plan"], ok.data["seats"]), ("Enterprise", 40))
        sub = Subscription.objects.get(workspace_id=self.ws)
        self.assertEqual((sub.plan_id, sub.seats_total), ("enterprise", 40))
        self.assertTrue(Payment.objects.filter(workspace_id=self.ws, source="manual", seats=40, amount_minor=0).exists())
        self.assertIn("plan.granted", self.audit_actions())
        grants = self.get("billing")["grants"]
        self.assertEqual((grants[0]["company"], grants[0]["seats"]), ("Acme Ltd", 40))
        # the company sees it in its own activity log
        self.assertTrue(AuditEvent.objects.filter(workspace_id=self.ws, action="plan.granted").exists())

    def test_grant_a_company_plan_still_works(self):
        res = self.admin.client.post(self.url("billing/grant"), {"company_id": self.ws, "plan_code": "company", "seats": 8, "reason": "pilot customer"}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_a_reason_is_needed(self):
        res = self.admin.client.post(self.url("billing/grant"), {"company_id": self.ws, "reason": "no"}, format="json")
        self.assertEqual(res.status_code, 400)


class CompaniesListTests(BillingCase):
    def rows(self, **params):
        return {r["name"]: r for r in self.get("companies", **params)["results"]}

    def test_rows_carry_the_plan_facts(self):
        beta = self.second_company()
        set_plan(beta, "company", 7, auto_renew=True, stripe_subscription_id="sub_b")
        CustomDomain.objects.create(workspace_id=self.ws, domain="cards.acme.test", token="t" * 20, status="verified", verified_at=self.now)
        rows = self.rows()
        acme, beta_row = rows["Acme Ltd"], rows["Beta Co"]
        self.assertEqual((acme["plan"], acme["plan_code"], acme["seats_total"], acme["seats_used"], acme["status"]), ("Enterprise", "enterprise", 5, 1, "active"))
        self.assertEqual((acme["auto_renew"], acme["enterprise"], acme["grandfathered"], acme["domain_status"]), ("manual", True, False, "verified"))
        self.assertEqual((beta_row["plan_code"], beta_row["auto_renew"], beta_row["enterprise"], beta_row["domain_status"]), ("company", "auto", False, None))
        self.assertFalse(beta_row["payment_failed"])
        Subscription.objects.filter(workspace_id=beta).update(cancel_at_period_end=True)
        self.assertEqual(self.rows()["Beta Co"]["auto_renew"], "cancels")

    def test_filters(self):
        beta = self.second_company()
        gamma = self.second_company("g@gamma.test", "Gamma Co")
        set_plan(beta, "company", 7, auto_renew=True)
        set_plan(gamma, "company", 9, starts=ENTERPRISE_GRANDFATHER_BEFORE - timedelta(days=100), ends=self.now + timedelta(days=60), auto_renew=False)
        Payment.objects.filter(workspace_id=gamma).update(paid_at=ENTERPRISE_GRANDFATHER_BEFORE - timedelta(days=100))
        Subscription.objects.filter(workspace_id=self.ws).update(payment_failed_at=self.now, failed_invoice_id="in_x")
        self.assertEqual(set(self.rows(plan="company")), {"Beta Co", "Gamma Co"})
        self.assertEqual(set(self.rows(auto_renew="off")), {"Acme Ltd", "Gamma Co"})
        self.assertEqual(set(self.rows(payment_failed="1")), {"Acme Ltd"})
        self.assertEqual(set(self.rows(grandfathered="1")), {"Gamma Co"})
        self.assertEqual(set(self.rows(enterprise="1")), {"Acme Ltd", "Gamma Co"})
        gam = self.rows()["Gamma Co"]
        self.assertTrue(gam["grandfathered"] and gam["enterprise"])
        self.assertTrue(gam["grandfathered_until"].startswith((self.now + timedelta(days=60)).strftime("%Y-%m-%d")))
        self.assertEqual(set(self.rows(grandfathered="1", enterprise="1", plan="company")), {"Gamma Co"})

    def test_a_payment_after_the_cut_off_ends_the_grandfathering_in_the_list_too(self):
        gamma = self.second_company("g@gamma.test", "Gamma Co")
        set_plan(gamma, "company", 9, starts=ENTERPRISE_GRANDFATHER_BEFORE - timedelta(days=100), ends=self.now + timedelta(days=60))
        Payment.objects.filter(workspace_id=gamma).update(paid_at=self.now)  # renewed after the cut-off
        self.assertEqual(self.rows(grandfathered="1"), {})
        self.assertFalse(self.rows()["Gamma Co"]["enterprise"])

    def test_the_list_agrees_with_the_product_rules(self):
        """The row facts are the rules of billing.services, repeated on loaded rows: they must give the same answers."""
        old = ENTERPRISE_GRANDFATHER_BEFORE - timedelta(days=100)
        cases = {
            "A1": ("company", {"starts": old}, {"paid_at": old}),
            "A2": ("company", {"starts": old}, {"paid_at": self.now}),
            "A3": ("company", {"starts": self.now - timedelta(days=3)}, {}),
            "A4": ("enterprise", {}, {}),
            "A5": ("company", {"starts": old, "ends": self.now - timedelta(days=40)}, {"paid_at": old}),
            "A6": ("company", {"starts": old}, {"source": "manual"}),
        }
        ids = {}
        for name, (plan, sub, pay) in cases.items():
            ids[name] = self.second_company(f"{name.lower()}@x.test", name)
            set_plan(ids[name], plan, 6, **sub)
            if pay:
                Payment.objects.filter(workspace_id=ids[name]).update(**pay)
        rows = self.rows()
        for name, ws in ids.items():
            workspace = Workspace.objects.get(pk=ws)
            self.assertEqual(rows[name]["enterprise"], enterprise_allowed(workspace), name)
            self.assertEqual(rows[name]["grandfathered"], enterprise_grandfathered(workspace), name)

    def test_the_list_does_not_ask_the_database_again_for_every_company(self):
        def count():
            from django.db import connection
            from django.test.utils import CaptureQueriesContext

            with CaptureQueriesContext(connection) as ctx:
                self.get("companies", page_size="50")
            return len(ctx)

        count()  # warm any caches
        few = count()
        for i in range(8):
            self.second_company(f"n{i}@x.test", f"Many {i}")
        self.assertEqual(count(), few)

    def test_the_export_has_the_new_columns_and_keeps_the_old_ones(self):
        beta = self.second_company()
        set_plan(beta, "company", 7, auto_renew=True)
        Subscription.objects.filter(workspace_id=beta).update(payment_failed_at=self.now)
        res = self.support.client.get(self.url("companies/export"), {"payment_failed": "1"})
        rows = list(csv.reader(io.StringIO(res.content.decode("utf-8-sig"))))
        self.assertEqual(rows[0][:5], ["Company", "Plan", "Seats used", "Seats", "Cards"])
        self.assertEqual(rows[0][10:], ["Plan code", "Plan ends (UTC)", "Auto-renew", "Payment failed since (UTC)", "Enterprise features", "Grandfathered until (UTC)", "Custom domain"])
        self.assertEqual(len(rows), 2)
        self.assertEqual((rows[1][0], rows[1][10], rows[1][12], rows[1][14]), ("Beta Co", "company", "auto", "no"))

    def test_bulk_actions_still_work(self):
        res = self.admin.client.post(self.url("companies/bulk"), {"ids": [self.ws], "action": "suspend", "reason": "Fraud check"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.get("companies", status="suspended")["count"], 1)


class CompanyBillingTests(BillingCase):
    def test_subscription_enterprise_payments_and_stripe_ids(self):
        set_plan(self.ws, "company", 7, auto_renew=True, stripe_customer_id="cus_1", stripe_subscription_id="sub_1", payment_failed_at=self.now, failed_invoice_id="in_f")
        data = self.get(f"companies/{self.ws}/billing")
        sub = data["subscription"]
        self.assertEqual((sub["plan_code"], sub["plan"], sub["seats_total"], sub["auto_renew"], sub["cancel_at_period_end"]), ("company", "Company", 7, True, False))
        self.assertEqual((sub["stripe_customer_id"], sub["stripe_subscription_id"], sub["failed_invoice_id"]), ("cus_1", "sub_1", "in_f"))
        self.assertTrue(sub["payment_failed_at"] and sub["grace_ends_at"] and sub["starts_at"] and sub["ends_at"])
        self.assertFalse(data["enterprise"]["features_on"])
        self.assertEqual(len(data["payments"]), 1)
        self.assertEqual(data["payments"][0]["currency"], "QAR")

    def test_ids_are_empty_when_the_company_has_none(self):
        sub = self.get(f"companies/{self.ws}/billing")["subscription"]
        self.assertEqual((sub["stripe_customer_id"], sub["stripe_subscription_id"]), ("", ""))

    def test_a_company_without_a_plan(self):
        Subscription.objects.filter(workspace_id=self.ws).delete()
        data = self.get(f"companies/{self.ws}/billing")
        self.assertIsNone(data["subscription"]["plan"])
        self.assertFalse(data["enterprise"]["features_on"])
        self.assertEqual(data["payments"][0]["plan"], "Enterprise")

    def test_grandfathered_company_shows_until_and_latest_quote(self):
        old = ENTERPRISE_GRANDFATHER_BEFORE - timedelta(days=100)
        set_plan(self.ws, "company", 6, starts=old, ends=self.now + timedelta(days=60))
        Payment.objects.filter(workspace_id=self.ws).update(paid_at=old)
        EnterpriseRequest.objects.create(workspace_id=self.ws, seats_wanted=50, status="quoted", quoted_seats=48, quoted_price_per_seat_minor=2500, quoted_by="admin@ilaf.test")
        e = self.get(f"companies/{self.ws}/billing")["enterprise"]
        self.assertTrue(e["features_on"] and e["grandfathered"])
        self.assertTrue(e["grandfathered_until"].startswith((self.now + timedelta(days=60)).strftime("%Y-%m-%d")))
        self.assertEqual((e["latest_request"]["status"], e["latest_request"]["quoted_seats"], e["latest_request"]["quoted_total_minor"]), ("quoted", 48, 120000))

    def test_contact_sharing_gives_counts_only(self):
        for i, share in enumerate((True, False, True)):
            Member.objects.create(workspace_id=self.ws, email=f"e{i}@acme.test", full_name=f"Emp {i}", role="employee", status="active", share_contacts=share,
                                  share_contacts_changed_at=self.now if share else None)
        Member.objects.create(workspace_id=self.ws, email="pending@acme.test", role="employee", status="invited", share_contacts=True)
        Lead.objects.filter(pk=self.lead.pk).update(shared_with_company=True)
        res = self.person("read_only").client.get(self.url(f"companies/{self.ws}/billing"))
        sharing = res.data["sharing"]
        self.assertEqual((sharing["employees"], sharing["sharing"], sharing["contacts_shared"]), (3, 2, 1))
        text = res.content.decode()
        for secret in ("Hannah", "hannah@mailbox.test", "+44 20 7946 0000", "Wants a quote"):
            self.assertNotIn(secret, text)

    def test_the_team_tab_shows_each_employees_setting_without_contacts(self):
        Member.objects.create(workspace_id=self.ws, email="e@acme.test", full_name="Emp", role="employee", status="active", share_contacts=True)
        rows = {m["email"]: m for m in self.get(f"companies/{self.ws}/team")}
        self.assertTrue(rows["e@acme.test"]["share_contacts"])
        self.assertIsNone(rows["owner@acme.test"]["share_contacts"])
        self.assertNotIn("hannah@mailbox.test", str(rows))

    def test_the_domain_block_has_status_and_dates_but_no_token(self):
        CustomDomain.objects.create(workspace_id=self.ws, domain="cards.acme.test", token="SECRETTOKEN123456789", status="dns_broken", verified_at=self.now - timedelta(days=9),
                                    broken_at=self.now - timedelta(days=1), last_error="txt_missing")
        res = self.person("read_only").client.get(self.url(f"companies/{self.ws}/billing"))
        d = res.data["domain"]
        self.assertEqual((d["domain"], d["status"], d["last_error"], d["holding"]), ("cards.acme.test", "dns_broken", "txt_missing", True))
        self.assertTrue(d["grace_ends_at"] and d["broken_at"])
        self.assertNotIn("SECRETTOKEN", res.content.decode())
        self.assertNotIn("records", d)

    def test_no_domain_is_null(self):
        self.assertIsNone(self.get(f"companies/{self.ws}/billing")["domain"])

    def test_unknown_company_is_404(self):
        res = self.ro.client.get(self.url("companies/00000000-0000-0000-0000-000000000000/billing"))
        self.assertEqual(res.status_code, 404)


class PersonTests(BillingCase):
    def user(self, person):
        res = self.ro.client.get(self.url(f"users/{person.user['id']}"))
        self.assertEqual(res.status_code, 200)
        return res.data

    def test_the_free_week_states(self):
        p = self.personal_user("fw@x.test")
        u = self.user(p)["personal"]
        self.assertEqual((u["state"], u["plan_code"], u["auto_renew"]), ("free_week", "free", "none"))
        self.assertTrue(u["ends_at"])
        Subscription.objects.filter(workspace_id=p.ws).update(ends_at=self.now - timedelta(hours=1))
        self.assertEqual(self.user(p)["personal"]["state"], "free_week_ended")
        set_plan(p.ws, "personal", 1, auto_renew=True, stripe_subscription_id="sub_p")
        u = self.user(p)["personal"]
        self.assertEqual((u["state"], u["plan_code"], u["auto_renew"]), ("paid", "personal", "auto"))
        set_plan(p.ws, "personal", 1, ends=self.now - timedelta(days=30))
        self.assertEqual(self.user(p)["personal"]["state"], "paid_ended")

    def test_a_person_who_never_published(self):
        p = self.personal_user("np@x.test", publish=False)
        self.assertEqual(self.user(p)["personal"]["state"], "none")

    def test_memberships_show_the_share_setting_for_employees_only(self):
        Member.objects.create(workspace_id=self.ws, user_id=self.user_of("owner@acme.test").id, email="owner2@acme.test", role="employee", status="active")
        emp = self.signup("emp@x.test", "Emp Loyee")
        Member.objects.create(workspace_id=self.ws, user_id=emp.user["id"], email="emp@x.test", role="employee", status="active", share_contacts=True)
        rows = {m["company_id"]: m for m in self.user(emp)["memberships"]}
        self.assertTrue(rows[str(self.ws)]["share_contacts"])
        owner = self.user_of("owner@acme.test")
        owner_rows = [m for m in self.ro.client.get(self.url(f"users/{owner.id}")).data["memberships"] if m["kind"] == "company" and m["role"] == "owner"]
        self.assertIsNone(owner_rows[0]["share_contacts"])


class FunnelAndRevenueTests(BillingCase):
    def test_the_funnel_follows_a_signup_to_a_paid_plan(self):
        live = self.personal_user("live@x.test")
        gone = self.personal_user("gone@x.test")
        paid = self.personal_user("paid@x.test")
        card_only = self.personal_user("card@x.test", publish=False)
        self.personal_user("nothing@x.test", publish=False)
        for p in (live, gone, paid, card_only):
            new_card(p, "published" if p in (live, gone, paid) else "draft")
        Subscription.objects.filter(workspace_id=gone.ws).update(ends_at=self.now - timedelta(days=1))
        set_plan(paid.ws, "personal", 1)
        f = billing_data.funnel(7, self.now)
        self.assertEqual((f["signed_up"], f["created_card"], f["published"], f["still_live"], f["ended_unpaid"], f["converted"]), (6, 5, 3, 2, 1, 1))  # six customers: the company owner (with a card) and five personal ones
        old = billing_data.funnel(30, self.now)
        self.assertEqual(old["signed_up"], f["signed_up"])

    def test_people_who_signed_up_long_ago_are_outside_the_window(self):
        p = self.personal_user("old@x.test")
        from accounts.models import User

        User.objects.filter(pk=p.user["id"]).update(created_at=self.now - timedelta(days=20))
        self.assertEqual(billing_data.funnel(7, self.now)["published"], 0)
        self.assertEqual(billing_data.funnel(30, self.now)["published"], 1)

    def test_revenue_per_month_in_qar_leaves_out_grants_and_other_currencies(self):
        Payment.objects.filter(workspace_id=self.ws).update(paid_at=self.now, amount_minor=10000)
        last = self.now.replace(day=1) - timedelta(days=3)
        beta = self.second_company()
        Payment.objects.filter(workspace_id=beta).update(paid_at=last, amount_minor=5000)
        gamma = self.second_company("g@gamma.test", "Gamma Co")
        Payment.objects.filter(workspace_id=gamma).update(paid_at=self.now, amount_minor=777, source="manual")
        rows = billing_data.revenue_by_month(12, self.now)
        self.assertEqual(len(rows), 12)
        self.assertEqual(rows[-1], {"month": self.now.strftime("%Y-%m"), "amount_minor": 10000, "payments": 1})
        self.assertEqual(rows[-2]["amount_minor"], 5000)
        self.assertEqual(rows[0]["amount_minor"], 0)

    def test_overview_and_analytics_carry_the_money_block(self):
        Subscription.objects.filter(workspace_id=self.ws).update(payment_failed_at=self.now, ends_at=self.now + timedelta(days=4))
        for data in (self.get("overview"), self.get("analytics")):
            m = data["money"]
            self.assertEqual(set(m["funnel"]), {"7", "30"})
            self.assertEqual(len(m["revenue_monthly"]), 12)
            self.assertEqual((m["currency"], m["renewals_due_7"], m["renewals_due_30"], m["failed_payments"]), ("QAR", 1, 1, 1))
        kinds = [a["kind"] for a in self.get("overview")["attention"]]
        self.assertIn("payments_failed", kinds)


class LabelsAndJobsTests(BillingCase):
    NEW_COMPANY = (
        "custom_domain.added", "custom_domain.verified", "custom_domain.broken", "custom_domain.removed", "member.share_contacts_changed",
        "enterprise.requested", "enterprise.cancelled", "enterprise.accepted", "subscription.renewed", "subscription.payment_failed",
        "subscription.auto_renew_off", "subscription.auto_renew_on", "plan.granted",
    )

    def test_every_new_event_has_a_sentence(self):
        for key in self.NEW_COMPANY:
            self.assertIn(key, COMPANY_ACTIONS)
            self.assertNotEqual(COMPANY_ACTIONS[key].strip(), "")
        for key in ("plan.granted", "enterprise.quoted", "enterprise.declined", "billing.exported"):
            self.assertIn(key, AUDIT_ACTIONS)
            self.assertEqual(category_of(key), "plan")
        self.assertIn("plan", AUDIT_CATEGORIES)

    def test_the_company_activity_tab_shows_the_sentence_for_the_new_events(self):
        AuditEvent.objects.create(workspace_id=self.ws, action="subscription.payment_failed", target_label="Acme Ltd")
        AuditEvent.objects.create(workspace_id=self.ws, action="custom_domain.broken", target_label="cards.acme.test")
        rows = {r["action"]: r["label"] for r in self.get(f"companies/{self.ws}/activity")["results"]}
        self.assertEqual(rows["subscription.payment_failed"], "A renewal payment failed")
        self.assertEqual(rows["custom_domain.broken"], COMPANY_ACTIONS["custom_domain.broken"])

    def test_the_staff_audit_log_shows_sentences_for_plan_and_billing_actions(self):
        self.admin.client.post(self.url("billing/grant"), {"company_id": self.ws, "reason": "pilot customer"}, format="json")
        self.support.client.get(self.url("billing/payments/export"))
        res = self.ro.client.get(self.url("audit"), {"category": "plan"})
        labels = {r["action"]: r["label"] for r in res.data["results"]}
        self.assertEqual(labels["plan.granted"], "Granted a free plan period")
        self.assertEqual(labels["billing.exported"], "Downloaded the payments CSV")

    def test_the_jobs_view_lists_the_new_cron_jobs(self):
        names = {j["name"] for j in self.get("system/jobs")["jobs"]}
        self.assertTrue({"check_custom_domains", "send_renewal_reminders", "expire_subscriptions"} <= names)

    def test_a_job_that_never_ran_is_late_and_a_marker_makes_it_ok(self):
        import os
        import tempfile

        with tempfile.TemporaryDirectory() as state, override_settings(BENCH_STATE_DIR=state):
            open(os.path.join(state, "ok-check_custom_domains"), "w").close()
            jobs = {j["name"]: j for j in self.get("system/jobs")["jobs"]}
            self.assertEqual(jobs["check_custom_domains"]["state"], "ok")
            self.assertEqual(jobs["send_renewal_reminders"]["state"], "late")
            self.assertEqual(jobs["expire_subscriptions"]["state"], "late")


class RenewalEventsTests(BillingCase):
    """What the Stripe handlers leave in the company's own activity log."""

    def actions(self):
        rows = AuditEvent.objects.filter(workspace_id=self.ws, action__startswith="subscription.").order_by("created_at")
        return list(rows.values_list("action", flat=True))

    def test_a_renewal_a_failure_and_a_cancel_are_written(self):
        Subscription.objects.filter(workspace_id=self.ws).update(stripe_subscription_id="sub_ev", stripe_customer_id="cus_ev", auto_renew=True)
        later = self.now + timedelta(days=365)
        invoice = {
            "id": "in_ev1", "subscription": "sub_ev", "customer": "cus_ev", "amount_paid": 12500, "currency": "qar",
            "lines": {"data": [{"period": {"start": int((self.now + timedelta(days=200)).timestamp()), "end": int(later.timestamp())}}]},
        }
        webhooks.handle("invoice.paid", invoice)
        webhooks.handle("invoice.payment_failed", {"id": "in_ev2", "subscription": "sub_ev"})
        webhooks.handle("invoice.payment_failed", {"id": "in_ev2", "subscription": "sub_ev"})  # a retry of the same invoice: no second line
        webhooks.handle("customer.subscription.updated", {"id": "sub_ev", "status": "active", "cancel_at_period_end": True})
        webhooks.handle("customer.subscription.updated", {"id": "sub_ev", "status": "active", "cancel_at_period_end": False})
        self.assertEqual(self.actions(), ["subscription.renewed", "subscription.payment_failed", "subscription.auto_renew_off", "subscription.auto_renew_on"])
        self.assertEqual(Payment.objects.filter(workspace_id=self.ws).count(), 2)

    def test_the_first_payment_is_not_called_a_renewal(self):
        ws = self.second_company("fresh@x.test", "Fresh Co")
        Payment.objects.filter(workspace_id=ws).delete()
        Subscription.objects.filter(workspace_id=ws).update(stripe_subscription_id="sub_new")
        webhooks.handle("invoice.paid", {"id": "in_first", "subscription": "sub_new", "customer": "cus_n", "amount_paid": 5000, "currency": "qar",
                                         "subscription_details": {"metadata": {"workspace_id": str(ws), "plan_code": "enterprise", "seats": "5"}}})
        self.assertFalse(AuditEvent.objects.filter(workspace_id=ws, action="subscription.renewed").exists())
