"""Staff: system health extras, overview comparisons and events, abuse numbers and bulk warnings, analytics totals and monthly retention."""
from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.utils import timezone

from billing.models import Plan, Subscription
from staff import metrics, ops_services
from staff.models import AbuseReport, EmailLog, StaffAuditEvent
from workspaces.models import Workspace

from .base import API
from .bo_base import BackOfficeCase


class AbuseNumberTests(BackOfficeCase):
    def report(self, **extra):
        return AbuseReport.objects.create(reason="spam", due_at=timezone.now() + timedelta(hours=48), workspace_id=self.ws, card_name="Card", **extra)

    def test_reports_get_the_next_free_number(self):
        a, b, c = self.report(), self.report(), self.report()
        self.assertEqual([a.number, b.number, c.number], [1, 2, 3])
        self.assertEqual(c.short_id, "R-00003")
        b.delete()
        self.assertEqual(self.report().number, 4)

    def test_the_number_is_in_lists_and_details_and_the_id_stays(self):
        a = self.report()
        row = self.ro.client.get(self.url("abuse")).data["results"][0]
        self.assertEqual((row["id"], row["number"], row["short_id"]), (str(a.id), 1, "R-00001"))
        self.assertEqual(self.ro.client.get(self.url(f"abuse/{a.id}")).data["short_id"], "R-00001")

    def test_search_finds_a_report_by_its_number(self):
        a, b = self.report(), self.report()
        for term in ("R-00002", "r-2", "2", "00002"):
            res = self.ro.client.get(self.url("abuse"), {"q": term}).data
            self.assertIn(str(b.id), [r["id"] for r in res["results"]], term)
            self.assertNotIn(str(a.id), [r["id"] for r in res["results"]], term)

    def test_fixed_query_budget_for_the_list(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        self.report()
        self.ro.client.get(self.url("abuse"))
        with CaptureQueriesContext(connection) as small:
            self.ro.client.get(self.url("abuse"))
        for _ in range(6):
            self.report()
        with CaptureQueriesContext(connection) as big:
            self.ro.client.get(self.url("abuse"))
        self.assertEqual(len(small), len(big))


class BulkWarnTests(BackOfficeCase):
    def make(self, name):
        return AbuseReport.objects.create(reason="offensive", due_at=timezone.now() + timedelta(hours=48), workspace_id=self.ws, card_name=name)

    def test_warn_owners_in_bulk_with_a_reason_and_an_audit_line_each(self):
        a, b = self.make("One"), self.make("Two")
        res = self.support.client.post(self.url("abuse/bulk"), {"ids": [str(a.id), str(b.id)], "action": "warn", "note": "Please remove the insult."}, format="json")
        self.assertEqual([r["ok"] for r in res.data["results"]], [True, True])
        self.assertEqual(len(mail.outbox), 2)
        self.assertIn("Please remove the insult.", mail.outbox[0].body)
        a.refresh_from_db()
        self.assertEqual((a.status, a.outcome), ("actioned", "warned"))
        self.assertEqual(a.history[-1]["text"], "Please remove the insult.")
        self.assertEqual(StaffAuditEvent.objects.filter(action="abuse.warn").count(), 2)

    def test_a_reason_is_required_and_closed_reports_are_skipped(self):
        a, b = self.make("One"), self.make("Two")
        self.assertEqual(self.support.client.post(self.url("abuse/bulk"), {"ids": [str(a.id)], "action": "warn", "note": "x"}, format="json").status_code, 400)
        AbuseReport.objects.filter(pk=b.pk).update(status="dismissed")
        res = self.support.client.post(self.url("abuse/bulk"), {"ids": [str(a.id), str(b.id)], "action": "warn", "note": "Please fix it."}, format="json")
        self.assertEqual([r["ok"] for r in res.data["results"]], [True, False])
        self.assertEqual(len(mail.outbox), 1)

    def test_read_only_cannot_warn(self):
        a = self.make("One")
        res = self.ro.client.post(self.url("abuse/bulk"), {"ids": [str(a.id)], "action": "warn", "note": "Please fix it."}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(len(mail.outbox), 0)


class SystemHealthExtrasTests(BackOfficeCase):
    def setUp(self):
        super().setUp()
        metrics.reset()
        cache.delete("staff:storage")

    def test_median_error_rate_and_success_rate(self):
        now = timezone.now()
        for ms, status in ((30, 200), (40, 200), (60, 200), (900, 500)):
            metrics.record(status, ms, now)
        metrics.flush()
        data = self.ro.client.get(self.url("system/health")).data
        h = data["health"]
        self.assertEqual(h["p50_ms"], 50)
        self.assertEqual(h["error_rate_1h"], 25.0)
        self.assertEqual(h["success_rate_7d"], 75.0)
        self.assertTrue(any(p["p50_ms"] is not None for p in data["series"]))
        self.assertTrue(any(p["error_rate"] == 25.0 for p in data["series"]))

    def test_no_traffic_gives_no_numbers(self):
        h = self.ro.client.get(self.url("system/health")).data["health"]
        self.assertIsNone(h["error_rate_1h"])
        self.assertIsNone(h["success_rate_7d"])

    def test_queue_counts(self):
        from privacy.models import DataRequest

        DataRequest.objects.create(user=self.user_of("owner@acme.test"), kind="export", scope="user", status="pending", due_at=timezone.now() + timedelta(days=30))
        EmailLog.objects.create(to_email="a@b.test", subject="s", status="failed", retry_text="body")
        queues = {q["key"]: q for q in self.ro.client.get(self.url("system/health")).data["queues"]}
        self.assertEqual(queues["exports"]["waiting"], 1)
        self.assertEqual(queues["email"]["waiting"], 1)
        self.assertEqual(queues["webhooks"]["waiting"], 0)
        self.assertIn("support", queues)
        self.assertEqual(queues["exports"]["state"], "ok")

    def test_a_long_queue_turns_red(self):
        EmailLog.objects.bulk_create([EmailLog(to_email="a@b.test", subject="s", status="failed", retry_text="body") for _ in range(ops_services.QUEUE_RED_ABOVE + 1)])
        queues = {q["key"]: q for q in self.ro.client.get(self.url("system/health")).data["queues"]}
        self.assertEqual(queues["email"]["state"], "bad")

    def test_storage_by_category(self):
        import os
        import tempfile

        from django.test import override_settings

        media = tempfile.mkdtemp()
        os.makedirs(os.path.join(media, "logos"))
        with open(os.path.join(media, "logos", "a.png"), "wb") as f:
            f.write(b"x" * 1234)
        with override_settings(MEDIA_ROOT=media):
            cache.delete("staff:storage")
            cats = {c["key"]: c["bytes"] for c in self.ro.client.get(self.url("system/health")).data["storage"]["categories"]}
        self.assertEqual(cats["logos"], 1234)
        self.assertEqual(set(cats), {"card_photos", "logos", "exports", "design_files"})
        cache.delete("staff:storage")

    def test_bounces_are_not_connected_without_a_provider(self):
        data = self.ro.client.get(self.url("system/email")).data
        self.assertEqual(data["bounce"], {"connected": False, "bounced": None, "rate": None})

    def test_resend_all_sends_every_failed_mail_and_logs_once(self):
        for i in range(3):
            EmailLog.objects.create(to_email=f"p{i}@b.test", subject=f"s{i}", status="failed", retry_text="hello")
        EmailLog.objects.create(to_email="gone@b.test", subject="old", status="failed", retry_text="")
        self.assertEqual(self.ro.client.get(self.url("system/email")).data["resendable"], 3)
        res = self.support.client.post(self.url("system/email/resend-all"), {}, format="json")
        self.assertEqual((res.status_code, res.data), (200, {"tried": 3, "sent": 3, "failed": 0}))
        self.assertEqual(len(mail.outbox), 3)
        self.assertEqual(EmailLog.objects.filter(status="resent").count(), 3)
        self.assertEqual(StaffAuditEvent.objects.filter(action="email.resent_all").count(), 1)

    def test_resend_all_is_not_for_read_only(self):
        self.assertEqual(self.ro.client.post(self.url("system/email/resend-all"), {}, format="json").status_code, 403)


class OverviewExtrasTests(BackOfficeCase):
    def test_deltas_total_chart_and_events(self):
        data = self.ro.client.get(self.url("overview")).data
        self.assertEqual(data["numbers"]["deltas"]["companies_4w"], 1)
        self.assertEqual(data["numbers"]["deltas"]["active_cards_4w"], 1)
        total = data["growth_total"]
        self.assertEqual(len(total), 12)
        self.assertEqual(total[-1]["n"], 1)
        self.assertEqual(total[0]["n"], 0)
        kinds = {e["kind"] for e in data["customer_events"]}
        self.assertTrue({"signup", "card"} <= kinds)
        self.assertTrue(all(e["text"] and e["path"] and e["at"] for e in data["customer_events"]))

    def test_total_includes_older_companies(self):
        Workspace.objects.filter(pk=self.ws).update(created_at=timezone.now() - timedelta(weeks=30))
        total = self.ro.client.get(self.url("overview")).data["growth_total"]
        self.assertEqual({row["n"] for row in total}, {1})

    def test_near_the_seat_limit(self):
        plan = Plan.objects.filter(kind="company", active=True).first()
        now = timezone.now()
        Subscription.objects.update_or_create(workspace_id=self.ws, defaults={"plan": plan, "status": "active", "seats_total": 1, "starts_at": now, "ends_at": now + timedelta(days=30)})
        items = [a for a in self.ro.client.get(self.url("overview")).data["attention"] if a["kind"] == "seats_near"]
        self.assertEqual(len(items), 1)
        self.assertIn("Acme Ltd", items[0]["text"])
        Subscription.objects.filter(workspace_id=self.ws).update(seats_total=50)
        self.assertEqual([a for a in self.ro.client.get(self.url("overview")).data["attention"] if a["kind"] == "seats_near"], [])

    def test_support_requests_and_upgrades_are_in_the_feed(self):
        from billing.models import Payment
        from support.models import SupportTicket

        plan = Plan.objects.filter(kind="company", active=True).first()
        now = timezone.now()
        Payment.objects.create(number="T-1", workspace_id=self.ws, plan=plan, seats=1, amount_minor=100, currency="EUR", source="stripe", period_start=now, period_end=now + timedelta(days=30), paid_at=now)
        SupportTicket.objects.create(number=900001, requester_email="x@y.test", subject="Help me", workspace_id=self.ws)
        kinds = {e["kind"] for e in self.ro.client.get(self.url("overview")).data["customer_events"]}
        self.assertTrue({"upgrade", "support"} <= kinds)


class AnalyticsExtrasTests(BackOfficeCase):
    def test_totals_and_active_cards_line(self):
        data = self.ro.client.get(self.url("analytics"), {"weeks": 8}).data
        self.assertEqual(data["totals"]["companies"], 1)
        self.assertEqual(data["totals"]["active_cards"], 1)
        self.assertEqual(data["totals"]["leads_30d"], 1)
        self.assertEqual(len(data["active_cards"]), 8)
        self.assertEqual(data["active_cards"][-1]["n"], 1)
        self.assertEqual(data["active_cards"][0]["n"], 0)

    def test_monthly_retention_rows(self):
        from analytics.models import Event
        from staff.views_growth import _month_start

        now = timezone.now()
        joined = _month_start(now, 3) + timedelta(days=2)
        Workspace.objects.filter(pk=self.ws).update(created_at=joined)
        event = Event.objects.create(card_id=self.card["id"], type="view")
        Event.objects.filter(pk=event.pk).update(created_at=joined + timedelta(days=40))
        rows = self.ro.client.get(self.url("analytics")).data["retention_monthly"]
        self.assertEqual(len(rows), 6)
        cohort = next(r for r in rows if r["companies"] == 1)
        self.assertEqual(cohort["month"], joined.strftime("%Y-%m"))
        self.assertEqual(cohort["after"]["0"], 0)
        self.assertEqual(cohort["after"]["1"], 100)
        self.assertEqual(cohort["after"]["3"], None)
        self.assertEqual(rows[-1]["after"]["1"], None)

    def test_read_only_can_read_analytics(self):
        self.assertEqual(self.ro.client.get(self.url("analytics")).status_code, 200)
