import time
from unittest import mock

from django.core import mail
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from accounts import google
from accounts.models import User
from ilaf import rsa
from workspaces.models import Member, Workspace

from .base import API, ApiTestCase
from .keys import KEY_ONE, KEY_ONE_PKCS1, KEY_TWO

CLIENT_ID = "123-test.apps.googleusercontent.com"
KEY = rsa.PrivateKey.from_pem(KEY_ONE)
OTHER_KEY = rsa.PrivateKey.from_pem(KEY_TWO)


def jwk(key=KEY, kid="k1"):
    return {
        "kty": "RSA", "alg": "RS256", "use": "sig", "kid": kid,
        "n": rsa.b64url_encode(key.n.to_bytes((key.n.bit_length() + 7) // 8, "big")),
        "e": rsa.b64url_encode(key.e.to_bytes(3, "big")),
    }


def make_token(key=KEY, kid="k1", **claims):
    now = int(time.time())
    body = {
        "iss": "https://accounts.google.com", "aud": CLIENT_ID, "sub": "g-1001", "email": "gina@example.com",
        "email_verified": True, "name": "Gina Google", "iat": now, "exp": now + 3600,
    }
    body.update(claims)
    body = {k: v for k, v in body.items() if v is not None}
    return rsa.jwt_encode_rs256(body, key, {"kid": kid})


def fake_jwks(keys=None):
    return mock.patch("accounts.google.fetch_jwks", return_value=(keys or [jwk()], 3600))


class RsaTests(SimpleTestCase):
    def test_sign_and_verify_round_trip(self):
        sig = rsa.sign(b"message", KEY)
        self.assertTrue(rsa.verify(b"message", sig, KEY.public()))
        self.assertFalse(rsa.verify(b"other", sig, KEY.public()))
        self.assertFalse(rsa.verify(b"message", sig, OTHER_KEY.public()))

    def test_pkcs1_and_pkcs8_keys_are_the_same_key(self):
        pkcs1 = rsa.PrivateKey.from_pem(KEY_ONE_PKCS1)
        self.assertEqual((pkcs1.n, pkcs1.d), (KEY.n, KEY.d))

    def test_garbage_keys_are_refused(self):
        for bad in ("", "not a key", "-----BEGIN PRIVATE KEY-----\nAAAA\n-----END PRIVATE KEY-----"):
            with self.assertRaises(rsa.RsaError):
                rsa.PrivateKey.from_pem(bad)

    def test_short_keys_never_verify(self):
        weak = rsa.PublicKey(3 * 5, 3)
        self.assertFalse(rsa.verify(b"m", b"\x01", weak))


@override_settings(GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleVerifyTests(ApiTestCase):
    def verify(self, token, **kw):
        with fake_jwks():
            return google.verify_id_token(token, **kw)

    def code_of(self, token, **kw):
        with self.assertRaises(Exception) as ctx:
            self.verify(token, **kw)
        return ctx.exception.code

    def test_valid_token(self):
        claims = self.verify(make_token())
        self.assertEqual(claims["email"], "gina@example.com")
        self.assertEqual(claims["sub"], "g-1001")

    def test_wrong_signature_audience_issuer_and_expiry(self):
        self.assertEqual(self.code_of(make_token(key=OTHER_KEY)), "google_token_invalid")
        self.assertEqual(self.code_of(make_token(aud="someone-else")), "google_token_invalid")
        self.assertEqual(self.code_of(make_token(iss="https://evil.example")), "google_token_invalid")
        self.assertEqual(self.code_of(make_token(exp=int(time.time()) - 3600)), "google_token_invalid")
        self.assertEqual(self.code_of(make_token(kid="unknown")), "google_token_invalid")

    def test_unverified_email_is_refused(self):
        self.assertEqual(self.code_of(make_token(email_verified=False)), "google_email_unverified")
        self.assertEqual(self.code_of(make_token(email_verified=None)), "google_email_unverified")
        self.assertEqual(self.verify(make_token(email_verified="true"))["email"], "gina@example.com")

    def test_alg_none_and_tampered_tokens(self):
        token = make_token()
        head, body, sig = token.split(".")
        forged_head = rsa.b64url_encode(b'{"alg":"none","kid":"k1"}')
        self.assertEqual(self.code_of(f"{forged_head}.{body}.{sig}"), "google_token_invalid")
        other_body = make_token(email="victim@example.com").split(".")[1]
        self.assertEqual(self.code_of(f"{head}.{other_body}.{sig}"), "google_token_invalid")
        self.assertEqual(self.code_of("garbage"), "google_token_invalid")

    def test_recent_token_requirement(self):
        old = make_token(iat=int(time.time()) - 3000)
        self.assertEqual(self.code_of(old, max_age=300), "google_token_invalid")
        self.assertEqual(self.verify(old)["sub"], "g-1001")

    def test_not_configured(self):
        with override_settings(GOOGLE_CLIENT_ID=""):
            self.assertEqual(self.code_of(make_token()), "google_not_configured")

    def test_keys_are_cached_and_refetched_on_unknown_kid(self):
        cache.clear()
        with mock.patch("accounts.google.fetch_jwks", return_value=([jwk()], 3600)) as fetch:
            google.verify_id_token(make_token())
            google.verify_id_token(make_token())
            self.assertEqual(fetch.call_count, 1)
        cache.clear()
        calls = iter([([jwk(OTHER_KEY, "old")], 3600), ([jwk(), jwk(OTHER_KEY, "old")], 3600)])
        with mock.patch("accounts.google.fetch_jwks", side_effect=lambda: next(calls)):
            self.assertEqual(google.verify_id_token(make_token())["sub"], "g-1001")

    def test_network_failure_is_a_503(self):
        cache.clear()
        with mock.patch("accounts.google.fetch_jwks", side_effect=OSError("down")):
            with self.assertRaises(Exception) as ctx:
                google.verify_id_token(make_token())
            self.assertEqual((ctx.exception.code, ctx.exception.status_code), ("google_unavailable", 503))


@override_settings(GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleSignInTests(ApiTestCase):
    def google(self, token=None, **claims):
        with fake_jwks():
            return APIClient().post(API + "auth/google", {"credential": token or make_token(**claims)}, format="json")

    def test_first_sign_in_creates_account_like_email_signup(self):
        res = self.google()
        self.assertEqual(res.status_code, 201, res.content)
        self.assertIn("access", res.data)
        user = User.objects.get(email="gina@example.com")
        self.assertFalse(user.has_usable_password())
        self.assertTrue(user.email_verified)
        self.assertEqual(user.google_sub, "g-1001")
        self.assertEqual(user.full_name, "Gina Google")
        ws = Workspace.objects.get(created_by=user)
        self.assertEqual(ws.kind, "personal")
        self.assertTrue(Member.objects.filter(workspace=ws, user=user, role="owner", status="active").exists())
        self.assertTrue(res.data["user"]["google_linked"])
        self.assertFalse(res.data["user"]["has_password"])
        # The tokens work like the normal ones.
        me = self.client_for(res.data["access"]).get(API + "auth/me")
        self.assertEqual(me.status_code, 200)

    def test_second_sign_in_is_the_same_account(self):
        self.google()
        res = self.google()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(User.objects.filter(email="gina@example.com").count(), 1)

    def test_links_to_account_with_verified_email(self):
        User.objects.create_user("gina@example.com", "pw-pass-123", full_name="Gina", email_verified=True)
        res = self.google()
        self.assertEqual(res.status_code, 200)
        user = User.objects.get(email="gina@example.com")
        self.assertEqual(user.google_sub, "g-1001")
        self.assertTrue(user.has_usable_password())

    def test_never_links_to_an_unverified_account(self):
        self.signup("gina@example.com", "Mallory")  # password sign-up: the address was never proven
        res = self.google()
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "account_exists_unverified")
        self.assertIsNone(User.objects.get(email="gina@example.com").google_sub)

    def test_password_reset_proves_the_address(self):
        self.signup("gina@example.com")
        APIClient().post(API + "auth/forgot", {"email": "gina@example.com"}, format="json")
        token = mail.outbox[-1].body.split("/reset/")[1].split()[0]
        APIClient().post(API + "auth/reset", {"token": token, "password": "brand-new-pw-1"}, format="json")
        self.assertEqual(self.google().status_code, 200)

    def test_different_google_account_cannot_take_a_linked_email(self):
        User.objects.create_user("gina@example.com", "pw-pass-123", email_verified=True, google_sub="someone-else")
        res = self.google()
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "google_account_mismatch")

    def test_unverified_google_email_is_refused(self):
        res = self.google(email_verified=False)
        self.assertEqual(res.status_code, 403)
        self.assertFalse(User.objects.filter(email="gina@example.com").exists())

    def test_bad_token_is_401(self):
        res = self.google(token=make_token(key=OTHER_KEY))
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "google_token_invalid")

    def test_suspended_account_is_refused(self):
        self.google()
        User.objects.filter(email="gina@example.com").update(is_active=False)
        res = self.google()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "account_suspended")

    def test_scheduled_for_deletion_is_reported(self):
        first = self.google()
        client = self.client_for(first.data["access"])
        with fake_jwks():
            res = client.post(API + "privacy/delete-account", {"confirm": "DELETE", "credential": make_token()}, format="json")
        self.assertEqual(res.status_code, 202, res.content)
        res = self.google()
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "account_scheduled_for_deletion")

    @override_settings(ILAF_THROTTLE_RATES={"auth_google": "2/min"})
    def test_rate_limited(self):
        codes = [self.google(token="x").status_code for _ in range(3)]
        self.assertEqual(codes[-1], 429)

    def test_not_configured_is_503(self):
        with override_settings(GOOGLE_CLIENT_ID=""):
            res = self.google()
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["error"]["code"], "google_not_configured")


@override_settings(GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleAccountSettingsTests(ApiTestCase):
    def link(self, person, **claims):
        with fake_jwks():
            return person.client.post(API + "auth/google/link", {"credential": make_token(**claims)}, format="json")

    def test_link_and_unlink_with_password(self):
        alice = self.signup("alice@example.com")
        res = self.link(alice, email="alice.work@example.com")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["google_linked"])
        self.assertEqual(res.data["google_email"], "alice.work@example.com")
        res = alice.client.post(API + "auth/google/unlink")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["google_linked"])

    def test_linking_the_same_address_marks_it_verified(self):
        alice = self.signup("alice@example.com")
        self.assertFalse(User.objects.get(email="alice@example.com").email_verified)
        self.link(alice, email="alice@example.com")
        self.assertTrue(User.objects.get(email="alice@example.com").email_verified)

    def test_google_account_cannot_be_linked_twice(self):
        alice = self.signup("alice@example.com")
        bob = self.signup("bob@example.com")
        self.assertEqual(self.link(alice).status_code, 200)
        res = self.link(bob)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "google_in_use")

    def test_unlink_needs_another_sign_in_method(self):
        with fake_jwks():
            first = APIClient().post(API + "auth/google", {"credential": make_token()}, format="json")
        client = self.client_for(first.data["access"])
        res = client.post(API + "auth/google/unlink")
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "no_other_sign_in")
        # Set a password, then it works.
        self.assertEqual(client.post(API + "auth/set-password", {"new_password": "short"}, format="json").status_code, 400)
        self.assertEqual(client.post(API + "auth/set-password", {"new_password": "a-good-pass-1"}, format="json").status_code, 204)
        self.assertEqual(client.post(API + "auth/google/unlink").status_code, 200)
        login = APIClient().post(API + "auth/login", {"email": "gina@example.com", "password": "a-good-pass-1"}, format="json")
        self.assertEqual(login.status_code, 200)

    def test_set_password_refused_when_one_exists(self):
        alice = self.signup("alice@example.com")
        res = alice.client.post(API + "auth/set-password", {"new_password": "another-pass-1"}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_endpoints_need_sign_in(self):
        for path in ("auth/google/link", "auth/google/unlink", "auth/set-password"):
            self.assertEqual(APIClient().post(API + path, {}, format="json").status_code, 401)


@override_settings(GOOGLE_CLIENT_ID=CLIENT_ID)
class CompanySignInRulesTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@northgate.com", "Olive Owner")
        self.ws = self.company(self.owner, "Northgate")

    def security(self, **body):
        return self.owner.client.patch(f"{API}workspaces/{self.ws}", {"security": body}, format="json")

    def test_owner_sets_rules_and_they_are_returned(self):
        res = self.security(allowed_email_domains=["@Northgate.com", "northgate.com", "north.co.uk"], require_google_signin=True)
        self.assertEqual(res.status_code, 200, res.content)
        security = res.data["security"]
        self.assertEqual(security["allowed_email_domains"], ["northgate.com", "north.co.uk"])
        self.assertTrue(security["require_google_signin"])
        self.assertFalse(security["require_2fa"])
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}").data["security"]["require_google_signin"], True)

    def test_invalid_domain_and_non_owner(self):
        self.assertEqual(self.security(allowed_email_domains=["not a domain"]).status_code, 400)
        member = self.invite(self.owner, self.ws, "eve@northgate.com", role="admin")
        admin = self.join(member)
        res = admin.client.patch(f"{API}workspaces/{self.ws}", {"security": {"require_google_signin": True}}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(admin.client.get(f"{API}workspaces/{self.ws}").data["security"]["require_google_signin"], False)

    def test_personal_workspace_has_no_rules(self):
        res = self.owner.client.patch(f"{API}workspaces/{self.owner.ws}", {"security": {"require_google_signin": True}}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_domain_rule_on_invite_and_accept(self):
        self.security(allowed_email_domains=["northgate.com"])
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/invites", {"invites": [{"email": "x@gmail.com"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("invites.0.email", res.data["error"]["fields"])
        member = self.invite(self.owner, self.ws, "ok@northgate.com")
        self.security(allowed_email_domains=["other.com"])  # the rule changed after the invite
        token = Member.objects.get(pk=member["id"]).invite_token
        res = APIClient().post(f"{API}invites/{token}/accept", {"password": "employee-pass-1"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "domain_not_allowed")

    def test_google_required_blocks_password_login_for_members_but_not_owners(self):
        member = self.invite(self.owner, self.ws, "eve@northgate.com")
        eve = self.join(member)
        self.security(require_google_signin=True)
        res = APIClient().post(API + "auth/login", {"email": "eve@northgate.com", "password": "employee-pass-1"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "google_signin_required")
        res = APIClient().post(API + "auth/login", {"email": "owner@northgate.com", "password": self.password}, format="json")
        self.assertEqual(res.status_code, 200)
        # Google sign-in still works for the member.
        with fake_jwks():
            res = APIClient().post(API + "auth/google", {"credential": make_token(email="eve@northgate.com", sub="g-eve")}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(eve.email, "eve@northgate.com")

    def test_unlink_blocked_when_google_is_required(self):
        member = self.invite(self.owner, self.ws, "eve@northgate.com")
        eve = self.join(member)
        with fake_jwks():
            eve.client.post(API + "auth/google/link", {"credential": make_token(email="eve@northgate.com", sub="g-eve")}, format="json")
        self.security(require_google_signin=True)
        res = eve.client.post(API + "auth/google/unlink")
        self.assertEqual(res.status_code, 403)

    def test_password_invite_acceptance_refused_when_google_required(self):
        member = self.invite(self.owner, self.ws, "new@northgate.com")
        self.security(require_google_signin=True)
        token = Member.objects.get(pk=member["id"]).invite_token
        res = APIClient().post(f"{API}invites/{token}/accept", {"password": "employee-pass-1"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "google_signin_required")

    def test_accept_invite_with_google(self):
        member = self.invite(self.owner, self.ws, "new@northgate.com")
        self.security(allowed_email_domains=["northgate.com"], require_google_signin=True)
        token = Member.objects.get(pk=member["id"]).invite_token
        with fake_jwks():
            wrong = APIClient().post(f"{API}invites/{token}/accept-google", {"credential": make_token(email="someone@northgate.com")}, format="json")
            self.assertEqual(wrong.status_code, 403)
            self.assertEqual(wrong.data["error"]["code"], "invite_email_mismatch")
            res = APIClient().post(f"{API}invites/{token}/accept-google", {"credential": make_token(email="new@northgate.com", sub="g-new")}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["workspace_id"], self.ws)
        seat = Member.objects.get(pk=member["id"])
        self.assertEqual(seat.status, "active")
        self.assertEqual(seat.user.google_sub, "g-new")
        self.assertTrue(seat.user.email_verified)
        # The link is used up.
        with fake_jwks():
            again = APIClient().post(f"{API}invites/{token}/accept-google", {"credential": make_token(email="new@northgate.com", sub="g-new")}, format="json")
        self.assertEqual(again.status_code, 410)

    def test_accept_invite_with_google_respects_domain_rule(self):
        member = self.invite(self.owner, self.ws, "new@northgate.com")
        self.security(allowed_email_domains=["other.com"])
        token = Member.objects.get(pk=member["id"]).invite_token
        with fake_jwks():
            res = APIClient().post(f"{API}invites/{token}/accept-google", {"credential": make_token(email="new@northgate.com")}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "domain_not_allowed")
