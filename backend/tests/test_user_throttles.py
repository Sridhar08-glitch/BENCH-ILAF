"""Per-person throttles for the signed-in API, and the per-address ones keyed on the real client address."""
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from ilaf.throttles import api_scope

from .base import API, BIG_RATES, ApiTestCase

LOW = dict(BIG_RATES, user_read="5/min", user_write="3/min", user_heavy="2/min", user_sensitive="2/min", user_create="2/hour")


class ScopeTests(SimpleTestCase):
    def test_scope_by_method_and_path(self):
        cases = [
            ("GET", "/api/v1/cards/1", "user_read"),
            ("PATCH", "/api/v1/cards/1", "user_write"),
            ("DELETE", "/api/v1/cards/1", "user_write"),
            ("GET", "/api/v1/workspaces/abc/leads.csv", "user_heavy"),
            ("GET", "/api/v1/workspaces/abc/audit.csv", "user_heavy"),
            ("GET", "/api/v1/workspaces/abc/leads", "user_read"),
            ("POST", "/api/v1/workspaces/abc/leads/bulk", "user_heavy"),
            ("POST", "/api/v1/workspaces/abc/bulk/cards", "user_heavy"),
            ("POST", "/api/v1/workspaces/abc/bulk/members", "user_heavy"),
            ("POST", "/api/v1/workspaces/abc/members/import", "user_heavy"),
            ("POST", "/api/v1/privacy/export", "user_heavy"),
            ("POST", "/api/v1/auth/change-password", "user_sensitive"),
            ("POST", "/api/v1/auth/google/link", "user_sensitive"),
            ("POST", "/api/v1/auth/logout-all", "user_sensitive"),
            ("POST", "/api/v1/privacy/delete-account", "user_sensitive"),
            ("POST", "/api/v1/privacy/workspaces/abc/delete", "user_sensitive"),
            ("POST", "/api/v1/workspaces", "user_create"),
            ("GET", "/api/v1/workspaces", "user_read"),
            ("POST", "/api/v1/workspaces/abc/invites", "user_create"),
            ("POST", "/api/v1/workspaces/abc/webhooks", "user_create"),
            ("POST", "/api/v1/workspaces/abc/webhooks/def/test", "user_write"),
        ]
        for method, path, scope in cases:
            self.assertEqual(api_scope(method, path), scope, (method, path))


@override_settings(ILAF_THROTTLE_RATES=LOW)
class UserThrottleTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def test_reads_are_limited_per_person(self):
        a = self.signup("a@example.com")
        b = self.signup("b@example.com")
        cache.clear()
        for _ in range(5):
            self.assertEqual(a.client.get(API + "auth/me").status_code, 200)
        res = a.client.get(API + "auth/me")
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data["error"]["code"], "throttled")
        self.assertIn("Retry-After", res)
        self.assertEqual(b.client.get(API + "auth/me").status_code, 200)  # another person is unaffected

    def test_limit_follows_the_person_not_the_address(self):
        a = self.signup("a@example.com")
        cache.clear()
        for ip in ("1.1.1.1", "2.2.2.2", "3.3.3.3", "4.4.4.4", "5.5.5.5"):
            self.assertEqual(a.client.get(API + "auth/me", HTTP_X_FORWARDED_FOR=ip).status_code, 200)
        self.assertEqual(a.client.get(API + "auth/me", HTTP_X_FORWARDED_FOR="6.6.6.6").status_code, 429)

    def test_writes_have_their_own_counter(self):
        a = self.signup("a@example.com")
        cache.clear()
        for _ in range(3):
            self.assertEqual(a.client.patch(API + "auth/me", {"full_name": "Alice B"}, format="json").status_code, 200)
        self.assertEqual(a.client.patch(API + "auth/me", {"full_name": "Alice C"}, format="json").status_code, 429)
        self.assertEqual(a.client.get(API + "auth/me").status_code, 200)  # reads still work

    def test_heavy_export_is_limited_lower(self):
        owner = self.signup("o@example.com")
        ws = self.company(owner)
        cache.clear()
        url = f"{API}workspaces/{ws}/leads.csv"
        self.assertEqual([owner.client.get(url).status_code for _ in range(3)], [200, 200, 429])
        self.assertEqual(owner.client.get(f"{API}workspaces/{ws}/leads").status_code, 200)

    def test_change_password_guessing_is_slowed(self):
        a = self.signup("a@example.com")
        cache.clear()
        codes = [
            a.client.post(API + "auth/change-password", {"old_password": f"guess{i}", "new_password": "newer-pass-123"}, format="json").status_code
            for i in range(4)
        ]
        self.assertEqual(codes, [400, 400, 429, 429])

    def test_creating_companies_is_limited(self):
        a = self.signup("a@example.com")
        cache.clear()
        codes = [a.client.post(API + "workspaces", {"name": f"Co {i}"}, format="json").status_code for i in range(3)]
        self.assertEqual(codes[2], 429)
        self.assertEqual(codes[:2], [201, 201])

    def test_anonymous_requests_are_left_to_their_address_throttles(self):
        anon = APIClient()
        for _ in range(10):
            self.assertEqual(anon.get(API + "plans").status_code, 200)

    def test_settings_override(self):
        a = self.signup("a@example.com")
        with override_settings(ILAF_THROTTLE_RATES=dict(LOW, user_read="2/min")):
            cache.clear()
            codes = [a.client.get(API + "auth/me").status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])

    def test_missing_rate_means_unlimited(self):
        a = self.signup("a@example.com")
        with override_settings(ILAF_THROTTLE_RATES=BIG_RATES):
            for _ in range(20):
                self.assertEqual(a.client.get(API + "auth/me").status_code, 200)


class DefaultRatesTests(SimpleTestCase):
    def test_defaults_present_in_settings(self):
        from django.conf import settings

        import importlib
        # BIG_RATES replaces the dict in tests, so read the module-level default straight from the settings module
        mod = importlib.import_module("ilaf.settings")
        for key, rate in (("user_read", "600/min"), ("user_write", "120/min")):
            self.assertEqual(mod.ILAF_THROTTLE_RATES[key], rate)
        for key in ("user_heavy", "user_sensitive", "user_create"):
            self.assertIn(key, mod.ILAF_THROTTLE_RATES)
        self.assertIn("ilaf.throttles.UserApiThrottle", settings.REST_FRAMEWORK["DEFAULT_THROTTLE_CLASSES"])


@override_settings(ILAF_THROTTLE_RATES=dict(BIG_RATES, auth_login="2/min"))
class AddressThrottleTests(ApiTestCase):
    """Login limits are counted per visitor address as sent by nginx, not for the whole world."""

    def test_two_visitors_have_separate_counters(self):
        self.signup("a@example.com")
        cache.clear()
        anon = APIClient()
        body = {"email": "a@example.com", "password": "wrong-pass-1"}
        for _ in range(2):
            self.assertEqual(anon.post(API + "auth/login", body, format="json", HTTP_X_FORWARDED_FOR="198.51.100.1").status_code, 401)
        self.assertEqual(anon.post(API + "auth/login", body, format="json", HTTP_X_FORWARDED_FOR="198.51.100.1").status_code, 429)
        self.assertEqual(anon.post(API + "auth/login", body, format="json", HTTP_X_FORWARDED_FOR="198.51.100.2").status_code, 401)

    def test_forged_left_hand_entries_do_not_dodge_the_limit(self):
        self.signup("a@example.com")
        cache.clear()
        anon = APIClient()
        body = {"email": "a@example.com", "password": "wrong-pass-1"}
        codes = [
            anon.post(API + "auth/login", body, format="json", HTTP_X_FORWARDED_FOR=f"10.9.9.{i}, 198.51.100.7").status_code
            for i in range(3)
        ]
        self.assertEqual(codes, [401, 401, 429])

    def test_web_server_header_gives_each_visitor_their_own_counter(self):
        self.signup("a@example.com")
        cache.clear()
        anon = APIClient()
        body = {"email": "a@example.com", "password": "wrong-pass-1"}
        for _ in range(2):
            anon.post(API + "auth/login", body, format="json", HTTP_X_BENCH_CLIENT_IP="203.0.113.10")
        self.assertEqual(anon.post(API + "auth/login", body, format="json", HTTP_X_BENCH_CLIENT_IP="203.0.113.10").status_code, 429)
        self.assertEqual(anon.post(API + "auth/login", body, format="json", HTTP_X_BENCH_CLIENT_IP="203.0.113.11").status_code, 401)
