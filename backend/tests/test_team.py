from django.conf import settings
from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from rest_framework.test import APIClient

from cards.models import Card
from workspaces.models import Member

from .base import API, ApiTestCase, png_upload


class CompanyBrandTests(ApiTestCase):
    def test_create_company_workspace_and_brand_patch(self):
        owner = self.signup()
        res = owner.client.post(API + "workspaces", {"name": "Acme Ltd"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["kind"], "company")
        self.assertEqual(res.data["role"], "owner")
        self.assertEqual(res.data["subscription"]["status"], "none")
        self.assertEqual(res.data["brand"]["company_name"], "Acme Ltd")
        self.assertIsNone(res.data["brand"]["logo_url"])
        self.assertIsNone(res.data["custom_domain"])
        ws = res.data["id"]
        res = owner.client.patch(
            f"{API}workspaces/{ws}",
            {"name": "Acme Group", "brand": {"website": "https://acme.test", "lock_design": True,
                                           "design": {"colour": 3, "face": 9}},
             "custom_domain": "Cards.Acme.test"},
            format="json",
        )
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["name"], "Acme Group")
        self.assertTrue(res.data["brand"]["lock_design"])
        self.assertEqual(res.data["brand"]["design"]["face"], 9)
        self.assertEqual(res.data["brand"]["company_name"], "Acme Ltd")  # partial: untouched fields stay
        self.assertEqual(res.data["custom_domain"], "cards.acme.test")

    def test_brand_validation(self):
        owner = self.signup()
        ws = owner.client.post(API + "workspaces", {"name": "Acme"}, format="json").data["id"]
        for body in (
            {"brand": {"design": {"face": 999}}}, {"brand": {"design": {"layout": "classic"}}}, {"brand": {"website": "javascript:alert(1)"}},
            {"custom_domain": "not a domain"}, {"brand": {"lock_design": "maybe"}},
        ):
            res = owner.client.patch(f"{API}workspaces/{ws}", body, format="json")
            self.assertEqual(res.status_code, 400, body)

    def test_logo_upload(self):
        owner = self.signup()
        ws = owner.client.post(API + "workspaces", {"name": "Acme"}, format="json").data["id"]
        res = owner.client.post(f"{API}workspaces/{ws}/logo", {"file": png_upload((1500, 700))}, format="multipart")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["logo_url"].endswith(".png"))
        detail = owner.client.get(f"{API}workspaces/{ws}").data
        self.assertEqual(detail["brand"]["logo_url"], res.data["logo_url"])

    def test_lock_design_gives_every_card_the_company_design(self):
        owner = self.signup()
        ws = self.company(owner)
        owner.client.patch(
            f"{API}workspaces/{ws}",
            {"brand": {"lock_design": True, "design": {"face": 14, "colour": 1, "below": 8, "intro": 17}}},
            format="json",
        )
        eve = self.join(self.invite(owner, ws, "eve@example.com"))
        card = eve.client.get(f"{API}workspaces/{ws}/cards").data[0]
        self.assertEqual((card["design"]["face"], card["design"]["colour"], card["design"]["below"]), (14, 1, 8))
        # Locked settings written by an employee are ignored; the photo switch stays the card's own.
        res = eve.client.patch(
            f"{API}cards/{card['id']}", {"design": {"face": 7, "intro": 0, "photo": False}, "title": "Rep"}, format="json"
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["design"]["face"], 14)
        self.assertEqual(res.data["design"]["intro"], 17)
        self.assertIs(res.data["design"]["photo"], False)
        self.assertEqual(res.data["title"], "Rep")
        eve.client.post(f"{API}cards/{card['id']}/publish")
        pub = APIClient().get(f"{API}public/cards/{card['public_code']}").data
        self.assertEqual(pub["card"]["design"]["face"], 14)
        self.assertIs(pub["card"]["design"]["photo"], False)
        # Unlocking brings back the card's own design (the employee's ignored write never happened).
        owner.client.patch(f"{API}workspaces/{ws}", {"brand": {"lock_design": False}}, format="json")
        res = eve.client.patch(f"{API}cards/{card['id']}", {"design": {"face": 7}}, format="json")
        self.assertEqual(res.data["design"]["face"], 7)

    def test_employee_cannot_edit_brand(self):
        owner = self.signup()
        ws = self.company(owner)
        eve = self.join(self.invite(owner, ws, "eve@example.com"))
        res = eve.client.patch(f"{API}workspaces/{ws}", {"name": "Hacked"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "forbidden")


class InviteFlowTests(ApiTestCase):
    def test_invite_accept_and_card_ownership(self):
        owner = self.signup("owner@example.com", "Olivia Owner")
        ws = self.company(owner)
        owner.client.patch(
            f"{API}workspaces/{ws}",
            {"brand": {"company_name": "Acme", "website": "https://acme.test", "design": {"face": 30, "colour": 2}}}, format="json",
        )
        res = owner.client.post(
            f"{API}workspaces/{ws}/invites",
            {"invites": [{"email": "Eve@Example.com", "full_name": "Eve Employee", "title": "Sales"}]}, format="json",
        )
        self.assertEqual(res.status_code, 201)
        member = res.data[0]
        self.assertEqual(member["email"], "eve@example.com")
        self.assertEqual(member["status"], "invited")
        self.assertIsNone(member["user"])
        self.assertIsNotNone(member["card_id"])
        self.assertEqual(member["role"], "employee")
        # Email with the join link, branded.
        self.assertEqual(len(mail.outbox), 1)
        token = Member.objects.get(pk=member["id"]).invite_token
        self.assertIn(f"https://web.test/join/{token}", mail.outbox[0].body)
        self.assertIn(settings.PRODUCT_NAME, mail.outbox[0].subject)
        self.assertIn("#FF6B35", mail.outbox[0].alternatives[0][0])
        self.assertIn("/brand/ilaf-logo.png", mail.outbox[0].alternatives[0][0])
        # Draft card from the company template.
        card = Card.objects.get(pk=member["card_id"])
        self.assertEqual(card.status, "draft")
        self.assertEqual((card.name, card.title, card.company), ("Eve Employee", "Sales", "Acme"))
        self.assertEqual((card.design["face"], card.design["colour"]), (30, 2))
        self.assertIsNone(card.owner)
        # Public lookup.
        lookup = APIClient().get(f"{API}invites/{token}")
        self.assertEqual(lookup.status_code, 200)
        self.assertEqual(lookup.data, {"workspace_name": "Acme Ltd", "email": "eve@example.com", "full_name": "Eve Employee", "language": None})
        # Accept creates the account.
        res = APIClient().post(f"{API}invites/{token}/accept", {"password": "employee-pass-1"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["workspace_id"], ws)
        eve = self.client_for(res.data["access"])
        card.refresh_from_db()
        self.assertEqual(card.owner.email, "eve@example.com")
        members = {m["email"]: m for m in owner.client.get(f"{API}workspaces/{ws}/members").data}
        self.assertEqual(members["eve@example.com"]["status"], "active")
        self.assertEqual(members["eve@example.com"]["user"]["email"], "eve@example.com")
        self.assertIsNotNone(members["eve@example.com"]["joined_at"])
        # The token cannot be used again.
        self.assertEqual(APIClient().get(f"{API}invites/{token}").status_code, 410)
        again = APIClient().post(f"{API}invites/{token}/accept", {"password": "employee-pass-1"}, format="json")
        self.assertEqual(again.status_code, 410)
        self.assertEqual(again.data["error"]["code"], "invite_invalid")
        # Eve sees one workspace with her own card only.
        cards = eve.get(f"{API}workspaces/{ws}/cards").data
        self.assertEqual([c["id"] for c in cards], [str(card.id)])
        self.assertEqual(cards[0]["owner"]["email"], "eve@example.com")

    def test_bad_token_is_410(self):
        res = APIClient().get(API + "invites/does-not-exist")
        self.assertEqual(res.status_code, 410)
        self.assertEqual(res.data["error"]["code"], "invite_invalid")

    def test_accept_requires_password_for_new_account(self):
        owner = self.signup()
        ws = self.company(owner)
        member = self.invite(owner, ws, "new@example.com")
        token = Member.objects.get(pk=member["id"]).invite_token
        res = APIClient().post(f"{API}invites/{token}/accept", {}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["error"]["fields"])

    def test_existing_account_must_prove_password(self):
        owner = self.signup()
        ws = self.company(owner)
        other = self.signup("other@example.com", "Other Person")
        member = self.invite(owner, ws, "other@example.com")
        token = Member.objects.get(pk=member["id"]).invite_token
        res = APIClient().post(f"{API}invites/{token}/accept", {"password": "wrong"}, format="json")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "invalid_credentials")
        res = APIClient().post(f"{API}invites/{token}/accept", {"password": self.password}, format="json")
        self.assertEqual(res.status_code, 200)
        names = [w["name"] for w in other.client.get(API + "me/workspaces").data]
        self.assertIn("Acme Ltd", names)

    def test_invite_over_seats_is_plan_limit(self):
        owner = self.signup()
        ws = self.company(owner, seats=5)
        # The owner holds one seat, so four invites fit.
        invites = [{"email": f"p{n}@example.com"} for n in range(4)]
        res = owner.client.post(f"{API}workspaces/{ws}/invites", {"invites": invites}, format="json")
        self.assertEqual(res.status_code, 201)
        res = owner.client.post(f"{API}workspaces/{ws}/invites", {"invites": [{"email": "one-more@example.com"}]}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")
        self.assertEqual(Member.objects.filter(workspace_id=ws).count(), 5)
        sub = owner.client.get(f"{API}workspaces/{ws}/subscription").data
        self.assertEqual((sub["seats_total"], sub["seats_used"]), (5, 5))

    def test_invite_needs_live_subscription_and_company(self):
        owner = self.signup()
        ws = owner.client.post(API + "workspaces", {"name": "NoPlan"}, format="json").data["id"]
        res = owner.client.post(f"{API}workspaces/{ws}/invites", {"invites": [{"email": "a@b.co"}]}, format="json")
        self.assertEqual(res.status_code, 402)
        self.assertEqual(res.data["error"]["code"], "subscription_required")
        self.buy(owner, "personal")
        res = owner.client.post(f"{API}workspaces/{owner.ws}/invites", {"invites": [{"email": "a@b.co"}]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_duplicate_invites_rejected(self):
        owner = self.signup()
        ws = self.company(owner)
        self.invite(owner, ws, "dup@example.com")
        res = owner.client.post(f"{API}workspaces/{ws}/invites", {"invites": [{"email": "dup@example.com"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        res = owner.client.post(
            f"{API}workspaces/{ws}/invites", {"invites": [{"email": "x@example.com"}, {"email": "X@example.com"}]}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_only_owner_can_invite_admins(self):
        owner = self.signup()
        ws = self.company(owner)
        adm = self.join(self.invite(owner, ws, "adm@example.com", role="admin"))
        res = adm.client.post(f"{API}workspaces/{ws}/invites", {"invites": [{"email": "n@example.com", "role": "admin"}]}, format="json")
        self.assertEqual(res.status_code, 403)
        res = adm.client.post(f"{API}workspaces/{ws}/invites", {"invites": [{"email": "n@example.com"}]}, format="json")
        self.assertEqual(res.status_code, 201)


class MemberManagementTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@example.com", "Olivia Owner")
        self.ws = self.company(self.owner)
        self.member = self.invite(self.owner, self.ws, "eve@example.com", full_name="Eve Employee")
        self.eve = self.join(self.member)
        self.card_id = self.member["card_id"]

    def test_removal_suspends_card_and_frees_seat(self):
        self.eve.client.post(f"{API}cards/{self.card_id}/publish")
        before = self.owner.client.get(f"{API}workspaces/{self.ws}/subscription").data["seats_used"]
        res = self.owner.client.delete(f"{API}workspaces/{self.ws}/members/{self.member['id']}")
        self.assertEqual(res.status_code, 204)
        card = Card.objects.get(pk=self.card_id)
        self.assertEqual(card.status, "suspended")
        self.assertIsNone(card.member)
        after = self.owner.client.get(f"{API}workspaces/{self.ws}/subscription").data["seats_used"]
        self.assertEqual(after, before - 1)
        # The former employee has lost access to the workspace and the card.
        self.assertEqual(self.eve.client.get(f"{API}workspaces/{self.ws}/cards").status_code, 404)
        self.assertEqual(self.eve.client.get(f"{API}cards/{self.card_id}").status_code, 404)
        # The public page now shows the suspended state.
        pub = APIClient().get(f"{API}public/cards/{card.public_code}").data
        self.assertEqual(pub["state"], "suspended")
        # The freed seat can be used again.
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/invites", {"invites": [{"email": "new@example.com"}]}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_suspend_and_restore_member(self):
        self.eve.client.post(f"{API}cards/{self.card_id}/publish")
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{self.member['id']}", {"status": "suspended"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "suspended")
        self.assertEqual(Card.objects.get(pk=self.card_id).status, "suspended")
        self.assertEqual(self.eve.client.get(f"{API}workspaces/{self.ws}").status_code, 404)
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{self.member['id']}", {"status": "active"}, format="json")
        self.assertEqual(res.data["status"], "active")
        self.assertEqual(Card.objects.get(pk=self.card_id).status, "published")
        self.assertEqual(self.eve.client.get(f"{API}workspaces/{self.ws}").status_code, 200)

    def test_role_change_rules(self):
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{self.member['id']}", {"role": "admin"}, format="json")
        self.assertEqual(res.data["role"], "admin")
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{self.member['id']}", {"role": "owner"}, format="json")
        self.assertEqual(res.status_code, 400)
        owner_member = Member.objects.get(workspace_id=self.ws, role="owner")
        res = self.eve.client.patch(f"{API}workspaces/{self.ws}/members/{owner_member.id}", {"role": "employee"}, format="json")
        self.assertEqual(res.status_code, 403)
        res = self.owner.client.delete(f"{API}workspaces/{self.ws}/members/{owner_member.id}")
        self.assertEqual(res.status_code, 403)

    def test_employee_cannot_list_or_manage_members(self):
        self.assertEqual(self.eve.client.get(f"{API}workspaces/{self.ws}/members").status_code, 403)
        res = self.eve.client.delete(f"{API}workspaces/{self.ws}/members/{self.member['id']}")
        self.assertEqual(res.status_code, 403)

    def test_employee_sees_and_edits_only_own_card(self):
        mine = self.eve.client.get(f"{API}workspaces/{self.ws}/cards").data
        self.assertEqual(len(mine), 1)
        owner_card = self.make_card(self.owner, ws=self.ws, name="Owner card")
        self.assertEqual(len(self.owner.client.get(f"{API}workspaces/{self.ws}/cards").data), 2)
        self.assertEqual(self.eve.client.get(f"{API}cards/{owner_card['id']}").status_code, 404)
        res = self.eve.client.patch(f"{API}cards/{owner_card['id']}", {"name": "x"}, format="json")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(self.eve.client.delete(f"{API}cards/{self.card_id}").status_code, 403)
        # One card per seat: the employee already has one.
        res = self.eve.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Second"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")

    def test_owner_second_card_is_plan_limit(self):
        self.make_card(self.owner, ws=self.ws, name="Owner card")
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Another"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")


class CsvImportTests(ApiTestCase):
    def upload(self, owner, ws, text):
        file = SimpleUploadedFile("team.csv", text.encode("utf-8"), content_type="text/csv")
        return owner.client.post(f"{API}workspaces/{ws}/members/import", {"file": file}, format="multipart")

    def test_import_creates_members_and_skips_bad_rows_with_reasons(self):
        owner = self.signup("owner@example.com")
        ws = self.company(owner, seats=6)
        csv_text = (
            "email,full_name,title\n"
            "ann@example.com,Ann One,Engineer\n"
            "not-an-email,Bad Row,X\n"
            ",No Email,Y\n"
            "ANN@example.com,Ann Again,Dup\n"
            "owner@example.com,Owner,Boss\n"
            "bob@example.com,Bob Two,Designer\n"
        )
        res = self.upload(owner, ws, csv_text)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["created"], 2)
        skipped = {s["row"]: s["reason"] for s in res.data["skipped"]}
        self.assertEqual(sorted(skipped), [3, 4, 5, 6])
        self.assertIn("Invalid", skipped[3])
        self.assertIn("Missing", skipped[4])
        self.assertIn("Duplicate", skipped[5])
        self.assertIn("Already", skipped[6])
        self.assertEqual(Member.objects.filter(workspace_id=ws, status="invited").count(), 2)
        self.assertEqual(Card.objects.get(member__email="ann@example.com").title, "Engineer")
        self.assertEqual(len(mail.outbox), 2)

    def test_import_stops_when_seats_run_out(self):
        owner = self.signup()
        ws = self.company(owner, seats=5)
        rows = "".join(f"u{n}@example.com,User {n},T\n" for n in range(6))
        res = self.upload(owner, ws, "email,full_name,title\n" + rows)
        self.assertEqual(res.data["created"], 4)
        self.assertEqual(len(res.data["skipped"]), 2)
        self.assertEqual(res.data["skipped"][0]["reason"], "No seats left.")

    def test_import_accepts_bom_and_header_variants_and_rejects_missing_column(self):
        owner = self.signup()
        ws = self.company(owner)
        res = self.upload(owner, ws, "﻿Email , Full_Name ,Title\nzed@example.com,Zed,CTO\n")
        self.assertEqual(res.data["created"], 1)
        res = self.upload(owner, ws, "name,title\nZed,CTO\n")
        self.assertEqual(res.status_code, 400)

    def test_import_needs_a_manager_and_a_live_plan(self):
        owner = self.signup()
        ws = self.company(owner)
        eve = self.join(self.invite(owner, ws, "eve@example.com"))
        self.assertEqual(self.upload(eve, ws, "email\nx@example.com\n").status_code, 403)
        empty_ws = owner.client.post(API + "workspaces", {"name": "NoPlan"}, format="json").data["id"]
        self.assertEqual(self.upload(owner, empty_ws, "email\nx@example.com\n").status_code, 402)
