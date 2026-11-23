"""The public company directory: address rules, who is listed, search, paging and rate limit."""
from django.test import override_settings
from rest_framework.test import APIClient

from workspaces.models import Member

from .base import API, BIG_RATES
from .ops_base import OpsTestCase


class DirectorySettingsTests(OpsTestCase):
    def patch(self, brand, who=None):
        return (who or self.owner).client.patch(f"{API}workspaces/{self.ws}", {"brand": brand}, format="json")

    def test_off_by_default(self):
        brand = self.owner.client.get(f"{API}workspaces/{self.ws}").data["brand"]
        self.assertFalse(brand["directory_enabled"])
        self.assertIsNone(brand["directory_slug"])
        self.assertEqual(self.client_for().get(f"{API}public/directory/acme").status_code, 404)

    def test_owner_switches_it_on_with_an_address(self):
        res = self.patch({"directory_slug": "Acme-People", "directory_enabled": True})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["brand"]["directory_slug"], res.data["brand"]["directory_enabled"]), ("acme-people", True))
        self.assertEqual(self.client_for().get(f"{API}public/directory/acme-people").status_code, 200)
        res = self.patch({"directory_enabled": False})
        self.assertFalse(res.data["brand"]["directory_enabled"])
        self.assertEqual(res.data["brand"]["directory_slug"], "acme-people")  # the address is kept
        self.assertEqual(self.client_for().get(f"{API}public/directory/acme-people").status_code, 404)

    def test_switching_on_needs_an_address(self):
        res = self.patch({"directory_enabled": True})
        self.assertEqual(res.status_code, 400)
        self.assertIn("brand.directory_slug", res.data["error"]["fields"])

    def test_address_validation_like_card_slugs(self):
        for bad in ("ab", "-nope", "has space", "UPPER_case", "x" * 41, "app", "api", "admin", "d", "directory", "bench"):
            res = self.patch({"directory_slug": bad})
            self.assertIn(res.status_code, (400, 409), bad)

    def test_address_must_be_unique(self):
        self.patch({"directory_slug": "acme-people"})
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        res = other.client.patch(f"{API}workspaces/{other_ws}", {"brand": {"directory_slug": "acme-people"}}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "slug_taken"))
        # Keeping your own address is fine.
        self.assertEqual(self.patch({"directory_slug": "acme-people"}).status_code, 200)

    def test_only_the_owner_changes_the_directory(self):
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        emp = self.add("emp@example.com", "Eve Employee")
        self.assertEqual(self.patch({"directory_slug": "mine-now", "directory_enabled": True}, who=admin).status_code, 403)
        self.assertEqual(self.patch({"directory_slug": "mine-now"}, who=emp).status_code, 403)
        # An admin saving other brand settings, with the directory values unchanged, is fine.
        self.patch({"directory_slug": "acme-people", "directory_enabled": True})
        res = self.patch({"website": "https://acme.example", "directory_slug": "acme-people", "directory_enabled": True}, who=admin)
        self.assertEqual(res.status_code, 200, res.content)

    def test_personal_workspaces_have_no_directory(self):
        person = self.signup("solo@example.com", "Solo")
        res = person.client.patch(f"{API}workspaces/{person.ws}", {"brand": {"directory_enabled": True, "directory_slug": "solo-dir"}}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_changes_are_logged(self):
        self.patch({"directory_slug": "acme-people", "directory_enabled": True})
        event = next(e for e in self.audit()["results"] if e["action"] == "directory.updated")
        self.assertEqual(event["details"], {"enabled": True, "slug": "acme-people"})


class DirectoryListingTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.sales = self.department("Sales")
        self.support = self.department("Support")
        self.anna = self.add("anna@example.com", "Anna Adams", department_id=self.sales["id"], title="Account Executive")
        self.ben = self.add("ben@example.com", "Ben Brooks", department_id=self.support["id"], title="Helpdesk Lead")
        self.cy = self.add("cy@example.com", "Cy Clark", title="Driver")
        self.draft = self.add("dee@example.com", "Dee Draft", department_id=self.sales["id"])
        for p in (self.anna, self.ben, self.cy):
            self.owner.client.post(f"{API}cards/{p.card_id}/publish")
            p.client.patch(f"{API}cards/{p.card_id}", {"items": [{"kind": "Email", "value": f"{p.name.split()[0].lower()}@secret.example"}, {"kind": "Mobile", "value": "+97455550123"}]}, format="json")
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"directory_slug": "acme-people", "directory_enabled": True}}, format="json")
        self.anon = APIClient()

    def get(self, **params):
        res = self.anon.get(f"{API}public/directory/acme-people", params)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def names(self, **params):
        return [r["name"] for r in self.get(**params)["results"]]

    def test_lists_published_cards_of_active_people_only(self):
        self.assertEqual(self.names(), ["Anna Adams", "Ben Brooks", "Cy Clark"])

    def test_shows_photo_name_title_department_and_a_link_but_no_contact_details(self):
        data = self.get()
        row = data["results"][0]
        self.assertEqual(set(row), {"code", "name", "title", "department", "photo_url", "url"})
        self.assertEqual((row["title"], row["department"]), ("Account Executive", "Sales"))
        self.assertTrue(row["url"].startswith("https://web.test/c/"))
        raw = self.anon.get(f"{API}public/directory/acme-people").content.decode()
        for secret in ("secret.example", "97455550123", "anna@example.com"):
            self.assertNotIn(secret, raw)

    def test_company_brand_and_counts(self):
        data = self.get()
        self.assertEqual(data["company"]["name"], "Acme Ltd")
        self.assertEqual(data["company"]["slug"], "acme-people")
        self.assertEqual((data["total"], data["count"], data["page"], data["pages"]), (3, 3, 1, 1))
        self.assertEqual([(d["name"], d["count"]) for d in data["departments"]], [("Sales", 1), ("Support", 1)])
        self.assertIn("palette", data["company"])

    def test_unpublished_suspended_hidden_and_unassigned_cards_are_not_listed(self):
        self.owner.client.post(f"{API}cards/{self.anna.card_id}/unpublish")
        self.assertNotIn("Anna Adams", self.names())
        self.owner.client.post(f"{API}cards/{self.anna.card_id}/publish")
        self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{self.ben.member_id}", {"status": "suspended"}, format="json")
        self.assertNotIn("Ben Brooks", self.names())
        self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{self.ben.member_id}", {"status": "active"}, format="json")
        self.assertIn("Ben Brooks", self.names())
        self.owner.client.post(f"{API}cards/{self.cy.card_id}/suspend")
        self.assertNotIn("Cy Clark", self.names())
        self.owner.client.post(f"{API}cards/{self.cy.card_id}/restore")
        self.assertIn("Cy Clark", self.names())
        self.owner.client.post(f"{API}cards/{self.cy.card_id}/reassign", {"member_id": None}, format="json")
        self.assertNotIn("Cy Clark", self.names())

    def test_a_person_can_hide_their_own_card_and_it_stays_live(self):
        res = self.anna.client.patch(f"{API}cards/{self.anna.card_id}", {"hide_from_directory": True}, format="json")
        self.assertTrue(res.data["hide_from_directory"])
        self.assertNotIn("Anna Adams", self.names())
        card = self.owner.client.get(f"{API}cards/{self.anna.card_id}").data
        self.assertEqual(self.anon.get(f"{API}public/cards/{card['public_code']}").data["state"], "live")
        self.anna.client.patch(f"{API}cards/{self.anna.card_id}", {"hide_from_directory": False}, format="json")
        self.assertIn("Anna Adams", self.names())

    def test_hide_switch_is_not_held_by_field_rules(self):
        self.owner.client.patch(f"{API}workspaces/{self.ws}/field-rules", {"name": "locked", "title": "locked"}, format="json")
        res = self.anna.client.patch(f"{API}cards/{self.anna.card_id}", {"hide_from_directory": True}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_search_by_name_title_and_department(self):
        self.assertEqual(self.names(q="ann"), ["Anna Adams"])
        self.assertEqual(self.names(q="help"), ["Ben Brooks"])
        self.assertEqual(self.names(q="support"), ["Ben Brooks"])
        self.assertEqual(self.names(q="nobody"), [])
        self.assertEqual(self.get(q="a")["count"], 3)  # matches name, title or department, ignoring case

    def test_department_filter(self):
        self.assertEqual(self.names(department=self.sales["id"]), ["Anna Adams"])
        self.assertEqual(self.names(department="not-an-id"), ["Anna Adams", "Ben Brooks", "Cy Clark"])

    def test_paging(self):
        page = self.get(page_size=2)
        self.assertEqual((len(page["results"]), page["pages"], page["count"]), (2, 2, 3))
        second = self.get(page_size=2, page=2)
        self.assertEqual([r["name"] for r in second["results"]], ["Cy Clark"])
        self.assertEqual(self.get(page_size=2, page=99)["page"], 2)  # beyond the end gives the last page
        self.assertEqual(self.get(page_size=1000)["page_size"], 60)
        self.assertEqual(self.anon.get(f"{API}public/directory/acme-people", {"page": "x"}).status_code, 400)

    def test_card_address_uses_the_friendly_slug_when_there_is_one(self):
        self.anna.client.patch(f"{API}cards/{self.anna.card_id}", {"slug": "anna-a"}, format="json")
        row = self.get(q="anna")["results"][0]
        self.assertEqual((row["code"], row["url"]), ("anna-a", "https://web.test/c/anna-a"))

    def test_an_expired_plan_lists_nobody(self):
        from billing.models import Subscription
        from django.utils import timezone
        from datetime import timedelta

        Subscription.objects.filter(workspace_id=self.ws).update(ends_at=timezone.now() - timedelta(days=30))
        data = self.get()
        self.assertEqual((data["results"], data["total"]), ([], 0))

    def test_unknown_address_is_not_found_and_needs_no_login(self):
        self.assertEqual(self.anon.get(f"{API}public/directory/nothing-here").status_code, 404)

    def test_other_companies_people_never_appear(self):
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        m = self.invite(other, other_ws, "zed@example.com", full_name="Zed Zimmer")
        other.client.post(f"{API}cards/{m['card_id']}/publish")
        self.assertNotIn("Zed Zimmer", self.names())

    def test_rate_limited_per_visitor(self):
        with override_settings(ILAF_THROTTLE_RATES={**BIG_RATES, "public_directory": "3/min"}):
            from django.core.cache import cache

            cache.clear()
            codes = [self.anon.get(f"{API}public/directory/acme-people").status_code for _ in range(5)]
        self.assertEqual(codes, [200, 200, 200, 429, 429])

    def test_member_rows_unaffected(self):
        self.assertEqual(Member.objects.filter(workspace_id=self.ws).count(), 5)
