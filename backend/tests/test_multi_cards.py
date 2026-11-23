"""A person with several cards: label, order, default card, duplicate, delete and the plan limit."""
from .base import API, ApiTestCase


class MultiCardTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("a@example.com")
        self.buy(self.person, "business")

    def card(self, name, **extra):
        return self.make_card(self.person, name=name, **extra)

    def listing(self):
        return self.person.client.get(f"{API}workspaces/{self.person.ws}/cards").data

    def test_first_card_is_the_default_and_later_ones_follow_in_order(self):
        first, second, third = self.card("One"), self.card("Two"), self.card("Three")
        self.assertTrue(first["is_default"])
        self.assertFalse(second["is_default"])
        self.assertEqual([c["name"] for c in self.listing()], ["One", "Two", "Three"])
        self.assertEqual([c["sort_order"] for c in self.listing()], [0, 1, 2])
        self.assertEqual(third["label"], "")

    def test_label_is_saved_trimmed_and_limited(self):
        card = self.card("One", label="  Work  ")
        self.assertEqual(card["label"], "Work")
        res = self.person.client.patch(f"{API}cards/{card['id']}", {"label": "x" * 41}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.person.client.patch(f"{API}cards/{card['id']}", {"label": "Side project"}, format="json")
        self.assertEqual(res.data["label"], "Side project")
        self.assertEqual(self.person.client.patch(f"{API}cards/{card['id']}", {"label": ""}, format="json").data["label"], "")

    def test_the_label_never_reaches_the_public_page(self):
        card = self.card("One", label="Secret label")
        self.person.client.post(f"{API}cards/{card['id']}/publish")
        from rest_framework.test import APIClient

        public = APIClient().get(f"{API}public/cards/{card['public_code']}")
        self.assertNotIn("Secret label", str(public.data))

    def test_reorder(self):
        a, b, c = self.card("A"), self.card("B"), self.card("C")
        res = self.person.client.post(f"{API}workspaces/{self.person.ws}/cards/reorder", {"ids": [c["id"], a["id"], b["id"]]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual([x["name"] for x in res.data], ["C", "A", "B"])
        self.assertEqual([x["name"] for x in self.listing()], ["C", "A", "B"])
        d = self.card("D")
        self.assertEqual([x["name"] for x in self.listing()][-1], "D")
        self.assertEqual(d["sort_order"], 3)

    def test_reorder_needs_every_card_exactly_once(self):
        a, b = self.card("A"), self.card("B")
        url = f"{API}workspaces/{self.person.ws}/cards/reorder"
        for bad in ({"ids": [a["id"]]}, {"ids": [a["id"], a["id"]]}, {"ids": [a["id"], b["id"], "00000000-0000-0000-0000-000000000000"]}, {"ids": "x"}, {}):
            self.assertEqual(self.person.client.post(url, bad, format="json").status_code, 400, bad)

    def test_nobody_else_can_reorder_my_cards(self):
        a = self.card("A")
        other = self.signup("b@example.com")
        res = other.client.post(f"{API}workspaces/{self.person.ws}/cards/reorder", {"ids": [a["id"]]}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_make_default_moves_the_flag(self):
        a, b = self.card("A"), self.card("B")
        res = self.person.client.post(f"{API}cards/{b['id']}/make-default")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["is_default"])
        flags = {c["name"]: c["is_default"] for c in self.listing()}
        self.assertEqual(flags, {"A": False, "B": True})
        via_patch = self.person.client.patch(f"{API}cards/{a['id']}", {"is_default": True}, format="json")
        self.assertTrue(via_patch.data["is_default"])
        self.assertEqual(sum(c["is_default"] for c in self.listing()), 1)

    def test_deleting_the_default_hands_it_to_the_next_card(self):
        a, b, c = self.card("A"), self.card("B"), self.card("C")
        self.assertEqual(self.person.client.delete(f"{API}cards/{a['id']}").status_code, 204)
        flags = {x["name"]: x["is_default"] for x in self.listing()}
        self.assertEqual(flags, {"B": True, "C": False})
        self.person.client.delete(f"{API}cards/{c['id']}")
        self.assertEqual(sum(x["is_default"] for x in self.listing()), 1)

    def test_duplicate_goes_last_keeps_a_label_and_is_not_the_default(self):
        a = self.card("A", label="Work")
        self.card("B")
        copy = self.person.client.post(f"{API}cards/{a['id']}/duplicate").data
        self.assertEqual(copy["label"], "Work (copy)")
        self.assertFalse(copy["is_default"])
        self.assertEqual(self.listing()[-1]["id"], copy["id"])

    def test_plan_limit_is_clear_and_arabic(self):
        for i in range(5):
            self.card(f"C{i}")
        res = self.person.client.post(f"{API}workspaces/{self.person.ws}/cards", {"name": "Six"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        self.assertIn("5 card", res.data["error"]["message"])
        self.person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        res = self.person.client.post(f"{API}workspaces/{self.person.ws}/cards", {"name": "Six"}, format="json")
        self.assertTrue(any("؀" <= ch <= "ۿ" for ch in res.data["error"]["message"]))
        dup = self.person.client.post(f"{API}cards/{self.listing()[0]['id']}/duplicate")
        self.assertEqual(dup.data["error"]["code"], "plan_limit")

    def test_the_single_card_plan_blocks_a_second_card(self):
        solo = self.signup("solo@example.com")
        self.buy(solo, "personal")
        self.make_card(solo)
        res = solo.client.post(f"{API}workspaces/{solo.ws}/cards", {"name": "Two"}, format="json")
        self.assertEqual(res.data["error"]["code"], "plan_limit")
