"""Customer 2-step verification: turning it on and off, the second sign-in step, recovery codes, remembered browsers,
lockout, Google sign-in and the company rule."""
import re
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from ilaf import totp
from security import services
from security.models import RecoveryCode, TrustedDevice, UserTotp, WorkspacePolicy
from workspaces.models import Member

from .base import API, ApiTestCase
from .test_google import CLIENT_ID, fake_jwks, make_token


def enable_two_factor(test, person):
    """Turn 2-step verification on through the API. Returns (secret, recovery codes)."""
    res = person.client.post(API + "auth/2fa/setup", {"password": test.password}, format="json")
    assert res.status_code == 201, res.content
    secret = res.data["secret"]
    res = person.client.post(API + "auth/2fa/confirm", {"code": totp.code_at(secret)}, format="json")
    assert res.status_code == 200, res.content
    return secret, res.data["recovery_codes"]


class TotpClockCase(ApiTestCase):
    """A code can be used once, and only the current time step and its neighbours are accepted, so a test that signs in
    several times moves the clock the code check sees one step on before each new code."""

    def setUp(self):
        super().setUp()
        self.steps = 0
        real = totp.counter_at
        shift = lambda now=None: real(now if now is not None else __import__("time").time() + 30 * self.steps)  # noqa: E731
        patcher = mock.patch("ilaf.totp.counter_at", shift)
        patcher.start()
        self.addCleanup(patcher.stop)

    def next_code(self, secret):
        self.steps += 1
        return totp.code_at(secret)


class EnrolmentTests(TotpClockCase):
    def test_enable_shows_secret_then_ten_recovery_codes_and_sends_mail(self):
        person = self.signup("a@example.com")
        res = person.client.post(API + "auth/2fa/setup", {"password": self.password}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["otpauth_uri"].startswith("otpauth://totp/"))
        self.assertIn("a%40example.com", res.data["otpauth_uri"])
        # Not on until the first code is right.
        self.assertFalse(person.client.get(API + "auth/2fa").data["enabled"])
        bad = person.client.post(API + "auth/2fa/confirm", {"code": "000000"}, format="json")
        self.assertEqual((bad.status_code, bad.data["error"]["code"]), (400, "invalid_two_factor_code"))
        before = len(mail.outbox)
        ok = person.client.post(API + "auth/2fa/confirm", {"code": totp.code_at(res.data["secret"])}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(ok.data["recovery_codes"]), 10)
        self.assertEqual(len(set(ok.data["recovery_codes"])), 10)
        self.assertTrue(ok.data["enabled"])
        self.assertEqual(ok.data["recovery_codes_left"], 10)
        self.assertEqual(len(mail.outbox), before + 1)
        self.assertIn("turned on", mail.outbox[-1].subject + mail.outbox[-1].body)
        # Only hashes are stored.
        self.assertFalse(RecoveryCode.objects.filter(code_hash__in=ok.data["recovery_codes"]).exists())
        self.assertTrue(person.client.get(API + "auth/me").data["two_factor"]["enabled"])

    def test_setup_needs_a_recent_sign_in_or_the_password(self):
        from .test_reauth import stale_client

        self.signup("a@example.com")
        res = stale_client("a@example.com").post(API + "auth/2fa/setup", {}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "reauth_required"))

    def test_setup_again_when_on_is_refused_and_confirm_without_setup_too(self):
        person = self.signup("a@example.com")
        self.assertEqual(person.client.post(API + "auth/2fa/confirm", {"code": "123456"}, format="json").data["error"]["code"], "two_factor_not_started")
        enable_two_factor(self, person)
        res = person.client.post(API + "auth/2fa/setup", {"password": self.password}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "two_factor_already_on"))

    def test_new_recovery_codes_need_a_code_and_replace_the_old_ones(self):
        person = self.signup("a@example.com")
        secret, old = enable_two_factor(self, person)
        self.assertEqual(person.client.post(API + "auth/2fa/recovery-codes", {"code": "000000"}, format="json").status_code, 400)
        res = person.client.post(API + "auth/2fa/recovery-codes", {"code": self.next_code(secret)}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(res.data["recovery_codes"]), 10)
        self.assertFalse(set(old) & set(res.data["recovery_codes"]))
        user = User.objects.get(email="a@example.com")
        self.assertFalse(services.use_recovery_code(user, old[0]))

    def test_disable_needs_password_and_code_and_mails(self):
        person = self.signup("a@example.com")
        secret, _codes = enable_two_factor(self, person)
        wrong_password = person.client.post(API + "auth/2fa/disable", {"password": "nope-nope-1", "code": self.next_code(secret)}, format="json")
        self.assertEqual(wrong_password.status_code, 400)
        wrong_code = person.client.post(API + "auth/2fa/disable", {"password": self.password, "code": "000000"}, format="json")
        self.assertEqual(wrong_code.data["error"]["code"], "invalid_two_factor_code")
        self.assertTrue(person.client.get(API + "auth/2fa").data["enabled"])
        before = len(mail.outbox)
        ok = person.client.post(API + "auth/2fa/disable", {"password": self.password, "code": self.next_code(secret)}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertFalse(ok.data["enabled"])
        self.assertEqual(len(mail.outbox), before + 1)
        self.assertFalse(UserTotp.objects.exists())
        self.assertEqual(person.client.post(API + "auth/2fa/disable", {"password": self.password, "code": "1"}, format="json").data["error"]["code"], "two_factor_not_enabled")

    def test_arabic_mail_when_the_account_language_is_arabic(self):
        person = self.signup("a@example.com")
        person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        enable_two_factor(self, person)
        self.assertIn("التحقق بخطوتين", mail.outbox[-1].subject)
        self.assertIn('dir="rtl"', mail.outbox[-1].alternatives[0][0])


class SignInTests(TotpClockCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("a@example.com")
        self.secret, self.codes = enable_two_factor(self, self.person)

    def login(self, **extra):
        return APIClient().post(API + "auth/login", {"email": "a@example.com", "password": self.password, **extra}, format="json")

    def test_password_alone_does_not_give_tokens(self):
        res = self.login()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["mfa_required"])
        self.assertNotIn("access", res.data)
        self.assertNotIn("refresh", res.data)
        self.assertIn("totp", res.data["methods"])

    def test_wrong_password_still_looks_like_before(self):
        res = APIClient().post(API + "auth/login", {"email": "a@example.com", "password": "wrong-pass-1"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (401, "invalid_credentials"))

    def test_code_completes_the_sign_in_and_cannot_be_replayed(self):
        token = self.login().data["mfa_token"]
        code = self.next_code(self.secret)
        ok = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": code}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertIn("access", ok.data)
        self.assertEqual(ok.data["user"]["email"], "a@example.com")
        again = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": code}, format="json")
        self.assertEqual((again.status_code, again.data["error"]["code"]), (400, "invalid_two_factor_code"))

    def test_wrong_code_and_bad_token(self):
        token = self.login().data["mfa_token"]
        bad = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": "000000"}, format="json")
        self.assertEqual(bad.data["error"]["code"], "invalid_two_factor_code")
        junk = APIClient().post(API + "auth/login/mfa", {"mfa_token": token + "x", "code": self.next_code(self.secret)}, format="json")
        self.assertEqual((junk.status_code, junk.data["error"]["code"]), (401, "mfa_token_invalid"))
        none = APIClient().post(API + "auth/login/mfa", {"code": self.next_code(self.secret)}, format="json")
        self.assertEqual(none.status_code, 401)

    def test_an_old_step_token_expires(self):
        token = self.login().data["mfa_token"]
        with mock.patch("security.services.MFA_TOKEN_SECONDS", -1):
            res = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": self.next_code(self.secret)}, format="json")
        self.assertEqual(res.data["error"]["code"], "mfa_token_invalid")

    def test_recovery_code_works_once_and_counts_down(self):
        token = self.login().data["mfa_token"]
        res = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "recovery_code": self.codes[0].upper()}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["recovery_codes_left"], 9)
        token = self.login().data["mfa_token"]
        reuse = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "recovery_code": self.codes[0]}, format="json")
        self.assertEqual(reuse.status_code, 400)
        spaced = " ".join([self.codes[1][:3], self.codes[1][3:]])
        self.assertEqual(APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "recovery_code": spaced}, format="json").status_code, 200)

    def test_five_wrong_codes_lock_the_check_even_for_the_right_code(self):
        token = self.login().data["mfa_token"]
        for _ in range(5):
            APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": "000000"}, format="json")
        locked = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": self.next_code(self.secret)}, format="json")
        self.assertEqual((locked.status_code, locked.data["error"]["code"]), (429, "two_factor_locked"))
        UserTotp.objects.update(locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": self.next_code(self.secret)}, format="json").status_code, 200)

    def test_remember_this_device_skips_the_step_for_thirty_days(self):
        token = self.login().data["mfa_token"]
        res = APIClient().post(
            API + "auth/login/mfa", {"mfa_token": token, "code": self.next_code(self.secret), "remember_device": True}, format="json",
        )
        device = res.data["device_token"]
        self.assertTrue(device)
        self.assertEqual(TrustedDevice.objects.count(), 1)
        self.assertNotIn(device, TrustedDevice.objects.get().token_hash)
        direct = self.login(device_token=device)
        self.assertIn("access", direct.data)
        self.assertNotIn("mfa_required", direct.data)
        self.assertTrue(self.login(device_token="x" * 40).data["mfa_required"])
        TrustedDevice.objects.update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertTrue(self.login(device_token=device).data["mfa_required"])

    def test_remembered_browser_is_listed_removable_and_cleared_on_disable(self):
        token = self.login().data["mfa_token"]
        res = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": self.next_code(self.secret), "remember_device": True}, format="json")
        client = self.client_for(res.data["access"])
        listing = client.get(API + "auth/devices").data
        self.assertEqual(len(listing["trusted_devices"]), 1)
        self.assertEqual(client.delete(API + f"auth/trusted-devices/{listing['trusted_devices'][0]['id']}").status_code, 204)
        self.assertEqual(TrustedDevice.objects.count(), 0)
        again = APIClient().post(API + "auth/login", {"email": "a@example.com", "password": self.password}, format="json")
        token = again.data["mfa_token"]
        res = APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": self.next_code(self.secret), "remember_device": True}, format="json")
        client = self.client_for(res.data["access"])
        client.post(API + "auth/2fa/disable", {"password": self.password, "code": self.next_code(self.secret)}, format="json")
        self.assertEqual(TrustedDevice.objects.count(), 0)

    def test_password_reset_forgets_remembered_browsers(self):
        token = self.login().data["mfa_token"]
        APIClient().post(API + "auth/login/mfa", {"mfa_token": token, "code": self.next_code(self.secret), "remember_device": True}, format="json")
        APIClient().post(API + "auth/forgot", {"email": "a@example.com"}, format="json")
        reset = re.search(r"/reset/([\w-]+)", mail.outbox[-1].body).group(1)
        APIClient().post(API + "auth/reset", {"token": reset, "password": "brand-new-pass-9"}, format="json")
        self.assertEqual(TrustedDevice.objects.count(), 0)

    def test_register_and_change_password_are_not_gated(self):
        res = self.person.client.post(API + "auth/change-password", {"old_password": self.password, "new_password": "another-pass-22"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIn("access", res.data)


@override_settings(GOOGLE_CLIENT_ID=CLIENT_ID)
class GoogleTests(TotpClockCase):
    def google(self, **extra):
        with fake_jwks():
            return APIClient().post(API + "auth/google", {"credential": make_token(), **extra}, format="json")

    def test_google_sign_in_also_asks_for_the_second_step(self):
        first = self.google()
        self.assertEqual(first.status_code, 201)
        client = self.client_for(first.data["access"])
        secret, _ = (lambda r: (r.data["secret"], None))(client.post(API + "auth/2fa/setup", {}, format="json"))
        self.assertEqual(client.post(API + "auth/2fa/confirm", {"code": totp.code_at(secret)}, format="json").status_code, 200)
        second = self.google()
        self.assertTrue(second.data["mfa_required"])
        self.assertNotIn("access", second.data)
        done = APIClient().post(API + "auth/login/mfa", {"mfa_token": second.data["mfa_token"], "code": self.next_code(secret)}, format="json")
        self.assertEqual(done.status_code, 200)
        self.assertIn("access", done.data)


class CompanyRuleTests(TotpClockCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@northgate.com", "Olive Owner")
        self.ws = self.company(self.owner, "Northgate")
        self.member = self.join(self.invite(self.owner, self.ws, "eve@northgate.com"))

    def set_rule(self, on=True):
        return self.owner.client.patch(f"{API}workspaces/{self.ws}", {"security": {"require_2fa": on}}, format="json")

    def test_the_owner_needs_two_step_first(self):
        res = self.set_rule()
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "two_factor_owner_required"))

    def test_only_the_owner_can_set_it(self):
        enable_two_factor(self, self.owner)
        admin = self.join(self.invite(self.owner, self.ws, "ada@northgate.com", role="admin"))
        res = admin.client.patch(f"{API}workspaces/{self.ws}", {"security": {"require_2fa": True}}, format="json")
        self.assertEqual(res.status_code, 403)

    def test_switching_on_mails_members_and_shows_in_the_workspace_and_user(self):
        enable_two_factor(self, self.owner)
        before = len(mail.outbox)
        res = self.set_rule()
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["security"]["require_2fa"])
        self.assertEqual(res.data["security"]["two_factor_grace_days"], 7)
        sent_to = [m.to[0] for m in mail.outbox[before:]]
        self.assertEqual(sent_to, ["eve@northgate.com"])
        status = self.member.client.get(API + "auth/me").data["two_factor"]
        self.assertFalse(status["enabled"])
        self.assertFalse(status["required"]["enforced"])
        self.assertEqual(status["required"]["workspace_name"], "Northgate")
        # Inside the grace period everything still works.
        self.assertEqual(self.member.client.get(f"{API}workspaces/{self.ws}/cards").status_code, 200)

    def test_after_the_grace_period_only_security_is_reachable_until_enrolled(self):
        enable_two_factor(self, self.owner)
        self.set_rule()
        WorkspacePolicy.objects.update(require_2fa_since=timezone.now() - timedelta(days=8))
        Member.objects.filter(email="eve@northgate.com").update(joined_at=timezone.now() - timedelta(days=8))
        blocked = self.member.client.get(f"{API}workspaces/{self.ws}/cards")
        self.assertEqual((blocked.status_code, blocked.data["error"]["code"]), (403, "two_factor_required"))
        self.assertTrue(self.member.client.get(API + "auth/me").data["two_factor"]["required"]["enforced"])
        self.assertEqual(self.member.client.get(API + "me/workspaces").status_code, 200)
        res = self.member.client.post(API + "auth/2fa/setup", {"password": "employee-pass-1"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.member.client.post(API + "auth/2fa/confirm", {"code": totp.code_at(res.data["secret"])}, format="json")
        self.assertEqual(self.member.client.get(f"{API}workspaces/{self.ws}/cards").status_code, 200)

    def test_a_late_joiner_gets_a_fresh_grace_period(self):
        enable_two_factor(self, self.owner)
        self.set_rule()
        WorkspacePolicy.objects.update(require_2fa_since=timezone.now() - timedelta(days=30))
        late = self.join(self.invite(self.owner, self.ws, "lee@northgate.com"))
        self.assertEqual(late.client.get(f"{API}workspaces/{self.ws}/cards").status_code, 200)

    def test_cannot_turn_off_while_the_company_requires_it(self):
        secret, _ = enable_two_factor(self, self.owner)
        self.set_rule()
        res = self.owner.client.post(API + "auth/2fa/disable", {"password": self.password, "code": self.next_code(secret)}, format="json")
        self.assertEqual(res.data["error"]["code"], "two_factor_required_by_company")

    def test_switching_off_clears_the_rule_and_is_audited(self):
        enable_two_factor(self, self.owner)
        self.set_rule()
        self.set_rule(False)
        self.assertFalse(WorkspacePolicy.objects.get().require_2fa)
        actions = [e.action for e in __import__("operations.models", fromlist=["AuditEvent"]).AuditEvent.objects.all()]
        self.assertEqual(actions.count("company.require_2fa_changed"), 2)


class InviteTests(TotpClockCase):
    def test_an_existing_account_with_two_step_takes_the_seat_but_waits_for_the_code(self):
        owner = self.signup("owner@northgate.com", "Olive Owner")
        ws = self.company(owner, "Northgate")
        person = self.signup("eve@northgate.com", "Eve Existing")
        secret, _codes = enable_two_factor(self, person)
        member = self.invite(owner, ws, "eve@northgate.com")
        token = Member.objects.get(pk=member["id"]).invite_token
        res = APIClient().post(f"{API}invites/{token}/accept", {"password": self.password}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["mfa_required"])
        self.assertNotIn("access", res.data)
        self.assertEqual(res.data["workspace_id"], ws)
        self.assertEqual(Member.objects.get(pk=member["id"]).status, "active")
        done = APIClient().post(API + "auth/login/mfa", {"mfa_token": res.data["mfa_token"], "code": self.next_code(secret)}, format="json")
        self.assertEqual(done.status_code, 200)
        self.assertIn("access", done.data)

    def test_restoring_a_deleted_account_with_two_step_still_asks_for_the_code(self):
        person = self.signup("a@example.com")
        secret, _codes = enable_two_factor(self, person)
        User.objects.filter(email="a@example.com").update(is_active=False, deletion_due_at=timezone.now() + timedelta(days=10))
        res = APIClient().post(API + "auth/restore", {"email": "a@example.com", "password": self.password}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["mfa_required"])
        self.assertTrue(User.objects.get(email="a@example.com").is_active)
