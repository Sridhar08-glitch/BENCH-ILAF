"""Employees stay inside the company field rules on every write path; admins cannot touch the owner's card."""
from cards.models import Card
from workspaces.models import Member

from .base import API
from .ops_base import OpsTestCase


class EmployeeRuleBypassTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.bob = self.add("bob@example.com", "Bob Builder")
        self.card_url = f"{API}cards/{self.bob.card_id}"

    def rules(self, **body):
        res = self.owner.client.patch(self.url("field-rules"), body, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def patch(self, body):
        return self.bob.client.patch(self.card_url, body, format="json")

    def lone_employee(self, email="dan@example.com", name="Dan New", title="Rep"):
        """An employee whose card was removed, so they create their first card themselves."""
        member = self.invite(self.owner, self.ws, email, full_name=name, title=title)
        Card.objects.filter(pk=member["card_id"]).delete()
        return self.join(member, full_name=name)

    # ---- the new setting rules
    def test_rules_endpoint_lists_the_setting_rules_defaulting_to_free(self):
        rules = self.owner.client.get(self.url("field-rules")).data
        for key in ("slug", "features", "vcard"):
            self.assertEqual(rules[key], "free")

    def test_free_by_default_so_nothing_changes(self):
        res = self.patch({"slug": "bob-builder", "features": {"exchange": {"enabled": False}}, "vc": {"note": "hi"}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["slug"], "bob-builder")

    def test_locked_slug(self):
        self.rules(slug="locked")
        res = self.patch({"slug": "mine"})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "field_locked")
        self.assertIn("slug", res.data["error"]["fields"])
        self.assertIsNone(Card.objects.get(pk=self.bob.card_id).slug)
        # sending the current value back is not a change
        self.assertEqual(self.patch({"slug": None, "title": "Rep"}).status_code, 200)

    def test_locked_features_and_vcard(self):
        self.rules(features="locked", vcard="locked")
        self.assertEqual(self.patch({"features": {"exchange": {"enabled": False}}}).status_code, 403)
        self.assertEqual(self.patch({"vc": {"note": "changed"}}).status_code, 403)
        self.assertEqual(self.patch({"save_contact": False}).status_code, 403)
        current = self.owner.client.get(self.card_url).data
        self.assertEqual(self.patch({"features": current["features"], "vc": current["vc"], "save_contact": current["save_contact"]}).status_code, 200)

    def test_approval_on_a_setting_acts_as_locked(self):
        self.rules(slug="approval")
        self.assertEqual(self.patch({"slug": "mine"}).status_code, 403)
        self.assertEqual(self.bob.client.get(self.card_url).data["field_access"]["slug"], "locked")

    def test_owner_and_admin_are_never_held_by_setting_rules(self):
        admin = self.add("ada@example.com", "Ada Admin", role="admin")
        self.rules(slug="locked", features="locked", vcard="locked")
        for who in (self.owner, admin):
            res = who.client.patch(self.card_url, {"slug": f"by-{who.member_id if hasattr(who, 'member_id') else 'owner'}"[:20], "vc": {"note": "x"}}, format="json")
            self.assertEqual(res.status_code, 200, res.content)

    # ---- creating a card
    def test_new_card_by_employee_takes_company_values_for_locked_fields(self):
        self.rules(name="locked", title="approval")
        dan = self.lone_employee()
        res = dan.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Totally Different", "title": "CEO"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["name"], "Dan New")
        self.assertEqual(res.data["title"], "Rep")
        self.assertEqual(res.data["pending_changes"], [])

    def test_new_card_free_fields_are_taken_as_typed(self):
        dan = self.lone_employee()
        res = dan.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Dan D", "title": "Boss"}, format="json")
        self.assertEqual((res.data["name"], res.data["title"]), ("Dan D", "Boss"))

    def test_new_card_cannot_set_locked_slug_or_features(self):
        self.rules(slug="locked", features="locked", vcard="locked")
        dan = self.lone_employee()
        res = dan.client.post(
            f"{API}workspaces/{self.ws}/cards",
            {"name": "Dan", "slug": "danny", "features": {"exchange": {"enabled": False}}, "vc": {"note": "x"}}, format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertIsNone(res.data["slug"])
        self.assertNotEqual(res.data["vc"]["note"], "x")

    def test_new_card_items_follow_the_rules(self):
        self.rules(allowed_kinds=["Mobile", "Landline"], button_add="locked", mandatory_buttons=[{"kind": "Landline", "value": "+97444440000", "label": "Support"}])
        dan = self.lone_employee()
        res = dan.client.post(
            f"{API}workspaces/{self.ws}/cards", {"name": "Dan", "items": [{"kind": "Mobile", "value": "+97455550000"}]}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual([i["kind"] for i in res.data["items"]], ["Landline"])  # only the mandatory button

    def test_new_card_banned_link_is_still_refused_when_adding_is_free(self):
        self.rules(banned_domains=["bad.com"])
        dan = self.lone_employee()
        res = dan.client.post(
            f"{API}workspaces/{self.ws}/cards", {"name": "Dan", "items": [{"kind": "Website", "value": "https://bad.com"}]}, format="json"
        )
        self.assertEqual(res.status_code, 400, res.content)

    def test_owner_and_admin_create_cards_without_rules(self):
        self.rules(name="locked", title="locked", slug="locked", button_add="locked")
        owner_card = Card.objects.filter(member=self.owner_member).first()
        if owner_card:
            owner_card.delete()
        res = self.owner.client.post(
            f"{API}workspaces/{self.ws}/cards", {"name": "Whatever", "title": "Anything", "slug": "owner-card"}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual((res.data["name"], res.data["slug"]), ("Whatever", "owner-card"))


class OwnerCardProtectionTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.admin = self.add("ada@example.com", "Ada Admin", role="admin")
        self.admin2 = self.add("abe@example.com", "Abe Admin", role="admin")
        self.eve = self.add("eve@example.com", "Eve Employee")
        # the owner has a card (a company owner gets a seat with a card on creation of one)
        existing = Card.objects.filter(member=self.owner_member).first()
        if existing is None:
            res = self.owner.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Olivia Owner"}, format="json")
            self.assertEqual(res.status_code, 201, res.content)
            existing = Card.objects.get(pk=res.data["id"])
        self.owner_card = existing
        self.owner.client.post(f"{API}cards/{self.owner_card.id}/publish")

    def card(self, pk=None):
        return Card.objects.get(pk=pk or self.owner_card.pk)

    def test_admin_cannot_delete_the_owners_card(self):
        res = self.admin.client.delete(f"{API}cards/{self.owner_card.id}")
        self.assertEqual(res.status_code, 403, res.content)
        self.assertTrue(Card.objects.filter(pk=self.owner_card.pk).exists())

    def test_admin_cannot_suspend_restore_publish_unpublish_the_owners_card(self):
        for action in ("suspend", "unpublish", "publish", "restore"):
            res = self.admin.client.post(f"{API}cards/{self.owner_card.id}/{action}")
            self.assertEqual(res.status_code, 403, (action, res.content))
        self.assertEqual(self.card().status, "published")

    def test_admin_cannot_reassign_the_owners_card(self):
        res = self.admin.client.post(f"{API}cards/{self.owner_card.id}/reassign", {"member_id": None}, format="json")
        self.assertEqual(res.status_code, 403, res.content)
        self.assertEqual(self.card().member_id, self.owner_member.id)

    def test_bulk_actions_report_a_refusal_per_item(self):
        for action in ("suspend", "unpublish", "delete"):
            res = self.admin.client.post(f"{API}workspaces/{self.ws}/bulk/cards", {"action": action, "ids": [str(self.owner_card.id)]}, format="json")
            self.assertEqual(res.status_code, 200, res.content)
            self.assertEqual(res.data["failed"], 1, (action, res.data))
        self.assertTrue(Card.objects.filter(pk=self.owner_card.pk, status="published").exists())
        res = self.admin.client.post(
            f"{API}workspaces/{self.ws}/bulk/members", {"action": "unpublish", "ids": [str(self.owner_member.id)]}, format="json"
        )
        self.assertEqual(res.data["failed"], 1, res.data)

    def test_admin_cannot_touch_another_admins_card_but_can_touch_an_employees(self):
        other_card = Card.objects.get(pk=self.admin2.card_id)
        res = self.admin.client.post(f"{API}cards/{other_card.id}/suspend")
        self.assertEqual(res.status_code, 403, res.content)
        eve_card = Card.objects.get(pk=self.eve.card_id)
        self.assertEqual(self.admin.client.post(f"{API}cards/{eve_card.id}/suspend").status_code, 200)
        self.assertEqual(self.admin.client.post(f"{API}cards/{eve_card.id}/restore").status_code, 200)

    def test_admin_keeps_control_of_their_own_card(self):
        mine = self.admin.card_id
        self.assertEqual(self.admin.client.post(f"{API}cards/{mine}/publish").status_code, 200)
        self.assertEqual(self.admin.client.post(f"{API}cards/{mine}/unpublish").status_code, 200)

    def test_admin_removing_an_employee_cannot_hand_the_card_around_unchecked(self):
        res = self.admin.client.delete(self.url(f"members/{self.eve.member_id}"), {"card": "reassign", "reassign_to": None}, format="json")
        self.assertEqual(res.status_code, 204, res.content)

    def test_owner_can_manage_everything(self):
        admin_card = Card.objects.get(pk=self.admin.card_id)
        for action in ("suspend", "restore", "unpublish", "publish"):
            self.assertEqual(self.owner.client.post(f"{API}cards/{admin_card.id}/{action}").status_code, 200, action)
        self.assertEqual(self.owner.client.post(f"{API}cards/{self.owner_card.id}/suspend").status_code, 200)
        self.assertEqual(self.owner.client.post(f"{API}cards/{self.owner_card.id}/restore").status_code, 200)
        self.assertEqual(self.owner.client.post(f"{API}cards/{admin_card.id}/reassign", {"member_id": None}, format="json").status_code, 200)
        self.assertEqual(self.owner.client.delete(f"{API}cards/{self.eve.card_id}").status_code, 204)
        self.assertEqual(self.owner.client.delete(f"{API}cards/{self.owner_card.id}").status_code, 204)

    def test_owner_and_employee_member_rows_unchanged(self):
        self.assertEqual(Member.objects.get(pk=self.owner_member.pk).role, "owner")
