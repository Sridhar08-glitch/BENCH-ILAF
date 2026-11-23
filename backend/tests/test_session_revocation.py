"""Refresh tokens are revoked when a password changes, on logout, when an account is scheduled for deletion and
when someone loses their seat in a company."""
import re

from django.core import mail
from rest_framework.test import APIClient

from .base import API, ApiTestCase
from .ops_base import OpsTestCase


def refresh_status(refresh):
    return APIClient().post(API + "auth/refresh", {"refresh": refresh}, format="json").status_code


def login(email, password):
    res = APIClient().post(API + "auth/login", {"email": email, "password": password}, format="json")
    assert res.status_code == 200, res.content
    return res.data


class PasswordTests(ApiTestCase):
    def test_reset_revokes_every_refresh_token(self):
        person = self.signup("reset@example.com")
        second = login("reset@example.com", self.password)["refresh"]
        self.assertEqual(refresh_status(second), 200)  # rotation: the old value is spent, use the fresh one below
        second = login("reset@example.com", self.password)["refresh"]
        APIClient().post(API + "auth/forgot", {"email": "reset@example.com"}, format="json")
        token = re.search(r"/reset/([\w-]+)", mail.outbox[-1].body).group(1)
        res = APIClient().post(API + "auth/reset", {"token": token, "password": "brand-new-pass-9"}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(refresh_status(person.refresh), 401)
        self.assertEqual(refresh_status(second), 401)
        self.assertEqual(login("reset@example.com", "brand-new-pass-9")["refresh"] != "", True)

    def test_only_the_newest_reset_link_works(self):
        self.signup("two@example.com")
        mails = []
        for _ in range(2):
            APIClient().post(API + "auth/forgot", {"email": "two@example.com"}, format="json")
            mails.append(re.search(r"/reset/([\w-]+)", mail.outbox[-1].body).group(1))
        old = APIClient().post(API + "auth/reset", {"token": mails[0], "password": "brand-new-pass-9"}, format="json")
        self.assertEqual(old.status_code, 400)
        new = APIClient().post(API + "auth/reset", {"token": mails[1], "password": "brand-new-pass-9"}, format="json")
        self.assertEqual(new.status_code, 204)

    def test_change_password_signs_out_other_devices_and_returns_fresh_tokens(self):
        person = self.signup("chg@example.com")
        other_device = login("chg@example.com", self.password)["refresh"]
        res = person.client.post(
            API + "auth/change-password", {"old_password": self.password, "new_password": "newer-pass-123"}, format="json"
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(refresh_status(person.refresh), 401)
        self.assertEqual(refresh_status(other_device), 401)
        self.assertEqual(refresh_status(res.data["refresh"]), 200)  # this device keeps its session
        self.assertTrue(self.client_for(res.data["access"]).get(API + "auth/me").status_code == 200)

    def test_wrong_old_password_revokes_nothing(self):
        person = self.signup("chg2@example.com")
        res = person.client.post(API + "auth/change-password", {"old_password": "nope", "new_password": "newer-pass-123"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(refresh_status(person.refresh), 200)


class LogoutTests(ApiTestCase):
    def test_logout_revokes_that_refresh_token_only(self):
        person = self.signup("out@example.com")
        other = login("out@example.com", self.password)["refresh"]
        res = APIClient().post(API + "auth/logout", {"refresh": person.refresh}, format="json")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(refresh_status(person.refresh), 401)
        self.assertEqual(refresh_status(other), 200)

    def test_logout_is_idempotent_and_tolerates_garbage(self):
        person = self.signup("out2@example.com")
        for body in ({"refresh": person.refresh}, {"refresh": person.refresh}, {"refresh": "junk"}, {}):
            self.assertEqual(APIClient().post(API + "auth/logout", body, format="json").status_code, 204)

    def test_logout_everywhere(self):
        person = self.signup("all@example.com")
        others = [login("all@example.com", self.password)["refresh"] for _ in range(2)]
        res = person.client.post(API + "auth/logout-all")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.data["revoked"], 3)
        for token in [person.refresh, *others]:
            self.assertEqual(refresh_status(token), 401)
        self.assertEqual(login("all@example.com", self.password)["refresh"] != "", True)

    def test_logout_everywhere_needs_sign_in_and_only_touches_own_tokens(self):
        a = self.signup("a@example.com")
        b = self.signup("b@example.com")
        self.assertEqual(APIClient().post(API + "auth/logout-all").status_code, 401)
        a.client.post(API + "auth/logout-all")
        self.assertEqual(refresh_status(b.refresh), 200)


class DeletionTests(ApiTestCase):
    def test_account_deletion_request_revokes_sessions(self):
        person = self.signup("bye@example.com")
        res = person.client.post(API + "privacy/delete-account", {"confirm": "DELETE", "password": self.password}, format="json")
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(refresh_status(person.refresh), 401)

    def test_restoring_the_account_does_not_bring_old_tokens_back(self):
        person = self.signup("back@example.com")
        person.client.post(API + "privacy/delete-account", {"confirm": "DELETE", "password": self.password}, format="json")
        res = APIClient().post(API + "auth/restore", {"email": "back@example.com", "password": self.password}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(refresh_status(person.refresh), 401)
        self.assertEqual(refresh_status(res.data["refresh"]), 200)


class SeatLossTests(OpsTestCase):
    def sign_in(self, email, password="employee-pass-1"):
        return login(email, password)["refresh"]

    def test_removed_member_must_sign_in_again(self):
        eve = self.add("eve@example.com", "Eve Employee")
        refresh = self.sign_in("eve@example.com")
        res = self.owner.client.delete(self.url(f"members/{eve.member_id}"), {"card_policy": "keep"}, format="json")
        self.assertIn(res.status_code, (200, 204), res.content)
        self.assertEqual(refresh_status(refresh), 401)

    def test_suspended_member_must_sign_in_again(self):
        eve = self.add("eve@example.com", "Eve Employee")
        refresh = self.sign_in("eve@example.com")
        res = self.owner.client.patch(self.url(f"members/{eve.member_id}"), {"status": "suspended"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(refresh_status(refresh), 401)

    def test_demoted_admin_must_sign_in_again_but_promotion_keeps_sessions(self):
        adam = self.add("adam@example.com", "Adam Admin", role="admin")
        refresh = self.sign_in("adam@example.com")
        res = self.owner.client.patch(self.url(f"members/{adam.member_id}"), {"role": "employee"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(refresh_status(refresh), 401)
        eve = self.add("eve@example.com", "Eve Employee")
        refresh = self.sign_in("eve@example.com")
        res = self.owner.client.patch(self.url(f"members/{eve.member_id}"), {"role": "admin"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(refresh_status(refresh), 200)

    def test_other_members_are_not_affected(self):
        eve = self.add("eve@example.com", "Eve Employee")
        sam = self.add("sam@example.com", "Sam Sales")
        sam_refresh = self.sign_in("sam@example.com")
        self.owner.client.delete(self.url(f"members/{eve.member_id}"), {"card_policy": "keep"}, format="json")
        self.assertEqual(refresh_status(sam_refresh), 200)
