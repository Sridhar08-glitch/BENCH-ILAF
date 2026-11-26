"""The top of the page (design.top), the page button sets (below 401 to 427), their switch and their plan rule."""
from billing.models import Plan, Subscription
from staff import flags
from staff.models import FeatureFlag

from .base import API, ApiTestCase
from .ops_base import OpsTestCase


def free_plan():
    return Plan.objects.get_or_create(
        code="free",
        defaults={
            "name": "Free", "kind": "personal", "interval": "year", "price_minor": 0, "currency": "QAR",
            "max_cards": 1, "per_seat": False, "min_seats": 1, "sort_order": 0,
        },
    )[0]


def move_to_free_plan(workspace_id):
    """The workspace keeps a live period, but on a plan that costs nothing."""
    Subscription.objects.filter(workspace_id=workspace_id).update(plan=free_plan())


class SwitchOff:
    def __init__(self, key="page_styles"):
        self.key = key

    def __enter__(self):
        FeatureFlag.objects.update_or_create(key=self.key, defaults={"state": "off"})
        flags.clear_cache()

    def __exit__(self, *exc):
        FeatureFlag.objects.filter(key=self.key).delete()
        flags.clear_cache()


class TopDesignTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.make_card(self.person)
        self.anon = self.client_for()

    def patch(self, body):
        return self.person.client.patch(f"{API}cards/{self.card['id']}", body, format="json")

    def public_design(self):
        res = self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        self.assertEqual(res.status_code, 200, res.content)
        return self.anon.get(f"{API}public/cards/{self.card['public_code']}").data["card"]["design"]

    def test_new_cards_are_classic(self):
        self.assertEqual(self.card["design"]["top"], 0)
        self.assertEqual(self.public_design()["top"], 0)

    def test_top_takes_zero_to_one_hundred_twenty_seven(self):
        from ilaf.design import TOP_COUNT

        self.assertEqual(TOP_COUNT, 127)
        for value in (0, 1, 14, 27, 28, 77, 78, 127):
            res = self.patch({"design": {"top": value}})
            self.assertEqual(res.status_code, 200, (value, res.content))
            self.assertEqual(res.data["design"]["top"], value)
        for bad in (-1, 128, 1.5, "popl", True, None):
            res = self.patch({"design": {"top": bad}})
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn("design.top", res.data["error"]["fields"])

    def test_page_button_sets_run_to_527(self):
        for value in (400, 401, 427, 428, 477, 478, 527):
            self.assertEqual(self.patch({"design": {"below": value}}).status_code, 200, value)
        res = self.patch({"design": {"below": 528}})
        self.assertEqual(res.status_code, 400)
        self.assertIn("design.below", res.data["error"]["fields"])

    def test_top_survives_other_design_changes_and_reaches_the_public_page(self):
        self.patch({"design": {"top": 5, "below": 405}})
        res = self.patch({"design": {"colour": 2}})
        self.assertEqual((res.data["design"]["top"], res.data["design"]["below"]), (5, 405))
        design = self.public_design()
        self.assertEqual((design["top"], design["below"]), (5, 405))

    def test_a_design_stored_without_top_reads_as_classic(self):
        from cards.models import Card

        Card.objects.filter(pk=self.card["id"]).update(
            design={"face": 5, "colour": 1, "below": 2, "intro": 3, "photo": True, "brand_colors": False, "foot": True}
        )
        res = self.person.client.get(f"{API}cards/{self.card['id']}")
        self.assertEqual((res.data["design"]["top"], res.data["design"]["face"]), (0, 5))

    def test_switch_off_refuses_page_styles_but_keeps_classic_writes(self):
        with SwitchOff():
            res = self.patch({"design": {"top": 3}})
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_unavailable"))
            res = self.patch({"design": {"below": 401}})
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_unavailable"))
            self.assertEqual(self.patch({"design": {"top": 0, "below": 400}}).status_code, 200)
            self.assertEqual(self.patch({"design": {"face": 9, "colour": 2}}).status_code, 200)

    def test_switch_off_still_renders_a_stored_page_style(self):
        self.assertEqual(self.patch({"design": {"top": 7, "below": 407}}).status_code, 200)
        with SwitchOff():
            card = self.person.client.get(f"{API}cards/{self.card['id']}").data
            self.assertEqual((card["design"]["top"], card["design"]["below"]), (7, 407))
            design = self.public_design()
            self.assertEqual((design["top"], design["below"]), (7, 407))

    def test_a_free_plan_is_told_to_upgrade(self):
        move_to_free_plan(self.person.ws)
        for rich in ({"top": 3}, {"below": 401}, {"top": 27, "below": 427}, {"top": 77, "below": 477}, {"top": 127, "below": 527}):
            res = self.patch({"design": rich})
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"), rich)
            self.assertIn("Upgrade", res.data["error"]["message"])
        # Classic stays free, inside the free set of 50 faces, layouts and animations.
        self.assertEqual(self.patch({"design": {"top": 0, "below": 12, "face": 50}}).status_code, 200)
        # Faces past the 50th are for the paid plans.
        self.assertEqual(self.patch({"design": {"face": 300}}).status_code, 403)

    def test_the_plan_rule_is_said_in_arabic_too(self):
        move_to_free_plan(self.person.ws)
        res = self.person.client.patch(
            f"{API}cards/{self.card['id']}", {"design": {"top": 3}}, format="json", HTTP_ACCEPT_LANGUAGE="ar"
        )
        self.assertEqual(res.status_code, 403)
        self.assertNotIn("Upgrade", res.data["error"]["message"])

    def test_a_plan_that_lapses_to_free_keeps_rendering_the_page_style(self):
        self.assertEqual(self.patch({"design": {"top": 9, "below": 409}}).status_code, 200)
        move_to_free_plan(self.person.ws)
        card = self.person.client.get(f"{API}cards/{self.card['id']}").data
        self.assertEqual((card["design"]["top"], card["design"]["below"]), (9, 409))
        design = self.public_design()
        self.assertEqual((design["top"], design["below"]), (9, 409))
        # Any further rich write is refused, a classic one is not.
        self.assertEqual(self.patch({"design": {"top": 10}}).status_code, 403)
        self.assertEqual(self.patch({"design": {"colour": 3}}).status_code, 200)

    def test_rich_pages_allowed_reads_the_plan(self):
        from cards.features import rich_pages_allowed
        from workspaces.models import Workspace

        ws = Workspace.objects.get(pk=self.person.ws)
        self.assertTrue(rich_pages_allowed(ws))
        move_to_free_plan(self.person.ws)
        self.assertFalse(rich_pages_allowed(ws))
        Subscription.objects.filter(workspace_id=self.person.ws).delete()
        self.assertFalse(rich_pages_allowed(ws))


class CompanyTopTests(OpsTestCase):
    """The company brand design and department designs carry `top`; the lock applies to it like to the face."""

    def setUp(self):
        super().setUp()
        self.company_design = {"face": 3, "colour": 1, "below": 2, "intro": 4, "top": 2}
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": self.company_design}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.sales = self.department("Sales", design={"face": 21, "top": 14})
        self.bob = self.add("bob@example.com", "Bob Builder", department_id=self.sales["id"])
        self.plain = self.add("plain@example.com", "Pia Plain")

    def design_of(self, person):
        return self.owner.client.get(f"{API}cards/{person.card_id}").data["design"]

    def set_lock(self, lock, departments=None):
        brand = {"lock_design": lock}
        if departments is not None:
            brand["lock_allows_departments"] = departments
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": brand}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_brand_and_department_designs_hold_top(self):
        ws = self.owner.client.get(f"{API}workspaces/{self.ws}").data
        self.assertEqual(ws["brand"]["design"]["top"], 2)
        self.assertEqual(self.sales["design"], {"face": 21, "top": 14})
        self.assertEqual(self.design_of(self.bob)["top"], 14)  # the department template started the card
        self.assertEqual(self.design_of(self.plain)["top"], 2)

    def test_lock_on_applies_the_company_top(self):
        res = self.bob.client.patch(f"{API}cards/{self.bob.card_id}", {"design": {"top": 20}}, format="json")
        self.assertEqual((res.status_code, res.data["design"]["top"]), (200, 20))
        self.set_lock(True, False)
        self.assertEqual(self.design_of(self.bob)["top"], 2)
        # An employee's write to a locked key is ignored without an error; the card keeps the company top.
        res = self.bob.client.patch(f"{API}cards/{self.bob.card_id}", {"design": {"top": 25, "photo": False}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["design"]["top"], 2)
        self.assertIs(res.data["design"]["photo"], False)

    def test_lock_that_allows_departments_takes_the_department_top(self):
        self.set_lock(True, True)
        self.assertEqual((self.design_of(self.bob)["top"], self.design_of(self.bob)["face"]), (14, 21))
        self.assertEqual(self.design_of(self.plain)["top"], 2)

    def test_department_top_is_checked_like_any_design_number(self):
        res = self.owner.client.patch(self.url(f"departments/{self.sales['id']}"), {"design": {"top": 128}}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("design.top", res.data["error"]["fields"])
        res = self.owner.client.patch(self.url(f"departments/{self.sales['id']}"), {"design": {"whatever": 1}}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("top of the page", res.data["error"]["fields"]["design"][0])

    def test_switch_off_refuses_company_and_department_page_styles(self):
        with SwitchOff():
            res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": {"top": 1}}}, format="json")
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_unavailable"))
            res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": {"below": 401}}}, format="json")
            self.assertEqual(res.status_code, 403)
            res = self.owner.client.patch(self.url(f"departments/{self.sales['id']}"), {"design": {"top": 3}}, format="json")
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_unavailable"))
            # Classic values still pass, and the stored tops still render.
            res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": {"face": 5}}}, format="json")
            self.assertEqual(res.status_code, 200, res.content)
            self.assertEqual(self.design_of(self.bob)["top"], 14)

    def test_a_company_on_a_free_plan_is_told_to_upgrade(self):
        Subscription.objects.filter(workspace_id=self.ws).update(plan=Plan.objects.get_or_create(
            code="free-company",
            defaults={"name": "Free company", "kind": "company", "interval": "year", "price_minor": 0, "currency": "QAR",
                      "max_cards": 1, "per_seat": True, "min_seats": 1, "sort_order": 0},
        )[0])
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": {"top": 1}}}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        res = self.owner.client.patch(self.url(f"departments/{self.sales['id']}"), {"design": {"below": 420}}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        self.assertEqual(self.design_of(self.bob)["top"], 14)  # what is stored keeps rendering


class FlagListTests(ApiTestCase):
    def test_page_styles_is_a_known_switch_that_is_on_by_default(self):
        self.assertIn("page_styles", flags.KNOWN)
        self.assertTrue(flags.flag_enabled("page_styles", None))
        self.assertTrue(flags.flags_for(None)["page_styles"])
