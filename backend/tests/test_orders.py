"""Orders: a visitor buys from the public page, follows the order, and the owner works the list."""
from django.core import mail
from django.test import override_settings
from rest_framework.test import APIClient

from cards.models import Product
from leads.models import Lead
from orders.models import Order
from orders.services import phones_match

from .base import API, ApiTestCase, body


class OrderCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("owner@example.com", "Olivia Owner")
        self.buy(self.person, "business")
        self.card = self.published_card(self.person)
        products_url = f"{API}cards/{self.card['id']}/products"
        self.coffee = self.person.client.post(products_url, {"title": "Coffee", "price": "12.50"}, format="json").data
        self.tea = self.person.client.post(products_url, {"title": "Tea", "price": "8", "stock": 5}, format="json").data
        self.url = f"{API}public/cards/{self.card['public_code']}/orders"
        mail.outbox.clear()

    def place(self, items=None, **extra):
        if items is None:
            items = [{"product_id": self.coffee["id"], "qty": 2}, {"product_id": self.tea["id"], "qty": 1}]
        payload = {
            "items": items,
            "name": "Visitor Vera", "phone": "+974 5555 1234", "email": "vera@example.com", "consent": True, **extra,
        }
        return APIClient().post(self.url, payload, format="json")


class PublicOrderTests(OrderCase):
    def test_order_is_saved_with_snapshot_total_lead_and_mails(self):
        res = self.place(note="Ring the bell", address="Street 1", payment_method="whatsapp")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(set(res.data), {"number", "status", "total", "currency"})
        self.assertEqual((res.data["status"], res.data["total"], res.data["currency"]), ("new", "33.00", "QAR"))
        self.assertRegex(res.data["number"], r"^B-[23456789A-HJ-NP-Z]{6}$")
        order = Order.objects.get()
        self.assertEqual(order.items, [
            {"product_id": self.coffee["id"], "title": "Coffee", "unit_price": "12.50", "currency": "QAR", "qty": 2},
            {"product_id": self.tea["id"], "title": "Tea", "unit_price": "8.00", "currency": "QAR", "qty": 1},
        ])
        self.assertEqual((order.payment_method, order.payment_status, order.address, order.note), ("whatsapp", "unpaid", "Street 1", "Ring the bell"))
        self.assertIsNotNone(order.consented_at)
        self.assertEqual(Product.objects.get(pk=self.tea["id"]).stock, 4)
        lead = Lead.objects.get()
        self.assertEqual((lead.source, lead.name, lead.phone, lead.email), ("order", "Visitor Vera", "+974 5555 1234", "vera@example.com"))
        self.assertIn(order.number, lead.note)
        self.assertIn("2 x Coffee", lead.note)
        recipients = sorted(address for m in mail.outbox for address in m.to)
        self.assertEqual(recipients, ["owner@example.com", "vera@example.com"])
        receipt = next(m for m in mail.outbox if "vera@example.com" in m.to)
        self.assertIn(order.number, receipt.subject)
        self.assertIn("/order/" + order.number, receipt.body)

    def test_the_bell_counts_the_order(self):
        self.place()
        res = self.person.client.get(f"{API}workspaces/{self.person.ws}/lead-bell")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["unread"], res.data["orders"], res.data["bookings"]), (1, 1, 0))
        self.person.client.post(f"{API}workspaces/{self.person.ws}/lead-bell/seen")
        self.assertEqual(self.person.client.get(f"{API}workspaces/{self.person.ws}/lead-bell").data["orders"], 0)

    def test_consent_is_required(self):
        res = self.place(consent=False)
        self.assertEqual(res.status_code, 400)
        self.assertIn("consent", res.data["error"]["fields"])
        self.assertEqual(Order.objects.count(), 0)

    def test_honeypot_pretends_success(self):
        res = self.place(website_url="http://spam.example")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(Lead.objects.count(), 0)

    @override_settings(LEAD_MIN_FILL_SECONDS=3)
    def test_too_fast_is_refused(self):
        res = self.place()
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "too_fast")

    @override_settings(LEAD_MAX_PER_CARD_PER_HOUR=1)
    def test_per_card_cap(self):
        self.assertEqual(self.place().status_code, 201)
        res = self.place()
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data["error"]["code"], "throttled")

    def test_cart_mistakes(self):
        self.assertIn("items", self.place(items=[]).data["error"]["fields"])
        self.assertIn("items", self.place(items=[{"product_id": "not-an-id", "qty": 1}]).data["error"]["fields"])
        self.assertIn("items", self.place(items=[{"product_id": self.coffee["id"], "qty": 0}]).data["error"]["fields"])
        res = self.place(items=[{"product_id": self.tea["id"], "qty": 6}])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["items"], ["Only 5 of Tea left."])
        self.person.client.patch(f"{API}cards/{self.card['id']}/products/{self.coffee['id']}", {"on": False}, format="json")
        res = self.place(items=[{"product_id": self.coffee["id"], "qty": 1}])
        self.assertEqual(res.status_code, 400)
        self.assertIn("no longer available", res.data["error"]["fields"]["items"][0])
        self.assertEqual(Order.objects.count(), 0)
        self.assertEqual(Product.objects.get(pk=self.tea["id"]).stock, 5)

    def test_mixed_currencies_are_refused(self):
        self.person.client.patch(f"{API}cards/{self.card['id']}/products/{self.tea['id']}", {"currency": "USD"}, format="json")
        res = self.place()
        self.assertEqual(res.status_code, 400)
        self.assertIn("currencies", res.data["error"]["fields"]["items"][0])

    def test_customer_fields(self):
        res = self.place(name="", phone="abc", email="not-an-email", payment_method="bitcoin")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.data["error"]["fields"]), {"name", "phone", "email", "payment_method"})

    def test_card_without_products_or_not_live_is_refused(self):
        Product.objects.all().delete()
        res = self.place()
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_off"))
        draft = self.make_card(self.person, name="Draft")
        self.assertEqual(APIClient().post(f"{API}public/cards/{draft['public_code']}/orders", {}, format="json").status_code, 404)

    def test_status_check_needs_the_phone(self):
        number = self.place().data["number"]
        base = f"{API}public/orders/{number}"
        self.assertEqual(APIClient().get(base).status_code, 404)
        self.assertEqual(APIClient().get(base, {"phone": "5555 9999"}).status_code, 404)
        res = APIClient().get(base, {"phone": "5555-1234"})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(set(res.data), {"number", "status", "payment_status", "payment_method", "pay_url", "items", "subtotal", "total", "currency", "card_name", "created_at"})
        self.assertEqual((res.data["card_name"], res.data["total"], res.data["pay_url"]), ("Alice Anderson", "33.00", None))
        self.assertEqual(APIClient().get(base.lower(), {"phone": "0097455551234"}).status_code, 200)
        self.assertEqual(APIClient().get(f"{API}public/orders/B-XXXXXX", {"phone": "55551234"}).status_code, 404)

    def test_phone_matching_rules(self):
        self.assertTrue(phones_match("+974 5555 1234", "55551234"))
        self.assertTrue(phones_match("55551234", "+97455551234"))
        self.assertFalse(phones_match("55551234", "1234"))
        self.assertFalse(phones_match("", "55551234"))
        self.assertFalse(phones_match("55551234", "55551235"))


class OwnerOrderTests(OrderCase):
    def setUp(self):
        super().setUp()
        self.number = self.place().data["number"]
        self.order = Order.objects.get(number=self.number)
        self.base = f"{API}workspaces/{self.person.ws}/orders"

    def test_list_with_filters_and_pages(self):
        res = self.person.client.get(self.base)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["count"], res.data["page"], res.data["pages"]), (1, 1, 1))
        row = res.data["results"][0]
        self.assertEqual(
            set(row),
            {"id", "number", "card_id", "card_name", "customer_name", "customer_phone", "customer_email", "note", "address", "items",
             "subtotal", "total", "currency", "payment_method", "payment_status", "pay_url", "status", "consented_at", "shared_with_company", "created_at", "updated_at"},
        )
        self.assertEqual(self.person.client.get(self.base, {"status": "new"}).data["count"], 1)
        self.assertEqual(self.person.client.get(self.base, {"status": "delivered,cancelled"}).data["count"], 0)
        self.assertEqual(self.person.client.get(self.base, {"card": self.card["id"]}).data["count"], 1)
        self.assertEqual(self.person.client.get(self.base, {"q": "vera"}).data["count"], 1)
        self.assertEqual(self.person.client.get(self.base, {"q": "nobody"}).data["count"], 0)
        self.assertEqual(self.person.client.get(self.base, {"from": "2099-01-01"}).data["count"], 0)
        self.assertEqual(self.person.client.get(self.base, {"from": "bad"}).status_code, 400)

    def test_detail_and_patch(self):
        url = f"{self.base}/{self.order.id}"
        self.assertEqual(self.person.client.get(url).data["number"], self.number)
        res = self.person.client.patch(url, {"status": "confirmed", "payment_status": "paid", "note": "Paid in cash"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["status"], res.data["payment_status"], res.data["note"]), ("confirmed", "paid", "Paid in cash"))
        self.assertEqual(self.person.client.patch(url, {"status": "shipped"}, format="json").status_code, 400)
        self.assertEqual(self.person.client.patch(url, {"payment_status": "lost"}, format="json").status_code, 400)
        self.assertEqual(self.person.client.patch(url, {}, format="json").status_code, 400)
        self.assertEqual(self.person.client.patch(url, {"status": "delivered"}, format="json").data["status"], "delivered")
        res = self.person.client.patch(url, {"status": "cancelled"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("finished", res.data["error"]["fields"]["status"][0])
        # Stating the same final status again is not a change and is accepted.
        self.assertEqual(self.person.client.patch(url, {"status": "delivered"}, format="json").status_code, 200)

    def test_export_csv(self):
        res = self.person.client.get(f"{self.base}/export")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "text/csv; charset=utf-8")
        text = body(res).decode("utf-8")
        lines = text.splitlines()
        self.assertTrue(lines[0].startswith("﻿number,created_at,card,customer_name,phone,email,address,items,subtotal,total,currency,payment_method,payment_status,status,note,id"))
        self.assertIn(self.number, lines[1])
        self.assertIn("2 x Coffee; 1 x Tea", lines[1])
        self.assertIn("33.00", lines[1])

    def test_stranger_and_other_workspace_get_404(self):
        stranger = self.signup("stranger@example.com", "Stranger")
        self.assertEqual(stranger.client.get(self.base).status_code, 404)
        self.assertEqual(stranger.client.get(f"{API}workspaces/{stranger.ws}/orders/{self.order.id}").status_code, 404)
        self.assertEqual(stranger.client.get(f"{API}workspaces/{stranger.ws}/orders").data["count"], 0)

    def test_order_survives_card_deletion(self):
        self.assertEqual(self.person.client.delete(f"{API}cards/{self.card['id']}").status_code, 204)
        res = self.person.client.get(self.base)
        self.assertEqual(res.data["count"], 1)
        self.assertEqual((res.data["results"][0]["card_id"], res.data["results"][0]["card_name"]), (None, "Alice Anderson"))
