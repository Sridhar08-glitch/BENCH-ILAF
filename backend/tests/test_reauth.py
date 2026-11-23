"""Linking Google, changing sign-in methods and exporting data need a recent sign-in or a password entry."""
import time

from django.conf import settings
from django.core import mail
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import RefreshToken

from accounts.models import User
from accounts.services import tokens_for

from .base import API, ApiTestCase
from .test_google import CLIENT_ID, fake_jwks, make_token
from django.test import override_settings


def stale_client(email, age=3600):
    """A client whose session was signed in `age` seconds ago (tokens are otherwise valid)."""
    user = User.objects.get(email=email)
    refresh = RefreshToken.for_user(user)
    refresh["auth_time"] = int(time.time()) - age
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {refresh.access_token}")
    return client


def legacy_client(email):
    """A client holding a token without the sign-in time (issued before this rule existed)."""
    user = User.objects.get(email=email)
    client = APIClient()
    client.credentials(HTTP_AUTHORIZATION=f"Bearer {RefreshToken.for_user(user).access_token}")
    return client


class SignInTimeTests(ApiTestCase):
    def test_every_sign_in_route_stamps_the_time(self):
        person = self.signup("a@example.com")
        login = APIClient().post(API + "auth/login", {"email": "a@example.com", "password": self.password}, format="json")
        for refresh in (person.refresh, login.data["refresh"]):
            self.assertAlmostEqual(RefreshToken(refresh)["auth_time"], time.time(), delta=30)

    def test_refresh_keeps_the_original_sign_in_time(self):
        user = self.signup("a@example.com")
        token = RefreshToken(user.refresh)
        token["auth_time"] = int(time.time()) - 5000
        res = APIClient().post(API + "auth/refresh", {"refresh": str(token)}, format="json")
        self.assertEqual(res.status_code, 200)
        from rest_framework_simplejwt.tokens import AccessToken

        self.assertEqual(AccessToken(res.data["access"])["auth_time"], token["auth_time"])
        self.assertEqual(RefreshToken(res.data["refresh"])["auth_time"], token["auth_time"])


@override_settings(GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleLinkReauthTests(ApiTestCase):
    def link(self, client, **extra):
        with fake_jwks():
            return client.post(API + "auth/google/link", {"credential": make_token(email="gina@example.com"), **extra}, format="json")

    def test_fresh_session_may_link(self):
        person = self.signup("gina@example.com")
        self.assertEqual(self.link(person.client).status_code, 200)

    def test_stale_session_is_asked_to_confirm(self):
        self.signup("gina@example.com")
        res = self.link(stale_client("gina@example.com"))
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "reauth_required")
        self.assertIsNone(User.objects.get(email="gina@example.com").google_sub)

    def test_stale_session_with_the_password_may_link(self):
        self.signup("gina@example.com")
        self.assertEqual(self.link(stale_client("gina@example.com"), password="wrong-pass-9").status_code, 400)
        self.assertEqual(self.link(stale_client("gina@example.com"), password=self.password).status_code, 200)
        self.assertEqual(User.objects.get(email="gina@example.com").google_sub, "g-1001")

    def test_old_tokens_without_a_sign_in_time_count_as_stale(self):
        self.signup("gina@example.com")
        self.assertEqual(self.link(legacy_client("gina@example.com")).status_code, 403)

    def test_a_stolen_token_cannot_replace_the_linked_google_account(self):
        person = self.signup("gina@example.com")
        self.assertEqual(self.link(person.client).status_code, 200)
        with fake_jwks():
            res = person.client.post(API + "auth/google/link", {"credential": make_token(sub="g-2002", email="evil@example.com")}, format="json")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "google_already_linked")
        self.assertEqual(User.objects.get(email="gina@example.com").google_sub, "g-1001")

    def test_unlink_also_needs_a_recent_sign_in(self):
        person = self.signup("gina@example.com")
        self.link(person.client)
        self.assertEqual(stale_client("gina@example.com").post(API + "auth/google/unlink", {}, format="json").status_code, 403)
        self.assertEqual(stale_client("gina@example.com").post(API + "auth/google/unlink", {"password": self.password}, format="json").status_code, 200)

    def test_window_is_configurable(self):
        self.signup("gina@example.com")
        client = stale_client("gina@example.com", age=300)
        self.assertEqual(self.link(client).status_code, 200)  # inside the default ten minutes
        User.objects.filter(email="gina@example.com").update(google_sub=None, google_email="")
        with override_settings(REAUTH_WINDOW_SECONDS=60):
            self.assertEqual(self.link(client).status_code, 403)


class ExportReauthTests(ApiTestCase):
    def test_fresh_session_can_request_and_fetch_an_export_link(self):
        person = self.signup("a@example.com")
        res = person.client.post(API + "privacy/export", {}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        link = person.client.post(f"{API}privacy/requests/{res.data['id']}/download-link", {}, format="json")
        self.assertEqual(link.status_code, 200)

    def test_stale_session_cannot_start_an_export_or_get_the_link(self):
        person = self.signup("a@example.com")
        res = person.client.post(API + "privacy/export", {}, format="json")
        stale = stale_client("a@example.com")
        blocked = stale.post(API + "privacy/export", {}, format="json")
        self.assertEqual((blocked.status_code, blocked.data["error"]["code"]), (403, "reauth_required"))
        link = stale.post(f"{API}privacy/requests/{res.data['id']}/download-link", {}, format="json")
        self.assertEqual(link.status_code, 403)
        ok = stale.post(f"{API}privacy/requests/{res.data['id']}/download-link", {"password": self.password}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_wrong_password_is_refused(self):
        self.signup("a@example.com")
        res = stale_client("a@example.com").post(API + "privacy/export", {"password": "nope-nope-1"}, format="json")
        self.assertEqual(res.status_code, 400)


class SetPasswordReauthTests(ApiTestCase):
    def google_only(self):
        user = User.objects.create_user("g@example.com", None, full_name="G")
        user.set_unusable_password()
        user.google_sub = "g-1"
        user.save()
        return user

    def test_fresh_google_session_can_set_a_first_password(self):
        user = self.google_only()
        client = self.client_for(tokens_for(user)["access"])
        res = client.post(API + "auth/set-password", {"new_password": "a-good-pass-1"}, format="json")
        self.assertEqual(res.status_code, 204, res.content)

    def test_stale_session_needs_a_fresh_google_sign_in(self):
        self.google_only()
        res = stale_client("g@example.com").post(API + "auth/set-password", {"new_password": "a-good-pass-1"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "reauth_required"))
        self.assertFalse(User.objects.get(email="g@example.com").has_usable_password())
