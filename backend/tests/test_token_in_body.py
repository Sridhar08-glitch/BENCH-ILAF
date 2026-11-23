"""Link tokens can travel in a request body, and log lines never show them."""
import logging
from io import StringIO
from unittest import mock

from django.core import mail
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from ilaf.logfilters import MaskSecrets, mask
from workspaces.models import Member

from .base import API, ApiTestCase
from .ops_base import OpsTestCase


class InviteBodyTokenTests(OpsTestCase):
    def test_lookup_and_accept_with_the_token_in_the_body(self):
        invited = self.invited("late@example.com", "Late Comer")
        anon = APIClient()
        res = anon.post(f"{API}invites/lookup", {"token": invited.token}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["email"], "late@example.com")
        self.assertEqual(anon.post(f"{API}invites/lookup", {"token": "nope"}, format="json").status_code, 410)
        self.assertEqual(anon.post(f"{API}invites/lookup", {}, format="json").status_code, 410)
        res = anon.post(f"{API}invites/accept", {"token": invited.token, "password": "employee-pass-1", "full_name": "Late"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(Member.objects.get(pk=invited.member_id).status, "active")
        self.assertTrue(res.data["access"])

    def test_the_old_url_forms_still_work(self):
        invited = self.invited("late@example.com", "Late Comer")
        anon = APIClient()
        self.assertEqual(anon.get(f"{API}invites/{invited.token}").status_code, 200)
        self.assertEqual(anon.post(f"{API}invites/{invited.token}/accept", {"password": "employee-pass-1"}, format="json").status_code, 200)

    def test_a_body_token_is_refused_when_wrong_or_used(self):
        invited = self.invited("late@example.com", "Late Comer")
        anon = APIClient()
        self.assertEqual(anon.post(f"{API}invites/accept", {"token": "x" * 40, "password": "employee-pass-1"}, format="json").status_code, 410)
        anon.post(f"{API}invites/accept", {"token": invited.token, "password": "employee-pass-1"}, format="json")
        self.assertEqual(anon.post(f"{API}invites/lookup", {"token": invited.token}, format="json").status_code, 410)


class DownloadBodyTokenTests(ApiTestCase):
    def export_token(self):
        person = self.signup("a@example.com")
        res = person.client.post(API + "privacy/export", {}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        body = [m for m in mail.outbox if "/data-download/" in m.body][-1].body
        return body.split("/data-download/")[1].split()[0]

    def test_check_and_download_with_the_token_in_the_body(self):
        token = self.export_token()
        anon = APIClient()
        res = anon.post(f"{API}privacy/download/check", {"token": token}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["valid"])
        res = anon.post(f"{API}privacy/download", {"token": token}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Cache-Control"], "no-store")
        b"".join(res.streaming_content)
        res.close()
        self.assertEqual(anon.post(f"{API}privacy/download/check", {"token": token}, format="json").status_code, 410)  # single use

    def test_bad_or_missing_body_token(self):
        anon = APIClient()
        for path in ("privacy/download/check", "privacy/download"):
            self.assertEqual(anon.post(f"{API}{path}", {"token": "bad"}, format="json").status_code, 410, path)
            self.assertEqual(anon.post(f"{API}{path}", {}, format="json").status_code, 410, path)


class MaskTests(SimpleTestCase):
    def test_paths_and_queries_are_masked(self):
        cases = {
            "Gone: /api/v1/invites/SECRETSECRETSECRETSECRETSECRETSECRET1234/accept": "Gone: /api/v1/invites/<token>/accept",
            "Gone: /api/v1/invites/SECRETSECRETSECRETSECRETSECRETSECRET1234": "Gone: /api/v1/invites/<token>",
            "Gone: /api/v1/privacy/download/AAAA:BBBB:CCCC/check": "Gone: /api/v1/privacy/download/<token>/check",
            "Gone: /api/v1/privacy/download/AAAA:BBBB:CCCC": "Gone: /api/v1/privacy/download/<token>",
            "GET /api/v1/reports/unsubscribe?token=abc.def&x=1": "GET /api/v1/reports/unsubscribe?token=<hidden>&x=1",
            "GET /reset/abcdefghijklmnopqrstuv": "GET /reset/<token>",
            "GET /join/abcdefghijklmnopqrstuv?next=/app": "GET /join/<token>?next=/app",
        }
        for raw, expected in cases.items():
            self.assertEqual(mask(raw), expected)

    def test_new_body_routes_are_left_readable(self):
        for path in ("/api/v1/invites/lookup", "/api/v1/invites/accept", "/api/v1/invites/accept-google", "/api/v1/privacy/download/check"):
            self.assertEqual(mask(f"Bad Request: {path}"), f"Bad Request: {path}")

    def test_filter_rewrites_formatted_records(self):
        record = logging.LogRecord("django.request", logging.WARNING, "x", 1, "Gone: %s", ("/api/v1/invites/%s" % ("T" * 43),), None)
        MaskSecrets().filter(record)
        self.assertEqual(record.getMessage(), "Gone: /api/v1/invites/<token>")

    def test_the_configured_handler_masks_real_log_output(self):
        from django.conf import settings

        self.assertIn("mask_secrets", settings.LOGGING["handlers"]["console"]["filters"])
        stream = StringIO()
        handler = logging.StreamHandler(stream)
        handler.addFilter(MaskSecrets())
        logger = logging.getLogger("django.request.test_mask")
        logger.addHandler(handler)
        logger.propagate = False
        logger.warning("Gone: /api/v1/invites/%s/accept", "S" * 43)
        logger.removeHandler(handler)
        self.assertNotIn("S" * 10, stream.getvalue())
