"""`prune_analytics` rolls up old events without changing the numbers the product shows, and tidies old rows."""
import re
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.utils import timezone

from accounts.models import PasswordResetToken, User
from analytics import weekly
from analytics.models import Event
from analytics.management.commands.prune_analytics import bucket_start, roll_up_events
from cards.models import Card
from leads.models import WebhookDelivery, WebhookEndpoint
from operations.models import AuditEvent
from workspaces.models import Member

from .base import API
from .ops_base import OpsTestCase


def strip_uniques(value):
    """Unique visitors cannot survive roll-up (the visitor hash is what gets removed); drop them from comparisons."""
    if isinstance(value, dict):
        return {k: strip_uniques(v) for k, v in value.items() if k not in ("unique_visitors", "visitors")}
    if isinstance(value, list):
        return [strip_uniques(v) for v in value]
    return value


class PruneCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.sales = self.department("Sales")
        self.eve = self.add("eve@example.com", "Eve Employee", department_id=self.sales["id"])
        self.sam = self.add("sam@example.com", "Sam Seller")
        self.cards = [Card.objects.get(pk=self.eve.card_id), Card.objects.get(pk=self.sam.card_id)]

    def event(self, card, type_, days_ago, hour, minute=0, **kw):
        when = (timezone.now() - timedelta(days=days_ago)).replace(hour=hour, minute=minute, second=7, microsecond=0)
        e = Event.objects.create(card=card, type=type_, **kw)
        Event.objects.filter(pk=e.pk).update(created_at=when)
        return e

    def seed(self):
        """Old (about 200 days ago) and recent events with every kind of attribute, spread over hours and minutes."""
        n = 0
        for card in self.cards:
            for days_ago in (200, 201, 207, 214, 5, 2):
                for hour in (0, 3, 9, 18, 19, 23):
                    for minute in (0, 14, 15, 44, 59):
                        n += 1
                        self.event(card, "view", days_ago, hour, minute, source=("qr", "nfc", "link", "email")[n % 4],
                                   country=("QA", "AE", "IN", "unknown")[n % 4], device=("ios", "android", "desktop")[n % 3],
                                   visitor_hash=f"h{n % 7}")
                if days_ago in (200, 207, 5):
                    self.event(card, "save", days_ago, 12, source="qr")
                    self.event(card, "tap", days_ago, 13)
                    self.event(card, "link_click", days_ago, 14, kind=("WhatsApp", "Website")[days_ago % 2], visitor_hash="x")
        return n

    def snapshot(self):
        out = {}
        for tz in ("UTC", "Asia/Kolkata", "Asia/Kathmandu", "America/New_York"):
            for group in ("day", "week", "month"):
                out[("overview", tz, group)] = self.owner.client.get(self.url("analytics"), {"days": 365, "tz": tz, "group": group}).data
            out[("window", tz)] = self.owner.client.get(self.url("analytics"), {"days": 120, "tz": tz}).data
            out[("old", tz)] = self.owner.client.get(self.url("analytics"), {"from": (timezone.now() - timedelta(days=230)).date().isoformat(),
                                                    "to": (timezone.now() - timedelta(days=195)).date().isoformat(), "tz": tz, "group": "week"}).data
            for name in ("people", "departments", "links", "sources"):
                out[(name, tz)] = self.owner.client.get(self.url(f"analytics/{name}"), {"days": 365, "tz": tz}).data
        out["stats"] = self.owner.client.get(f"{API}workspaces/{self.ws}/cards").data
        return strip_uniques(out)

    def old_week_text(self):
        week = weekly.week_of((timezone.now() - timedelta(days=203)).date() - timedelta(days=(timezone.now() - timedelta(days=203)).weekday()))
        member = Member.objects.get(workspace_id=self.ws, user__email="owner@example.com")
        subject, text, html, data = weekly.build(member, "company", week)
        return re.sub(r"token=[^\s\"<>]+", "token=X", text), strip_uniques(data)


class RollUpTests(PruneCase):
    def test_every_number_the_product_shows_is_unchanged(self):
        total = self.seed()
        before = self.snapshot()
        weekly_before = self.old_week_text()
        raw_before = Event.objects.count()
        out = StringIO()
        call_command("prune_analytics", "--days", "100", stdout=out)
        self.assertLessEqual(Event.objects.count(), raw_before)
        self.assertTrue(Event.objects.filter(rolled=True).exists())
        self.assertEqual(Event.objects.filter(rolled=True, visitor_hash="").count(), Event.objects.filter(rolled=True).count())
        self.assertEqual(sum(Event.objects.values_list("weight", flat=True)), raw_before)
        self.assertEqual(self.snapshot(), before)
        self.assertEqual(self.old_week_text(), weekly_before)
        # recent events are untouched
        self.assertFalse(Event.objects.filter(rolled=False, created_at__lt=timezone.now() - timedelta(days=100)).exists())
        self.assertGreater(total, 0)

    def test_total_weight_equals_total_events(self):
        self.seed()
        total_before = sum(Event.objects.values_list("weight", flat=True))
        call_command("prune_analytics", "--days", "100", stdout=StringIO())
        self.assertEqual(sum(Event.objects.values_list("weight", flat=True)), total_before)

    def test_running_twice_changes_nothing_more(self):
        self.seed()
        call_command("prune_analytics", "--days", "100", stdout=StringIO())
        rows = list(Event.objects.order_by("id").values_list("id", "weight", "rolled"))
        call_command("prune_analytics", "--days", "100", stdout=StringIO())
        self.assertEqual(list(Event.objects.order_by("id").values_list("id", "weight", "rolled")), rows)

    def test_new_run_with_a_later_cutoff_folds_into_existing_rows(self):
        self.seed()
        call_command("prune_analytics", "--days", "150", stdout=StringIO())
        before = self.snapshot()
        call_command("prune_analytics", "--days", "3", stdout=StringIO())  # also rolls the 5-day-old ones
        self.assertEqual(self.snapshot(), before)

    def test_small_batches_give_the_same_result(self):
        self.seed()
        before = self.snapshot()
        call_command("prune_analytics", "--days", "100", "--batch", "37", stdout=StringIO())
        self.assertEqual(self.snapshot(), before)

    def test_a_bucket_never_mixes_cards_or_attributes(self):
        card_a, card_b = self.cards
        self.event(card_a, "view", 300, 10, 1, country="QA", device="ios", source="qr")
        self.event(card_a, "view", 300, 10, 2, country="QA", device="ios", source="qr")
        self.event(card_a, "view", 300, 10, 3, country="AE", device="ios", source="qr")
        self.event(card_b, "view", 300, 10, 3, country="QA", device="ios", source="qr")
        self.event(card_a, "view", 300, 10, 16, country="QA", device="ios", source="qr")
        call_command("prune_analytics", "--days", "100", stdout=StringIO())
        rows = sorted(Event.objects.filter(rolled=True).values_list("card_id", "country", "weight"), key=str)
        self.assertEqual(len(rows), 4)
        self.assertEqual(sorted(w for _, _, w in rows), [1, 1, 1, 2])

    def test_dry_run_and_minimum_retention(self):
        self.seed()
        count = Event.objects.count()
        out = StringIO()
        call_command("prune_analytics", "--days", "100", "--dry-run", stdout=out)
        self.assertIn("Would roll up", out.getvalue())
        self.assertEqual(Event.objects.count(), count)
        err = StringIO()
        call_command("prune_analytics", "--days", "5", stdout=StringIO(), stderr=err)
        self.assertIn("Refusing", err.getvalue())
        self.assertEqual(Event.objects.count(), count)

    def test_default_retention_is_400_days(self):
        from django.conf import settings

        self.assertEqual(settings.ANALYTICS_RETENTION_DAYS, 400)
        self.event(self.cards[0], "view", 399, 10)
        self.event(self.cards[0], "view", 401, 10)
        call_command("prune_analytics", stdout=StringIO())
        self.assertEqual(Event.objects.filter(rolled=True).count(), 1)
        self.assertEqual(Event.objects.filter(rolled=False).count(), 1)

    def test_unique_visitors_for_recent_days_are_kept(self):
        for _ in range(3):
            self.event(self.cards[0], "view", 2, 10, visitor_hash="same")
        self.event(self.cards[0], "view", 2, 11, visitor_hash="other")
        self.event(self.cards[0], "view", 300, 11, visitor_hash="old")
        call_command("prune_analytics", "--days", "100", stdout=StringIO())
        data = self.owner.client.get(self.url("analytics"), {"days": 7}).data
        self.assertEqual((data["totals"]["views"], data["totals"]["unique_visitors"]), (4, 2))

    def test_bucket_helper(self):
        moment = timezone.now().replace(minute=44, second=59, microsecond=5)
        self.assertEqual(bucket_start(moment).minute, 30)

    def test_roll_up_stops_after_max_batches(self):
        self.seed()
        done, _ = roll_up_events(timezone.now() - timedelta(days=100), batch=10, max_batches=2)
        self.assertEqual(done, 20)


class OtherPruningTests(PruneCase):
    def test_old_finished_webhook_deliveries_go_but_pending_and_recent_stay(self):
        endpoint = WebhookEndpoint.objects.create(workspace_id=self.ws, url="https://h.example.com/x", secret="s", events=["lead.created"])
        old = timezone.now() - timedelta(days=95)
        rows = {}
        for status in ("success", "failed", "pending"):
            rows[status] = WebhookDelivery.objects.create(endpoint=endpoint, event_type="lead.created", payload={}, status=status)
            WebhookDelivery.objects.filter(pk=rows[status].pk).update(created_at=old)
        recent = WebhookDelivery.objects.create(endpoint=endpoint, event_type="lead.created", payload={}, status="success")
        call_command("prune_analytics", stdout=StringIO())
        self.assertEqual(set(WebhookDelivery.objects.values_list("pk", flat=True)), {rows["pending"].pk, recent.pk})

    def test_reset_tokens_and_expired_invitation_links(self):
        user = User.objects.get(email="owner@example.com")
        PasswordResetToken.objects.create(user=user, token_hash="a" * 64)
        PasswordResetToken.objects.create(user=user, token_hash="b" * 64)
        PasswordResetToken.objects.filter(token_hash="a" * 64).update(created_at=timezone.now() - timedelta(days=2))
        long_ago = self.invited("old@example.com")
        fresh = self.invited("new@example.com")
        Member.objects.filter(pk=long_ago.member_id).update(invited_at=timezone.now() - timedelta(days=60), invite_sent_at=None)
        call_command("prune_analytics", stdout=StringIO())
        self.assertEqual(list(PasswordResetToken.objects.values_list("token_hash", flat=True)), ["b" * 64])
        self.assertIsNone(Member.objects.get(pk=long_ago.member_id).invite_token)
        self.assertEqual(Member.objects.get(pk=long_ago.member_id).status, "invited")  # the seat stays; a resend makes a new link
        self.assertIsNotNone(Member.objects.get(pk=fresh.member_id).invite_token)

    def test_resend_works_after_the_link_was_cleared(self):
        long_ago = self.invited("old@example.com")
        Member.objects.filter(pk=long_ago.member_id).update(invited_at=timezone.now() - timedelta(days=60), invite_sent_at=None)
        call_command("prune_analytics", stdout=StringIO())
        res = self.owner.client.post(self.url(f"members/{long_ago.member_id}/resend-invite"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNotNone(Member.objects.get(pk=long_ago.member_id).invite_token)

    def test_audit_entries_are_kept(self):
        AuditEvent.objects.filter(workspace_id=self.ws).update(created_at=timezone.now() - timedelta(days=900))
        count = AuditEvent.objects.count()
        call_command("prune_analytics", stdout=StringIO())
        self.assertEqual(AuditEvent.objects.count(), count)
        self.assertGreater(count, 0)
