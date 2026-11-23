"""Field rules, mandatory buttons, banned links, and the approval flow."""
from django.core import mail

from cards.models import Card
from operations.models import ChangeRequest

from .base import API, png_upload
from .ops_base import OpsTestCase


class FieldRulesApiTests(OpsTestCase):
    def test_defaults_everything_free(self):
        rules = self.owner.client.get(self.url("field-rules")).data
        for key in ("name", "title", "photo", "company", "address", "button_add", "button_edit", "button_remove"):
            self.assertEqual(rules[key], "free")
        self.assertEqual((rules["allowed_kinds"], rules["banned_domains"], rules["mandatory_buttons"]), (None, [], []))

    def test_patch_merges_and_normalises(self):
        res = self.owner.client.patch(self.url("field-rules"), {
            "title": "approval", "name": "locked", "banned_domains": ["https://www.Bad.com/page", "evil.org", "bad.com"],
            "allowed_kinds": ["Website", "Mobile"],
            "mandatory_buttons": [{"kind": "Website", "value": "acme.example", "label": "Our site"}],
        }, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["title"], res.data["name"], res.data["photo"]), ("approval", "locked", "free"))
        self.assertEqual(res.data["banned_domains"], ["bad.com", "evil.org"])
        self.assertEqual(res.data["mandatory_buttons"][0]["value"], "acme.example")
        again = self.owner.client.patch(self.url("field-rules"), {"address": "locked"}, format="json").data
        self.assertEqual(again["title"], "approval")  # untouched keys stay

    def test_validation(self):
        patch = lambda body: self.owner.client.patch(self.url("field-rules"), body, format="json")
        self.assertEqual(patch({"name": "maybe"}).status_code, 400)
        self.assertEqual(patch({"nonsense": "free"}).status_code, 400)
        self.assertEqual(patch({"allowed_kinds": ["Fax"]}).status_code, 400)
        self.assertEqual(patch({"allowed_kinds": "Website"}).status_code, 400)
        self.assertEqual(patch({"banned_domains": ["not a domain"]}).status_code, 400)
        self.assertEqual(patch({"banned_domains": "x.com"}).status_code, 400)
        self.assertEqual(patch({"mandatory_buttons": [{"kind": "Website", "value": "javascript:alert(1)"}]}).status_code, 400)
        self.assertEqual(patch({"mandatory_buttons": [{"kind": "Website"}]}).status_code, 400)
        self.assertEqual(patch({"mandatory_buttons": "x"}).status_code, 400)
        self.assertEqual(patch({"mandatory_buttons": [{"kind": "Website", "value": "acme.example"}] * 11}).status_code, 400)
        # A mandatory button must itself be allowed.
        patch({"allowed_kinds": ["Mobile"]})
        res = patch({"mandatory_buttons": [{"kind": "Website", "value": "acme.example"}]})
        self.assertEqual(res.status_code, 400)
        patch({"allowed_kinds": None, "banned_domains": ["acme.example"]})
        self.assertEqual(patch({"mandatory_buttons": [{"kind": "Website", "value": "https://shop.acme.example"}]}).status_code, 400)

    def test_permissions(self):
        emp = self.add("emp@example.com", "Eve Employee")
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        self.assertEqual(emp.client.get(self.url("field-rules")).status_code, 403)
        self.assertEqual(emp.client.patch(self.url("field-rules"), {"name": "locked"}, format="json").status_code, 403)
        self.assertEqual(self.client_for().get(self.url("field-rules")).status_code, 401)
        self.assertEqual(admin.client.patch(self.url("field-rules"), {"name": "locked"}, format="json").status_code, 200)
        self.assertEqual(self.signup("o@example.com", "O").client.get(self.url("field-rules")).status_code, 404)

    def test_a_personal_workspace_has_no_rules(self):
        person = self.signup("solo@example.com", "Solo")
        self.assertEqual(person.client.get(f"{API}workspaces/{person.ws}/field-rules").status_code, 400)


class EnforcementTests(OpsTestCase):
    """What an employee can and cannot write once the owner has set rules."""

    def setUp(self):
        super().setUp()
        self.bob = self.add("bob@example.com", "Bob Builder")
        self.card_url = f"{API}cards/{self.bob.card_id}"
        self.bob.client.patch(self.card_url, {"title": "Rep", "company": "Acme", "address": "Doha"}, format="json")

    def rules(self, **body):
        res = self.owner.client.patch(self.url("field-rules"), body, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def patch(self, body, who=None):
        return (who or self.bob).client.patch(self.card_url, body, format="json")

    def card(self):
        return Card.objects.get(pk=self.bob.card_id)

    # ---- plain fields
    def test_free_fields_save_as_before(self):
        res = self.patch({"title": "Senior Rep"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["title"], "Senior Rep")
        self.assertEqual(res.data["submitted_for_approval"], [])

    def test_locked_field_refuses_the_change_with_a_plain_reason(self):
        self.rules(name="locked", title="locked", company="locked", address="locked")
        for field in ("name", "title", "company", "address"):
            res = self.patch({field: "Changed"})
            self.assertEqual(res.status_code, 403, field)
            self.assertEqual(res.data["error"]["code"], "field_locked")
            self.assertIn(field, res.data["error"]["fields"])
            self.assertIn("company has set", res.data["error"]["message"])
        self.assertEqual(self.card().name, "Bob Builder")

    def test_writing_the_same_value_to_a_locked_field_is_not_a_change(self):
        self.rules(title="locked")
        res = self.patch({"title": "Rep", "address": "Abu Dhabi"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["address"], "Abu Dhabi")

    def test_owner_and_admin_bypass_every_rule(self):
        admin = self.add("admin@example.com", "Ada Admin", role="admin")
        self.rules(name="locked", title="approval", allowed_kinds=["Website"], banned_domains=["bad.com"])
        for who in (self.owner, admin):
            res = self.patch({"name": "Owner Edit", "title": "Boss", "items": [{"kind": "Mobile", "value": "+97455550000"}, {"kind": "Website", "value": "bad.com"}]}, who=who)
            self.assertEqual(res.status_code, 200, res.content)
            self.assertEqual(res.data["title"], "Boss")
        self.assertEqual(ChangeRequest.objects.count(), 0)

    def test_creating_the_first_card_is_not_held_up(self):
        self.rules(name="locked")
        dan = self.invited("dan@example.com", "Dan New")
        Card.objects.filter(pk=dan.card_id).delete()
        from workspaces.models import Member

        joined = self.join({"id": dan.member_id, "email": dan.email}, full_name="Dan New")
        res = joined.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Dan D"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertTrue(Member.objects.filter(pk=dan.member_id).exists())

    # ---- approval
    def test_approval_field_keeps_the_old_value_and_records_a_request(self):
        self.rules(title="approval")
        mail.outbox.clear()
        res = self.patch({"title": "Head of Sales", "address": "Lusail"})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["title"], "Rep")  # unchanged until approved
        self.assertEqual(res.data["address"], "Lusail")  # free fields in the same write are saved
        self.assertEqual(res.data["submitted_for_approval"], ["title"])
        self.assertEqual([c["field"] for c in res.data["pending_changes"]], ["title"])
        change = ChangeRequest.objects.get()
        self.assertEqual((change.field, change.old_value, change.new_value, change.status), ("title", "Rep", "Head of Sales", "pending"))
        self.assertEqual(change.requested_by.email, "bob@example.com")
        self.assertEqual(self.client_for().get(f"{API}public/cards/{self.card().public_code}").status_code, 404)  # draft, still hidden
        # Admins are told by email.
        self.assertEqual([m.to for m in mail.outbox], [["owner@example.com"]])
        self.assertIn("Bob Builder", mail.outbox[0].body)
        self.assertIn("approval", mail.outbox[0].subject.lower() + mail.outbox[0].body.lower())

    def test_a_new_request_replaces_the_waiting_one_for_the_same_field(self):
        self.rules(title="approval")
        self.patch({"title": "First"})
        self.patch({"title": "Second"})
        self.assertEqual(ChangeRequest.objects.filter(status="pending").count(), 1)
        self.assertEqual(ChangeRequest.objects.get(status="pending").new_value, "Second")
        self.assertEqual(ChangeRequest.objects.filter(status="superseded").count(), 1)

    def list_pending(self):
        return self.owner.client.get(self.url("change-requests")).data

    def test_admin_approves_and_the_card_changes_and_the_employee_is_told(self):
        self.rules(title="approval")
        self.patch({"title": "Head of Sales"})
        change = self.list_pending()["results"][0]
        self.assertEqual((change["field"], change["old"], change["new"], change["card_name"]), ("title", "Rep", "Head of Sales", "Bob Builder"))
        self.assertEqual(change["requested_by"]["email"], "bob@example.com")
        mail.outbox.clear()
        res = self.owner.client.post(self.url(f"change-requests/{change['id']}/approve"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["status"], "approved")
        self.assertEqual(self.card().title, "Head of Sales")
        self.assertEqual([m.to for m in mail.outbox], [["bob@example.com"]])
        self.assertIn("approved", mail.outbox[0].body)
        self.assertEqual(self.list_pending()["pending_count"], 0)
        self.assertEqual(self.owner.client.get(self.url("change-requests"), {"status": "approved"}).data["count"], 1)

    def test_admin_rejects_with_a_reason_and_the_card_stays(self):
        self.rules(title="approval")
        self.patch({"title": "Head of Sales"})
        change = self.list_pending()["results"][0]
        mail.outbox.clear()
        res = self.owner.client.post(self.url(f"change-requests/{change['id']}/reject"), {"reason": "Use the official title"}, format="json")
        self.assertEqual((res.data["status"], res.data["reason"]), ("rejected", "Use the official title"))
        self.assertEqual(self.card().title, "Rep")
        self.assertIn("Use the official title", mail.outbox[0].body)
        self.assertEqual(mail.outbox[0].to, ["bob@example.com"])

    def test_a_decided_request_cannot_be_decided_again(self):
        self.rules(title="approval")
        self.patch({"title": "X"})
        cid = self.list_pending()["results"][0]["id"]
        self.assertEqual(self.owner.client.post(self.url(f"change-requests/{cid}/approve")).status_code, 200)
        for verb in ("approve", "reject"):
            res = self.owner.client.post(self.url(f"change-requests/{cid}/{verb}"))
            self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "not_pending"))

    def test_bulk_decision_with_partial_failure(self):
        self.rules(title="approval", company="approval")
        self.patch({"title": "New title", "company": "New Co"})
        ids = [c["id"] for c in self.list_pending()["results"]]
        self.assertEqual(len(ids), 2)
        self.owner.client.post(self.url(f"change-requests/{ids[0]}/reject"))
        res = self.owner.client.post(self.url("change-requests/bulk"), {"action": "approve", "ids": ids + ["00000000-0000-0000-0000-000000000000"]}, format="json")
        self.assertEqual((res.data["ok"], res.data["failed"]), (1, 2))
        codes = sorted(r["code"] for r in res.data["results"] if not r["ok"])
        self.assertEqual(codes, ["not_found", "not_pending"])
        self.assertEqual(self.owner.client.post(self.url("change-requests/bulk"), {"action": "x", "ids": ids}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.post(self.url("change-requests/bulk"), {"action": "approve", "ids": []}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.post(self.url("change-requests/bulk"), {"action": "approve", "ids": ["0"] * 201}, format="json").status_code, 400)

    def test_only_managers_decide_and_only_their_own_company(self):
        self.rules(title="approval")
        self.patch({"title": "X"})
        cid = self.list_pending()["results"][0]["id"]
        cara = self.add("cara@example.com", "Cara Closer")
        for verb in ("approve", "reject"):
            self.assertEqual(self.bob.client.post(self.url(f"change-requests/{cid}/{verb}")).status_code, 403)
            self.assertEqual(cara.client.post(self.url(f"change-requests/{cid}/{verb}")).status_code, 403)
        self.assertEqual(self.bob.client.get(self.url("change-requests")).status_code, 403)
        self.assertEqual(self.bob.client.post(self.url("change-requests/bulk"), {"action": "approve", "ids": [cid]}, format="json").status_code, 403)
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        self.assertEqual(other.client.post(f"{API}workspaces/{other_ws}/change-requests/{cid}/approve").status_code, 404)
        self.assertEqual(ChangeRequest.objects.get().status, "pending")

    def test_the_employee_can_take_a_waiting_request_back(self):
        self.rules(title="approval")
        self.patch({"title": "X"})
        cid = self.list_pending()["results"][0]["id"]
        cara = self.add("cara@example.com", "Cara Closer")
        self.assertEqual(cara.client.post(f"{API}change-requests/{cid}/withdraw").status_code, 404)
        self.assertEqual(self.bob.client.post(f"{API}change-requests/{cid}/withdraw").status_code, 200)
        self.assertEqual(ChangeRequest.objects.get().status, "withdrawn")
        self.assertEqual(self.bob.client.post(f"{API}change-requests/{cid}/withdraw").status_code, 409)
        self.assertEqual(self.bob.client.get(self.card_url).data["pending_changes"], [])

    def test_decisions_are_logged(self):
        self.rules(title="approval")
        self.patch({"title": "X"})
        cid = self.list_pending()["results"][0]["id"]
        self.owner.client.post(self.url(f"change-requests/{cid}/approve"))
        actions = self.audit_actions()
        for key in ("change.requested", "change.approved", "fields.rules_changed"):
            self.assertIn(key, actions)

    # ---- the card tells the editor what is allowed
    def test_card_payload_lists_field_access_for_employees_only(self):
        self.rules(name="locked", title="approval", button_remove="locked", allowed_kinds=["Website", "Mobile"], banned_domains=["bad.com"])
        mine = self.bob.client.get(self.card_url).data
        self.assertEqual((mine["field_access"]["name"], mine["field_access"]["title"], mine["field_access"]["company"]), ("locked", "approval", "free"))
        self.assertEqual(mine["field_access"]["buttons"], {"add": "free", "edit": "free", "remove": "locked"})
        self.assertEqual(mine["field_access"]["allowed_kinds"], ["Mobile", "Website"])
        manager = self.owner.client.get(self.card_url).data["field_access"]
        self.assertEqual((manager["name"], manager["buttons"]["remove"], manager["allowed_kinds"]), ("free", "free", None))

    # ---- buttons
    def items(self, *extra):
        existing = self.bob.client.get(self.card_url).data["items"]
        return existing, [*existing, *extra]

    def test_button_add_locked_approval_and_free(self):
        new = {"kind": "Mobile", "value": "+97455550000"}
        self.rules(button_add="locked")
        _, body = self.items(new)
        res = self.patch({"items": body})
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "field_locked"))
        self.rules(button_add="approval")
        res = self.patch({"items": body})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["submitted_for_approval"], ["buttons"])
        self.assertEqual(len(res.data["items"]), 0 if not self.card().items.exists() else self.card().items.count())
        self.assertEqual(self.card().items.filter(kind="Mobile").count(), 0)
        cid = self.list_pending()["results"][0]["id"]
        self.assertEqual(self.owner.client.post(self.url(f"change-requests/{cid}/approve")).status_code, 200)
        self.assertEqual(self.card().items.filter(kind="Mobile", value="+97455550000").count(), 1)
        self.rules(button_add="free")
        _, body = self.items({"kind": "Email", "value": "bob@acme.example"})
        self.assertEqual(self.patch({"items": body}).status_code, 200)
        self.assertEqual(self.card().items.filter(kind="Email").count(), 1)

    def test_button_edit_and_remove_rules(self):
        self.patch({"items": [{"kind": "Mobile", "value": "+97455550000"}, {"kind": "Email", "value": "bob@acme.example"}]})
        existing = self.bob.client.get(self.card_url).data["items"]
        edited = [dict(existing[0], value="+97455551111"), existing[1]]
        removed = [existing[0]]
        self.rules(button_edit="locked")
        self.assertEqual(self.patch({"items": edited}).status_code, 403)
        self.assertEqual(self.patch({"items": removed}).status_code, 200)  # remove is still free
        self.rules(button_edit="free", button_remove="locked")
        existing = self.bob.client.get(self.card_url).data["items"]
        self.assertEqual(existing[0]["kind"], "Mobile")
        res = self.patch({"items": []})
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "field_locked"))
        # Switching a button off counts as removing it.
        res = self.patch({"items": [dict(existing[0], on=False)]})
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.patch({"items": [dict(existing[0], value="+97455552222")]}).status_code, 200)

    def test_empty_or_switched_off_buttons_are_not_changes(self):
        self.rules(button_add="locked", button_edit="locked", button_remove="locked")
        existing = self.bob.client.get(self.card_url).data["items"]
        res = self.patch({"items": [*existing, {"kind": "Mobile", "value": "", "on": True}, {"kind": "Email", "value": "x@y.example", "on": False}]})
        self.assertEqual(res.status_code, 200, res.content)

    def test_allowed_kinds(self):
        self.rules(allowed_kinds=["Website", "Mobile"])
        res = self.patch({"items": [{"kind": "Instagram", "value": "bob"}]})
        self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "validation_error"))
        self.assertIn("Instagram", res.data["error"]["message"])
        self.assertEqual(self.patch({"items": [{"kind": "Mobile", "value": "+97455550000"}]}).status_code, 200)

    def test_banned_domains_including_subdomains_custom_links_and_email(self):
        self.rules(banned_domains=["bad.com"])
        for item in (
            {"kind": "Website", "value": "https://bad.com/x"}, {"kind": "Website", "value": "www.bad.com"},
            {"kind": "Custom", "value": "https://shop.bad.com", "label": "Shop"}, {"kind": "Email", "value": "bob@bad.com"},
            {"kind": "Website", "value": "HTTPS://BAD.COM"},
        ):
            res = self.patch({"items": [item]})
            self.assertEqual(res.status_code, 400, item)
            self.assertIn("bad.com", res.data["error"]["message"])
        self.assertEqual(self.patch({"items": [{"kind": "Website", "value": "https://notbad.com"}]}).status_code, 200)
        self.assertEqual(self.patch({"items": [{"kind": "Website", "value": "https://good.org/bad.com"}]}).status_code, 200)

    # ---- mandatory buttons
    MUST = {"kind": "Website", "value": "https://acme.example", "label": "Acme"}

    def test_mandatory_button_cannot_be_removed_switched_off_or_changed(self):
        self.rules(mandatory_buttons=[self.MUST])
        # The card does not have it yet: a write that does not mention it gets it added.
        res = self.patch({"items": [{"kind": "Mobile", "value": "+97455550000"}]})
        self.assertEqual(res.status_code, 200, res.content)
        values = [(i["kind"], i["value"]) for i in res.data["items"]]
        self.assertIn(("Website", "https://acme.example"), values)
        existing = res.data["items"]
        must = next(i for i in existing if i["kind"] == "Website")
        others = [i for i in existing if i["kind"] != "Website"]
        for attempt in (others, [*others, dict(must, on=False)], [*others, dict(must, value="https://other.example")], []):
            res = self.patch({"items": attempt})
            self.assertEqual(res.status_code, 403, attempt)
            self.assertEqual(res.data["error"]["code"], "field_locked")
            self.assertIn("required by your company", res.data["error"]["message"])
        # Changing the other buttons is fine.
        self.assertEqual(self.patch({"items": [*others, must, {"kind": "Email", "value": "bob@acme.example"}]}).status_code, 200)
        # Owners may still change it.
        self.assertEqual(self.patch({"items": others}, who=self.owner).status_code, 200)

    def test_mandatory_buttons_also_apply_through_the_approval_path(self):
        self.rules(mandatory_buttons=[self.MUST], button_add="approval")
        self.patch({"items": [{"kind": "Mobile", "value": "+97455550000"}]})
        change = ChangeRequest.objects.get(field="buttons")
        self.assertIn("https://acme.example", [i["value"] for i in change.new_value])

    def test_department_mandatory_buttons_apply_to_that_department_only(self):
        sales = self.department("Sales", mandatory_items=[{"kind": "Mobile", "value": "+97440001111", "label": "Desk"}])
        self.owner.client.patch(self.url(f"members/{self.bob.member_id}"), {"department_id": sales["id"]}, format="json")
        res = self.patch({"items": [{"kind": "Email", "value": "bob@acme.example"}]})
        self.assertIn(("Mobile", "+97440001111"), [(i["kind"], i["value"]) for i in res.data["items"]])
        cara = self.add("cara@example.com", "Cara Closer")
        res = cara.client.patch(f"{API}cards/{cara.card_id}", {"items": [{"kind": "Email", "value": "cara@acme.example"}]}, format="json")
        self.assertNotIn("Mobile", [i["kind"] for i in res.data["items"]])
        self.assertEqual(cara.client.get(f"{API}cards/{cara.card_id}").data["field_access"]["mandatory_buttons"], [])
        self.assertEqual(len(self.bob.client.get(self.card_url).data["field_access"]["mandatory_buttons"]), 1)

    # ---- photo
    def test_photo_locked_and_approval(self):
        self.rules(photo="locked")
        res = self.bob.client.post(f"{self.card_url}/photo", {"file": png_upload((400, 400))}, format="multipart")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "field_locked"))
        self.rules(photo="approval")
        res = self.bob.client.post(f"{self.card_url}/photo", {"file": png_upload((400, 400))}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["pending"])
        self.assertIsNone(res.data["photo_url"])
        self.assertFalse(self.card().photo)
        change = self.list_pending()["results"][0]
        self.assertEqual(change["field"], "photo")
        self.assertTrue(change["new"]["url"])
        self.assertEqual(self.owner.client.post(self.url(f"change-requests/{change['id']}/approve")).status_code, 200)
        self.assertTrue(self.card().photo)
        # A rejected photo leaves the card alone.
        self.bob.client.post(f"{self.card_url}/photo", {"file": png_upload((300, 300))}, format="multipart")
        before = self.card().photo.name
        cid = self.list_pending()["results"][0]["id"]
        self.owner.client.post(self.url(f"change-requests/{cid}/reject"))
        self.assertEqual(self.card().photo.name, before)
        self.rules(photo="free")
        res = self.bob.client.post(f"{self.card_url}/photo", {"file": png_upload((300, 300))}, format="multipart")
        self.assertNotIn("pending", res.data)
        self.assertTrue(res.data["photo_url"])
        # Managers are never held back.
        self.rules(photo="locked")
        self.assertEqual(self.owner.client.post(f"{self.card_url}/photo", {"file": png_upload((300, 300))}, format="multipart").status_code, 200)


class RulesDoNotLeakTests(OpsTestCase):
    def test_personal_cards_ignore_rules_entirely(self):
        person = self.signup("solo@example.com", "Solo")
        self.buy(person)
        card = self.make_card(person)
        res = person.client.patch(f"{API}cards/{card['id']}", {"name": "New Name"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["field_access"]["name"], "free")

    def test_rules_of_one_company_do_not_apply_to_another(self):
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Co")
        member = self.invite(other, other_ws, "w@example.com", full_name="Wes W")
        worker = self.join(member, full_name="Wes W")
        self.owner.client.patch(self.url("field-rules"), {"name": "locked"}, format="json")
        res = worker.client.patch(f"{API}cards/{member['card_id']}", {"name": "Wesley"}, format="json")
        self.assertEqual(res.status_code, 200)
