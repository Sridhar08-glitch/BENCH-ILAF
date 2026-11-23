import re

from django.conf import settings
from django.core import mail
from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from workspaces.models import Member, Workspace

from .base import API, BIG_RATES, ApiTestCase


class AuthTests(ApiTestCase):
    def test_register_creates_user_personal_workspace_and_tokens(self):
        res = APIClient().post(
            API + "auth/register",
            {"email": "New@Example.com", "password": self.password, "full_name": "New Person"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["user"]["email"], "new@example.com")
        self.assertEqual(res.data["user"]["full_name"], "New Person")
        self.assertIn("access", res.data)
        self.assertIn("refresh", res.data)
        user = User.objects.get(email="new@example.com")
        ws = Workspace.objects.get(created_by=user)
        self.assertEqual(ws.kind, "personal")
        self.assertTrue(Member.objects.filter(workspace=ws, user=user, role="owner", status="active").exists())

    def test_register_validation_and_duplicates(self):
        client = APIClient()
        res = client.post(API + "auth/register", {"email": "bad", "password": "x", "full_name": ""}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertIn("email", res.data["error"]["fields"])
        self.signup("dup@example.com")
        res = client.post(
            API + "auth/register", {"email": "DUP@example.com", "password": self.password, "full_name": "X"},
            format="json",
        )
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "email_taken")

    def test_short_password_rejected(self):
        res = APIClient().post(
            API + "auth/register", {"email": "s@example.com", "password": "short", "full_name": "S"}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["error"]["fields"])

    def test_login_ok_and_wrong_password(self):
        self.signup("login@example.com")
        res = APIClient().post(
            API + "auth/login", {"email": "login@example.com", "password": self.password}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["user"]["email"], "login@example.com")
        res = APIClient().post(API + "auth/login", {"email": "login@example.com", "password": "nope"}, format="json")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "invalid_credentials")
        res = APIClient().post(API + "auth/login", {"email": "ghost@example.com", "password": "nope"}, format="json")
        self.assertEqual(res.data["error"]["code"], "invalid_credentials")

    def test_refresh_rotates_and_old_token_is_dead(self):
        person = self.signup()
        res = APIClient().post(API + "auth/refresh", {"refresh": person.refresh}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)
        self.assertNotEqual(res.data["refresh"], person.refresh)
        again = APIClient().post(API + "auth/refresh", {"refresh": person.refresh}, format="json")
        self.assertEqual(again.status_code, 401)
        self.assertEqual(again.data["error"]["code"], "unauthorized")
        bad = APIClient().post(API + "auth/refresh", {"refresh": "garbage"}, format="json")
        self.assertEqual(bad.status_code, 401)

    def test_me_get_and_patch(self):
        person = self.signup()
        res = person.client.get(API + "auth/me")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(
            set(res.data),
            {"id", "email", "full_name", "photo_url", "created_at", "email_verified", "has_password", "google_linked", "google_email", "language", "product_updates", "two_factor"},
        )
        res = person.client.patch(API + "auth/me", {"full_name": "Alice B"}, format="json")
        self.assertEqual(res.data["full_name"], "Alice B")

    def test_requests_without_token_get_the_error_shape(self):
        res = APIClient().get(API + "auth/me")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "unauthorized")
        self.assertIn("message", res.data["error"])

    def test_me_workspaces_lists_personal_workspace_with_subscription(self):
        person = self.signup()
        res = person.client.get(API + "me/workspaces")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data), 1)
        row = res.data[0]
        self.assertEqual(row["kind"], "personal")
        self.assertEqual(row["role"], "owner")
        self.assertEqual(row["card_count"], 0)
        self.assertEqual(row["subscription"]["status"], "none")
        self.assertFalse(row["subscription"]["live"])

    def test_forgot_always_204_and_reset_flow(self):
        person = self.signup("reset@example.com")
        res = APIClient().post(API + "auth/forgot", {"email": "ghost@example.com"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(len(mail.outbox), 0)
        res = APIClient().post(API + "auth/forgot", {"email": "reset@example.com"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(len(mail.outbox), 1)
        body = mail.outbox[0].body
        self.assertIn(settings.PRODUCT_NAME, mail.outbox[0].subject)
        token = re.search(r"/reset/([\w-]+)", body).group(1)
        res = APIClient().post(API + "auth/reset", {"token": token, "password": "brand-new-pass-9"}, format="json")
        self.assertEqual(res.status_code, 204)
        login = APIClient().post(
            API + "auth/login", {"email": "reset@example.com", "password": "brand-new-pass-9"}, format="json"
        )
        self.assertEqual(login.status_code, 200)
        # A token works once only.
        res = APIClient().post(API + "auth/reset", {"token": token, "password": "another-pass-99"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "validation_error")

    def test_reset_with_bad_token(self):
        res = APIClient().post(API + "auth/reset", {"token": "nope", "password": "whatever-123"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_change_password(self):
        person = self.signup("chg@example.com")
        res = person.client.post(
            API + "auth/change-password", {"old_password": "wrong", "new_password": "newer-pass-123"}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        res = person.client.post(
            API + "auth/change-password",
            {"old_password": self.password, "new_password": "newer-pass-123"}, format="json",
        )
        self.assertEqual(res.status_code, 200)  # fresh tokens for this device; the others are signed out
        self.assertTrue(res.data["access"] and res.data["refresh"])
        login = APIClient().post(
            API + "auth/login", {"email": "chg@example.com", "password": "newer-pass-123"}, format="json"
        )
        self.assertEqual(login.status_code, 200)

    def test_login_is_throttled(self):
        rates = dict(BIG_RATES, auth_login="2/min")
        with override_settings(ILAF_THROTTLE_RATES=rates):
            client = APIClient()
            for _ in range(2):
                client.post(API + "auth/login", {"email": "a@b.co", "password": "x"}, format="json")
            res = client.post(API + "auth/login", {"email": "a@b.co", "password": "x"}, format="json")
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data["error"]["code"], "throttled")

    def test_unknown_url_returns_json_404(self):
        res = APIClient().get(API + "nothing-here")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.json()["error"]["code"], "not_found")
