"""Back office: card reports (public form and staff queue), data requests and applications."""
from datetime import timedelta

from django.core import mail
from django.test import override_settings
from django.utils import timezone

from cards.models import Card
from privacy.models import DataRequest
from staff.models import AbuseReport, CompanyLead
from workspaces.models import Workspace

from .base import API, BIG_RATES
from .bo_base import BackOfficeCase


class PublicReportTests(BackOfficeCase):
    def report(self, key=None, **body):
        body = {"reason": "spam", **body}
        return self.client_for().post(f"{API}public/cards/{key or self.card['public_code']}/report", body, format="json")

    def test_a_visitor_reports_a_card(self):
        res = self.report(note="Sells pills", email="visitor@mail.test")
        self.assertEqual(res.status_code, 201)
        row = AbuseReport.objects.get()
        self.assertEqual((row.reason, row.status, row.card_name, str(row.workspace_id)), ("spam", "new", "Alice Anderson", self.ws))
        self.assertEqual(row.reporter_email, "visitor@mail.test")
        self.assertAlmostEqual((row.due_at - row.created_at).total_seconds(), 48 * 3600, delta=5)
        self.assertEqual(len(row.reporter_hash), 32)

    def test_the_reason_must_be_one_of_the_five(self):
        self.assertEqual(self.report(reason="rude").status_code, 400)
        self.assertEqual(self.report(email="not an email").status_code, 400)

    def test_the_honeypot_looks_like_success_and_stores_nothing(self):
        res = self.report(website="http://spam.test")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(AbuseReport.objects.count(), 0)

    def test_the_same_visitor_twice_in_a_day_makes_one_report(self):
        self.report()
        self.report(reason="fake")
        self.assertEqual(AbuseReport.objects.count(), 1)

    def test_unknown_and_draft_cards_are_not_found(self):
        self.assertEqual(self.report(key="zzzzzzzz").status_code, 404)
        Card.objects.filter(pk=self.card["id"]).update(status="draft")
        self.assertEqual(self.report().status_code, 404)

    def test_the_form_is_rate_limited(self):
        with override_settings(ILAF_THROTTLE_RATES={**BIG_RATES, "public_report": "2/hour"}):
            codes = [self.report(email=f"v{i}@mail.test").status_code for i in range(3)]
        self.assertEqual(codes, [201, 201, 429])


class AbuseQueueTests(BackOfficeCase):
    def setUp(self):
        super().setUp()
        self.client_for().post(f"{API}public/cards/{self.card['public_code']}/report", {"reason": "impersonation", "note": "Pretends to be our CEO"}, format="json")
        self.report = AbuseReport.objects.get()

    def act(self, person, action, note="", rid=None, **extra):
        return person.client.post(self.url(f"abuse/{rid or self.report.id}/action"), {"action": action, "note": note, **extra}, format="json")

    def test_the_queue_shows_sla_and_counts(self):
        res = self.ro.client.get(self.url("abuse"))
        row = res.data["results"][0]
        self.assertEqual(row["sla"]["state"], "ok")
        self.assertGreater(row["sla"]["minutes_left"], 47 * 60)
        self.assertEqual(res.data["counts"]["new"], 1)
        AbuseReport.objects.update(due_at=timezone.now() - timedelta(hours=1))
        late = self.ro.client.get(self.url("abuse"), {"late": "1"}).data
        self.assertEqual((late["count"], late["results"][0]["sla"]["state"]), (1, "late"))

    def test_detail_has_the_card_preview_data_and_related_reports(self):
        res = self.ro.client.get(self.url(f"abuse/{self.report.id}"))
        self.assertEqual(res.data["card"]["public_code"], self.card["public_code"])
        self.assertIn("design", res.data["card"])
        self.assertEqual(res.data["related"], [])
        self.client_for().post(f"{API}public/cards/{self.card['public_code']}/report", {"reason": "fake"}, format="json", REMOTE_ADDR="198.51.100.9")
        self.assertEqual(len(self.ro.client.get(self.url(f"abuse/{self.report.id}")).data["related"]), 1)

    def test_dismiss_and_notes(self):
        self.assertEqual(self.act(self.support, "note", "Checked the profile").status_code, 200)
        res = self.act(self.support, "dismiss")
        self.assertEqual(res.data["status"], "dismissed")
        self.report.refresh_from_db()
        self.assertEqual([h["kind"] for h in self.report.history], ["note", "status"])
        self.assertIsNotNone(self.report.resolved_at)
        self.assertEqual(self.ro.client.get(self.url("abuse")).data["count"], 0)

    def test_warn_owner_sends_an_email_in_their_language(self):
        owner = self.user_of("owner@acme.test")
        owner.language = "ar"
        owner.save()
        res = self.act(self.support, "warn")
        self.assertEqual(res.data["outcome"], "warned")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["owner@acme.test"])
        self.assertRegex(mail.outbox[0].subject, "[؀-ۿ]")

    def test_warn_owner_in_english(self):
        self.act(self.support, "warn")
        self.assertEqual(mail.outbox[0].subject, "A visitor reported your card")

    def test_suspend_card_from_a_report(self):
        res = self.act(self.support, "suspend_card")
        self.assertEqual(res.data["outcome"], "card_suspended")
        card = Card.objects.get(pk=self.card["id"])
        self.assertEqual((card.status, card.staff_hold), ("suspended", True))

    def test_suspend_company_is_admin_only(self):
        self.assertEqual(self.act(self.support, "suspend_company", confirm_name="Acme Ltd").status_code, 403)
        self.assertIsNone(Workspace.objects.get(pk=self.ws).suspended_at)
        self.assertEqual(self.act(self.admin, "suspend_company", confirm_name="Acme Ltd").status_code, 200)
        self.assertIsNotNone(Workspace.objects.get(pk=self.ws).suspended_at)

    def test_suspend_company_needs_the_typed_name(self):
        for wrong in ("", "Acme", "Other Ltd"):
            res = self.act(self.admin, "suspend_company", confirm_name=wrong)
            self.assertEqual(res.status_code, 400, wrong)
        self.assertIsNone(Workspace.objects.get(pk=self.ws).suspended_at)
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, "new")
        self.assertEqual(self.act(self.admin, "suspend_company", confirm_name="  acme ltd ").status_code, 200)

    def test_read_only_cannot_triage(self):
        self.assertEqual(self.act(self.ro, "dismiss").status_code, 403)
        self.assertEqual(self.ro.client.post(self.url("abuse/bulk"), {"ids": [str(self.report.id)], "action": "dismiss"}, format="json").status_code, 403)

    def test_bulk_dismiss_and_assign(self):
        res = self.support.client.post(self.url("abuse/bulk"), {"ids": [str(self.report.id), "00000000-0000-0000-0000-000000000000"], "action": "assign"}, format="json")
        ok = [r["ok"] for r in res.data["results"]]
        self.assertEqual(ok, [True, False])
        self.report.refresh_from_db()
        self.assertEqual((self.report.status, self.report.assignee.email), ("reviewing", "support@ilaf.test"))
        self.support.client.post(self.url("abuse/bulk"), {"ids": [str(self.report.id)], "action": "dismiss"}, format="json")
        self.report.refresh_from_db()
        self.assertEqual(self.report.status, "dismissed")

    def test_unknown_action_and_unknown_assignee_are_refused(self):
        self.assertEqual(self.act(self.support, "explode").status_code, 400)
        res = self.support.client.post(self.url(f"abuse/{self.report.id}/action"), {"action": "assign", "assignee": str(self.user_of("owner@acme.test").id)}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_every_action_is_in_the_audit_log(self):
        self.act(self.support, "reviewing")
        self.act(self.support, "dismiss")
        self.assertEqual([a for a in self.audit_actions() if a.startswith("abuse.")], ["abuse.reviewing", "abuse.dismiss"])


class DataRequestTests(BackOfficeCase):
    def make(self, **kw):
        user = self.user_of("owner@acme.test")
        base = {"kind": "export", "scope": "user", "user": user, "status": "pending", "due_at": timezone.now() + timedelta(days=10)}
        base.update(kw)
        return DataRequest.objects.create(**base)

    def act(self, person, dr, **body):
        return person.client.post(self.url(f"data-requests/{dr.id}/action"), body, format="json")

    def test_list_has_a_countdown_and_flags_overdue(self):
        late = self.make(due_at=timezone.now() - timedelta(days=2))
        fine = self.make()
        rows = {r["id"]: r for r in self.ro.client.get(self.url("data-requests")).data["results"]}
        self.assertTrue(rows[str(late.id)]["overdue"])
        self.assertLess(rows[str(late.id)]["days_left"], 0)
        self.assertFalse(rows[str(fine.id)]["overdue"])
        self.assertEqual(rows[str(fine.id)]["days_left"], 9)
        self.assertEqual(self.ro.client.get(self.url("data-requests")).data["overdue"], 1)

    def test_start_export_builds_the_file(self):
        dr = self.make()
        res = self.support.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "start_export"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        dr.refresh_from_db()
        self.assertEqual(dr.status, "ready")
        self.assertEqual(dr.handled_by.email, "support@ilaf.test")

    def test_mark_done_records_who_and_a_note(self):
        dr = self.make()
        res = self.admin.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "mark_done", "note": "Sent by hand"}, format="json")
        self.assertEqual(res.data["status"], "completed")
        self.assertEqual(res.data["note"], "Sent by hand")
        self.assertEqual(self.admin.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "mark_done"}, format="json").status_code, 409)

    def test_delete_needs_the_typed_confirmation(self):
        user = self.make_staff("gone@person.test", "read_only", verified=False).user
        dr = self.make(kind="delete", user=user, scheduled_for=timezone.now() + timedelta(days=5))
        bad = self.support.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "confirm_delete", "typed": "wrong"}, format="json")
        self.assertEqual(bad.status_code, 400)
        dr.refresh_from_db()
        self.assertEqual(dr.status, "pending")
        ok = self.support.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "confirm_delete", "typed": "GONE@person.test"}, format="json")
        self.assertEqual(ok.status_code, 200, ok.content)
        self.assertEqual(ok.data["status"], "completed")
        user.refresh_from_db()
        self.assertTrue(user.deleted_at is not None or not user.is_active)

    def test_deleting_a_company_needs_the_extra_confirmation(self):
        dr = self.make(kind="delete", scope="workspace", workspace_id=self.ws, scheduled_for=timezone.now() + timedelta(days=5))
        typed = self.support.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "confirm_delete", "typed": "acme ltd"}, format="json")
        self.assertEqual(typed.status_code, 400)
        self.assertIn("ack_company", typed.json()["error"]["fields"])
        self.assertTrue(Workspace.objects.filter(pk=self.ws, deleted_at__isnull=True).exists())
        done = self.support.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "confirm_delete", "typed": "Acme Ltd", "ack_company": True}, format="json")
        self.assertEqual(done.status_code, 200, done.content)
        self.assertFalse(Workspace.objects.filter(pk=self.ws, deleted_at__isnull=True).exists())

    def test_read_only_cannot_act(self):
        dr = self.make()
        self.assertEqual(self.act(self.ro, dr, action="mark_done").status_code, 403)
        self.assertEqual(self.act(self.support, dr, action="nonsense").status_code, 400)


class ApplicationTests(BackOfficeCase):
    def apply(self, **body):
        data = {"company": "Delta Ltd", "name": "Dana", "email": "dana@delta.test", "size": "6-20", "message": "Hello", **body}
        return self.client_for().post(f"{API}public/company-leads", data, format="json", HTTP_X_LANGUAGE="ar")

    def test_the_public_form_creates_an_application(self):
        self.assertEqual(self.apply().status_code, 201)
        row = CompanyLead.objects.get()
        self.assertEqual((row.company, row.status, row.size, row.language, row.source), ("Delta Ltd", "new", "6-20", "ar", "website"))

    def test_bad_input_honeypot_and_repeat(self):
        self.assertEqual(self.apply(email="nope").status_code, 400)
        self.assertEqual(self.apply(company="").status_code, 400)
        self.assertEqual(self.apply(size="9999").status_code, 400)
        self.assertEqual(self.apply(website="http://spam").status_code, 201)
        self.assertEqual(CompanyLead.objects.count(), 0)
        self.apply()
        self.apply()
        self.assertEqual(CompanyLead.objects.count(), 1)

    def test_the_team_is_told_when_addresses_are_set(self):
        with override_settings(STAFF_NOTIFY_EMAILS=["team@bench.test"]):
            self.apply()
        self.assertEqual(mail.outbox[0].to, ["team@bench.test"])

    def test_the_board_moves_an_application_through_the_pipeline(self):
        self.apply()
        row = CompanyLead.objects.get()
        res = self.support.client.patch(self.url(f"applications/{row.id}"), {"status": "contacted", "note": "Emailed them", "assignee": str(self.user_of("support@ilaf.test").id)}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["status"], res.data["assignee"], res.data["notes"][0]["text"]), ("contacted", "support@ilaf.test", "Emailed them"))
        board = self.ro.client.get(self.url("applications")).data
        self.assertEqual((board["counts"]["contacted"], board["counts"]["new"], board["design_requests_open"]), (1, 0, 0))
        self.assertEqual(self.support.client.patch(self.url(f"applications/{row.id}"), {"status": "weird"}, format="json").status_code, 400)
        self.assertEqual(self.ro.client.patch(self.url(f"applications/{row.id}"), {"status": "won"}, format="json").status_code, 403)

    def test_design_requests_open_count_is_shown(self):
        self.new_request(self.owner)
        self.assertEqual(self.ro.client.get(self.url("applications")).data["design_requests_open"], 1)
