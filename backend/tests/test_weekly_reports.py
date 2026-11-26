"""Weekly report e-mails: the command, idempotence, switches, unsubscribe links, the preview."""
from datetime import timedelta
from io import StringIO
from unittest import mock

from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from analytics import weekly
from analytics.models import Event, ReportPreference, WeeklyReportLog
from cards.models import Card
from leads.models import Lead
from operations.models import ChangeRequest

from .base import API
from .ops_base import OpsTestCase


class ReportCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.week = weekly.last_full_week()
        self.mid = self.week.window.start + timedelta(days=2, hours=10)
        self.eve = self.add("eve@example.com", "Eve Employee")
        self.sam = self.add("sam@example.com", "Sam Seller")
        self.card = Card.objects.get(pk=self.eve.card_id)

    def event(self, type_="view", when=None, card=None, **kw):
        e = Event.objects.create(card=card or self.card, type=type_, **kw)
        Event.objects.filter(pk=e.pk).update(created_at=when or self.mid)

    def run_cmd(self, *args):
        out = StringIO()
        call_command("send_weekly_reports", *args, stdout=out, stderr=StringIO())
        return out.getvalue()

    def to(self):
        return sorted(m.to[0] for m in mail.outbox)


class CommandTests(ReportCase):
    def test_sends_personal_reports_only_to_people_with_activity_and_company_report_to_owner(self):
        for _ in range(4):
            self.event()
        self.event("link_click", kind="WhatsApp")
        mail.outbox.clear()
        out = self.run_cmd()
        self.assertEqual(self.to(), ["eve@example.com", "owner@example.com"])
        self.assertIn("1 personal, 1 company", out)
        personal = next(m for m in mail.outbox if m.to == ["eve@example.com"])
        self.assertIn("4 views", personal.subject)
        company = next(m for m in mail.outbox if m.to == ["owner@example.com"])
        self.assertIn("Acme Ltd", company.subject)

    def test_second_run_for_the_same_week_sends_nothing(self):
        self.event()
        self.run_cmd()
        mail.outbox.clear()
        out = self.run_cmd()
        self.assertEqual(mail.outbox, [])
        self.assertIn("Already sent 2", out)
        self.assertEqual(WeeklyReportLog.objects.count(), 2)

    def test_another_week_is_a_new_report(self):
        self.event()
        self.run_cmd()
        mail.outbox.clear()
        earlier = self.week.window.start.date() - timedelta(days=7)
        self.event(when=self.week.window.start - timedelta(days=5))
        self.run_cmd("--week", f"{earlier.isocalendar()[0]}-W{earlier.isocalendar()[1]:02d}")
        self.assertTrue(mail.outbox)

    def test_dry_run_counts_and_changes_nothing(self):
        self.event()
        mail.outbox.clear()
        out = self.run_cmd("--dry-run")
        self.assertEqual(mail.outbox, [])
        self.assertEqual(WeeklyReportLog.objects.count(), 0)
        self.assertIn("Would send: 1 personal, 1 company", out)

    def test_switches_stop_each_kind(self):
        self.event()
        ReportPreference.objects.create(user=self.owner_member.user, workspace=self.owner_member.workspace, company_report=False)
        from accounts.models import User
        ReportPreference.objects.create(user=User.objects.get(email="eve@example.com"), workspace=self.owner_member.workspace, personal_report=False)
        mail.outbox.clear()
        out = self.run_cmd()
        self.assertEqual(mail.outbox, [])
        self.assertIn("switched off 2", out)

    def test_employees_never_get_the_company_report(self):
        self.event()
        mail.outbox.clear()
        self.run_cmd("--only", "company")
        self.assertEqual(self.to(), ["owner@example.com"])

    def test_a_mail_failure_frees_the_claim_so_the_next_run_retries(self):
        self.event()
        with mock.patch.object(weekly, "send_brand_html", side_effect=OSError("smtp down")):
            out = self.run_cmd()
        self.assertIn("failed 2", out)
        self.assertEqual(WeeklyReportLog.objects.count(), 0)
        mail.outbox.clear()
        self.run_cmd()
        self.assertEqual(len(mail.outbox), 2)

    def test_batches_handle_many_people(self):
        self.event()
        mail.outbox.clear()
        out = self.run_cmd("--batch-size", "1")
        self.assertEqual(len(mail.outbox), 2)
        self.assertIn("1 personal, 1 company", out)

    def test_bad_week_argument(self):
        from django.core.management.base import CommandError
        with self.assertRaises(CommandError):
            self.run_cmd("--week", "nonsense")

    def test_suspended_member_gets_nothing(self):
        self.event()
        from workspaces.models import Member
        Member.objects.filter(pk=self.eve.member_id).update(status="suspended")
        mail.outbox.clear()
        self.run_cmd()
        self.assertEqual(self.to(), ["owner@example.com"])

    def test_headers_and_unsubscribe_link(self):
        self.event()
        mail.outbox.clear()
        self.run_cmd()
        msg = next(m for m in mail.outbox if m.to == ["eve@example.com"])
        self.assertTrue(msg.extra_headers["List-Unsubscribe"].startswith("<http"))
        self.assertEqual(msg.extra_headers["List-Unsubscribe-Post"], "List-Unsubscribe=One-Click")
        html = msg.alternatives[0][0]
        self.assertIn("reports/unsubscribe?token=", html)
        self.assertIn("reports/unsubscribe?token=", msg.body)
        self.assertIn("text/html", msg.alternatives[0][1])


class ContentTests(ReportCase):
    def test_personal_numbers_and_change_against_the_week_before(self):
        for _ in range(6):
            self.event()
        for _ in range(3):
            self.event(when=self.week.window.start - timedelta(days=3))
        self.event("view", source="qr")
        self.event("save")
        for _ in range(3):
            self.event("link_click", kind="Phone")
        Lead.objects.create(card=self.card, workspace_id=self.ws, name="L")
        Lead.objects.update(created_at=self.mid)
        data = weekly.personal_data(self.owner_member.__class__.objects.get(pk=self.eve.member_id), self.week)
        self.assertEqual(data["totals"]["views"], 7)
        self.assertEqual(data["prev"]["views"], 3)
        self.assertEqual(data["changes"]["views"], 133)
        self.assertEqual(data["totals"]["scans"], 1)
        self.assertEqual(data["top_link"]["kind"], "Phone")
        self.assertEqual(data["totals"]["leads"], 1)

    def test_company_report_lists_top_people_status_unassigned_and_approvals(self):
        for _ in range(5):
            self.event()
        for _ in range(2):
            self.event(card=Card.objects.get(pk=self.sam.card_id))
        # The report counts the contacts its reader may see: the company card's, never an employee's.
        company = Card.objects.get(pk=self.owner.client.post(f"{API}workspaces/{self.ws}/company-card").data["id"])
        for status in ("new", "new", "won"):
            Lead.objects.create(card=company, workspace_id=self.ws, name="L", status=status)
        Lead.objects.create(card=self.card, workspace_id=self.ws, name="Employee private", status="new")
        ChangeRequest.objects.create(workspace_id=self.ws, card=self.card, field="title", new_value="x", status="pending")
        data = weekly.company_data(self.owner_member, self.week)
        self.assertEqual([p["name"] for p in data["top_people"]], ["Eve Employee", "Sam Seller"])
        self.assertEqual(data["leads_by_status"]["new"], 2)
        self.assertEqual(data["unassigned_leads"], 2)
        self.assertEqual(data["pending_approvals"], 1)
        subject, text, html, _ = weekly.build(self.owner_member, "company", self.week)
        for needle in ("Top people", "Eve Employee", "Leads by status", "Assign 2 open leads", "Review 1 change"):
            self.assertIn(needle, html)
        self.assertIn("Open leads nobody owns yet: 2", text)

    def test_html_is_escaped(self):
        from workspaces.models import Member
        Member.objects.filter(pk=self.eve.member_id).update(full_name="<script>alert(1)</script>")
        self.event()
        html = weekly.build(self.owner_member, "company", self.week)[2]
        self.assertNotIn("<script>", html)
        self.assertIn("&lt;script&gt;", html)

    def test_brand_look(self):
        self.event()
        html = weekly.build(self.owner_member, "company", self.week)[2]
        self.assertIn("#FF6B35", html)
        self.assertIn("Poppins", html)
        self.assertIn("/brand/bench-logo.png", html)

    def test_iso_week_helpers(self):
        w = weekly.parse_week("2026-W46")
        self.assertEqual(w.window.start_date.isoformat(), "2026-11-09")
        self.assertEqual(w.window.end_date.isoformat(), "2026-11-15")
        self.assertEqual((w.year, w.week), (2026, 46))
        with self.assertRaises(ValueError):
            weekly.parse_week("2026-46")
        last = weekly.last_full_week(timezone.now().replace(year=2026, month=11, day=22))
        self.assertEqual(last.window.start_date.isoformat(), "2026-11-09")


class PreferenceAndPreviewTests(ReportCase):
    def test_defaults_and_changes(self):
        res = self.eve.client.get(self.url("report-preferences"))
        self.assertEqual(res.data, {"personal_report": True, "company_report": None, "can_company_report": False})
        res = self.owner.client.get(self.url("report-preferences"))
        self.assertEqual((res.data["personal_report"], res.data["company_report"]), (True, True))
        res = self.owner.client.patch(self.url("report-preferences"), {"company_report": False, "personal_report": False}, format="json")
        self.assertEqual((res.data["personal_report"], res.data["company_report"]), (False, False))
        self.assertEqual(self.eve.client.patch(self.url("report-preferences"), {"company_report": False}, format="json").status_code, 403)
        self.assertEqual(self.owner.client.patch(self.url("report-preferences"), {"personal_report": "no"}, format="json").status_code, 400)

    def test_preview(self):
        self.event()
        res = self.eve.client.get(self.url("reports/weekly/preview"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn("<html", res.data["html"])
        self.assertNotIn("reports/unsubscribe", res.data["html"])
        self.assertEqual(res.data["week"]["week"], self.week.week)
        self.assertFalse(res.data["week"]["partial"])
        res = self.owner.client.get(self.url("reports/weekly/preview"), {"kind": "company", "week": "current"})
        self.assertTrue(res.data["week"]["partial"])
        self.assertEqual(self.eve.client.get(self.url("reports/weekly/preview"), {"kind": "company"}).status_code, 403)
        self.assertEqual(self.eve.client.get(self.url("reports/weekly/preview"), {"kind": "x"}).status_code, 400)

    def test_preview_sends_nothing(self):
        mail.outbox.clear()
        self.owner.client.get(self.url("reports/weekly/preview"))
        self.assertEqual(mail.outbox, [])


class UnsubscribeTests(ReportCase):
    def token(self, kind="personal"):
        user = self.owner_member.user
        return weekly.unsubscribe_token(user.id, self.ws, kind)

    def test_link_switches_the_report_off_without_signing_in(self):
        res = APIClient().get(f"{API}reports/unsubscribe", {"token": self.token()})
        self.assertEqual(res.status_code, 200)
        self.assertIn("You are unsubscribed", res.content.decode())
        pref = ReportPreference.objects.get(user=self.owner_member.user, workspace_id=self.ws)
        self.assertFalse(pref.personal_report)
        self.assertTrue(pref.company_report)

    def test_company_kind_only_turns_off_the_company_report(self):
        APIClient().get(f"{API}reports/unsubscribe", {"token": self.token("company")})
        pref = ReportPreference.objects.get(user=self.owner_member.user, workspace_id=self.ws)
        self.assertTrue(pref.personal_report)
        self.assertFalse(pref.company_report)

    def test_one_click_post_and_undo(self):
        client = APIClient()
        res = client.post(f"{API}reports/unsubscribe?token={self.token()}", {"List-Unsubscribe": "One-Click"}, format="multipart")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(ReportPreference.objects.get(user=self.owner_member.user).personal_report)
        res = client.post(f"{API}reports/unsubscribe", {"token": self.token(), "resubscribe": "1"})
        self.assertIn("Welcome back", res.content.decode())
        self.assertTrue(ReportPreference.objects.get(user=self.owner_member.user).personal_report)

    def test_bad_tokens(self):
        for token in ("", "garbage", self.token() + "x"):
            res = APIClient().get(f"{API}reports/unsubscribe", {"token": token})
            self.assertIn("not valid", res.content.decode())
        self.assertEqual(ReportPreference.objects.count(), 0)

    def test_unsubscribed_person_gets_no_more_mail(self):
        self.event()
        APIClient().get(f"{API}reports/unsubscribe", {"token": self.token("company")})
        mail.outbox.clear()
        self.run_cmd()
        self.assertEqual(self.to(), ["eve@example.com"])
