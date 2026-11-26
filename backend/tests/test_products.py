"""Products on a card: the owner's list, pictures, limits, the plan rule and what the public sees."""
from billing.models import Plan
from billing.services import activate
from cards.models import Product
from rest_framework.test import APIClient
from staff import flags
from staff.models import FeatureFlag
from workspaces.models import Workspace

from .base import API, ApiTestCase, png_upload


class ProductCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("owner@example.com", "Olivia Owner")
        self.buy(self.person, "business")
        self.card = self.published_card(self.person)
        self.url = f"{API}cards/{self.card['id']}/products"

    def add(self, **fields):
        body = {"title": "Coffee", "price": "12.50", **fields}
        res = self.person.client.post(self.url, body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data


class ProductCrudTests(ProductCase):
    def test_create_returns_full_shape_with_workspace_currency(self):
        product = self.add(description="Hot and strong", badge="New", meta={"tags": ["hot"], "size": "L"})
        self.assertEqual(
            set(product),
            {"id", "section_id", "title", "description", "price", "currency", "image_url", "badge", "meta", "on", "order", "stock", "created_at", "updated_at"},
        )
        self.assertEqual((product["price"], product["currency"], product["on"], product["stock"]), ("12.50", "QAR", True, None))
        self.assertEqual(product["meta"], {"tags": ["hot"], "size": "L"})
        self.assertIsNone(product["image_url"])

    def test_currency_default_follows_the_workspace_country(self):
        Workspace.objects.filter(pk=self.person.ws).update(country="AE")
        self.assertEqual(self.add()["currency"], "AED")
        self.assertEqual(self.add(currency="usd")["currency"], "USD")

    def test_list_is_in_order_and_patch_and_delete_work(self):
        first = self.add(title="First")
        second = self.add(title="Second")
        self.assertEqual([p["title"] for p in self.person.client.get(self.url).data], ["First", "Second"])
        self.assertEqual((first["order"], second["order"]), (0, 1))
        res = self.person.client.patch(f"{self.url}/{first['id']}", {"price": 9, "on": False, "stock": 3, "order": 5}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["price"], res.data["on"], res.data["stock"], res.data["order"]), ("9.00", False, 3, 5))
        self.assertEqual([p["title"] for p in self.person.client.get(self.url).data], ["Second", "First"])
        self.assertEqual(self.person.client.delete(f"{self.url}/{first['id']}").status_code, 204)
        self.assertEqual(Product.objects.count(), 1)
        self.assertEqual(self.person.client.delete(f"{self.url}/{first['id']}").status_code, 404)

    def test_validation(self):
        res = self.person.client.post(self.url, {"price": "1"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("title", res.data["error"]["fields"])
        bad = {"title": "x", "price": -1, "currency": "Qatari", "meta": {"a": {"b": 1}}, "stock": -2, "section_id": "nope"}
        res = self.person.client.post(self.url, bad, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(set(res.data["error"]["fields"]), {"price", "currency", "meta", "stock", "section_id"})
        res = self.person.client.post(self.url, {"title": "x" * 81, "price": "abc"}, format="json")
        self.assertEqual(set(res.data["error"]["fields"]), {"title", "price"})

    def test_at_most_sixty_items(self):
        card = Product.objects.none()
        from cards.models import Card

        card = Card.objects.get(pk=self.card["id"])
        Product.objects.bulk_create([Product(card=card, title=f"Item {n}", price=1) for n in range(60)])
        res = self.person.client.post(self.url, {"title": "One more", "price": 1}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("products", res.data["error"]["fields"])

    def test_image_upload_and_removal(self):
        product = self.add()
        res = self.person.client.post(f"{self.url}/{product['id']}/image", {"file": png_upload(size=(2000, 1500))}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["image_url"].startswith("https://api.test/media/products/"))
        self.assertTrue(res.data["image_url"].endswith(".jpg"))
        res = self.person.client.post(f"{self.url}/{product['id']}/image", {"file": png_upload(name="bad.gif", fmt="GIF", mode="P")}, format="multipart")
        self.assertEqual(res.status_code, 400)
        res = self.person.client.patch(f"{self.url}/{product['id']}", {"image": None}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.data["image_url"])

    def test_stranger_and_anonymous_are_refused(self):
        self.add()
        stranger = self.signup("stranger@example.com", "Stranger")
        self.assertEqual(stranger.client.get(self.url).status_code, 404)
        self.assertEqual(stranger.client.post(self.url, {"title": "x", "price": 1}, format="json").status_code, 404)
        self.assertEqual(APIClient().get(self.url).status_code, 401)


class PlanRuleTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("free@example.com", "Fred Free")
        plan, _ = Plan.objects.get_or_create(code="free", defaults={"name": "Free", "kind": "personal", "price_minor": 0, "max_cards": 1})
        activate(Workspace.objects.get(pk=self.person.ws), plan, 1, amount_minor=0, source="manual")
        self.card = self.make_card(self.person)

    def test_free_plan_can_read_but_not_write_products_or_booking_settings(self):
        url = f"{API}cards/{self.card['id']}/products"
        self.assertEqual(self.person.client.get(url).status_code, 200)
        res = self.person.client.post(url, {"title": "x", "price": 1}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")
        settings_url = f"{API}cards/{self.card['id']}/booking-settings"
        self.assertEqual(self.person.client.get(settings_url).status_code, 200)
        res = self.person.client.put(settings_url, {"enabled": True}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")

    def test_switched_off_feature_is_refused_for_everyone(self):
        paid = self.signup("paid@example.com", "Paula Paid")
        self.buy(paid)
        card = self.make_card(paid)
        FeatureFlag.objects.create(key="page_styles", state="off")
        flags.clear_cache()
        res = paid.client.post(f"{API}cards/{card['id']}/products", {"title": "x", "price": 1}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "feature_unavailable")


class PublicProductsTests(ProductCase):
    def test_public_list_shows_only_items_that_are_on(self):
        self.add(title="Shown")
        self.add(title="Hidden", on=False)
        self.add(title="Sold out", stock=0)
        res = APIClient().get(f"{API}public/cards/{self.card['public_code']}/products")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["currency"], "QAR")
        self.assertEqual([(p["title"], p["sold_out"]) for p in res.data["products"]], [("Shown", False), ("Sold out", True)])
        self.assertEqual(set(res.data["products"][0]), {"id", "section_id", "title", "description", "price", "currency", "image_url", "badge", "meta", "order", "sold_out"})

    def test_draft_card_is_not_found(self):
        draft = self.make_card(self.person, name="Draft")
        self.assertEqual(APIClient().get(f"{API}public/cards/{draft['public_code']}/products").status_code, 404)
