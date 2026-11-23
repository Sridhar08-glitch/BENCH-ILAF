"""Back office: request metrics, the error list, the e-mail log, scheduled-job markers, storage, the overview and staff people."""
import logging
import os
import tempfile
import time
from datetime import timedelta
from unittest import mock as umock

from django.core import mail
from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from ilaf.emails import send_brand_email
from staff import errorlog, metrics, ops_services
from staff.models import EmailLog, ErrorLogEntry, RequestMetric, StaffSession

from .base import API
from .bo_base import BackOfficeCase


class MetricsTests(BackOfficeCase):
    def setUp(self):
        super().setUp()
        metrics.reset()
        RequestMetric.objects.all().delete()

    def test_the_middleware_counts_requests_and_errors_per_minute(self):
        now = timezone.now()
        for ms, status in ((20, 200), (40, 200), (300, 200), (4000, 500)):
            metrics.record(status, ms, now)
        metrics.flush()
        row = RequestMetric.objects.get()
        self.assertEqual((row.requests, row.server_errors), (4, 1))
        self.assertEqual(row.buckets, {"50": 2, "500": 1, "5000": 1})

    def test_a_new_minute_writes_the_finished_one(self):
        now = timezone.now().replace(second=5, microsecond=0)
        metrics.record(200, 10, now)
        metrics.record(200, 10, now + timedelta(minutes=1))
        self.assertEqual(RequestMetric.objects.count(), 1)
        metrics.flush()
        self.assertEqual(RequestMetric.objects.count(), 2)

    def test_p95_and_summary(self):
        self.assertIsNone(metrics.percentile({}))
        self.assertEqual(metrics.percentile({"50": 90, "100": 4, "2500": 6}), 2500)
        self.assertEqual(metrics.percentile({"50": 100}), 50)
        now = timezone.now()
        for _ in range(19):
            metrics.record(200, 30, now)
        metrics.record(200, 900, now)
        summary = metrics.summary(10)
        self.assertEqual((summary["requests"], summary["p95_ms"]), (20, 50))

    def test_old_rows_are_pruned_when_a_minute_is_written(self):
        old = timezone.now() - timedelta(days=9)
        RequestMetric.objects.create(minute=old.replace(second=0, microsecond=0), requests=1)
        metrics.record(200, 5, timezone.now())
        metrics.flush()
        self.assertFalse(RequestMetric.objects.filter(minute__lt=timezone.now() - timedelta(days=8)).exists())

    def test_real_requests_are_counted(self):
        self.admin.client.get(self.url("overview"))
        self.assertGreaterEqual(metrics.summary(10)["requests"], 1)

    def test_series_has_one_point_per_hour(self):
        metrics.record(200, 10, timezone.now())
        metrics.flush()
        points = metrics.series(24)
        self.assertEqual(len(points), 24)
        self.assertEqual(points[-1]["requests"], 1)


class ErrorLogTests(SimpleTestCase):
    def test_scrub_removes_personal_details(self):
        text = errorlog.scrub("Failed for hannah@mailbox.test token abcdefghijklmnopqrstuvwxyz123456 card 1234567 id 123e4567-e89b-12d3-a456-426614174000")
        self.assertNotIn("hannah", text)
        self.assertNotIn("abcdefghijklmnop", text)
        self.assertNotIn("1234567", text)
        self.assertNotIn("123e4567", text)
        self.assertEqual(errorlog.scrub_path("/api/v1/cards/123e4567-e89b-12d3-a456-426614174000/x?secret=1"), "/api/v1/cards/{id}/x")


class ErrorListTests(BackOfficeCase):
    def test_an_error_is_stored_scrubbed_and_listed(self):
        logging.getLogger("tests.errors").error("Boom for hannah@mailbox.test")
        row = ErrorLogEntry.objects.get()
        self.assertEqual(row.message, "Boom for [email]")
        self.assertEqual(len(row.trace_hash), 16)
        res = self.ro.client.get(self.url("system/errors"))
        self.assertEqual(res.data["results"][0]["message"], "Boom for [email]")
        self.assertEqual(res.data["groups"][0]["n"], 1)

    def test_only_the_newest_rows_are_kept(self):
        for i in range(8):
            ErrorLogEntry.objects.create(message=f"m{i}", trace_hash="x" * 16)
        errorlog.prune(keep=3)
        self.assertEqual(sorted(ErrorLogEntry.objects.values_list("message", flat=True)), ["m5", "m6", "m7"])

    def test_warnings_are_not_stored(self):
        logging.getLogger("tests.errors").warning("just a warning")
        self.assertEqual(ErrorLogEntry.objects.count(), 0)

    def test_a_trace_gives_the_same_fingerprint_every_time(self):
        hashes = set()
        for _ in range(2):
            try:
                raise ValueError("x")
            except ValueError:
                logging.getLogger("tests.errors").exception("same place")
        hashes = set(ErrorLogEntry.objects.values_list("trace_hash", flat=True))
        self.assertEqual(len(hashes), 1)


class EmailLogTests(BackOfficeCase):
    def test_a_sent_mail_is_logged_without_its_body(self):
        send_brand_email("a@b.test", "Hello", "Hi", ["text"], lang="en")
        row = EmailLog.objects.get()
        self.assertEqual((row.status, row.to_email, row.subject, row.kind, row.retry_text), ("sent", "a@b.test", "Hello", "transactional", ""))

    def test_a_failed_mail_keeps_its_body_and_can_be_resent(self):
        with umock.patch("django.core.mail.message.EmailMessage.send", side_effect=OSError("smtp down")):
            send_brand_email("a@b.test", "Hello", "Hi", ["some text"], lang="en")
        row = EmailLog.objects.get()
        self.assertEqual(row.status, "failed")
        self.assertIn("smtp down", row.error)
        self.assertIn("some text", row.retry_text)
        self.assertEqual(mail.outbox, [])
        listing = self.ro.client.get(self.url("system/email")).data
        self.assertEqual(listing["results"][0]["can_resend"], True)
        self.assertEqual(self.ro.client.post(self.url(f"system/email/{row.id}/resend")).status_code, 403)
        res = self.support.client.post(self.url(f"system/email/{row.id}/resend"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["a@b.test"])
        row.refresh_from_db()
        self.assertEqual((row.status, row.retry_text), ("resent", ""))
        self.assertIn("email.resent", self.audit_actions())

    def test_a_failed_resend_says_so(self):
        with umock.patch("django.core.mail.message.EmailMessage.send", side_effect=OSError("smtp down")):
            send_brand_email("a@b.test", "Hello", "Hi", ["x"], lang="en")
            row = EmailLog.objects.get()
            res = self.support.client.post(self.url(f"system/email/{row.id}/resend"))
        self.assertEqual((res.status_code, res.json()["error"]["code"]), (502, "resend_failed"))

    def test_counts_and_days(self):
        send_brand_email("a@b.test", "One", "Hi", ["x"], lang="en")
        res = self.ro.client.get(self.url("system/email")).data
        self.assertEqual(res["last_24h"]["sent"], 1)
        self.assertEqual(len(res["days"]), 7)
        self.assertEqual(res["days"][-1]["sent"], 1)

    def test_prune_drops_old_bodies_and_rows(self):
        old = EmailLog.objects.create(to_email="a@b.test", subject="s", status="failed", retry_text="body")
        EmailLog.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=20))
        ancient = EmailLog.objects.create(to_email="a@b.test", subject="s")
        EmailLog.objects.filter(pk=ancient.pk).update(created_at=timezone.now() - timedelta(days=120))
        ops_services.prune_back_office()
        self.assertEqual(EmailLog.objects.get().retry_text, "")


class JobMarkerTests(BackOfficeCase):
    def test_states_come_from_the_markers_run_job_leaves(self):
        with tempfile.TemporaryDirectory() as state, override_settings(BENCH_STATE_DIR=state):
            now = time.time()
            for name, age_minutes in (("deliver_webhooks", 2), ("sync_crm", 600)):
                path = os.path.join(state, f"ok-{name}")
                open(path, "w").close()
                os.utime(path, (now - age_minutes * 60, now - age_minutes * 60))
            open(os.path.join(state, "ok-support_tick"), "w").close()
            with open(os.path.join(state, "fail-support_tick"), "w") as f:
                f.write("2026-11-22T10:00:00Z support_tick rc=1 Traceback")
            with open(os.path.join(state, "last-deliver_webhooks"), "w") as f:
                f.write(f"{int(now)} 0 7")
            rows = {j["name"]: j for j in ops_services.job_states(now)}
            self.assertEqual(rows["deliver_webhooks"]["state"], "ok")
            self.assertEqual(rows["deliver_webhooks"]["duration_s"], 7)
            self.assertEqual(rows["sync_crm"]["state"], "late")
            self.assertEqual(rows["support_tick"]["state"], "failed")
            self.assertIn("Traceback", rows["support_tick"]["note"])
            self.assertEqual(rows["send_weekly_reports"]["state"], "late")
            res = self.ro.client.get(self.url("system/jobs")).data
            self.assertTrue(res["state_dir_found"])
            self.assertEqual(next(j for j in res["jobs"] if j["name"] == "support_tick")["state"], "failed")

    def test_without_a_state_folder_the_jobs_are_unknown_not_failed(self):
        with override_settings(BENCH_STATE_DIR="/definitely/not/here"):
            self.assertTrue(all(j["state"] == "unknown" for j in ops_services.job_states()))
            self.assertFalse(self.ro.client.get(self.url("system/jobs")).data["state_dir_found"])

    def test_the_deploy_scripts_know_the_new_jobs(self):
        from pathlib import Path

        deploy = Path(__file__).resolve().parent.parent.parent / "deploy"
        cron = (deploy / "cron" / "bench-cron").read_text(encoding="utf-8")
        check = (deploy / "check_bench.sh").read_text(encoding="utf-8")
        run = (deploy / "run_job.sh").read_text(encoding="utf-8")
        for job in ("send_announcements", "expire_support_views", "prune_back_office"):
            self.assertIn(f"$J {job} {job}", cron)
            self.assertIn(f"{job}:", check)
        self.assertIn("last-$NAME", run)
        every_job = [name for name, *_ in ops_services.JOBS]
        for name in every_job:
            self.assertIn(name, cron, name)


class OverviewTests(BackOfficeCase):
    def test_the_overview_has_every_block(self):
        res = self.ro.client.get(self.url("overview"))
        self.assertEqual(res.status_code, 200)
        data = res.data
        self.assertTrue(data["health"]["api_up"] and data["health"]["db_ok"])
        self.assertEqual(data["numbers"]["companies"], 1)
        self.assertEqual(data["numbers"]["active_cards"], 1)
        self.assertEqual(data["numbers"]["new_companies_week"], 1)
        self.assertEqual(data["numbers"]["open_reports"], 0)
        self.assertEqual(len(data["growth"]), 12)
        self.assertEqual(data["growth"][-1]["n"], 1)
        self.assertGreaterEqual(len(data["jobs"]), 10)
        self.assertIn("sent", data["email"])
        self.assertIsNotNone(data["numbers"]["open_support_tickets"])

    def test_attention_lists_what_is_late(self):
        from datetime import timedelta as td

        from staff.models import AbuseReport

        AbuseReport.objects.create(reason="spam", due_at=timezone.now() - td(hours=3), workspace_id=self.ws)
        kinds = [a["kind"] for a in self.ro.client.get(self.url("overview")).data["attention"]]
        self.assertIn("reports_late", kinds)
        self.assertEqual(self.ro.client.get(self.url("overview")).data["numbers"]["open_reports"], 1)

    def test_storage_sizes_are_numbers(self):
        res = self.ro.client.get(self.url("system/health")).data["storage"]
        self.assertGreaterEqual(res["media_bytes"], 0)
        self.assertGreaterEqual(res["private_bytes"], 0)
        self.assertTrue(res["database_bytes"] is None or res["database_bytes"] > 0)


class StaffPeopleTests(BackOfficeCase):
    def test_the_table_shows_role_second_step_and_sessions(self):
        res = self.admin.client.get(self.url("team")).data
        by_email = {p["email"]: p for p in res["people"]}
        self.assertEqual(set(by_email), {"admin@ilaf.test", "support@ilaf.test", "ro@ilaf.test"})
        self.assertTrue(by_email["support@ilaf.test"]["totp_enrolled"])
        self.assertEqual(by_email["support@ilaf.test"]["staff_role"], "support")
        self.assertEqual(len(by_email["support@ilaf.test"]["sessions"]), 1)
        self.assertEqual(by_email["support@ilaf.test"]["recovery_codes_left"], 10)

    def test_invite_an_existing_account_gives_the_role(self):
        res = self.admin.client.post(self.url("team"), {"email": "OWNER@acme.test", "role": "read_only"}, format="json")
        self.assertEqual((res.status_code, res.data["granted"]), (201, True))
        self.assertEqual(self.user_of("owner@acme.test").staff_role, "read_only")

    def test_invite_an_unknown_address_sends_an_email_in_its_language(self):
        res = self.admin.client.post(self.url("team"), {"email": "new@person.test", "role": "support"}, format="json")
        self.assertEqual((res.data["invited"], res.data["granted"]), (True, False))
        self.assertEqual(mail.outbox[0].to, ["new@person.test"])
        self.assertIn("staff.invited", self.audit_actions())
        self.assertEqual(self.admin.client.post(self.url("team"), {"email": "bad", "role": "support"}, format="json").status_code, 400)
        self.assertEqual(self.admin.client.post(self.url("team"), {"email": "x@y.test", "role": "root"}, format="json").status_code, 400)

    def test_admin_ends_all_sessions_of_one_person(self):
        res = self.admin.client.post(self.url(f"members/{self.support.user.id}/sessions/revoke"))
        self.assertEqual(res.data["revoked"], 1)
        self.assertEqual(self.support.client.get(self.url("overview")).status_code, 403)
        self.assertFalse(StaffSession.objects.filter(user=self.support.user, revoked_at__isnull=True).exists())
        self.assertEqual(self.support.client.post(self.url(f"members/{self.admin.user.id}/sessions/revoke")).status_code, 403)

    def test_the_last_admin_cannot_be_removed_or_lowered(self):
        res = self.admin.client.delete(self.url(f"members/{self.admin.user.id}"))
        self.assertEqual((res.status_code, res.json()["error"]["code"]), (409, "last_admin"))
        res = self.admin.client.patch(self.url(f"members/{self.admin.user.id}"), {"role": "support"}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_role_change_and_reset_are_admin_only_and_logged(self):
        self.assertEqual(self.support.client.patch(self.url(f"members/{self.ro.user.id}"), {"role": "admin"}, format="json").status_code, 403)
        self.assertEqual(self.admin.client.patch(self.url(f"members/{self.ro.user.id}"), {"role": "support"}, format="json").status_code, 200)
        self.assertEqual(self.support.client.post(self.url(f"members/{self.ro.user.id}/reset-totp")).status_code, 403)
        self.assertEqual(self.admin.client.post(self.url(f"members/{self.ro.user.id}/reset-totp")).status_code, 200)
        self.assertIn("staff.totp_reset", self.audit_actions())

    def test_removing_a_role_ends_their_staff_access(self):
        self.admin.client.delete(self.url(f"members/{self.ro.user.id}"))
        self.assertEqual(self.ro.client.get(self.url("overview")).status_code, 404)


class CustomerAreaStillWorksTests(BackOfficeCase):
    def test_customer_endpoints_are_unchanged_for_a_normal_company(self):
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}/cards").status_code, 200)
        self.assertEqual(self.client_for().get(f"{API}public/cards/{self.card['public_code']}").json()["state"], "live")
