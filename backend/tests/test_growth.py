"""Launch features: the per-card search-engine setting and leads saved in event mode."""
from django.core import mail
from rest_framework.test import APIClient

from leads.models import Lead
from ilaf.i18n import translate_message

from .base import API, ApiTestCase
from .ops_base import OpsTestCase


class SeoIndexableTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person)
        self.anon = APIClient()

    def test_default_is_off_and_the_public_page_says_so(self):
        card = self.published_card(self.person)
        self.assertIs(card["seo_indexable"], False)
        public = self.anon.get(f"{API}public/cards/{card['public_code']}").data
        self.assertIs(public["card"]["seo_indexable"], False)

    def test_owner_can_turn_it_on_and_off(self):
        card = self.published_card(self.person)
        on = self.person.client.patch(f"{API}cards/{card['id']}", {"seo_indexable": True}, format="json")
        self.assertEqual(on.status_code, 200, on.content)
        self.assertIs(on.data["seo_indexable"], True)
        public = self.anon.get(f"{API}public/cards/{card['public_code']}").data
        self.assertIs(public["card"]["seo_indexable"], True)
        off = self.person.client.patch(f"{API}cards/{card['id']}", {"seo_indexable": False}, format="json")
        self.assertIs(off.data["seo_indexable"], False)

    def test_other_edits_keep_the_setting(self):
        card = self.published_card(self.person)
        self.person.client.patch(f"{API}cards/{card['id']}", {"seo_indexable": True}, format="json")
        res = self.person.client.patch(f"{API}cards/{card['id']}", {"title": "Chair"}, format="json")
        self.assertIs(res.data["seo_indexable"], True)


class EventLeadTests(OpsTestCase):
    def post(self, body, client=None):
        return (client or self.owner.client).post(self.url("leads"), body, format="json")

    def test_event_lead_keeps_source_tag_and_event(self):
        res = self.post({"source": "event", "name": "Omar", "company": "Zeta", "tag": "hot", "event_name": "Expo 2027", "note": "Wants a demo"})
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.data["source"], res.data["tag"], res.data["event_name"]), ("event", "hot", "Expo 2027"))
        self.assertEqual(self.owner.client.get(self.url("leads") + "?source=event").data["count"], 1)
        self.assertEqual(len(mail.outbox), 0)

    def test_event_lead_needs_no_name_but_needs_something(self):
        self.assertEqual(self.post({"source": "event", "email": "x@example.com"}).status_code, 201)
        self.assertEqual(self.post({"source": "event", "note": "Tall, blue jacket"}).status_code, 201)
        self.assertEqual(self.post({"source": "event"}).status_code, 400)
        self.assertEqual(self.post({"source": "event", "tag": "hot"}).status_code, 400)

    def test_scanned_card_still_needs_a_name_and_stays_the_default(self):
        self.assertEqual(self.post({"email": "a@b.co"}).status_code, 400)
        self.assertEqual(self.post({"name": "Sara"}).data["source"], "scanned_card")

    def test_unknown_source_and_tag_are_refused(self):
        bad_source = self.post({"source": "exchange", "name": "A"})
        self.assertEqual(bad_source.status_code, 400)
        self.assertIn("source", bad_source.data["error"]["fields"])
        self.assertEqual(self.post({"source": "event", "name": "A", "tag": "cold"}).status_code, 400)
        self.assertEqual(self.post({"name": "A", "tag": "hot"}).data["tag"], "hot")

    def test_sending_the_same_note_twice_saves_it_once(self):
        body = {"source": "event", "name": "Lina", "client_ref": "evt-123"}
        first = self.post(body)
        second = self.post(body)
        self.assertEqual((first.status_code, second.status_code), (201, 200))
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(Lead.objects.filter(client_ref="evt-123").count(), 1)

    def test_a_retry_never_returns_a_colleagues_lead(self):
        self.post({"source": "event", "name": "Lina", "client_ref": "evt-9"})
        other = self.add("eve@example.com", "Eve Employee")
        res = self.post({"source": "event", "name": "Lina", "client_ref": "evt-9"}, other.client)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Lead.objects.filter(client_ref="evt-9").count(), 2)

    def test_timeline_says_the_lead_was_created_from_an_event(self):
        res = self.post({"source": "event", "name": "Omar"})
        lead = Lead.objects.get(pk=res.data["id"])
        created = lead.activity.get(kind="created")
        self.assertEqual(created.details["source"], "event")

    def test_new_messages_have_arabic_texts(self):
        for text in ("Choose a valid source.", "Choose a valid tag."):
            self.assertNotEqual(translate_message("ar", text), text)
