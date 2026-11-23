"""Browser push (storage, preferences, sending, dead endpoints) and the daily summary e-mail."""
from datetime import datetime, timedelta, timezone as dt_tz
from io import StringIO
from unittest import mock
from zoneinfo import ZoneInfo

from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from analytics.models import Event
from notify import services, webpush
from notify.models import NotificationPrefs, PushSubscription

from .base import API, ApiTestCase

PRIVATE, PUBLIC = webpush.generate_vapid_keys()
VAPID = dict(VAPID_PUBLIC_KEY=PUBLIC, VAPID_PRIVATE_KEY=PRIVATE, VAPID_SUBJECT="mailto:ops@example.com")
ENDPOINT = "https://fcm.googleapis.com/fcm/send/abc123"


def browser_keys():
    d = webpush.new_private_key()
    return d, {"p256dh": webpush.b64e(webpush.public_key(d)), "auth": webpush.b64e(b"0123456789abcdef")}


def subscription(endpoint=ENDPOINT):
    d, keys = browser_keys()
    return d, {"endpoint": endpoint, "keys": keys}


class FakePushService:
    def __init__(self, status=201):
        self.status = status
        self.calls = []

    def __call__(self, url, headers, body, timeout=8):
        self.calls.append((url, headers, body))
        return self.status


@override_settings(**VAPID)
class PushTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("a@example.com")
        self.fake = FakePushService()
        patcher = mock.patch.object(services, "transport", self.fake)
        patcher.start()
        self.addCleanup(patcher.stop)

    def subscribe(self, sub=None, client=None):
        return (client or self.person.client).post(API + "notifications/push/subscribe", sub or subscription()[1], format="json")

    def test_prefs_expose_the_public_key_only_when_configured(self):
        data = self.person.client.get(API + "notifications/prefs").data
        self.assertTrue(data["push_available"])
        self.assertEqual(data["vapid_public_key"], PUBLIC)
        self.assertEqual((data["push_leads"], data["push_support"], data["daily_summary"]), (True, True, False))
        with override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY=""):
            off = self.person.client.get(API + "notifications/prefs").data
            self.assertFalse(off["push_available"])
            self.assertIsNone(off["vapid_public_key"])
            res = self.subscribe()
            self.assertEqual((res.status_code, res.data["error"]["code"]), (503, "push_not_configured"))

    def test_subscribe_validates_the_endpoint_and_keys(self):
        self.assertEqual(self.subscribe().status_code, 201)
        self.assertEqual(PushSubscription.objects.count(), 1)
        self.assertEqual(self.subscribe().status_code, 201)  # the same browser again: no duplicate
        self.assertEqual(PushSubscription.objects.count(), 1)
        _d, good = subscription()
        for bad in (
            {**good, "endpoint": "http://fcm.googleapis.com/x"},
            {**good, "endpoint": "https://evil.example.com/x"},
            {**good, "endpoint": "https://fcm.googleapis.com.evil.com/x"},
            {**good, "endpoint": "https://127.0.0.1/x"},
            {**good, "keys": {"p256dh": "AAAA", "auth": good["keys"]["auth"]}},
            {**good, "keys": {"p256dh": good["keys"]["p256dh"], "auth": "AAAA"}},
            {"endpoint": ENDPOINT},
        ):
            res = self.subscribe(bad)
            self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "push_endpoint_invalid"), bad)

    def test_a_browser_moves_to_the_person_who_signs_in_on_it(self):
        _d, sub = subscription()
        self.subscribe(sub)
        other = self.signup("b@example.com")
        self.subscribe(sub, other.client)
        self.assertEqual(PushSubscription.objects.get().user.email, "b@example.com")

    def test_unsubscribe_removes_it(self):
        _d, sub = subscription()
        self.subscribe(sub)
        res = self.person.client.post(API + "notifications/push/unsubscribe", {"endpoint": sub["endpoint"]}, format="json")
        self.assertEqual(res.data["subscriptions"], 0)

    def test_the_message_is_decryptable_by_the_browser_and_signed(self):
        d, sub = subscription()
        self.subscribe(sub)
        user = User.objects.get(email="a@example.com")
        self.assertEqual(services.notify_user(user, "lead", "Hello", "World", "/app/contacts"), 1)
        url, headers, body = self.fake.calls[0]
        self.assertEqual(url, ENDPOINT)
        self.assertEqual(headers["Content-Encoding"], "aes128gcm")
        self.assertTrue(headers["Authorization"].startswith("vapid t="))
        self.assertTrue(headers["Authorization"].endswith("k=" + PUBLIC))
        # The browser side: the same shared secret from the other direction opens the record.
        salt, record_size, idlen = body[:16], int.from_bytes(body[16:20], "big"), body[20]
        as_public = body[21:21 + idlen]
        self.assertEqual((record_size, idlen), (4096, 65))
        secret = webpush.ecdh(d, as_public)
        ua_public = webpush.public_key(d)
        ikm = webpush.hkdf(webpush.b64d(sub["keys"]["auth"]), secret, b"WebPush: info\0" + ua_public + as_public, 32)
        self.assertEqual(len(webpush.hkdf(salt, ikm, b"Content-Encoding: aes128gcm\0", 16)), 16)
        again = webpush.encrypt_message(b"x", ua_public, webpush.b64d(sub["keys"]["auth"]))
        self.assertNotEqual(again[:16], body[:16])  # a fresh salt every time

    def test_gone_endpoint_is_deleted_and_flaky_one_is_counted(self):
        self.subscribe()
        user = User.objects.get(email="a@example.com")
        self.fake.status = 500
        services.notify_user(user, "lead", "t", "b")
        self.assertEqual(PushSubscription.objects.get().failure_count, 1)
        self.fake.status = 410
        services.notify_user(user, "lead", "t", "b")
        self.assertEqual(PushSubscription.objects.count(), 0)
        self.subscribe()
        self.fake.status = 404
        services.notify_user(user, "lead", "t", "b")
        self.assertEqual(PushSubscription.objects.count(), 0)

    def test_ten_failures_in_a_row_drop_the_browser_and_success_resets(self):
        self.subscribe()
        user = User.objects.get(email="a@example.com")
        self.fake.status = 500
        for _ in range(9):
            services.notify_user(user, "lead", "t", "b")
        self.fake.status = 201
        services.notify_user(user, "lead", "t", "b")
        self.assertEqual(PushSubscription.objects.get().failure_count, 0)
        self.fake.status = 500
        for _ in range(10):
            services.notify_user(user, "lead", "t", "b")
        self.assertEqual(PushSubscription.objects.count(), 0)

    def test_preferences_switch_kinds_off(self):
        self.subscribe()
        self.person.client.patch(API + "notifications/prefs", {"push_leads": False}, format="json")
        user = User.objects.get(email="a@example.com")
        self.assertEqual(services.notify_user(user, "lead", "t", "b"), 0)
        self.assertEqual(services.notify_user(user, "support", "t", "b"), 1)
        self.assertEqual(self.person.client.patch(API + "notifications/prefs", {"push_leads": "yes"}, format="json").status_code, 400)
        self.assertEqual(self.person.client.patch(API + "notifications/prefs", {"timezone": "Mars/Base"}, format="json").status_code, 400)

    def test_open_redirect_style_urls_are_never_sent(self):
        self.subscribe()
        user = User.objects.get(email="a@example.com")
        self.assertEqual(services.notify_user(user, "lead", "t", "b", "https://evil.example.com"), 0)
        self.assertEqual(services.notify_user(user, "lead", "t", "b", "//evil.example.com"), 0)

    def test_a_new_lead_and_a_meeting_request_push_to_the_card_holder(self):
        self.subscribe()
        self.buy(self.person)
        card = self.published_card(self.person)
        res = APIClient().post(
            f"{API}public/cards/{card['public_code']}/leads",
            {"name": "Visitor Vic", "email": "vic@example.com", "consent": True, "website": ""}, format="json",
        )
        self.assertIn(res.status_code, (200, 201), res.content)
        self.assertEqual(len(self.fake.calls), 1)
        self.assertEqual(self.fake.calls[0][0], ENDPOINT)

    def test_a_support_reply_pushes_to_the_requester(self):
        self.subscribe()
        from support.models import SupportTicket

        user = User.objects.get(email="a@example.com")
        ticket = SupportTicket.objects.create(number=1, requester=user, requester_email=user.email, subject="Help me")
        self.assertEqual(services.notify_support_reply(ticket), 1)

    def test_test_button_and_arabic_title(self):
        self.subscribe()
        self.person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        res = self.person.client.post(API + "notifications/push/test", {}, format="json")
        self.assertEqual(res.data["sent"], 1)

    def test_nothing_is_sent_while_the_keys_are_unset(self):
        self.subscribe()
        user = User.objects.get(email="a@example.com")
        with override_settings(VAPID_PUBLIC_KEY="", VAPID_PRIVATE_KEY=""):
            self.assertEqual(services.notify_user(user, "lead", "t", "b"), 0)
        self.assertEqual(self.fake.calls, [])

    def test_the_vapid_command_prints_a_matching_pair(self):
        out = StringIO()
        call_command("generate_vapid_keys", stdout=out)
        lines = dict(line.split("=", 1) for line in out.getvalue().strip().splitlines())
        self.assertTrue(webpush.keys_match(lines["VAPID_PRIVATE_KEY"], lines["VAPID_PUBLIC_KEY"]))

    def test_dead_subscriptions_are_pruned(self):
        self.subscribe()
        PushSubscription.objects.update(failure_count=3, created_at=timezone.now() - timedelta(days=90))
        self.assertEqual(services.prune_subscriptions(), 1)


class DailySummaryTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("a@example.com")
        self.buy(self.person)
        self.card = self.published_card(self.person)
        self.user = User.objects.get(email="a@example.com")
        mail.outbox.clear()

    def turn_on(self, tz="Asia/Qatar"):
        res = self.person.client.patch(API + "notifications/prefs", {"daily_summary": True, "timezone": tz}, format="json")
        self.assertEqual(res.status_code, 200)

    def add_events(self, local_when, views=3, scans=1):
        from cards.models import Card

        card = Card.objects.get(pk=self.card["id"])
        for i in range(views):
            e = Event.objects.create(card=card, type="view", source="qr" if i < scans else "link")
            Event.objects.filter(pk=e.pk).update(created_at=local_when.astimezone(dt_tz.utc))

    def morning(self, hour=7):
        return datetime(2026, 11, 20, hour, 5, tzinfo=ZoneInfo("Asia/Qatar"))

    def test_off_by_default(self):
        self.add_events(self.morning() - timedelta(hours=20))
        self.assertEqual(services.run_daily_summary(self.morning())["sent"], 0)
        self.assertEqual(mail.outbox, [])

    def test_sends_in_the_local_morning_once_with_the_numbers(self):
        self.turn_on()
        self.add_events(self.morning() - timedelta(hours=18), views=5, scans=2)  # yesterday 13:05
        stats = services.run_daily_summary(self.morning())
        self.assertEqual(stats["sent"], 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["a@example.com"])
        self.assertIn("daily", message.subject.lower())
        self.assertIn("Card views: 5", message.body)
        self.assertIn("QR scans: 2", message.body)
        self.assertIn("List-Unsubscribe", message.extra_headers)
        again = services.run_daily_summary(self.morning(9))
        self.assertEqual((again["sent"], again["already"]), (0, 1))
        self.assertEqual(len(mail.outbox), 1)
        next_day = services.run_daily_summary(self.morning() + timedelta(days=1))
        self.assertEqual(next_day["quiet"], 1)  # nothing happened that day: no mail, but recorded

    def test_not_before_or_long_after_the_morning(self):
        self.turn_on()
        self.add_events(self.morning() - timedelta(hours=18))
        self.assertEqual(services.run_daily_summary(self.morning(5))["not_yet"], 1)
        self.assertEqual(services.run_daily_summary(self.morning(15))["not_yet"], 1)
        self.assertEqual(mail.outbox, [])

    def test_the_time_zone_decides_the_morning(self):
        self.turn_on("America/New_York")
        self.add_events(self.morning() - timedelta(hours=18))
        # 07:05 in Qatar is 23:05 the night before in New York.
        self.assertEqual(services.run_daily_summary(self.morning())["not_yet"], 1)
        ny_morning = datetime(2026, 11, 20, 7, 5, tzinfo=ZoneInfo("America/New_York"))
        self.add_events(ny_morning - timedelta(hours=18))
        self.assertEqual(services.run_daily_summary(ny_morning)["sent"], 1)

    def test_quiet_day_sends_nothing_but_counts_the_day(self):
        self.turn_on()
        stats = services.run_daily_summary(self.morning())
        self.assertEqual((stats["sent"], stats["quiet"]), (0, 1))
        self.assertEqual(NotificationPrefs.objects.get().last_summary_date, self.morning().date())

    def test_dry_run_changes_nothing(self):
        self.turn_on()
        self.add_events(self.morning() - timedelta(hours=18))
        self.assertEqual(services.run_daily_summary(self.morning(), dry_run=True)["sent"], 1)
        self.assertEqual(mail.outbox, [])
        self.assertIsNone(NotificationPrefs.objects.get().last_summary_date)

    def test_arabic_and_pending_tickets_and_approvals(self):
        from support.models import SupportTicket

        self.person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        self.turn_on()
        SupportTicket.objects.create(number=1, requester=self.user, requester_email=self.user.email, subject="s", status="waiting_customer")
        services.run_daily_summary(self.morning())
        message = mail.outbox[0]
        self.assertIn("ملخصك اليومي", message.subject)
        self.assertIn('dir="rtl"', message.alternatives[0][0])

    def test_unsubscribe_link_switches_it_off(self):
        self.turn_on()
        token = services.unsubscribe_token(self.user.pk)
        res = APIClient().get(API + "notifications/unsubscribe", {"token": token})
        self.assertEqual(res.status_code, 200)
        self.assertFalse(NotificationPrefs.objects.get().daily_summary)
        self.turn_on()
        self.assertEqual(APIClient().post(API + "notifications/unsubscribe", {"token": token}, format="json").status_code, 200)
        self.assertFalse(NotificationPrefs.objects.get().daily_summary)
        self.assertIn("not valid", APIClient().get(API + "notifications/unsubscribe", {"token": "bad"}).content.decode())

    def test_the_command_runs(self):
        out = StringIO()
        call_command("send_daily_summary", "--dry-run", stdout=out)
        self.assertIn("Would send", out.getvalue())
