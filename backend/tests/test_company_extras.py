"""What a company lets its employees add under their cards, the company's own card, and whose orders and bookings are whose."""
from rest_framework.test import APIClient

from cards.models import Card, Product
from operations.rules import EXTRA_KINDS, extras_for
from orders.models import Order

from .ops_base import OpsTestCase
from .base import API

SHOP = {"title": "Coffee", "price": "12.50"}


class ExtrasCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.eve = self.add("eve@example.com", "Eve Employee")
        self.rules_url = self.url("field-rules")

    def set_rules(self, **rules):
        res = self.owner.client.patch(self.rules_url, rules, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def section(self, person, kind, card_id=None):
        return person.client.post(f"{API}cards/{card_id or person.card_id}/sections", {"kind": kind, "data": {"title": "x"}}, format="json")


class ExtrasRuleTests(ExtrasCase):
    def test_every_extra_is_allowed_by_default(self):
        rules = self.owner.client.get(self.rules_url).data
        self.assertEqual(rules["extras"], "all")
        self.assertEqual(rules["extra_kinds"], list(EXTRA_KINDS))

    def test_the_rule_takes_all_some_or_none_and_a_list_of_kinds(self):
        self.assertEqual(self.set_rules(extras="some", extra_kinds=["map", "hours"])["extra_kinds"], ["hours", "map"])
        self.assertEqual(self.owner.client.patch(self.rules_url, {"extras": "maybe"}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.patch(self.rules_url, {"extra_kinds": ["nope"]}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.patch(self.rules_url, {"extra_kinds": "map"}, format="json").status_code, 400)

    def test_the_card_editor_is_told_which_extras_a_person_may_add(self):
        self.assertEqual(self.eve.client.get(f"{API}cards/{self.eve.card_id}").data["field_access"]["extras"], list(EXTRA_KINDS))
        self.set_rules(extras="some", extra_kinds=["map"])
        self.assertEqual(self.eve.client.get(f"{API}cards/{self.eve.card_id}").data["field_access"]["extras"], ["map"])
        self.set_rules(extras="none")
        self.assertEqual(self.eve.client.get(f"{API}cards/{self.eve.card_id}").data["field_access"]["extras"], [])
        # the owner is never limited by the company's own rule
        mine = self.owner.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Olivia"}, format="json").data
        self.assertEqual(self.owner.client.get(f"{API}cards/{mine['id']}").data["field_access"]["extras"], list(EXTRA_KINDS))

    def test_only_an_employee_is_limited(self):
        self.set_rules(extras="none")
        admin = self.add("ann@example.com", "Ann Admin", role="admin")
        from workspaces.models import Member

        self.assertEqual(extras_for(self.owner_member.workspace, self.owner_member), list(EXTRA_KINDS))
        self.assertEqual(extras_for(self.owner_member.workspace, Member.objects.get(pk=admin.member_id)), list(EXTRA_KINDS))
        self.assertEqual(extras_for(self.owner_member.workspace, Member.objects.get(pk=self.eve.member_id)), [])


class ExtrasEnforcementTests(ExtrasCase):
    def test_an_employee_adds_an_extra_the_company_allows_and_is_refused_one_it_does_not(self):
        self.set_rules(extras="some", extra_kinds=["map"])
        self.assertEqual(self.section(self.eve, "map").status_code, 201)
        refused = self.section(self.eve, "hours")
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.data["error"]["code"], "feature_unavailable")

    def test_with_none_allowed_nothing_can_be_added_and_the_shop_and_booking_are_refused(self):
        self.set_rules(extras="none")
        self.assertEqual(self.section(self.eve, "map").status_code, 403)
        self.assertEqual(self.eve.client.post(f"{API}cards/{self.eve.card_id}/products", SHOP, format="json").status_code, 403)
        self.assertEqual(self.eve.client.put(f"{API}cards/{self.eve.card_id}/booking-settings", {"enabled": True}, format="json").status_code, 403)

    def test_the_owner_and_the_company_card_are_not_limited(self):
        self.set_rules(extras="none")
        mine = self.owner.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Olivia"}, format="json").data
        self.assertEqual(self.section(self.owner, "map", card_id=mine["id"]).status_code, 201)

    def test_an_extra_that_was_added_before_is_kept_but_not_shown_on_the_public_page(self):
        self.assertEqual(self.section(self.eve, "map").status_code, 201)
        self.assertTrue(self.eve.client.post(f"{API}cards/{self.eve.card_id}/publish").status_code in (200, 402))
        card = Card.objects.get(pk=self.eve.card_id)
        card.status = "published"
        card.save(update_fields=["status"])
        shown = APIClient().get(f"{API}public/cards/{card.public_code}").data["card"]["sections"]
        self.assertEqual([s["kind"] for s in shown], ["map"])
        self.set_rules(extras="none")
        self.assertEqual(card.sections.count(), 1)
        shown = APIClient().get(f"{API}public/cards/{card.public_code}").data["card"]["sections"]
        self.assertEqual(shown, [])
        self.set_rules(extras="all")
        shown = APIClient().get(f"{API}public/cards/{card.public_code}").data["card"]["sections"]
        self.assertEqual([s["kind"] for s in shown], ["map"])

    def test_a_shop_the_company_no_longer_allows_takes_no_orders(self):
        product = Product.objects.create(card_id=self.eve.card_id, title="Tea", price="5.00")
        card = Card.objects.get(pk=self.eve.card_id)
        card.status = "published"
        card.save(update_fields=["status"])
        self.set_rules(extras="none")
        res = APIClient().post(
            f"{API}public/cards/{card.public_code}/orders",
            {"items": [{"product_id": str(product.id), "qty": 1}], "name": "Vera", "phone": "+974 5555 1234", "consent": True},
            format="json",
        )
        self.assertEqual(res.status_code, 403)


class CompanyCardTests(ExtrasCase):
    def test_an_owner_or_admin_makes_the_companys_own_card_once(self):
        url = f"{API}workspaces/{self.ws}/company-card"
        first = self.owner.client.post(url)
        self.assertEqual(first.status_code, 201, first.content)
        self.assertIs(first.data["is_company"], True)
        self.assertEqual(first.data["status"], "draft")
        again = self.owner.client.post(url)
        self.assertEqual(again.status_code, 200)
        self.assertEqual(again.data["id"], first.data["id"])
        self.assertEqual(Card.objects.filter(workspace_id=self.ws, is_company=True).count(), 1)

    def test_an_employee_cannot_make_or_see_it(self):
        url = f"{API}workspaces/{self.ws}/company-card"
        self.assertEqual(self.eve.client.post(url).status_code, 403)
        card = self.owner.client.post(url).data
        self.assertEqual(self.eve.client.get(f"{API}cards/{card['id']}").status_code, 404)
        self.assertNotIn(card["id"], [c["id"] for c in self.eve.client.get(f"{API}workspaces/{self.ws}/cards").data])

    def test_a_personal_workspace_has_no_company_card(self):
        person = self.signup("solo@example.com", "Solo Person")
        self.assertEqual(person.client.post(f"{API}workspaces/{person.ws}/company-card").status_code, 403)

    def test_the_company_card_can_have_any_extra(self):
        self.set_rules(extras="none")
        card = self.owner.client.post(f"{API}workspaces/{self.ws}/company-card").data
        self.assertEqual(self.section(self.owner, "map", card_id=card["id"]).status_code, 201)


class OrdersBelongToTheCardOwnerTests(ExtrasCase):
    def order_on(self, card_id, number):
        card = Card.objects.get(pk=card_id)
        return Order.objects.create(
            card=card, workspace_id=self.ws, number=number, customer_name="Vera", customer_phone="+974 5555 1234", items=[], total="5.00", currency="QAR",
        )

    def numbers(self, person):
        res = person.client.get(f"{API}workspaces/{self.ws}/orders")
        self.assertEqual(res.status_code, 200, res.content)
        return sorted(o["number"] for o in res.data["results"])

    def test_an_admin_does_not_see_an_employees_orders_but_sees_the_company_cards(self):
        company = self.owner.client.post(f"{API}workspaces/{self.ws}/company-card").data
        self.order_on(self.eve.card_id, "B-EVE111")
        self.order_on(company["id"], "B-CO2222")
        self.assertEqual(self.numbers(self.eve), ["B-EVE111"])
        self.assertEqual(self.numbers(self.owner), ["B-CO2222"])

    def test_an_employee_never_sees_the_company_cards_orders(self):
        company = self.owner.client.post(f"{API}workspaces/{self.ws}/company-card").data
        self.order_on(company["id"], "B-CO3333")
        self.assertEqual(self.numbers(self.eve), [])

    def test_the_orders_of_a_deleted_card_stay_with_the_owners_and_admins(self):
        self.order_on(self.eve.card_id, "B-GONE44")
        Card.objects.filter(pk=self.eve.card_id).delete()
        self.assertEqual(self.numbers(self.owner), ["B-GONE44"])

    def test_an_admin_cannot_open_an_employees_order_by_its_address(self):
        order = self.order_on(self.eve.card_id, "B-EVE555")
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}/orders/{order.id}").status_code, 404)
        self.assertEqual(self.eve.client.get(f"{API}workspaces/{self.ws}/orders/{order.id}").status_code, 200)


class MenuAccessTests(ExtrasCase):
    def access(self, person):
        res = person.client.get(f"{API}workspaces/{self.ws}/commerce-access")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def test_orders_and_bookings_wait_until_there_is_a_shop_or_a_booking_page(self):
        got = self.access(self.eve)
        self.assertEqual((got["orders"], got["bookings"]), (False, False))
        self.assertEqual(self.section(self.eve, "products").status_code, 201)
        got = self.access(self.eve)
        self.assertEqual((got["orders"], got["bookings"]), (True, False))
        self.assertEqual(self.section(self.eve, "booking").status_code, 201)
        self.assertEqual(self.access(self.eve)["bookings"], True)

    def test_they_disappear_when_not_allowed_and_nothing_came_in(self):
        self.assertEqual(self.section(self.eve, "products").status_code, 201)
        self.set_rules(extras="some", extra_kinds=["map"])
        got = self.access(self.eve)
        self.assertEqual((got["orders"], got["bookings"]), (False, False))
        self.assertEqual(got["extras"], ["map"])

    def test_old_orders_keep_the_orders_page_reachable(self):
        Order.objects.create(
            card_id=self.eve.card_id, workspace_id=self.ws, number="B-OLD777", customer_name="Vera", customer_phone="+974 5555 1234", items=[], total="5.00", currency="QAR",
        )
        self.set_rules(extras="none")
        got = self.access(self.eve)
        self.assertEqual((got["orders"], got["bookings"]), (True, False))

    def test_owners_with_a_shop_on_the_company_card_have_the_pages(self):
        self.set_rules(extras="none")
        self.assertEqual((self.access(self.owner)["orders"], self.access(self.owner)["bookings"]), (False, False))
        company = self.owner.client.post(f"{API}workspaces/{self.ws}/company-card").data
        self.assertEqual(self.section(self.owner, "products", card_id=company["id"]).status_code, 201)
        self.assertEqual(self.access(self.owner)["orders"], True)


class EmployeesDoNotSeeBillingTests(ExtrasCase):
    def test_an_employee_gets_the_plan_status_but_not_seats_or_billing_dates(self):
        mine = next(w for w in self.eve.client.get(f"{API}me/workspaces").data if w["id"] == self.ws)
        sub = mine["subscription"]
        self.assertIs(sub["live"], True)
        self.assertEqual((sub["seats_total"], sub["seats_used"], sub["starts_at"], sub["ends_at"], sub["grace_ends_at"]), (0, 0, None, None, None))
        detail = self.eve.client.get(f"{API}workspaces/{self.ws}").data["subscription"]
        self.assertEqual((detail["seats_total"], detail["ends_at"]), (0, None))
        owners = next(w for w in self.owner.client.get(f"{API}me/workspaces").data if w["id"] == self.ws)["subscription"]
        self.assertGreater(owners["seats_total"], 0)
        self.assertIsNotNone(owners["ends_at"])
