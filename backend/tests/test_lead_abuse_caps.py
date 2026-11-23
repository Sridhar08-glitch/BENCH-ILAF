"""The public contact form cannot flood a card, bury an address in mail, or put a stranger's text in a subject."""
from django.core import mail
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from leads.models import Lead
from leads.services import _subject_name

from .base import API, ApiTestCase


class CapTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("owner@example.com", "Olivia Owner")
        self.buy(self.person)
        self.card = self.published_card(self.person)
        self.url = f"{API}public/cards/{self.card['public_code']}/leads"

    def send(self, name="Visitor", **extra):
        body = {"name": name, "email": "v@example.com", "consent": True, **extra}
        return APIClient().post(self.url, body, format="json")

    @override_settings(LEAD_MAX_PER_CARD_PER_DAY=3)
    def test_daily_ceiling_per_card(self):
        codes = [self.send(f"Visitor {i}").status_code for i in range(5)]
        self.assertEqual(codes, [201, 201, 201, 429, 429])
        self.assertEqual(Lead.objects.count(), 3)

    @override_settings(LEAD_MAX_PER_CARD_PER_DAY=3)
    def test_old_leads_do_not_count_towards_today(self):
        from datetime import timedelta

        from django.utils import timezone

        for i in range(3):
            self.send(f"Old {i}")
        Lead.objects.update(created_at=timezone.now() - timedelta(days=2))
        self.assertEqual(self.send("Fresh").status_code, 201)

    @override_settings(LEAD_NOTIFY_MAX_PER_RECIPIENT_PER_DAY=2)
    def test_mail_to_one_address_is_capped_but_leads_are_saved(self):
        for i in range(4):
            self.assertEqual(self.send(f"Visitor {i}").status_code, 201)
        self.assertEqual(Lead.objects.count(), 4)
        self.assertEqual(len([m for m in mail.outbox if "owner@example.com" in m.to]), 2)

    @override_settings(LEAD_NOTIFY_MAX_PER_RECIPIENT_PER_DAY=0)
    def test_zero_means_no_limit(self):
        for i in range(4):
            self.send(f"Visitor {i}")
        self.assertEqual(len(mail.outbox), 4)

    def test_subject_never_carries_a_link_or_address(self):
        for name in ("Win a prize at http://evil.example/x", "buy@evil.example", "visit www.evil.xyz now", "Cheap pills evil.com"):
            mail.outbox.clear()
            self.send(name)
            subject = mail.outbox[-1].subject
            self.assertNotIn("evil", subject)
            self.assertIn("A visitor", subject)

    def test_normal_names_keep_their_place_in_the_subject(self):
        self.send("Maryam Al-Thani")
        self.assertIn("Maryam Al-Thani", mail.outbox[-1].subject)


class SubjectNameTests(SimpleTestCase):
    def test_rules(self):
        self.assertEqual(_subject_name("  Sam   Seller "), "Sam Seller")
        self.assertEqual(_subject_name("x" * 100), "x" * 40)
        self.assertEqual(_subject_name(""), "A visitor")
        self.assertEqual(_subject_name("Look: https://a.b"), "A visitor")
        self.assertEqual(_subject_name("أحمد"), "أحمد")
