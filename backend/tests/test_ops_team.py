"""Resend invite, reassigning cards, offboarding, bulk actions and the audit log."""
from datetime import timedelta
from types import SimpleNamespace

from django.core import mail
from django.utils import timezone

from cards.models import Card
from leads.models import Lead
from operations.models import AuditEvent
from workspaces.models import Member

from .base import API, body
from .ops_base import OpsTestCase


class ResendInviteTests(OpsTestCase):
    def resend(self, who, member_id, ws=None):
        return who.client.post(f"{API}workspaces/{ws or self.ws}/members/{member_id}/resend-invite")

    def age_invite(self, member_id, minutes=11):
        Member.objects.filter(pk=member_id).update(invite_sent_at=timezone.now() - timedelta(minutes=minutes))

    def test_owner_resends_with_a_fresh_link_and_expiry(self):
        pending = self.invited("sam@example.com", "Sam Sender")
        self.age_invite(pending.member_id, minutes=60 * 24 * 29)
        mail.outbox.clear()
        res = self.resend(self.owner, pending.member_id)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(mail.outbox), 1)
        member = Member.objects.get(pk=pending.member_id)
        self.assertNotEqual(member.invite_token, pending.token)
        self.assertIn(member.invite_token, mail.outbox[0].body)
        # The new expiry runs from now, and the old link no longer works.
        self.assertLess(timezone.now() - member.invite_sent_at, timedelta(seconds=30))
        self.assertEqual(self.client_for().get(f"{API}invites/{pending.token}").status_code, 410)
        self.assertEqual(self.client_for().get(f"{API}invites/{member.invite_token}").status_code, 200)

    def test_an_invite_about_to_expire_is_extended(self):
        pending = self.invited("late@example.com", "Late Larry")
        Member.objects.filter(pk=pending.member_id).update(invite_sent_at=timezone.now() - timedelta(days=31))
        self.assertEqual(self.client_for().get(f"{API}invites/{pending.token}").status_code, 410)
        self.assertEqual(self.resend(self.owner, pending.member_id).status_code, 200)
        token = Member.objects.get(pk=pending.member_id).invite_token
        self.assertEqual(self.client_for().get(f"{API}invites/{token}").status_code, 200)

    def test_one_resend_per_ten_minutes_per_member(self):
        pending = self.invited("a@example.com", "Ann A")
        other = self.invited("b@example.com", "Bob B")
        # Right after the first invite email a second one is refused.
        res = self.resend(self.owner, pending.member_id)
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data["error"]["code"], "throttled")
        self.assertIn("minute", res.data["error"]["message"])
        self.assertTrue(int(res["Retry-After"]) > 0)
        self.age_invite(pending.member_id)
        self.assertEqual(self.resend(self.owner, pending.member_id).status_code, 200)
        self.assertEqual(self.resend(self.owner, pending.member_id).status_code, 429)
        # Another member has their own allowance.
        self.age_invite(other.member_id)
        self.assertEqual(self.resend(self.owner, other.member_id).status_code, 200)

    def test_member_json_says_when_a_resend_is_possible(self):
        pending = self.invited("a@example.com", "Ann A")
        row = next(m for m in self.owner.client.get(self.url("members")).data if m["id"] == pending.member_id)
        self.assertIsNotNone(row["can_resend_at"])
        self.assertGreater(row["can_resend_at"], row["invite_sent_at"])

    def test_permissions(self):
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        emp = self.add("emp@example.com", "Eve Employee")
        pending = self.invited("p@example.com", "Pat Pending")
        self.age_invite(pending.member_id)
        self.assertEqual(self.resend(emp, pending.member_id).status_code, 403)
        self.assertEqual(self.resend(SimpleNamespace(client=self.client_for()), pending.member_id).status_code, 401)
        outsider = self.signup("out@example.com", "Out Sider")
        self.assertEqual(self.resend(outsider, pending.member_id).status_code, 404)
        self.assertEqual(self.resend(admin, pending.member_id).status_code, 200)

    def test_only_invited_people_can_be_resent(self):
        emp = self.add("emp@example.com", "Eve Employee")
        res = self.resend(self.owner, emp.member_id)
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.resend(self.owner, "00000000-0000-0000-0000-000000000000").status_code, 404)

    def test_resend_is_logged(self):
        pending = self.invited("p@example.com", "Pat Pending")
        self.age_invite(pending.member_id)
        self.resend(self.owner, pending.member_id)
        self.assertIn("invite.resent", self.audit_actions())
        self.assertIn("invite.sent", self.audit_actions())


class ReassignTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.bob = self.add("bob@example.com", "Bob Builder")
        self.cara = self.add("cara@example.com", "Cara Closer")
        self.card = self.bob.client.get(f"{API}cards/{self.bob.card_id}").data
        self.bob.client.patch(f"{API}cards/{self.bob.card_id}", {"slug": "bob-b"}, format="json")
        self.bob.client.post(f"{API}cards/{self.bob.card_id}/publish")

    def reassign(self, card_id, member_id=None, who=None, **extra):
        return (who or self.owner).client.post(f"{API}cards/{card_id}/reassign", {"member_id": member_id, **extra}, format="json")

    def test_reassign_to_a_member_without_a_card(self):
        dan = self.invited("dan@example.com", "Dan New")
        Card.objects.filter(pk=dan.card_id).delete()
        res = self.reassign(self.bob.card_id, dan.member_id)
        self.assertEqual(res.status_code, 200, res.content)
        card = Card.objects.get(pk=self.bob.card_id)
        self.assertEqual(str(card.member_id), dan.member_id)
        # Address, QR and link stay exactly as they were; the card stays live.
        self.assertEqual(res.data["public_code"], self.card["public_code"])
        self.assertEqual(res.data["slug"], "bob-b")
        self.assertEqual(res.data["public_url"], "https://web.test/c/bob-b")
        self.assertEqual(res.data["status"], "published")
        self.assertEqual(self.client_for().get(f"{API}public/cards/bob-b").data["state"], "live")

    def test_new_holder_must_not_already_have_a_card(self):
        res = self.reassign(self.bob.card_id, self.cara.member_id)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "target_has_card")
        self.assertEqual(str(Card.objects.get(pk=self.bob.card_id).member_id), self.bob.member_id)

    def test_unassigned_card_keeps_its_address_and_nobody_edits_it(self):
        res = self.reassign(self.bob.card_id, None)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.data["owner"])
        self.assertEqual(res.data["slug"], "bob-b")
        # Bob lost access, managers still see the card and leads stay reachable.
        self.assertEqual(self.bob.client.get(f"{API}cards/{self.bob.card_id}").status_code, 404)
        self.assertEqual(self.owner.client.get(f"{API}cards/{self.bob.card_id}").status_code, 200)
        self.assertEqual(self.reassign(self.bob.card_id, None).status_code, 400)

    def test_a_person_can_take_an_unassigned_card_after_giving_up_their_own(self):
        self.reassign(self.bob.card_id, None)
        Card.objects.filter(pk=self.cara.card_id).update(member=None)
        res = self.reassign(self.bob.card_id, self.cara.member_id, reset_details=True)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["name"], "Cara Closer")
        self.assertEqual(self.cara.client.get(f"{API}cards/{self.bob.card_id}").status_code, 200)

    def test_suspended_card_is_restored_for_an_active_holder_and_stays_off_for_a_suspended_one(self):
        self.owner.client.delete(f"{API}workspaces/{self.ws}/members/{self.bob.member_id}")
        card = Card.objects.get(pk=self.bob.card_id)
        self.assertEqual(card.status, "suspended")
        self.assertIsNone(card.member_id)
        Card.objects.filter(pk=self.cara.card_id).update(member=None)
        res = self.reassign(self.bob.card_id, self.cara.member_id)
        self.assertEqual(res.data["status"], "published")
        # Reassigning to someone who is suspended keeps the card off until they are restored.
        eli = self.add("eli@example.com", "Eli Elder")
        Card.objects.filter(pk=eli.card_id).update(member=None)
        self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{eli.member_id}", {"status": "suspended"}, format="json")
        res = self.reassign(self.bob.card_id, eli.member_id)
        self.assertEqual(res.data["status"], "suspended")
        self.owner.client.patch(f"{API}workspaces/{self.ws}/members/{eli.member_id}", {"status": "active"}, format="json")
        self.assertEqual(Card.objects.get(pk=self.bob.card_id).status, "published")

    def test_permissions_and_foreign_ids(self):
        self.assertEqual(self.reassign(self.bob.card_id, None, who=self.cara).status_code, 404)
        self.assertEqual(self.reassign(self.bob.card_id, None, who=self.bob).status_code, 403)
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        stranger = self.invite(other, other_ws, "stranger@example.com")
        res = self.reassign(self.bob.card_id, stranger["id"])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.reassign(self.bob.card_id, "not-an-id").status_code, 400)

    def test_reassign_is_logged_with_both_sides(self):
        self.reassign(self.bob.card_id, None)
        event = AuditEvent.objects.get(action="card.reassigned")
        self.assertEqual(event.details["from"]["email"], "bob@example.com")
        self.assertIsNone(event.details["to"])
        self.assertEqual(event.target_id, self.bob.card_id)


class OffboardingTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.bob = self.add("bob@example.com", "Bob Builder")
        self.bob.client.post(f"{API}cards/{self.bob.card_id}/publish")
        card = Card.objects.get(pk=self.bob.card_id)
        self.client_for().post(
            f"{API}public/cards/{card.public_code}/leads", {"consent": True, "name": "Lena Lead", "email": "lena@example.com"}, format="json"
        )

    def remove(self, **body):
        return self.owner.client.delete(self.url(f"members/{self.bob.member_id}"), body, format="json")

    def test_keep_is_the_default_and_suspends_the_card(self):
        self.assertEqual(self.remove().status_code, 204)
        card = Card.objects.get(pk=self.bob.card_id)
        self.assertEqual((card.status, card.member_id), ("suspended", None))
        self.assertFalse(Member.objects.filter(pk=self.bob.member_id).exists())

    def test_reassign_to_a_colleague_without_a_card(self):
        dan = self.invited("dan@example.com", "Dan New")
        Card.objects.filter(pk=dan.card_id).delete()
        self.assertEqual(self.remove(card="reassign", reassign_to=dan.member_id).status_code, 204)
        card = Card.objects.get(pk=self.bob.card_id)
        self.assertEqual(str(card.member_id), dan.member_id)
        self.assertEqual(card.status, "published")

    def test_reassign_to_nobody(self):
        self.assertEqual(self.remove(card="reassign", reassign_to=None).status_code, 204)
        card = Card.objects.get(pk=self.bob.card_id)
        self.assertIsNone(card.member_id)
        self.assertEqual(card.status, "published")

    def test_reassign_refused_when_the_colleague_has_a_card_and_nothing_changes(self):
        cara = self.add("cara@example.com", "Cara Closer")
        res = self.remove(card="reassign", reassign_to=cara.member_id)
        self.assertEqual(res.status_code, 409)
        self.assertTrue(Member.objects.filter(pk=self.bob.member_id).exists())
        self.assertEqual(Card.objects.get(pk=self.bob.card_id).status, "published")

    def test_delete_removes_the_card_but_leads_stay_with_the_company(self):
        self.assertEqual(self.remove(card="delete").status_code, 204)
        self.assertFalse(Card.objects.filter(pk=self.bob.card_id).exists())
        res = self.owner.client.get(self.url("leads"))
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["results"][0]["card_name"], "Bob Builder")
        self.assertIsNone(res.data["results"][0]["card_id"])
        self.assertIn("Lena Lead", body(self.owner.client.get(self.url("leads.csv"))).decode())
        lead = Lead.objects.get()
        self.assertEqual(self.owner.client.patch(f"{API}leads/{lead.id}", {"status": "won"}, format="json").status_code, 200)
        # Employees only ever see leads of their own card.
        cara = self.add("cara@example.com", "Cara Closer")
        self.assertEqual(cara.client.get(self.url("leads")).data["count"], 0)

    def test_bad_policy_is_refused(self):
        self.assertEqual(self.remove(card="burn").status_code, 400)

    def test_removal_is_logged_with_the_policy(self):
        self.remove(card="delete")
        event = AuditEvent.objects.get(action="member.removed")
        self.assertEqual(event.details["card_policy"], "delete")
        self.assertIn("card.deleted", self.audit_actions())


class BulkTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.people = [self.add(f"p{i}@example.com", f"Person {i}") for i in range(4)]
        self.admin = self.add("admin@example.com", "Ada Admin", role="admin")

    def bulk(self, kind, body, who=None):
        return (who or self.owner).client.post(self.url(f"bulk/{kind}"), body, format="json")

    def ids(self, people=None):
        return [p.member_id for p in (people or self.people)]

    def test_publish_and_unpublish_members_with_per_item_results(self):
        res = self.bulk("members", {"action": "publish", "ids": self.ids()})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["total"], res.data["ok"], res.data["failed"]), (4, 4, 0))
        self.assertEqual(Card.objects.filter(status="published").count(), 4)
        res = self.bulk("members", {"action": "publish", "ids": self.ids()})
        self.assertEqual((res.data["ok"], res.data["failed"]), (0, 4))
        self.assertIn("already published", res.data["results"][0]["reason"])
        res = self.bulk("members", {"action": "unpublish", "ids": self.ids()})
        self.assertEqual(res.data["ok"], 4)

    def test_partial_failure_does_not_stop_the_others(self):
        self.owner.client.patch(f"{API}cards/{self.people[1].card_id}", {"name": ""}, format="json")
        res = self.bulk("members", {"action": "publish", "ids": self.ids() + ["00000000-0000-0000-0000-000000000000"]})
        by_id = {r["id"]: r for r in res.data["results"]}
        self.assertFalse(by_id[self.people[1].member_id]["ok"])
        self.assertIn("name", by_id[self.people[1].member_id]["reason"])
        self.assertFalse(by_id["00000000-0000-0000-0000-000000000000"]["ok"])
        self.assertEqual((res.data["ok"], res.data["failed"]), (3, 2))
        self.assertEqual(Card.objects.filter(status="published").count(), 3)

    def test_suspend_restore(self):
        self.bulk("members", {"action": "publish", "ids": self.ids()})
        res = self.bulk("members", {"action": "suspend", "ids": self.ids() + [self.owner_member.id.hex and str(self.owner_member.id)]})
        self.assertEqual((res.data["ok"], res.data["failed"]), (4, 1))
        self.assertIn("owner", res.data["results"][-1]["reason"])
        self.assertEqual(Card.objects.filter(status="suspended").count(), 4)
        res = self.bulk("members", {"action": "restore", "ids": self.ids()})
        self.assertEqual(res.data["ok"], 4)
        self.assertEqual(Card.objects.filter(status="published").count(), 4)

    def test_owner_cannot_be_suspended_and_admins_only_by_the_owner(self):
        res = self.bulk("members", {"action": "suspend", "ids": [self.admin.member_id]}, who=self.admin)
        self.assertEqual(res.data["failed"], 1)
        self.assertIn("Only the owner", res.data["results"][0]["reason"])
        res = self.bulk("members", {"action": "suspend", "ids": [self.admin.member_id]})
        self.assertEqual(res.data["ok"], 1)

    def test_change_role_is_owner_only(self):
        res = self.bulk("members", {"action": "role", "role": "admin", "ids": self.ids()[:2]}, who=self.admin)
        self.assertEqual(res.status_code, 403)
        res = self.bulk("members", {"action": "role", "role": "admin", "ids": self.ids()[:2]})
        self.assertEqual(res.data["ok"], 2)
        self.assertEqual(Member.objects.filter(role="admin").count(), 3)
        res = self.bulk("members", {"action": "role", "role": "owner", "ids": self.ids()[:2]})
        self.assertEqual(res.status_code, 400)

    def test_move_to_department_and_out_again(self):
        sales = self.department("Sales")
        res = self.bulk("members", {"action": "department", "department_id": sales["id"], "ids": self.ids()})
        self.assertEqual(res.data["ok"], 4)
        self.assertEqual(Member.objects.filter(department_id=sales["id"]).count(), 4)
        res = self.bulk("members", {"action": "department", "department_id": sales["id"], "ids": self.ids()})
        self.assertEqual(res.data["failed"], 4)
        res = self.bulk("members", {"action": "department", "department_id": None, "ids": self.ids()})
        self.assertEqual(res.data["ok"], 4)
        self.assertEqual(self.bulk("members", {"action": "department", "department_id": "x", "ids": self.ids()}).status_code, 400)

    def test_remove_with_offboarding_choice(self):
        res = self.bulk("members", {"action": "remove", "card": "delete", "ids": self.ids()[:2]})
        self.assertEqual(res.data["ok"], 2)
        self.assertEqual(Card.objects.count(), 3)
        res = self.bulk("members", {"action": "remove", "ids": self.ids()[2:]})
        self.assertEqual(res.data["ok"], 2)
        self.assertEqual(Card.objects.filter(status="suspended", member__isnull=True).count(), 2)
        res = self.bulk("members", {"action": "remove", "card": "reassign", "reassign_to": self.admin.member_id, "ids": [self.admin.member_id, str(self.owner_member.id)]})
        self.assertEqual(res.status_code, 400)

    def test_card_actions(self):
        cards = [p.card_id for p in self.people]
        res = self.bulk("cards", {"action": "publish", "ids": cards})
        self.assertEqual(res.data["ok"], 4)
        res = self.bulk("cards", {"action": "suspend", "ids": cards[:2]})
        self.assertEqual(res.data["ok"], 2)
        res = self.bulk("cards", {"action": "suspend", "ids": cards[:2]})
        self.assertEqual(res.data["failed"], 2)
        res = self.bulk("cards", {"action": "restore", "ids": cards})
        self.assertEqual((res.data["ok"], res.data["failed"]), (2, 2))
        res = self.bulk("cards", {"action": "delete", "ids": cards[:1]})
        self.assertEqual(res.data["ok"], 1)
        self.assertEqual(Card.objects.count(), 4)

    def test_cards_of_another_company_are_refused_per_item(self):
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        theirs = self.invite(other, other_ws, "t@example.com")
        res = self.bulk("cards", {"action": "delete", "ids": [theirs["card_id"]]})
        self.assertEqual(res.data["failed"], 1)
        self.assertEqual(res.data["results"][0]["code"], "not_found")
        self.assertTrue(Card.objects.filter(pk=theirs["card_id"]).exists())

    def test_limits_and_validation(self):
        ids = [f"00000000-0000-0000-0000-{i:012d}" for i in range(201)]
        self.assertEqual(self.bulk("members", {"action": "suspend", "ids": ids}).status_code, 400)
        ids200 = ids[:200]
        res = self.bulk("members", {"action": "suspend", "ids": ids200})
        self.assertEqual((res.status_code, res.data["total"], res.data["failed"]), (200, 200, 200))
        self.assertEqual(self.bulk("members", {"action": "suspend", "ids": []}).status_code, 400)
        self.assertEqual(self.bulk("members", {"action": "explode", "ids": ids[:1]}).status_code, 400)
        self.assertEqual(self.bulk("members", {"action": "suspend", "ids": ["nope"]}).status_code, 400)
        self.assertEqual(self.bulk("cards", {"action": "role", "ids": ids[:1]}).status_code, 400)

    def test_employees_and_strangers_cannot_run_bulk_actions(self):
        self.assertEqual(self.bulk("members", {"action": "suspend", "ids": self.ids()[1:]}, who=self.people[0]).status_code, 403)
        self.assertEqual(self.bulk("cards", {"action": "publish", "ids": [self.people[1].card_id]}, who=self.people[0]).status_code, 403)
        outsider = self.signup("out@example.com", "Out Sider")
        self.assertEqual(self.bulk("members", {"action": "suspend", "ids": self.ids()}, who=outsider).status_code, 404)
        self.assertEqual(self.bulk("members", {"action": "suspend", "ids": self.ids()}, who=SimpleNamespace(client=self.client_for())).status_code, 401)

    def test_bulk_writes_one_event_per_item_and_a_summary(self):
        self.bulk("members", {"action": "publish", "ids": self.ids()})
        actions = self.audit_actions()
        self.assertEqual(actions.count("card.published"), 4)
        self.assertEqual(actions.count("bulk.run"), 1)
        summary = AuditEvent.objects.get(action="bulk.run")
        self.assertEqual((summary.details["ok"], summary.details["total"]), (4, 4))
        item = AuditEvent.objects.filter(action="card.published").first()
        self.assertEqual(item.details["bulk_id"], summary.target_id)


class AuditLogTests(OpsTestCase):
    def test_only_owner_and_admin_can_read_it(self):
        emp = self.add("emp@example.com", "Eve Employee")
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        self.assertEqual(emp.client.get(self.url("audit")).status_code, 403)
        self.assertEqual(emp.client.get(self.url("audit.csv")).status_code, 403)
        self.assertEqual(self.client_for().get(self.url("audit")).status_code, 401)
        self.assertEqual(self.signup("o@example.com", "O").client.get(self.url("audit")).status_code, 404)
        self.assertEqual(admin.client.get(self.url("audit")).status_code, 200)
        self.assertEqual(admin.client.get(self.url("audit.csv")).status_code, 200)

    def test_personal_workspaces_have_no_log(self):
        person = self.signup("solo@example.com", "Solo")
        self.assertEqual(person.client.get(f"{API}workspaces/{person.ws}/audit").status_code, 400)
        self.assertEqual(AuditEvent.objects.filter(workspace_id=person.ws).count(), 0)

    def test_every_admin_action_is_written(self):
        bob = self.add("bob@example.com", "Bob Builder")
        cara = self.add("cara@example.com", "Cara Closer")
        pending = self.invited("pat@example.com", "Pat Pending")
        Member.objects.filter(pk=pending.member_id).update(invite_sent_at=timezone.now() - timedelta(hours=1))
        c = self.owner.client
        c.post(f"{API}workspaces/{self.ws}/members/{pending.member_id}/resend-invite")
        c.patch(self.url(f"members/{bob.member_id}"), {"role": "admin"}, format="json")
        c.patch(self.url(f"members/{bob.member_id}"), {"role": "employee"}, format="json")
        c.patch(self.url(f"members/{cara.member_id}"), {"status": "suspended"}, format="json")
        c.patch(self.url(f"members/{cara.member_id}"), {"status": "active"}, format="json")
        c.post(f"{API}cards/{bob.card_id}/publish")
        c.post(f"{API}cards/{bob.card_id}/unpublish")
        c.post(f"{API}cards/{bob.card_id}/suspend")
        c.post(f"{API}cards/{bob.card_id}/restore")
        c.patch(f"{API}workspaces/{self.ws}", {"brand": {"website": "https://acme.example", "design": {"face": 5}, "lock_design": True}}, format="json")
        c.patch(f"{API}workspaces/{self.ws}", {"name": "Acme Group"}, format="json")
        dept = self.department("Sales")
        c.patch(self.url(f"departments/{dept['id']}"), {"name": "Sales team"}, format="json")
        c.patch(self.url(f"members/{bob.member_id}"), {"department_id": dept["id"]}, format="json")
        c.patch(self.url("field-rules"), {"title": "locked"}, format="json")
        c.post(f"{API}cards/{bob.card_id}/reassign", {"member_id": None}, format="json")
        c.delete(self.url(f"departments/{dept['id']}"))
        c.post(self.url("bulk/members"), {"action": "unpublish", "ids": [cara.member_id]}, format="json")
        c.delete(self.url(f"members/{cara.member_id}"))
        c.delete(f"{API}cards/{bob.card_id}")
        c.post(self.url("logo"), {"file": __import__("tests.base", fromlist=["png_upload"]).png_upload((200, 200))}, format="multipart")
        c.patch(f"{API}workspaces/{self.ws}", {"brand": {"directory_slug": "acme-people", "directory_enabled": True}}, format="json")
        got = set(self.audit_actions())
        expected = {
            "invite.sent", "invite.resent", "member.role_changed", "member.suspended", "member.restored",
            "member.removed", "member.department_changed", "card.published", "card.unpublished", "card.suspended",
            "card.restored", "card.deleted", "card.reassigned", "brand.updated", "brand.design_changed",
            "brand.lock_changed", "brand.logo_changed", "department.created", "department.updated",
            "department.deleted", "fields.rules_changed", "directory.updated", "bulk.run",
        }
        self.assertEqual(expected - got, set(), f"missing {expected - got}")

    def test_entries_carry_who_what_and_target(self):
        bob = self.add("bob@example.com", "Bob Builder")
        self.owner.client.post(f"{API}cards/{bob.card_id}/publish")
        event = self.audit(action="card.published")["results"][0]
        self.assertEqual(event["actor"]["email"], "owner@example.com")
        self.assertEqual(event["target_type"], "card")
        self.assertEqual(event["target_id"], bob.card_id)
        self.assertEqual(event["target_label"], "Bob Builder")
        self.assertEqual(event["label"], "Published a card")
        row = AuditEvent.objects.get(action="card.published")
        self.assertEqual(len(row.ip_hash), 32)
        self.assertNotIn("127.0.0.1", row.ip_hash)

    def test_filters_by_actor_action_prefix_dates_and_pages(self):
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        bob = self.add("bob@example.com", "Bob Builder")
        self.owner.client.post(f"{API}cards/{bob.card_id}/publish")
        admin.client.post(f"{API}cards/{bob.card_id}/unpublish")
        admin_id = admin.client.get(f"{API}auth/me").data["id"]
        self.assertEqual({e["action"] for e in self.audit(actor=admin_id)["results"]}, {"card.unpublished"})
        self.assertEqual(self.audit(action="card.published")["count"], 1)
        self.assertGreaterEqual(self.audit(action="card.")["count"], 2)
        self.assertEqual(self.audit(action="invite.")["count"], 2)
        today = timezone.now().strftime("%Y-%m-%d")
        self.assertGreaterEqual(self.audit(**{"from": today, "to": today})["count"], 4)
        self.assertEqual(self.audit(**{"to": "2001-01-01"})["count"], 0)
        self.assertEqual(self.owner.client.get(self.url("audit"), {"from": "yesterday"}).status_code, 400)
        self.assertEqual(self.owner.client.get(self.url("audit"), {"actor": "nope"}).status_code, 400)
        page = self.audit(page_size=2)
        total = self.audit()["count"]
        self.assertEqual((len(page["results"]), page["pages"]), (2, -(-total // 2)))
        self.assertEqual(len(self.audit(page_size=2, page=2)["results"]), 2)
        self.assertEqual(self.audit(q="bob")["count"] >= 2, True)
        self.assertTrue(any(a["email"] == "owner@example.com" for a in self.audit()["actors"]))

    def test_csv_export_with_the_same_filters_and_formula_protection(self):
        bob = self.add("bob@example.com", "=HYPERLINK(1)")
        self.owner.client.post(f"{API}cards/{bob.card_id}/publish")
        res = self.owner.client.get(self.url("audit.csv"), {"action": "card.published"})
        self.assertEqual(res["Content-Type"], "text/csv; charset=utf-8")
        text = res.content.decode()
        self.assertIn("time,who,email,action", text)
        self.assertIn("card.published", text)
        self.assertNotIn("invite.sent", text)
        self.assertIn("'=HYPERLINK(1)", text)

    def test_the_log_cannot_be_changed_or_deleted(self):
        self.add("bob@example.com", "Bob Builder")
        event = AuditEvent.objects.first()
        event.action = "x"
        with self.assertRaises(RuntimeError):
            event.save()
        with self.assertRaises(RuntimeError):
            event.delete()
        self.assertEqual(self.owner.client.delete(self.url("audit")).status_code, 405)
        self.assertEqual(self.owner.client.patch(self.url("audit"), {}, format="json").status_code, 405)

    def test_each_company_only_sees_its_own_log(self):
        self.add("bob@example.com", "Bob Builder")
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        mine = self.audit()["count"]
        theirs = other.client.get(f"{API}workspaces/{other_ws}/audit").data["count"]
        self.assertGreater(mine, 0)
        self.assertEqual(theirs, 0)
        self.assertEqual(other.client.get(self.url("audit")).status_code, 404)
