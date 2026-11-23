"""Sign-in and forgot-password do the same work and give the same answer whether or not the address has an account."""
import time
from unittest import mock

from django.core import mail
from django.test import override_settings
from rest_framework.test import APIClient

from accounts import services
from accounts.models import PasswordResetToken, User

from .base import API, ApiTestCase


class LoginTimingTests(ApiTestCase):
    def post(self, email, password):
        return APIClient().post(API + "auth/login", {"email": email, "password": password}, format="json")

    def test_unknown_address_burns_one_password_hash(self):
        with mock.patch.object(services, "burn_password_time") as burn:
            res = self.post("ghost@example.com", "whatever-pass-1")
        self.assertEqual(res.status_code, 401)
        burn.assert_called_once()

    def test_wrong_password_for_a_real_account_checks_the_hash_once(self):
        self.signup("real@example.com")
        with mock.patch.object(User, "check_password", return_value=False) as check, mock.patch.object(services, "burn_password_time") as burn:
            res = self.post("real@example.com", "wrong-pass-1")
        self.assertEqual(res.status_code, 401)
        check.assert_called_once()
        burn.assert_not_called()

    def test_google_only_account_also_burns_a_hash(self):
        user = self.signup("g@example.com")
        User.objects.get(email="g@example.com").set_unusable_password()
        u = User.objects.get(email="g@example.com")
        u.set_unusable_password()
        u.save()
        with mock.patch.object(services, "burn_password_time") as burn:
            res = self.post("g@example.com", "wrong-pass-1")
        self.assertEqual(res.status_code, 401)
        burn.assert_called_once()

    def test_overlong_password_is_not_hashed_in_full(self):
        self.signup("long@example.com")
        seen = []
        real = User.set_password

        def spy(self_, raw):
            seen.append(len(raw))
            return real(self_, raw)

        with mock.patch.object(User, "set_password", spy), mock.patch.object(User, "check_password") as check:
            res = self.post("long@example.com", "x" * 100000)
        self.assertEqual(res.status_code, 401)
        check.assert_not_called()
        self.assertEqual(seen, [services.MAX_LOGIN_PASSWORD_CHARS])

    def test_all_failures_look_identical(self):
        self.signup("real@example.com")
        a = self.post("real@example.com", "wrong-pass-1")
        b = self.post("ghost@example.com", "wrong-pass-1")
        c = self.post("", "")
        self.assertEqual((a.status_code, b.status_code, c.status_code), (401, 401, 401))
        self.assertEqual(a.json(), b.json())
        self.assertEqual(a.json(), c.json())

    def test_the_right_password_still_works(self):
        self.signup("real@example.com")
        self.assertEqual(self.post("real@example.com", self.password).status_code, 200)
        self.assertEqual(self.post("REAL@example.com", self.password).status_code, 200)

    def test_restore_by_password_burns_a_hash_for_unknown_addresses(self):
        with mock.patch.object(services, "burn_password_time") as burn:
            res = APIClient().post(API + "auth/restore", {"email": "ghost@example.com", "password": "x-pass-123"}, format="json")
        self.assertEqual(res.status_code, 401)
        burn.assert_called_once()

    def test_wall_clock_difference_is_small_with_a_real_hasher(self):
        """Not a strict timing proof (machines are noisy): with the real PBKDF2 hasher an unknown address must cost
        a comparable amount of time, not nothing."""
        with override_settings(PASSWORD_HASHERS=["django.contrib.auth.hashers.PBKDF2PasswordHasher"]):
            self.signup("real@example.com")
            start = time.perf_counter()
            self.post("ghost@example.com", "wrong-pass-1")
            ghost = time.perf_counter() - start
            start = time.perf_counter()
            self.post("real@example.com", "wrong-pass-1")
            real = time.perf_counter() - start
        self.assertGreater(ghost, real * 0.4)


class ForgotTimingTests(ApiTestCase):
    def forgot(self, email):
        return APIClient().post(API + "auth/forgot", {"email": email}, format="json")

    def test_same_answer_for_known_unknown_and_empty(self):
        self.signup("real@example.com")
        answers = [self.forgot(e) for e in ("real@example.com", "ghost@example.com", "", "not-an-email")]
        self.assertEqual({a.status_code for a in answers}, {204})
        self.assertEqual({a.content for a in answers}, {b""})

    def test_mail_is_sent_after_the_answer_when_background_sending_is_on(self):
        self.signup("real@example.com")
        started = []

        class FakeThread:
            def __init__(self, target, daemon):
                self.target = target

            def start(self):
                started.append(self.target)

        with override_settings(EMAIL_AFTER_RESPONSE=True), mock.patch("ilaf.utils.threading.Thread", FakeThread):
            res = self.forgot("real@example.com")
            self.assertEqual(res.status_code, 204)
            self.assertEqual(len(mail.outbox), 0)  # nothing was sent while the request was being answered
            self.assertEqual(len(started), 1)
            started[0]()
        self.assertEqual(len(mail.outbox), 1)

    def test_unknown_address_starts_no_background_work(self):
        with override_settings(EMAIL_AFTER_RESPONSE=True), mock.patch("ilaf.utils.threading.Thread") as thread:
            self.assertEqual(self.forgot("ghost@example.com").status_code, 204)
        thread.assert_not_called()

    def test_a_mail_failure_does_not_change_the_answer(self):
        self.signup("real@example.com")
        with mock.patch("accounts.views.send_brand_email", side_effect=RuntimeError("smtp down")):
            self.assertEqual(self.forgot("real@example.com").status_code, 204)

    def test_asking_twice_keeps_only_the_newest_link(self):
        user = self.signup("real@example.com")
        self.forgot("real@example.com")
        self.forgot("real@example.com")
        self.assertEqual(PasswordResetToken.objects.filter(user__email="real@example.com", used_at__isnull=True).count(), 1)


class RegisterEnumerationTests(ApiTestCase):
    def test_existing_address_is_reported_because_people_sign_in_straight_away(self):
        """Documented trade-off: the sign-up form must tell a person that the address is taken, since there is no
        e-mail confirmation step yet. The per-address register throttle limits scraping."""
        self.signup("real@example.com")
        res = APIClient().post(
            API + "auth/register", {"email": "real@example.com", "password": self.password, "full_name": "X"}, format="json"
        )
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "email_taken"))
