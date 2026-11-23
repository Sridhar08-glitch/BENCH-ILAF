"""Card features: exchange contact, meeting button and request form, lead settings, QR PNG, scanned-card leads."""
import time

from django.core import mail
from django.test import override_settings
from rest_framework.test import APIClient

from leads.models import Lead

from .base import API, BIG_RATES, ApiTestCase
from .ops_base import OpsTestCase


class MeetingItemTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.base_card = self.make_card(self.person)

    def put_items(self, items):
        return self.person.client.patch(f"{API}cards/{self.base_card['id']}", {"items": items}, format="json")

    def test_https_booking_links_are_kept(self):
        res = self.put_items([{"kind": "Meeting", "value": "https://calendly.com/alice/30min"}])
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["items"][0]["value"], "https://calendly.com/alice/30min")

    def test_bare_domain_gets_https(self):
        res = self.put_items([{"kind": "Meeting", "value": "cal.com/alice"}])
        self.assertEqual(res.data["items"][0]["value"], "https://cal.com/alice")

    def test_only_https_is_allowed(self):
        for value in ("http://calendly.com/alice", "javascript:alert(1)", "ftp://x.example.com/a", "tel:+97455550000", "not a link", "localhost"):
            res = self.put_items([{"kind": "Meeting", "value": value}])
            self.assertEqual(res.status_code, 400, value)
            self.assertEqual(res.data["error"]["code"], "validation_error")

    def test_form_word_selects_the_built_in_form(self):
        res = self.put_items([{"kind": "Meeting", "value": "FORM"}])
        self.assertEqual(res.data["items"][0]["value"], "form")

    def test_public_href(self):
        card = self.published_card(self.person, items=[
            {"kind": "Meeting", "value": "https://cal.com/alice"}, {"kind": "Meeting", "value": "form"},
        ])
        data = APIClient().get(f"{API}public/cards/{card['public_code']}").data["card"]
        self.assertEqual([i["href"] for i in data["items"]], ["https://cal.com/alice", "#meeting-request"])
        self.assertTrue(data["features"]["meeting_form"])

    def test_known_providers(self):
        from ilaf.items import meeting_provider

        self.assertEqual(meeting_provider("https://calendly.com/a"), "Calendly")
        self.assertEqual(meeting_provider("https://calendar.app.google/xyz"), "Google Calendar")
        self.assertEqual(meeting_provider("https://app.cal.com/a"), "Cal.com")
        self.assertEqual(meeting_provider("https://outlook.office365.com/book/x"), "Microsoft Bookings")
        self.assertIsNone(meeting_provider("https://example.com/book"))
        self.assertIsNone(meeting_provider("https://evilcalendly.com/a"))


class ExchangeSettingsTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.make_card(self.person)

    def test_defaults(self):
        self.assertEqual(self.card["features"]["exchange"]["enabled"], True)
        self.assertEqual(self.card["features"]["exchange"]["fields"], {"email": "optional", "phone": "optional", "company": "optional", "note": "optional"})

    def test_partial_update_merges(self):
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"features": {"exchange": {"fields": {"phone": "required"}}}}, format="json")
        self.assertEqual(res.status_code, 200)
        ex = res.data["features"]["exchange"]
        self.assertEqual(ex["fields"]["phone"], "required")
        self.assertEqual(ex["fields"]["email"], "optional")
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"features": {"exchange": {"enabled": False}}}, format="json")
        ex = res.data["features"]["exchange"]
        self.assertFalse(ex["enabled"])
        self.assertEqual(ex["fields"]["phone"], "required")

    def test_bad_values_are_refused(self):
        url = f"{API}cards/{self.card['id']}"
        for body in (
            {"exchange": {"enabled": "yes"}},
            {"exchange": {"fields": {"email": "maybe"}}},
            {"exchange": {"fields": {"email": "off", "phone": "off"}}},
            {"exchange": {"consent_text": "x" * 400}},
        ):
            res = self.person.client.patch(url, {"features": body}, format="json")
            self.assertEqual(res.status_code, 400, body)
            self.assertEqual(res.data["error"]["code"], "validation_error")

    def test_public_payload_has_consent_and_privacy_link(self):
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        pub = APIClient().get(f"{API}public/cards/{self.card['public_code']}").data["card"]["features"]
        self.assertIn("Alice Anderson", pub["exchange"]["consent_text"])
        self.assertIsNone(pub["exchange"]["privacy_url"])
        self.person.client.patch(f"{API}workspaces/{self.person.ws}/lead-settings", {"privacy_url": "example.com/privacy"}, format="json")
        pub = APIClient().get(f"{API}public/cards/{self.card['public_code']}").data["card"]["features"]
        self.assertEqual(pub["exchange"]["privacy_url"], "https://example.com/privacy")
        self.person.client.patch(f"{API}cards/{self.card['id']}", {"features": {"exchange": {"consent_text": "I agree."}}}, format="json")
        pub = APIClient().get(f"{API}public/cards/{self.card['public_code']}").data["card"]["features"]
        self.assertEqual(pub["exchange"]["consent_text"], "I agree.")


class ExchangeLeadTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.published_card(self.person)
        self.anon = APIClient()
        self.url = f"{API}public/cards/{self.card['public_code']}/leads"
        self.good = {"name": "Visitor", "email": "v@example.com", "consent": True}

    def set_features(self, features):
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"features": features}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_lead_has_source_exchange_and_owner_is_emailed(self):
        res = self.anon.post(self.url, {**self.good, "note": "Met at the expo", "company": "Zeta", "source": "qr"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["vcard_url"].endswith(f"/public/cards/{self.card['public_code']}/vcard"))
        lead = Lead.objects.get()
        self.assertEqual((lead.source, lead.channel), ("exchange", "qr"))
        self.assertIsNotNone(lead.consented_at)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["alice@example.com"])
        self.assertIn("Visitor", mail.outbox[0].subject)
        self.assertIn("v@example.com", mail.outbox[0].body)
        self.assertIn("Met at the expo", mail.outbox[0].body)
        listed = self.person.client.get(f"{API}workspaces/{self.person.ws}/leads").data["results"][0]
        self.assertEqual(listed["source"], "exchange")

    def test_consent_is_required(self):
        res = self.anon.post(self.url, {"name": "V", "email": "v@example.com"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("consent", res.data["error"]["fields"])
        self.assertEqual(Lead.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_switched_off_card_refuses(self):
        self.set_features({"exchange": {"enabled": False}})
        res = self.anon.post(self.url, self.good, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "feature_off")

    def test_field_modes(self):
        self.set_features({"exchange": {"fields": {"phone": "required", "email": "off", "company": "off"}}})
        self.assertEqual(self.anon.post(self.url, {"name": "V", "consent": True}, format="json").status_code, 400)
        res = self.anon.post(self.url, {"name": "V", "phone": "+97455550000", "email": "ignored@example.com", "company": "Zeta", "consent": True}, format="json")
        self.assertEqual(res.status_code, 201)
        lead = Lead.objects.get()
        self.assertEqual((lead.phone, lead.email, lead.company), ("+97455550000", "", ""))

    def test_required_note(self):
        self.set_features({"exchange": {"fields": {"note": "required"}}})
        res = self.anon.post(self.url, self.good, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("note", res.data["error"]["fields"])

    def test_honeypot_sends_nothing(self):
        res = self.anon.post(self.url, {**self.good, "website_url": "http://spam.example"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Lead.objects.count(), 0)
        self.assertEqual(len(mail.outbox), 0)

    def test_time_check(self):
        now_ms = time.time() * 1000
        with override_settings(LEAD_MIN_FILL_SECONDS=3):
            for opened in (None, "abc", now_ms, now_ms - 3 * 86400 * 1000, now_ms + 60000):
                body = dict(self.good)
                if opened is not None:
                    body["opened_at"] = opened
                res = self.anon.post(self.url, body, format="json")
                self.assertEqual(res.status_code, 400, opened)
                self.assertEqual(res.data["error"]["code"], "too_fast")
            res = self.anon.post(self.url, {**self.good, "opened_at": now_ms - 10000}, format="json")
            self.assertEqual(res.status_code, 201)

    def test_per_address_cap_for_one_card(self):
        with override_settings(LEAD_MAX_PER_CARD_PER_HOUR=2):
            codes = [self.anon.post(self.url, self.good, format="json").status_code for _ in range(3)]
            self.assertEqual(codes, [201, 201, 429])
            other = self.published_card(self.person, name="Second")
            self.assertEqual(self.anon.post(f"{API}public/cards/{other['public_code']}/leads", self.good, format="json").status_code, 201)
            res = self.anon.post(self.url, self.good, HTTP_CF_CONNECTING_IP="9.9.9.9", format="json")
            self.assertEqual(res.status_code, 201)

    def test_failed_attempts_do_not_use_the_cap(self):
        with override_settings(LEAD_MAX_PER_CARD_PER_HOUR=1):
            self.assertEqual(self.anon.post(self.url, {"name": ""}, format="json").status_code, 400)
            self.assertEqual(self.anon.post(self.url, self.good, format="json").status_code, 201)

    def test_csv_and_json_carry_channel(self):
        self.anon.post(self.url, {**self.good, "source": "nfc"}, format="json")
        row = self.person.client.get(f"{API}workspaces/{self.person.ws}/leads").data["results"][0]
        self.assertEqual(row["channel"], "nfc")
        self.assertEqual(row["meeting_times"], [])


class CompanyNotifyTests(OpsTestCase):
    def test_admins_are_emailed_only_when_the_company_asks(self):
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        res = self.owner.client.post(f"{API}cards/{admin.card_id}/publish")
        self.assertEqual(res.status_code, 200, res.content)
        url = f"{API}public/cards/{res.data['public_code']}/leads"
        body = {"name": "Visitor", "email": "v@example.com", "consent": True}
        APIClient().post(url, body, format="json")
        self.assertEqual({tuple(m.to) for m in mail.outbox if "Visitor" in m.subject}, {("admin@example.com",)})
        mail.outbox.clear()
        res = self.owner.client.patch(self.url("lead-settings"), {"notify_admins": True}, format="json")
        self.assertEqual(res.status_code, 200)
        APIClient().post(url, body, format="json")
        got = sorted(a for m in mail.outbox for a in m.to)
        self.assertEqual(got, ["admin@example.com", "owner@example.com"])

    def test_only_managers_change_lead_settings(self):
        eve = self.add("eve@example.com", "Eve Employee")
        self.assertEqual(eve.client.get(self.url("lead-settings")).status_code, 200)
        self.assertEqual(eve.client.patch(self.url("lead-settings"), {"notify_admins": True}, format="json").status_code, 403)
        self.assertEqual(self.owner.client.patch(self.url("lead-settings"), {"privacy_url": "javascript:alert(1)"}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.patch(self.url("lead-settings"), {"privacy_url": "http://exa mple.com"}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.patch(self.url("lead-settings"), {"notify_admins": "yes"}, format="json").status_code, 400)
        res = self.owner.client.patch(self.url("lead-settings"), {"privacy_url": ""}, format="json")
        self.assertEqual(res.data, {"privacy_url": "", "notify_admins": False})
        self.assertEqual(APIClient().get(self.url("lead-settings")).status_code, 401)


class MeetingRequestTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.published_card(self.person, items=[{"kind": "Meeting", "value": "form"}])
        self.anon = APIClient()
        self.url = f"{API}public/cards/{self.card['public_code']}/meeting-requests"
        self.good = {"name": "Mo", "email": "mo@example.com", "times": ["Tue 10:00", "Wed after lunch"], "message": "Let us talk", "consent": True}

    def test_request_becomes_a_lead_and_an_email(self):
        res = self.anon.post(self.url, self.good, format="json")
        self.assertEqual(res.status_code, 201)
        lead = Lead.objects.get()
        self.assertEqual(lead.source, "meeting_request")
        self.assertEqual(lead.meeting_times, ["Tue 10:00", "Wed after lunch"])
        self.assertEqual(lead.note, "Let us talk")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Tue 10:00", mail.outbox[0].body)
        self.assertIn("Meeting request", mail.outbox[0].subject)
        row = self.person.client.get(f"{API}workspaces/{self.person.ws}/leads").data["results"][0]
        self.assertEqual((row["source"], row["meeting_times"]), ("meeting_request", ["Tue 10:00", "Wed after lunch"]))

    def test_validation(self):
        for patch in (
            {"times": []}, {"times": ["a", "b", "c", "d"]}, {"times": "tomorrow"}, {"times": [5]}, {"times": ["x" * 81]},
            {"email": ""}, {"email": "nope"}, {"name": ""}, {"consent": False},
        ):
            res = self.anon.post(self.url, {**self.good, **patch}, format="json")
            self.assertEqual(res.status_code, 400, patch)
        self.assertEqual(Lead.objects.count(), 0)

    def test_blank_times_are_dropped(self):
        res = self.anon.post(self.url, {**self.good, "times": ["", "Fri 9:00", "  "]}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Lead.objects.get().meeting_times, ["Fri 9:00"])

    def test_needs_a_form_button_on_the_card(self):
        card = self.published_card(self.person, items=[{"kind": "Meeting", "value": "https://cal.com/alice"}])
        res = self.anon.post(f"{API}public/cards/{card['public_code']}/meeting-requests", self.good, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "feature_off")
        off = self.person.client.patch(f"{API}cards/{self.card['id']}", {"items": [{"kind": "Meeting", "value": "form", "on": False}]}, format="json")
        self.assertEqual(off.status_code, 200)
        self.assertEqual(self.anon.post(self.url, self.good, format="json").status_code, 403)

    def test_honeypot_time_and_cap(self):
        self.assertEqual(self.anon.post(self.url, {**self.good, "website_url": "x"}, format="json").status_code, 201)
        self.assertEqual(Lead.objects.count(), 0)
        with override_settings(LEAD_MIN_FILL_SECONDS=3):
            self.assertEqual(self.anon.post(self.url, self.good, format="json").status_code, 400)
        with override_settings(LEAD_MAX_PER_CARD_PER_HOUR=1):
            self.assertEqual(self.anon.post(self.url, self.good, format="json").status_code, 201)
            self.assertEqual(self.anon.post(self.url, self.good, format="json").status_code, 429)

    def test_throttled_like_other_public_forms(self):
        with override_settings(ILAF_THROTTLE_RATES=dict(BIG_RATES, public_lead="1/min")):
            codes = [self.anon.post(self.url, self.good, format="json").status_code for _ in range(2)]
        self.assertEqual(codes, [201, 429])


class ScannedCardLeadTests(OpsTestCase):
    def test_a_member_saves_a_scanned_contact(self):
        res = self.owner.client.post(self.url("leads"), {"name": "Sara Ali", "email": "sara@example.com", "phone": "+974 5555 0000", "company": "Zeta", "note": "Paper card"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.data["source"], res.data["name"], res.data["card_id"]), ("scanned_card", "Sara Ali", None))
        self.assertEqual(len(mail.outbox), 0)
        self.assertEqual(self.owner.client.get(self.url("leads")).data["count"], 1)

    def test_validation_and_card_scope(self):
        c = self.owner.client
        self.assertEqual(c.post(self.url("leads"), {"email": "a@b.co"}, format="json").status_code, 400)
        self.assertEqual(c.post(self.url("leads"), {"name": "X", "email": "bad"}, format="json").status_code, 400)
        self.assertEqual(c.post(self.url("leads"), {"name": "X", "card_id": "not-a-uuid"}, format="json").status_code, 400)
        eve = self.add("eve@example.com", "Eve Employee")
        res = eve.client.post(self.url("leads"), {"name": "Scanned"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["card_id"], eve.card_id)
        self.assertEqual(eve.client.get(self.url("leads")).data["count"], 1)
        mine = self.make_card(self.owner, ws=self.ws, name="Olivia")
        self.assertEqual(eve.client.post(self.url("leads"), {"name": "X", "card_id": mine["id"]}, format="json").status_code, 400)
        self.assertEqual(APIClient().post(self.url("leads"), {"name": "X"}, format="json").status_code, 401)


class QrPngTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.published_card(self.person)

    def test_png_is_public_cacheable_and_sized(self):
        res = APIClient().get(f"{API}public/cards/{self.card['public_code']}/qr.png", {"size": 300})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/png")
        self.assertIn("max-age", res["Cache-Control"])
        self.assertTrue(res.content.startswith(b"\x89PNG"))
        from PIL import Image
        import io

        width, height = Image.open(io.BytesIO(res.content)).size
        self.assertEqual(width, height)
        self.assertTrue(200 <= width <= 300)

    def test_bad_size_and_unknown_code(self):
        self.assertEqual(APIClient().get(f"{API}public/cards/{self.card['public_code']}/qr.png", {"size": "big"}).status_code, 400)
        self.assertEqual(APIClient().get(f"{API}public/cards/zzzzzzzzzz/qr.png").status_code, 404)

    def test_works_for_a_card_in_the_slug_form(self):
        self.person.client.patch(f"{API}cards/{self.card['id']}", {"slug": "alice-q"}, format="json")
        self.assertEqual(APIClient().get(f"{API}public/cards/alice-q/qr.png").status_code, 200)


class MediaCorsTests(ApiTestCase):
    def test_public_pictures_can_be_read_by_any_site(self):
        res = APIClient().get("/media/logos/none.png", HTTP_ORIGIN="https://other.example")
        self.assertEqual(res["Access-Control-Allow-Origin"], "*")
        pre = APIClient().options("/media/logos/none.png", HTTP_ORIGIN="https://other.example")
        self.assertEqual(pre.status_code, 204)
