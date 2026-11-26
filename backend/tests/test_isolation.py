"""A signed-in user must never read or change another workspace's data."""
from rest_framework.test import APIClient

from .base import API, ApiTestCase, body


class WorkspaceIsolationTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.a = self.signup("a@example.com", "Alice A")
        self.b = self.signup("b@example.com", "Bob B")
        self.buy(self.a, "business")
        self.buy(self.b, "business")
        self.card_a = self.published_card(self.a, items=[{"kind": "Email", "value": "a@private.example"}])
        self.anon = APIClient()
        self.anon.post(
            f"{API}public/cards/{self.card_a['public_code']}/leads", {"consent": True, "name": "Lead A", "email": "l@example.com"}, format="json"
        )
        self.anon.post(f"{API}public/cards/{self.card_a['public_code']}/events", {"type": "view"}, format="json")
        self.lead_id = self.a.client.get(f"{API}workspaces/{self.a.ws}/leads").data["results"][0]["id"]

    def assert_hidden(self, res):
        self.assertIn(res.status_code, (403, 404), res.content)
        self.assertNotIn("a@private.example", res.content.decode())

    def test_b_cannot_read_a_workspace_data(self):
        for path in (
            f"workspaces/{self.a.ws}", f"workspaces/{self.a.ws}/cards", f"workspaces/{self.a.ws}/members",
            f"workspaces/{self.a.ws}/leads", f"workspaces/{self.a.ws}/leads.csv", f"workspaces/{self.a.ws}/analytics",
            f"workspaces/{self.a.ws}/subscription", f"workspaces/{self.a.ws}/invoices", f"cards/{self.card_a['id']}",
        ):
            self.assert_hidden(self.b.client.get(API + path))

    def test_b_cannot_change_a_data(self):
        c = self.b.client
        card = self.card_a["id"]
        self.assert_hidden(c.patch(f"{API}cards/{card}", {"name": "Hacked"}, format="json"))
        self.assert_hidden(c.delete(f"{API}cards/{card}"))
        self.assert_hidden(c.post(f"{API}cards/{card}/publish"))
        self.assert_hidden(c.post(f"{API}cards/{card}/unpublish"))
        self.assert_hidden(c.post(f"{API}cards/{card}/duplicate"))
        self.assert_hidden(c.post(f"{API}cards/{card}/photo", {}, format="multipart"))
        self.assert_hidden(c.post(f"{API}cards/{card}/icon", {}, format="multipart"))
        self.assert_hidden(c.patch(f"{API}leads/{self.lead_id}", {"status": "won"}, format="json"))
        self.assert_hidden(c.post(f"{API}workspaces/{self.a.ws}/cards", {"name": "Injected"}, format="json"))
        self.assert_hidden(c.patch(f"{API}workspaces/{self.a.ws}", {"name": "Hacked"}, format="json"))
        self.assert_hidden(c.post(f"{API}workspaces/{self.a.ws}/checkout", {"plan_code": "business"}, format="json"))
        self.assert_hidden(c.post(f"{API}workspaces/{self.a.ws}/invites", {"invites": [{"email": "x@y.co"}]}, format="json"))
        from workspaces.models import Member

        member = Member.objects.get(workspace_id=self.a.ws)
        self.assert_hidden(c.patch(f"{API}workspaces/{self.a.ws}/members/{member.id}", {"role": "employee"}, format="json"))
        self.assert_hidden(c.delete(f"{API}workspaces/{self.a.ws}/members/{member.id}"))
        # Nothing changed.
        card = self.a.client.get(f"{API}cards/{card}").data
        self.assertEqual(card["name"], "Alice Anderson")
        self.assertEqual(card["status"], "published")
        self.assertEqual(self.a.client.get(f"{API}workspaces/{self.a.ws}/leads").data["results"][0]["status"], "new")

    def test_my_workspaces_only_lists_own(self):
        ids = [w["id"] for w in self.b.client.get(API + "me/workspaces").data]
        self.assertEqual(ids, [self.b.ws])

    def test_card_id_filters_cannot_cross_workspaces(self):
        res = self.b.client.get(f"{API}workspaces/{self.b.ws}/leads", {"card_id": self.card_a["id"]})
        self.assertEqual(res.data["count"], 0)
        res = self.b.client.get(f"{API}workspaces/{self.b.ws}/analytics", {"card_id": self.card_a["id"]})
        self.assertEqual(res.status_code, 404)

    def test_other_company_member_cannot_reach_this_company(self):
        owner = self.signup("owner@example.com")
        ws = self.company(owner)
        outsider_ws = self.company(self.b, name="Other Co")
        self.assert_hidden(self.b.client.get(f"{API}workspaces/{ws}/members"))
        self.assertEqual(self.b.client.get(f"{API}workspaces/{outsider_ws}").status_code, 200)

    def test_anonymous_cannot_use_private_endpoints(self):
        for path in (
            f"workspaces/{self.a.ws}", f"cards/{self.card_a['id']}", f"workspaces/{self.a.ws}/leads", "me/workspaces",
        ):
            res = self.anon.get(API + path)
            self.assertEqual(res.status_code, 401, path)
            self.assertEqual(res.data["error"]["code"], "unauthorized")

    def test_employee_leads_are_scoped_to_their_card(self):
        owner = self.signup("owner@example.com")
        ws = self.company(owner)
        member = self.invite(owner, ws, "eve@example.com")
        eve = self.join(member)
        eve_card = eve.client.post(f"{API}cards/{member['card_id']}/publish").data
        boss_card = self.published_card(owner, ws=ws, name="Boss")
        for card in (eve_card, boss_card):
            self.anon.post(f"{API}public/cards/{card['public_code']}/leads", {"consent": True, "name": card["name"], "email": "x@example.com"}, format="json")
        mine = eve.client.get(f"{API}workspaces/{ws}/leads").data
        self.assertEqual(mine["count"], 1)
        self.assertEqual(mine["results"][0]["card_id"], eve_card["id"])
        # the owner sees their own card's contact, not the employee's
        self.assertEqual(owner.client.get(f"{API}workspaces/{ws}/leads").data["count"], 1)
        boss_lead = next(l for l in owner.client.get(f"{API}workspaces/{ws}/leads").data["results"] if l["card_id"] == boss_card["id"])
        res = eve.client.patch(f"{API}leads/{boss_lead['id']}", {"status": "won"}, format="json")
        self.assertEqual(res.status_code, 404)
        csv_text = body(eve.client.get(f"{API}workspaces/{ws}/leads.csv")).decode()
        self.assertNotIn("Boss", csv_text)
