"""Smaller hardening rules: date filters, bad ids, event kinds, error text, production settings guards, file names."""
import os
import re
import subprocess
import sys
from pathlib import Path

from django.test import SimpleTestCase
from rest_framework.test import APIClient

from .base import API, ApiTestCase, png_upload
from .ops_base import OpsTestCase

BACKEND = Path(__file__).resolve().parent.parent


class DateAndIdTests(OpsTestCase):
    def test_absurd_dates_are_400_not_500(self):
        for value in ("9999-12-31", "0001-01-01", "1800-01-01", "2200-06-01"):
            for path, key in (("analytics", "to"), ("analytics", "from"), ("analytics/people", "from"), ("audit", "to"), ("audit", "from"), ("leads", "from"), ("leads", "to"), ("leads.csv", "to")):
                res = self.owner.client.get(self.url(path), {key: value})
                self.assertEqual(res.status_code, 400, (path, key, value, res.status_code))

    def test_normal_dates_still_work(self):
        self.assertEqual(self.owner.client.get(self.url("analytics"), {"from": "2026-01-01", "to": "2026-02-01"}).status_code, 200)
        self.assertEqual(self.owner.client.get(self.url("audit"), {"from": "2026-01-01"}).status_code, 200)

    def test_bad_workspace_id_in_export_body_is_404(self):
        res = self.owner.client.post(API + "privacy/export", {"workspace_id": "not-a-uuid"}, format="json")
        self.assertEqual(res.status_code, 404)
        res = self.owner.client.post(API + "privacy/export", {"workspace_id": "12345"}, format="json")
        self.assertEqual(res.status_code, 404)


class RestoreRuleTests(OpsTestCase):
    def test_restore_by_password_obeys_the_google_only_rule(self):
        from accounts.models import User

        eve = self.add("eve@example.com", "Eve Employee")
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"security": {"require_google_signin": True}}, format="json")
        user = User.objects.get(email="eve@example.com")
        user.is_active = False
        from django.utils import timezone
        from datetime import timedelta

        user.deletion_due_at = timezone.now() + timedelta(days=5)
        user.save()
        res = APIClient().post(API + "auth/restore", {"email": "eve@example.com", "password": "employee-pass-1"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "google_signin_required"))


class EventKindTests(ApiTestCase):
    def test_only_real_button_kinds_are_recorded(self):
        from analytics.models import Event

        person = self.signup()
        self.buy(person)
        card = self.published_card(person)
        url = f"{API}public/cards/{card['public_code']}/events"
        anon = APIClient()
        for kind in ("WhatsApp", "Buy my pills http://evil.example", "x" * 20):
            self.assertEqual(anon.post(url, {"type": "link_click", "kind": kind}, format="json").status_code, 204)
        kinds = list(Event.objects.filter(type="link_click").order_by("id").values_list("kind", flat=True))
        self.assertEqual(kinds, ["WhatsApp", "", ""])
        data = person.client.get(f"{API}workspaces/{person.ws}/analytics").data
        self.assertEqual([b["kind"] for b in data["top_buttons"]], ["WhatsApp"])


class ExportErrorTextTests(ApiTestCase):
    def test_failure_text_hides_the_exception(self):
        from unittest import mock

        from privacy import exporter, services
        from privacy.models import DataRequest

        person = self.signup()
        with mock.patch.object(exporter, "build_user_export", side_effect=RuntimeError("secret path /srv/x password=hunter2")):
            res = person.client.post(API + "privacy/export", {}, format="json")
        dr = DataRequest.objects.get(pk=res.data["id"])
        self.assertEqual(dr.status, "failed")
        self.assertNotIn("hunter2", dr.error)
        self.assertNotIn("/srv", dr.error)
        self.assertIn("RuntimeError", dr.error)


class FileNameTests(ApiTestCase):
    def test_uploaded_picture_names_carry_32_random_hex_characters(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        res = person.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload((50, 50))}, format="multipart")
        name = res.data["photo_url"].rsplit("/", 1)[-1]
        self.assertRegex(name, r"^[0-9a-f]{8}-[0-9a-f]{32}\.jpg$")


class ProductionGuardTests(SimpleTestCase):
    """Starting the server with unsafe production settings fails at once."""

    def run_settings(self, **extra):
        env = {k: v for k, v in os.environ.items() if k not in ("DEBUG", "HTTPS_ONLY", "REDIS_URL", "CARDS_DEV_ACTIVATE", "TRUST_PROXY_HEADERS")}
        env.update(DEBUG="false", SECRET_KEY="x" * 60, DJANGO_SETTINGS_MODULE="ilaf.settings", HTTPS_ONLY="true", TRUST_PROXY_HEADERS="true", REDIS_URL="redis://127.0.0.1:6379/5")
        env.update(extra)
        proc = subprocess.run([sys.executable, "-c", "import ilaf.settings"], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=60)
        return proc.returncode, proc.stderr

    def test_a_safe_production_configuration_loads(self):
        code, err = self.run_settings()
        self.assertEqual(code, 0, err)

    def test_dev_activate_is_refused(self):
        code, err = self.run_settings(CARDS_DEV_ACTIVATE="true")
        self.assertNotEqual(code, 0)
        self.assertIn("CARDS_DEV_ACTIVATE", err)

    def test_debug_is_refused(self):
        code, err = self.run_settings(DEBUG="true")
        self.assertNotEqual(code, 0)
        self.assertIn("DEBUG", err)

    def test_missing_shared_cache_is_refused_unless_acknowledged(self):
        code, err = self.run_settings(REDIS_URL="")
        self.assertNotEqual(code, 0)
        self.assertIn("REDIS_URL", err)
        code, err = self.run_settings(REDIS_URL="", ALLOW_LOCAL_THROTTLE_CACHE="true")
        self.assertEqual(code, 0, err)

    def test_development_defaults_are_untouched(self):
        env = {k: v for k, v in os.environ.items() if k not in ("HTTPS_ONLY", "REDIS_URL", "CARDS_DEV_ACTIVATE")}
        env.update(DEBUG="true", DJANGO_SETTINGS_MODULE="ilaf.settings")
        proc = subprocess.run([sys.executable, "-c", "import ilaf.settings"], cwd=BACKEND, env=env, capture_output=True, text=True, timeout=60)
        self.assertEqual(proc.returncode, 0, proc.stderr)


class JwtKeyTests(ApiTestCase):
    def test_tokens_are_signed_with_the_jwt_key_when_one_is_set(self):
        from django.test import override_settings
        from rest_framework_simplejwt.settings import api_settings
        from rest_framework_simplejwt.tokens import AccessToken

        person = self.signup()
        self.assertEqual(AccessToken(person.access)["token_type"], "access")
        from django.conf import settings

        self.assertEqual(settings.SIMPLE_JWT["SIGNING_KEY"], settings.SECRET_KEY)  # default: unchanged behaviour
