"""Departments, their card templates and how the design lock treats them."""
from django.core import mail

from cards.models import Card
from workspaces.models import Member

from .base import API
from .ops_base import OpsTestCase


class DepartmentCrudTests(OpsTestCase):
    def test_owner_and_admin_manage_departments(self):
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        dept = self.department("Sales", design={"face": 12, "colour": 2}, items=[{"kind": "Calendly", "value": "acme/intro", "label": "Book a meeting"}])
        self.assertEqual(dept["member_count"], 0)
        self.assertEqual(dept["design"], {"face": 12, "colour": 2})
        self.assertEqual(dept["items"][0]["kind"], "Calendly")
        res = admin.client.post(self.url("departments"), {"name": "Support"}, format="json")
        self.assertEqual(res.status_code, 201)
        res = admin.client.patch(self.url(f"departments/{dept['id']}"), {"name": "Sales EMEA"}, format="json")
        self.assertEqual(res.data["name"], "Sales EMEA")
        listing = self.owner.client.get(self.url("departments")).data
        self.assertEqual([d["name"] for d in listing], ["Sales EMEA", "Support"])
        self.assertEqual(self.owner.client.get(self.url(f"departments/{dept['id']}")).status_code, 200)

    def test_employees_and_outsiders_cannot_touch_departments(self):
        emp = self.add("emp@example.com", "Eve Employee")
        dept = self.department("Sales")
        self.assertEqual(emp.client.get(self.url("departments")).status_code, 403)
        self.assertEqual(emp.client.post(self.url("departments"), {"name": "X"}, format="json").status_code, 403)
        self.assertEqual(emp.client.patch(self.url(f"departments/{dept['id']}"), {"name": "X"}, format="json").status_code, 403)
        self.assertEqual(emp.client.delete(self.url(f"departments/{dept['id']}")).status_code, 403)
        outsider = self.signup("out@example.com", "Out Sider")
        self.assertEqual(outsider.client.get(self.url("departments")).status_code, 404)
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        self.assertEqual(other.client.get(f"{API}workspaces/{other_ws}/departments/{dept['id']}").status_code, 404)

    def test_validation(self):
        self.department("Sales")
        post = lambda body: self.owner.client.post(self.url("departments"), body, format="json")
        self.assertEqual(post({"name": ""}).status_code, 400)
        self.assertEqual(post({"name": "sales"}).status_code, 400)  # same name in any case
        self.assertEqual(post({"name": "x" * 61}).status_code, 400)
        self.assertEqual(post({"name": "A", "design": {"font": "x"}}).status_code, 400)
        self.assertEqual(post({"name": "B", "design": {"face": 999}}).status_code, 400)
        # Company colours need a palette.
        self.assertEqual(post({"name": "C", "design": {"colour": 4}}).status_code, 400)
        self.assertEqual(post({"name": "D", "items": [{"kind": "Website", "value": "javascript:alert(1)"}]}).status_code, 400)
        self.assertEqual(post({"name": "E", "items": [{"kind": "Nope", "value": "x"}]}).status_code, 400)
        self.assertEqual(post({"name": "F", "items": [{"kind": "Website", "value": ""}]}).status_code, 400)
        self.assertEqual(post({"name": "G", "items": "nope"}).status_code, 400)

    def test_delete_keeps_people_and_clears_their_department(self):
        dept = self.department("Sales")
        bob = self.add("bob@example.com", "Bob Builder", department_id=dept["id"])
        self.assertEqual(Member.objects.get(pk=bob.member_id).department_id.hex, dept["id"].replace("-", ""))
        self.assertEqual(self.owner.client.delete(self.url(f"departments/{dept['id']}")).status_code, 204)
        self.assertIsNone(Member.objects.get(pk=bob.member_id).department_id)
        self.assertTrue(Member.objects.filter(pk=bob.member_id).exists())

    def test_assign_members_single_and_bulk(self):
        dept = self.department("Sales")
        a = self.add("a@example.com", "Ann A")
        b = self.add("b@example.com", "Bob B")
        res = self.owner.client.patch(self.url(f"members/{a.member_id}"), {"department_id": dept["id"]}, format="json")
        self.assertEqual(res.data["department_name"], "Sales")
        res = self.owner.client.post(self.url(f"departments/{dept['id']}/assign"), {"member_ids": [a.member_id, b.member_id]}, format="json")
        self.assertEqual((res.data["ok"], res.data["failed"]), (1, 1))  # Ann was already in it
        counts = {d["name"]: d["member_count"] for d in self.owner.client.get(self.url("departments")).data}
        self.assertEqual(counts["Sales"], 2)
        res = self.owner.client.patch(self.url(f"members/{a.member_id}"), {"department_id": "nope"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.owner.client.patch(self.url(f"members/{a.member_id}"), {"department_id": None}, format="json")
        self.assertIsNone(res.data["department_id"])
        members = {m["email"]: m for m in self.owner.client.get(self.url("members")).data}
        self.assertEqual(members["b@example.com"]["department_name"], "Sales")

    def test_cannot_use_another_companys_department(self):
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        theirs = other.client.post(f"{API}workspaces/{other_ws}/departments", {"name": "Theirs"}, format="json").data
        res = self.owner.client.post(
            self.url("invites"), {"invites": [{"email": "x@example.com", "department_id": theirs["id"]}]}, format="json"
        )
        self.assertEqual(res.status_code, 400)
        a = self.add("a@example.com", "Ann A")
        res = self.owner.client.patch(self.url(f"members/{a.member_id}"), {"department_id": theirs["id"]}, format="json")
        self.assertEqual(res.status_code, 400)


class DepartmentTemplateTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.owner.client.patch(
            f"{API}workspaces/{self.ws}",
            {"brand": {"website": "https://acme.example", "design": {"face": 3, "colour": 1, "below": 2, "intro": 4}}},
            format="json",
        )
        self.sales = self.department(
            "Sales",
            design={"face": 21, "colour": 3},
            items=[{"kind": "Calendly", "value": "acme/intro", "label": "Book a meeting"}, {"kind": "WhatsApp", "value": "+97455550000"}],
            mandatory_items=[{"kind": "Mobile", "value": "+97440001111", "label": "Sales desk"}],
        )

    def card(self, owner_client, card_id):
        return owner_client.get(f"{API}cards/{card_id}").data

    def test_invite_into_a_department_starts_the_draft_from_its_template(self):
        member = self.invite(self.owner, self.ws, "new@example.com", full_name="Nia New", department_id=self.sales["id"])
        card = self.card(self.owner.client, member["card_id"])
        self.assertEqual(card["status"], "draft")
        self.assertEqual((card["design"]["face"], card["design"]["colour"]), (21, 3))
        # The rest of the design still comes from the company.
        self.assertEqual((card["design"]["below"], card["design"]["intro"]), (2, 4))
        kinds = [(i["kind"], i["value"]) for i in card["items"]]
        self.assertEqual(kinds[0], ("Website", "https://acme.example"))
        self.assertIn(("Calendly", "acme/intro"), kinds)
        self.assertIn(("WhatsApp", "+97455550000"), kinds)
        self.assertIn(("Mobile", "+97440001111"), kinds)
        self.assertEqual(len(kinds), 4)
        self.assertEqual(member["department_name"], "Sales")

    def test_company_mandatory_buttons_are_on_every_new_card(self):
        self.owner.client.patch(
            self.url("field-rules"), {"mandatory_buttons": [{"kind": "Landline", "value": "+97444440000", "label": "Support"}]}, format="json"
        )
        plain = self.invite(self.owner, self.ws, "plain@example.com", full_name="Pia Plain")
        card = self.card(self.owner.client, plain["card_id"])
        self.assertIn(("Landline", "+97444440000"), [(i["kind"], i["value"]) for i in card["items"]])

    def test_no_department_means_the_company_design_only(self):
        member = self.invite(self.owner, self.ws, "plain@example.com", full_name="Pia Plain")
        card = self.card(self.owner.client, member["card_id"])
        self.assertEqual((card["design"]["face"], card["design"]["colour"]), (3, 1))

    def test_csv_import_takes_a_department_column(self):
        from django.core.files.uploadedfile import SimpleUploadedFile

        csv = "email,full_name,title,department\nsue@example.com,Sue S,Rep,sales\nbad@example.com,Bad B,Rep,Nowhere\n"
        res = self.owner.client.post(
            self.url("members/import"), {"file": SimpleUploadedFile("t.csv", csv.encode(), content_type="text/csv")}, format="multipart"
        )
        self.assertEqual(res.data["created"], 1, res.data)
        self.assertEqual(res.data["skipped"][0]["row"], 3)
        self.assertIn("Unknown department", res.data["skipped"][0]["reason"])
        self.assertEqual(Member.objects.get(email="sue@example.com").department.name, "Sales")

    def test_moving_a_person_does_not_rewrite_their_existing_card(self):
        member = self.invite(self.owner, self.ws, "plain@example.com", full_name="Pia Plain")
        self.owner.client.patch(self.url(f"members/{member['id']}"), {"department_id": self.sales["id"]}, format="json")
        card = self.card(self.owner.client, member["card_id"])
        self.assertEqual(card["design"]["face"], 3)
        self.assertEqual(len(card["items"]), 1)


class DepartmentDesignAndLockTests(OpsTestCase):
    """The department design counts when the lock is off, or when the lock allows departments."""

    def setUp(self):
        super().setUp()
        self.company_design = {"face": 3, "colour": 1, "below": 2, "intro": 4}
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": self.company_design}}, format="json")
        self.sales = self.department("Sales", design={"face": 21, "below": 9})
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
        return res.data["brand"]

    def test_lock_off_keeps_the_designs_the_cards_started_with(self):
        self.assertEqual(self.design_of(self.bob)["face"], 21)
        self.assertEqual(self.design_of(self.plain)["face"], 3)

    def test_lock_on_wins_over_the_department_design(self):
        brand = self.set_lock(True, False)
        self.assertFalse(brand["lock_allows_departments"])
        self.assertEqual(self.design_of(self.bob), {**self.company_design, "custom_face": None, "top": 0, "font": "face", "size": 100, "photo": True, "brand_colors": False, "foot": True})

    def test_lock_on_with_departments_allowed_uses_the_department_keys_only(self):
        brand = self.set_lock(True, True)
        self.assertTrue(brand["lock_allows_departments"])
        design = self.design_of(self.bob)
        self.assertEqual((design["face"], design["below"]), (21, 9))
        self.assertEqual((design["colour"], design["intro"]), (1, 4))
        self.assertEqual(self.design_of(self.plain)["face"], 3)
        public = self.client_for().get(f"{API}public/cards/{Card.objects.get(pk=self.bob.card_id).public_code}")
        self.owner.client.post(f"{API}cards/{self.bob.card_id}/publish")
        public = self.client_for().get(f"{API}public/cards/{Card.objects.get(pk=self.bob.card_id).public_code}")
        self.assertEqual(public.data["card"]["design"]["face"], 21)

    def test_the_company_font_and_size_are_locked_with_the_rest(self):
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": {"font": "lora", "size": 90}}}, format="json")
        self.set_lock(True, False)
        res = self.bob.client.patch(f"{API}cards/{self.bob.card_id}", {"design": {"font": "bebas", "size": 140, "photo": False}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["design"]["font"], res.data["design"]["size"]), ("lora", 90))
        self.assertIs(res.data["design"]["photo"], False)  # the photo switch stays the card's own
        self.assertEqual(self.design_of(self.plain)["font"], "lora")

    def test_a_department_can_override_font_and_size_when_the_lock_allows_it(self):
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"design": {"font": "lora", "size": 90}}}, format="json")
        res = self.owner.client.patch(self.url(f"departments/{self.sales['id']}"), {"design": {"font": "oswald", "size": 110}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.set_lock(True, True)
        design = self.design_of(self.bob)
        self.assertEqual((design["font"], design["size"]), ("oswald", 110))
        plain = self.design_of(self.plain)
        self.assertEqual((plain["font"], plain["size"]), ("lora", 90))
        self.set_lock(True, False)
        self.assertEqual(self.design_of(self.bob)["font"], "lora")

    def test_a_department_design_with_a_bad_font_or_size_is_refused(self):
        for bad in ({"font": "wingdings"}, {"size": 200}, {"size": True}):
            res = self.owner.client.patch(self.url(f"departments/{self.sales['id']}"), {"design": bad}, format="json")
            self.assertEqual(res.status_code, 400, bad)

    def test_employee_design_writes_stay_ignored_under_the_lock(self):
        self.set_lock(True, True)
        res = self.bob.client.patch(f"{API}cards/{self.bob.card_id}", {"design": {"face": 99}}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["design"]["face"], 21)

    def test_lock_changes_are_logged_with_the_department_flag(self):
        self.set_lock(True, True)
        events = [e for e in self.audit()["results"] if e["action"] == "brand.lock_changed"]
        self.assertEqual(events[0]["details"], {"lock_design": True, "lock_allows_departments": True})

    def test_invite_email_is_sent_with_the_department_card(self):
        mail.outbox.clear()
        self.invite(self.owner, self.ws, "mail@example.com", department_id=self.sales["id"])
        self.assertEqual(len(mail.outbox), 1)
