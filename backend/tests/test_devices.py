"""Signed-in devices: the list, signing one or all others out, the new-device e-mail, masking and pruning."""
from datetime import timedelta

from django.core import mail
from django.test import SimpleTestCase
from django.utils import timezone
from rest_framework.test import APIClient

from security import devices, services
from security.models import KnownDevice, Session

from .base import API, ApiTestCase

CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"
SAFARI_IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
FIREFOX_LINUX = "Mozilla/5.0 (X11; Linux x86_64; rv:121.0) Gecko/20100101 Firefox/121.0"


class ParseTests(SimpleTestCase):
    def test_labels(self):
        self.assertEqual(devices.device_label(CHROME_WIN), "Chrome on Windows")
        self.assertEqual(devices.device_label(SAFARI_IPHONE), "Safari on iPhone")
        self.assertEqual(devices.device_label(FIREFOX_LINUX), "Firefox on Linux")
        self.assertEqual(devices.device_label("Mozilla/5.0 (Windows NT 10.0) Edg/120.0 Chrome/120 Safari/537"), "Edge on Windows")
        self.assertEqual(devices.device_label(""), "")
        self.assertEqual(devices.parse_user_agent(SAFARI_IPHONE)[2], "phone")
        self.assertEqual(devices.parse_user_agent(CHROME_WIN)[2], "desktop")

    def test_masking_hides_the_last_part(self):
        self.assertEqual(devices.mask_ip("203.0.113.77"), "203.0.113.x")
        self.assertEqual(devices.mask_ip("2001:db8:abcd:12::5"), "2001:0db8:abcd:x")
        self.assertEqual(devices.mask_ip("not an address"), "")


class DeviceTests(ApiTestCase):
    def login(self, ua=CHROME_WIN, ip="203.0.113.77", country="QA"):
        return APIClient().post(
            API + "auth/login", {"email": "a@example.com", "password": self.password}, format="json",
            HTTP_X_CLIENT_USER_AGENT=ua, HTTP_X_BENCH_CLIENT_IP=ip, HTTP_CF_IPCOUNTRY=country,
        )

    def setUp(self):
        super().setUp()
        APIClient().post(
            API + "auth/register", {"email": "a@example.com", "password": self.password, "full_name": "Ann"}, format="json",
            HTTP_X_CLIENT_USER_AGENT=CHROME_WIN,
        )
        mail.outbox.clear()

    def test_list_marks_this_device_and_masks_the_address(self):
        first = self.login()
        client = self.client_for(first.data["access"])
        data = client.get(API + "auth/devices").data
        mine = [s for s in data["sessions"] if s["current"]]
        self.assertEqual(len(mine), 1)
        self.assertEqual(mine[0]["label"], "Chrome on Windows")
        self.assertEqual(mine[0]["ip"], "203.0.113.x")
        self.assertEqual(mine[0]["country"], "QA")
        self.assertEqual(data["current_session_id"], mine[0]["id"])
        self.assertNotIn("203.0.113.77", str(data))
        self.assertTrue(mine[0]["last_used_at"] and mine[0]["created_at"])

    def test_sign_out_one_device_kills_its_refresh_token(self):
        phone = self.login(SAFARI_IPHONE)
        laptop = self.login()
        client = self.client_for(laptop.data["access"])
        sessions = client.get(API + "auth/devices").data["sessions"]
        other = next(s for s in sessions if s["label"] == "Safari on iPhone")
        self.assertEqual(client.delete(API + f"auth/devices/{other['id']}").status_code, 204)
        self.assertEqual(APIClient().post(API + "auth/refresh", {"refresh": phone.data["refresh"]}, format="json").status_code, 401)
        self.assertEqual(APIClient().post(API + "auth/refresh", {"refresh": laptop.data["refresh"]}, format="json").status_code, 200)
        self.assertFalse(Session.objects.filter(pk=other["id"]).exists())

    def test_current_device_cannot_be_removed_here_and_others_cannot_be_touched(self):
        client = self.client_for(self.login().data["access"])
        mine = next(s for s in client.get(API + "auth/devices").data["sessions"] if s["current"])
        res = client.delete(API + f"auth/devices/{mine['id']}")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "current_session"))
        stranger = self.signup("b@example.com")
        self.assertEqual(stranger.client.delete(API + f"auth/devices/{mine['id']}").status_code, 404)

    def test_sign_out_all_others_keeps_this_one(self):
        phone = self.login(SAFARI_IPHONE)
        linux = self.login(FIREFOX_LINUX)
        laptop = self.login()
        client = self.client_for(laptop.data["access"])
        res = client.post(API + "auth/devices/sign-out-others", {}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertGreaterEqual(res.data["signed_out"], 2)
        for other in (phone, linux):
            self.assertEqual(APIClient().post(API + "auth/refresh", {"refresh": other.data["refresh"]}, format="json").status_code, 401)
        self.assertEqual(APIClient().post(API + "auth/refresh", {"refresh": laptop.data["refresh"]}, format="json").status_code, 200)
        self.assertEqual(len(client.get(API + "auth/devices").data["sessions"]), 1)

    def test_refresh_keeps_the_session_and_follows_the_new_token(self):
        laptop = self.login()
        phone = self.login(SAFARI_IPHONE)
        rotated = APIClient().post(API + "auth/refresh", {"refresh": phone.data["refresh"]}, format="json").data
        client = self.client_for(rotated["access"])
        sessions = client.get(API + "auth/devices").data
        self.assertTrue(next(s for s in sessions["sessions"] if s["id"] == sessions["current_session_id"])["label"] == "Safari on iPhone")
        # Signing the phone out from the laptop still blocks the rotated token.
        laptop_client = self.client_for(laptop.data["access"])
        laptop_client.delete(API + f"auth/devices/{sessions['current_session_id']}")
        self.assertEqual(APIClient().post(API + "auth/refresh", {"refresh": rotated["refresh"]}, format="json").status_code, 401)

    def test_logout_removes_the_row(self):
        laptop = self.login()
        before = Session.objects.count()
        APIClient().post(API + "auth/logout", {"refresh": laptop.data["refresh"]}, format="json")
        self.assertEqual(Session.objects.count(), before - 1)

    def test_logout_everywhere_and_password_change_clear_the_list(self):
        laptop = self.login()
        client = self.client_for(laptop.data["access"])
        client.post(API + "auth/logout-all", {}, format="json")
        self.assertEqual(Session.objects.count(), 0)

    def test_new_device_mail_once_per_kind_of_device_and_not_for_the_first(self):
        self.login()  # same kind as the registration device: known already
        self.assertEqual(len(mail.outbox), 0)
        self.login(SAFARI_IPHONE)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("new device", mail.outbox[0].body.lower())
        self.assertIn("Safari on iPhone", mail.outbox[0].body)
        self.login(SAFARI_IPHONE)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(KnownDevice.objects.count(), 2)

    def test_new_device_mail_in_arabic(self):
        client = self.client_for(self.login().data["access"])
        client.patch(API + "auth/me", {"language": "ar"}, format="json")
        mail.outbox.clear()
        self.login(FIREFOX_LINUX)
        self.assertIn("تسجيل دخول جديد", mail.outbox[0].subject)

    def test_pruning_removes_idle_sessions_only(self):
        self.login()
        Session.objects.update(last_used_at=timezone.now() - timedelta(days=40))
        self.login(SAFARI_IPHONE)
        services.prune()
        self.assertEqual(Session.objects.count(), 1)

    def test_devices_need_sign_in(self):
        self.assertEqual(APIClient().get(API + "auth/devices").status_code, 401)

    def test_old_tokens_without_a_session_id_are_told_to_sign_in_again(self):
        from .test_reauth import legacy_client

        res = legacy_client("a@example.com").post(API + "auth/devices/sign-out-others", {}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "current_session_unknown"))
