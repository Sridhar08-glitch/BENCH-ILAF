from datetime import timedelta

from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from analytics.models import Event
from billing.models import Subscription
from leads.models import Lead

from .base import API, BIG_RATES, ApiTestCase, body, png_upload

SECRET_MAIL = "private.person@example.com"
SECRET_PHONE = "+97455559999"


class PublicStateTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.anon = APIClient()
        self.items = [
            {"kind": "Mobile", "value": SECRET_PHONE, "label": "Mobile"},
            {"kind": "Email", "value": SECRET_MAIL},
            {"kind": "Instagram", "value": "@alice"},
            {"kind": "Website", "value": "alice.example.com", "on": False},
            {"kind": "Custom", "value": "shop.example.com", "label": "Shop", "icon": {"type": "brand", "key": "shopify"}},
            {"kind": "Facebook", "value": ""},
        ]

    def card(self, **extra):
        return self.published_card(self.person, items=self.items, **extra)

    def test_live_card_payload(self):
        card = self.card(slug="alice-d")
        res = self.anon.get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(res.status_code, 200)
        data = res.data
        self.assertEqual(data["state"], "live")
        self.assertEqual(data["canonical"], "alice-d")
        c = data["card"]
        self.assertEqual(c["name"], "Alice Anderson")
        self.assertEqual(c["public_url"], "https://web.test/c/alice-d")
        self.assertEqual(c["vcard_url"], "https://api.test/api/v1/public/cards/alice-d/vcard")
        self.assertEqual(c["qr_url"], "https://api.test/api/v1/public/cards/alice-d/qr.svg")
        self.assertIsNone(c["brand"])
        self.assertTrue(c["footer"])
        # Only on and non-empty items, in order, with a ready link.
        self.assertEqual([i["kind"] for i in c["items"]], ["Mobile", "Email", "Instagram", "Custom"])
        by_kind = {i["kind"]: i for i in c["items"]}
        self.assertEqual(by_kind["Mobile"]["href"], "tel:+97455559999")
        self.assertEqual(by_kind["Email"]["href"], "mailto:" + SECRET_MAIL)
        self.assertEqual(by_kind["Instagram"]["href"], "https://instagram.com/alice")
        self.assertEqual(by_kind["Custom"]["href"], "https://shop.example.com")
        self.assertEqual(by_kind["Custom"]["icon"], {"type": "brand", "key": "shopify", "image_url": None})
        self.assertEqual(set(c["items"][0]), {"kind", "value", "label", "icon", "href"})
        self.assertEqual(data["og"]["title"], "Alice Anderson - Designer")
        self.assertEqual(data["og"]["description"], "Designer at Studio")
        self.assertIsNone(data["og"]["image_url"])

    def test_slug_history_redirects_to_canonical(self):
        card = self.card(slug="old-name")
        self.person.client.patch(f"{API}cards/{card['id']}", {"slug": "new-name"}, format="json")
        for key in ("old-name", "new-name", card["public_code"]):
            res = self.anon.get(f"{API}public/cards/{key}")
            self.assertEqual(res.status_code, 200, key)
            self.assertEqual(res.data["canonical"], "new-name")
        self.assertEqual(self.anon.get(f"{API}public/cards/OLD-NAME").status_code, 200)

    def test_photo_in_payload_and_og_image(self):
        card = self.card()
        self.person.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload((300, 300))}, format="multipart")
        data = self.anon.get(f"{API}public/cards/{card['public_code']}").data
        self.assertTrue(data["card"]["photo_url"].startswith("https://api.test/media/"))
        self.assertEqual(data["og"]["image_url"], data["card"]["photo_url"])

    def test_unknown_code_is_404(self):
        res = self.anon.get(API + "public/cards/zzzzzzzzzz")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(res.data["error"]["code"], "not_found")
        self.assertEqual(self.anon.get(API + "public/cards/zzzzzzzzzz/vcard").status_code, 404)
        self.assertEqual(self.anon.post(API + "public/cards/zzzzzzzzzz/events", {"type": "view"}, format="json").status_code, 404)

    def test_draft_is_not_found_and_leaks_nothing(self):
        card = self.make_card(self.person, items=self.items)
        res = self.anon.get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(res.status_code, 404)
        self.assertNotIn(SECRET_MAIL, res.content.decode())
        self.assertEqual(self.anon.get(f"{API}public/cards/{card['public_code']}/vcard").status_code, 404)

    def test_paused_when_subscription_not_live_and_no_leak(self):
        card = self.card()
        Subscription.objects.update(ends_at=timezone.now() - timedelta(days=9))
        res = self.anon.get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["state"], "paused")
        self.assertIsNone(res.data["company_name"])
        self.assertIn("message", res.data)
        body = res.content.decode()
        self.assertNotIn(SECRET_MAIL, body)
        self.assertNotIn(SECRET_PHONE, body)
        self.assertNotIn("items", res.data)
        self.assertEqual(self.anon.get(f"{API}public/cards/{card['public_code']}/vcard").status_code, 404)
        # Inside the grace window the card is still live.
        Subscription.objects.update(ends_at=timezone.now() - timedelta(days=3))
        self.assertEqual(self.anon.get(f"{API}public/cards/{card['public_code']}").data["state"], "live")

    def test_company_paused_and_suspended_show_company_name(self):
        owner = self.signup("owner@example.com")
        ws = self.company(owner)
        owner.client.patch(f"{API}workspaces/{ws}", {"brand": {"company_name": "Acme", "website": "https://acme.test"}}, format="json")
        member = self.invite(owner, ws, "eve@example.com")
        eve = self.join(member)
        eve.client.patch(f"{API}cards/{member['card_id']}", {"items": [{"kind": "Email", "value": SECRET_MAIL}]}, format="json")
        card = eve.client.post(f"{API}cards/{member['card_id']}/publish").data
        live = self.anon.get(f"{API}public/cards/{card['public_code']}").data
        self.assertEqual(live["card"]["brand"]["company_name"], "Acme")
        self.assertIsNone(live["card"]["brand"]["logo_url"])
        owner.client.patch(f"{API}workspaces/{ws}/members/{member['id']}", {"status": "suspended"}, format="json")
        res = self.anon.get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(res.data["state"], "suspended")
        self.assertEqual(res.data["company_name"], "Acme")
        self.assertEqual(res.data["website"], "https://acme.test")
        self.assertNotIn(SECRET_MAIL, res.content.decode())
        owner.client.patch(f"{API}workspaces/{ws}/members/{member['id']}", {"status": "active"}, format="json")
        Subscription.objects.filter(workspace_id=ws).update(ends_at=timezone.now() - timedelta(days=20))
        res = self.anon.get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(res.data["state"], "paused")
        self.assertEqual(res.data["company_name"], "Acme")

    def test_suspended_personal_card_by_admin_action(self):
        card = self.card()
        from cards.models import Card

        Card.objects.filter(pk=card["id"]).update(status="suspended")
        res = self.anon.get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(res.data["state"], "suspended")
        self.assertIsNone(res.data["company_name"])
        self.assertIsNone(res.data["website"])
        self.assertEqual(self.person.client.post(f"{API}cards/{card['id']}/publish").status_code, 403)

    def test_public_endpoints_allow_any_origin_and_preflight(self):
        card = self.card()
        res = self.anon.get(f"{API}public/cards/{card['public_code']}", HTTP_ORIGIN="https://random.example")
        self.assertEqual(res["Access-Control-Allow-Origin"], "*")
        pre = self.anon.options(f"{API}public/cards/{card['public_code']}/leads", HTTP_ORIGIN="https://random.example",
                                HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST")
        self.assertEqual(pre.status_code, 204)
        self.assertEqual(pre["Access-Control-Allow-Origin"], "*")
        self.assertEqual(self.anon.get(API + "plans", HTTP_ORIGIN="https://x.example")["Access-Control-Allow-Origin"], "*")
        # Private endpoints do not get the wildcard.
        res = self.person.client.get(API + "auth/me", HTTP_ORIGIN="https://random.example")
        self.assertNotEqual(res.get("Access-Control-Allow-Origin"), "*")

    def test_qr_svg(self):
        card = self.card()
        res = self.anon.get(f"{API}public/cards/{card['public_code']}/qr.svg", {"size": 256})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/svg+xml")
        body = res.content.decode()
        self.assertIn("<svg", body)
        self.assertEqual(self.anon.get(f"{API}public/cards/{card['public_code']}/qr.svg", {"size": "big"}).status_code, 400)


class LeadTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person)
        self.card = self.published_card(self.person)
        self.anon = APIClient()
        self.url = f"{API}public/cards/{self.card['public_code']}/leads"

    def test_lead_created_and_listed(self):
        res = self.anon.post(self.url, {"consent": True, "name": "Visitor", "email": "v@example.com", "note": "Call me\nsoon", "website_url": ""}, format="json")
        self.assertEqual(res.status_code, 201)
        leads = self.person.client.get(f"{API}workspaces/{self.person.ws}/leads").data
        self.assertEqual(leads["count"], 1)
        lead = leads["results"][0]
        self.assertEqual(lead["name"], "Visitor")
        self.assertEqual(lead["card_id"], self.card["id"])
        self.assertEqual(lead["card_name"], "Alice Anderson")
        self.assertEqual(lead["status"], "new")
        self.assertEqual(set(lead), {"id", "card_id", "card_name", "name", "email", "phone", "company", "note", "source", "channel", "meeting_times", "status", "created_at", "assignee", "assigned_at", "consented_at", "note_count", "tag", "event_name", "shared_with_company"})

    def test_honeypot_is_dropped_silently(self):
        res = self.anon.post(self.url, {"consent": True, "name": "Bot", "email": "bot@example.com", "website_url": "http://spam.example"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Lead.objects.count(), 0)

    def test_needs_name_and_email_or_phone(self):
        for body in ({"consent": True, "name": "Only"}, {"consent": True, "email": "a@b.co"}, {"consent": True, "name": "X", "email": "nope"}, {"consent": True, "name": "X" * 121, "email": "a@b.co"}):
            res = self.anon.post(self.url, body, format="json")
            self.assertEqual(res.status_code, 400, body)
            self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertEqual(self.anon.post(self.url, {"consent": True, "name": "Phone", "phone": "+97455550000"}, format="json").status_code, 201)
        self.assertEqual(Lead.objects.count(), 1)

    def test_no_leads_for_draft_or_unknown_cards(self):
        self.person.client.post(f"{API}cards/{self.card['id']}/unpublish")
        res = self.anon.post(self.url, {"consent": True, "name": "X", "email": "a@b.co"}, format="json")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(self.anon.post(API + "public/cards/zzzzzzzzzz/leads", {"consent": True, "name": "X", "email": "a@b.co"}, format="json").status_code, 404)

    def test_lead_endpoint_is_throttled(self):
        with override_settings(ILAF_THROTTLE_RATES=dict(BIG_RATES, public_lead="2/min")):
            codes = [
                self.anon.post(self.url, {"consent": True, "name": "X", "email": "a@b.co"}, format="json").status_code for _ in range(3)
            ]
        self.assertEqual(codes, [201, 201, 429])

    def test_filters_paging_status_and_csv(self):
        for n in range(3):
            self.anon.post(self.url, {"consent": True, "name": f"Person {n}", "email": f"p{n}@example.com", "company": "Zeta" if n == 1 else ""}, format="json")
        self.anon.post(self.url, {"consent": True, "name": "=HYPERLINK(\"x\")", "email": "evil@example.com"}, format="json")
        base = f"{API}workspaces/{self.person.ws}/leads"
        c = self.person.client
        self.assertEqual(c.get(base, {"limit": 2}).data["count"], 4)
        self.assertEqual(len(c.get(base, {"limit": 2}).data["results"]), 2)
        self.assertEqual(len(c.get(base, {"limit": 2, "offset": 3}).data["results"]), 1)
        self.assertEqual(c.get(base, {"q": "zeta"}).data["count"], 1)
        self.assertEqual(c.get(base, {"card_id": self.card["id"]}).data["count"], 4)
        lead_id = c.get(base, {"q": "Person 0"}).data["results"][0]["id"]
        res = c.patch(f"{API}leads/{lead_id}", {"status": "won"}, format="json")
        self.assertEqual(res.data["status"], "won")
        self.assertEqual(c.get(base, {"status": "won"}).data["count"], 1)
        self.assertEqual(c.patch(f"{API}leads/{lead_id}", {"status": "bogus"}, format="json").status_code, 400)
        csv_res = c.get(base + ".csv")
        self.assertEqual(csv_res.status_code, 200)
        self.assertTrue(csv_res["Content-Type"].startswith("text/csv"))
        text = body(csv_res).decode()
        self.assertIn("p1@example.com", text)
        self.assertIn("'=HYPERLINK", text)  # formulas are defused
        self.assertEqual(len(text.strip().splitlines()), 5)


class EventAndAnalyticsTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.published_card(self.person)
        self.other = self.published_card(self.person, name="Second")
        self.anon = APIClient()
        self.url = f"{API}public/cards/{self.card['public_code']}/events"

    def event(self, body, ua="Mozilla/5.0 (iPhone; CPU iPhone OS 17)", country="QA", ip="1.2.3.4", url=None):
        return self.anon.post(
            url or self.url, body, format="json", HTTP_USER_AGENT=ua, HTTP_CF_IPCOUNTRY=country, HTTP_CF_CONNECTING_IP=ip
        )

    def test_events_204_and_validation(self):
        self.assertEqual(self.event({"type": "view", "source": "qr"}).status_code, 204)
        self.assertEqual(self.event({"type": "bogus"}).status_code, 400)
        self.assertEqual(self.event({}).status_code, 400)

    def test_no_raw_ip_or_ua_is_stored(self):
        self.event({"type": "view"}, ip="9.9.9.9")
        row = Event.objects.get()
        stored = " ".join(str(v) for v in row.__dict__.values())
        self.assertNotIn("9.9.9.9", stored)
        self.assertNotIn("iPhone", stored)
        self.assertEqual(len(row.visitor_hash), 32)
        self.assertEqual(row.country, "QA")
        self.assertEqual(row.device, "ios")

    def test_events_on_unpublished_card_are_not_recorded(self):
        self.person.client.post(f"{API}cards/{self.other['id']}/unpublish")
        res = self.event({"type": "view"}, url=f"{API}public/cards/{self.other['public_code']}/events")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(Event.objects.count(), 0)

    def test_analytics_totals_and_breakdowns(self):
        self.event({"type": "view", "source": "qr"}, ip="1.1.1.1")
        self.event({"type": "view", "source": "qr"}, ip="1.1.1.1")  # same visitor again
        self.event({"type": "view", "source": "nfc"}, ip="2.2.2.2", ua="Mozilla/5.0 (Linux; Android 14)", country="AE")
        self.event({"type": "view", "source": "link"}, ip="3.3.3.3", ua="Mozilla/5.0 (Windows NT 10.0)", country="QA")
        self.event({"type": "view", "source": "weird"}, ip="4.4.4.4", ua="curl/8", country="")
        self.event({"type": "save"}, ip="1.1.1.1")
        self.event({"type": "tap"}, ip="1.1.1.1")
        self.event({"type": "link_click", "kind": "Instagram"})
        self.event({"type": "link_click", "kind": "Instagram"})
        self.event({"type": "link_click", "kind": "Mobile"})
        self.event({"type": "view"}, url=f"{API}public/cards/{self.other['public_code']}/events", ip="5.5.5.5")
        self.anon.post(f"{API}public/cards/{self.card['public_code']}/leads", {"consent": True, "name": "L", "email": "l@example.com"}, format="json")
        res = self.person.client.get(f"{API}workspaces/{self.person.ws}/analytics", {"days": 7})
        self.assertEqual(res.status_code, 200)
        data = res.data
        self.assertEqual(
            data["totals"],
            {"views": 6, "unique_visitors": 5, "scans": 2, "taps": 2, "saves": 1, "leads": 1, "link_clicks": 3},
        )
        self.assertEqual(data["prev_totals"]["views"], 0)
        self.assertEqual(set(data["prev_totals"]), set(data["totals"]))
        self.assertEqual(len(data["series"]), 7)
        today = data["series"][-1]
        self.assertEqual((today["views"], today["saves"], today["leads"]), (6, 1, 1))
        self.assertEqual(data["series"][0]["views"], 0)
        self.assertEqual({s["key"]: s["count"] for s in data["sources"]}, {"nfc": 1, "qr": 2, "link": 2, "email": 0, "other": 1})
        self.assertEqual({d["key"]: d["count"] for d in data["devices"]}, {"ios": 3, "android": 1, "desktop": 1, "other": 1})
        self.assertEqual({l["country"]: l["count"] for l in data["locations"]}, {"QA": 4, "AE": 1, "unknown": 1})
        self.assertEqual(len(data["hours"]), 24)
        self.assertEqual(sum(data["hours"]), 6)
        self.assertEqual(data["top_buttons"][0], {"kind": "Instagram", "count": 2})
        by_card = {c["card_id"]: c for c in data["cards"]}
        self.assertEqual(by_card[self.card["id"]], {"card_id": self.card["id"], "name": "Alice Anderson", "views": 5, "saves": 1, "leads": 1, "leads_visible": True})
        self.assertEqual(by_card[self.other["id"]]["views"], 1)
        # Single-card filter.
        res = self.person.client.get(f"{API}workspaces/{self.person.ws}/analytics", {"card_id": self.other["id"]})
        self.assertEqual(res.data["totals"]["views"], 1)
        self.assertEqual(len(res.data["cards"]), 1)
        # Card stats follow.
        card = self.person.client.get(f"{API}cards/{self.card['id']}").data
        self.assertEqual(card["stats"], {"views": 5, "scans": 2, "saves": 1, "leads": 1})

    def test_previous_period_totals(self):
        self.event({"type": "view"})
        Event.objects.update(created_at=timezone.now() - timedelta(days=10))
        res = self.person.client.get(f"{API}workspaces/{self.person.ws}/analytics", {"days": 7}).data
        self.assertEqual(res["totals"]["views"], 0)
        self.assertEqual(res["prev_totals"]["views"], 1)

    def test_hours_are_utc(self):
        self.event({"type": "view"})
        Event.objects.update(created_at=timezone.now().replace(hour=23, minute=30))
        res = self.person.client.get(f"{API}workspaces/{self.person.ws}/analytics", {"days": 3}).data
        self.assertEqual(res["hours"][23], 1)

    def test_bad_days(self):
        for days in ("0", "400", "abc"):
            res = self.person.client.get(f"{API}workspaces/{self.person.ws}/analytics", {"days": days})
            self.assertEqual(res.status_code, 400, days)

    def test_analytics_scoped_to_employee_card(self):
        owner = self.signup("owner@example.com")
        ws = self.company(owner)
        member = self.invite(owner, ws, "eve@example.com")
        eve = self.join(member)
        eve_card = eve.client.post(f"{API}cards/{member['card_id']}/publish").data
        owner_card = self.published_card(owner, ws=ws, name="Boss")
        for card in (eve_card, owner_card):
            self.anon.post(f"{API}public/cards/{card['public_code']}/events", {"type": "view"}, format="json")
        res = eve.client.get(f"{API}workspaces/{ws}/analytics").data
        self.assertEqual(res["totals"]["views"], 1)
        self.assertEqual([c["card_id"] for c in res["cards"]], [eve_card["id"]])
        self.assertEqual(eve.client.get(f"{API}workspaces/{ws}/analytics", {"card_id": owner_card["id"]}).status_code, 404)
        self.assertEqual(owner.client.get(f"{API}workspaces/{ws}/analytics").data["totals"]["views"], 2)

    def test_country_header_is_ignored_when_malformed(self):
        self.event({"type": "view"}, country="<script>")
        self.assertEqual(Event.objects.get().country, "unknown")
