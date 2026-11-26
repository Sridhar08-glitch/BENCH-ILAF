"""Lead assignment, statuses, notes, timeline, filters, bulk actions and the spreadsheet export."""
from django.core import mail
from rest_framework.test import APIClient

from leads.models import Lead, WebhookDelivery

from .base import API, body
from .ops_base import OpsTestCase


class LeadWorkflowCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.eve = self.add("eve@example.com", "Eve Employee")
        self.sam = self.add("sam@example.com", "Sam Seller")
        self.admin = self.add("ada@example.com", "Ada Admin", role="admin")
        for person in (self.eve, self.sam):
            res = self.owner.client.post(f"{API}cards/{person.card_id}/publish")
            self.assertEqual(res.status_code, 200, res.content)
            person.code = res.data["public_code"]
        self.eve_member = self.eve.member_id
        # The company's own card: its contacts belong to the company, so owners and admins work them. An employee's contacts are the
        # employee's own and are never shown to an admin.
        co = self.owner.client.post(f"{API}workspaces/{self.ws}/company-card")
        self.assertEqual(co.status_code, 201, co.content)
        published = self.owner.client.post(f"{API}cards/{co.data['id']}/publish")
        self.assertEqual(published.status_code, 200, published.content)
        self.co = type("Co", (), {"code": published.data["public_code"], "card_id": co.data["id"]})()

    def lead_for(self, person, name="Visitor One", **extra):
        body = {"name": name, "email": f"{name.split()[0].lower()}@example.com", "consent": True, **extra}
        res = APIClient().post(f"{API}public/cards/{person.code}/leads", body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return Lead.objects.filter(name=name).latest("created_at")

    def patch(self, client, lead, body):
        return client.patch(f"{API}leads/{lead.id}", body, format="json")


class AssignmentTests(LeadWorkflowCase):
    def test_new_lead_has_a_timeline_with_created_and_emailed(self):
        lead = self.lead_for(self.co)
        res = self.owner.client.get(f"{API}leads/{lead.id}")
        self.assertEqual(res.status_code, 200)
        kinds = [a["kind"] for a in res.data["activity"]]
        self.assertEqual(kinds, ["created", "emailed"])
        self.assertIsNone(res.data["assignee"])

    def test_owner_assigns_and_the_colleague_is_emailed(self):
        lead = self.lead_for(self.co)
        mail.outbox.clear()
        res = self.patch(self.owner.client, lead, {"assignee_id": self.sam.member_id})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["assignee"]["email"], "sam@example.com")
        self.assertEqual([m.to for m in mail.outbox], [["sam@example.com"]])
        self.assertIn("A lead was assigned to you", mail.outbox[0].subject)
        self.assertIn("assigned", [a["kind"] for a in res.data["activity"]])

    def test_assigning_to_yourself_sends_no_mail(self):
        lead = self.lead_for(self.co)
        mail.outbox.clear()
        self.patch(self.owner.client, lead, {"assignee_id": str(self.owner_member.id)})
        self.assertEqual(mail.outbox, [])

    def test_employee_cannot_assign(self):
        lead = self.lead_for(self.eve)
        res = self.patch(self.eve.client, lead, {"assignee_id": self.sam.member_id})
        self.assertEqual(res.status_code, 403)

    def test_assignee_must_be_an_active_member_of_this_company(self):
        lead = self.lead_for(self.co)
        pending = self.invited("pending@example.com", "Pat Pending")
        for bad in (pending.member_id, "00000000-0000-0000-0000-000000000000"):
            res = self.patch(self.owner.client, lead, {"assignee_id": bad})
            self.assertEqual(res.status_code, 400, res.content)
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Ltd")
        from workspaces.models import Member
        foreign = Member.objects.get(workspace_id=other_ws, user__email="other@example.com")
        self.assertEqual(self.patch(self.owner.client, lead, {"assignee_id": str(foreign.id)}).status_code, 400)

    def test_unassign(self):
        lead = self.lead_for(self.co)
        self.patch(self.owner.client, lead, {"assignee_id": self.sam.member_id})
        res = self.patch(self.owner.client, lead, {"assignee_id": None})
        self.assertIsNone(res.data["assignee"])

    def test_employee_sees_own_card_leads_and_assigned_ones_only(self):
        mine = self.lead_for(self.eve, "Mine Lead")
        theirs = self.lead_for(self.sam, "Theirs Lead")
        company = self.lead_for(self.co, "Company Lead")
        names = lambda c: {l["name"] for l in c.get(self.url("leads")).data["results"]}
        self.assertEqual(names(self.eve.client), {"Mine Lead"})
        # an owner or admin works the company card's contacts and may hand one to a colleague
        self.patch(self.owner.client, company, {"assignee_id": self.eve.member_id})
        self.assertEqual(names(self.eve.client), {"Mine Lead", "Company Lead"})
        self.assertEqual(self.eve.client.get(f"{API}leads/{company.id}").status_code, 200)
        self.assertEqual(names(self.sam.client), {"Theirs Lead"})
        self.assertEqual(self.sam.client.get(f"{API}leads/{mine.id}").status_code, 404)

    def test_an_owner_or_admin_never_sees_an_employees_contacts(self):
        mine = self.lead_for(self.eve, "Eve Private")
        company = self.lead_for(self.co, "Company Open")
        for person in (self.owner, self.admin):
            res = person.client.get(self.url("leads"))
            self.assertEqual({l["name"] for l in res.data["results"]}, {"Company Open"})
            self.assertEqual(person.client.get(f"{API}leads/{mine.id}").status_code, 404)
            self.assertEqual(person.client.get(f"{API}leads/{company.id}").status_code, 200)
        self.assertEqual(self.patch(self.owner.client, mine, {"assignee_id": str(self.owner_member.id)}).status_code, 404)
        self.assertNotIn("Eve Private", body(self.owner.client.get(self.url("leads.csv"))).decode("utf-8-sig"))

    def test_the_employee_alone_is_told_about_their_contact(self):
        mail.outbox.clear()
        self.lead_for(self.eve, "Eve Private")
        recipients = sorted(a for m in mail.outbox for a in m.to)
        self.assertEqual(recipients, ["eve@example.com"])

    def test_admins_are_told_about_the_company_cards_contacts_when_the_company_asks(self):
        from workspaces.models import Workspace

        Workspace.objects.filter(pk=self.ws).update(lead_settings={"privacy_url": "", "notify_admins": True})
        mail.outbox.clear()
        self.lead_for(self.co, "Company Open")
        self.assertIn("ada@example.com", {a for m in mail.outbox for a in m.to})
        mail.outbox.clear()
        self.lead_for(self.eve, "Eve Private")
        self.assertEqual(sorted(a for m in mail.outbox for a in m.to), ["eve@example.com"])

    def test_assigned_employee_can_change_status_and_add_notes(self):
        theirs = self.lead_for(self.co, "Theirs Lead")
        self.patch(self.owner.client, theirs, {"assignee_id": self.eve.member_id})
        self.assertEqual(self.patch(self.eve.client, theirs, {"status": "qualified"}).status_code, 200)
        res = self.eve.client.post(f"{API}leads/{theirs.id}/notes", {"body": "Called, wants a quote"}, format="json")
        self.assertEqual(res.status_code, 201)

    def test_audit_log_has_assignment_and_status_entries(self):
        lead = self.lead_for(self.co)
        self.patch(self.owner.client, lead, {"assignee_id": self.sam.member_id, "status": "contacted"})
        actions = self.audit_actions()
        self.assertIn("lead.assigned", actions)
        self.assertIn("lead.status_changed", actions)

    def test_same_value_writes_nothing(self):
        lead = self.lead_for(self.co)
        self.patch(self.owner.client, lead, {"status": "new"})
        self.assertNotIn("lead.status_changed", self.audit_actions())

    def test_personal_workspace_cannot_assign(self):
        person = self.signup("solo@example.com", "Solo Person")
        self.buy(person, "personal")
        card = self.published_card(person)
        res = APIClient().post(
            f"{API}public/cards/{card['public_code']}/leads", {"name": "Solo Lead", "email": "s@example.com", "consent": True}, format="json"
        )
        self.assertEqual(res.status_code, 201)
        lead = Lead.objects.get(name="Solo Lead")
        res = person.client.patch(f"{API}leads/{lead.id}", {"assignee_id": None}, format="json")
        self.assertEqual(res.status_code, 400)


class StatusAndNotesTests(LeadWorkflowCase):
    def test_all_five_statuses_work(self):
        lead = self.lead_for(self.co)
        for status in ("contacted", "qualified", "won", "lost", "new"):
            res = self.patch(self.owner.client, lead, {"status": status})
            self.assertEqual(res.status_code, 200, status)
            self.assertEqual(res.data["status"], status)
        self.assertEqual(self.patch(self.owner.client, lead, {"status": "bogus"}).status_code, 400)
        self.assertEqual(self.patch(self.owner.client, lead, {}).status_code, 400)

    def test_notes_have_author_and_time_and_show_in_the_timeline(self):
        lead = self.lead_for(self.co)
        res = self.owner.client.post(f"{API}leads/{lead.id}/notes", {"body": "  First call done  "}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["body"], "First call done")
        self.assertEqual(res.data["author"], "Olivia Owner")
        detail = self.owner.client.get(f"{API}leads/{lead.id}").data
        self.assertEqual(len(detail["notes"]), 1)
        self.assertIn("note_added", [a["kind"] for a in detail["activity"]])
        for bad in ({"body": ""}, {"body": "   "}, {}, {"body": 5}):
            self.assertEqual(self.owner.client.post(f"{API}leads/{lead.id}/notes", bad, format="json").status_code, 400)

    def test_notes_are_private_to_people_who_can_see_the_lead(self):
        lead = self.lead_for(self.co)
        res = self.sam.client.post(f"{API}leads/{lead.id}/notes", {"body": "snoop"}, format="json")
        self.assertEqual(res.status_code, 404)


class FilterTests(LeadWorkflowCase):
    def setUp(self):
        super().setUp()
        self.a = self.lead_for(self.co, "Alpha One")
        self.b = self.lead_for(self.co, "Bravo Two", note="hello")
        self.c = self.lead_for(self.co, "Charlie Three")
        self.patch(self.owner.client, self.b, {"assignee_id": self.eve.member_id, "status": "contacted"})
        self.patch(self.owner.client, self.c, {"status": "won"})

    def names(self, **params):
        res = self.owner.client.get(self.url("leads"), params)
        self.assertEqual(res.status_code, 200, res.content)
        return {l["name"] for l in res.data["results"]}

    def test_filters(self):
        self.assertEqual(self.names(assignee="none"), {"Alpha One", "Charlie Three"})
        self.assertEqual(self.names(assignee=self.eve.member_id), {"Bravo Two"})
        self.assertEqual(self.names(status="won"), {"Charlie Three"})
        self.assertEqual(self.names(status="won,contacted"), {"Bravo Two", "Charlie Three"})
        self.assertEqual(self.names(source="exchange"), {"Alpha One", "Bravo Two", "Charlie Three"})
        self.assertEqual(self.names(source="scanned_card"), set())
        self.assertEqual(self.names(card_id=self.co.card_id), {"Alpha One", "Bravo Two", "Charlie Three"})
        self.assertEqual(self.names(card_id=self.eve.card_id), set())
        self.assertEqual(self.names(q="hello"), {"Bravo Two"})

    def test_mine_means_assigned_to_me(self):
        res = self.eve.client.get(self.url("leads"), {"assignee": "me"})
        self.assertEqual({l["name"] for l in res.data["results"]}, {"Bravo Two"})

    def test_date_filters(self):
        self.assertEqual(len(self.names(**{"from": "2000-01-01", "to": "2100-01-01"})), 3)
        self.assertEqual(self.names(**{"to": "2000-01-01"}), set())
        self.assertEqual(self.names(**{"from": "2100-01-01"}), set())
        res = self.owner.client.get(self.url("leads"), {"from": "garbage"})
        self.assertEqual(res.status_code, 400)

    def test_assignee_list_for_the_filter(self):
        res = self.owner.client.get(self.url("lead-assignees"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual({r["email"] for r in res.data}, {"owner@example.com", "eve@example.com", "sam@example.com", "ada@example.com"})


class BulkTests(LeadWorkflowCase):
    def setUp(self):
        super().setUp()
        self.leads = [self.lead_for(self.co, f"Lead{i} Person") for i in range(4)]
        self.ids = [str(l.id) for l in self.leads]

    def bulk(self, client, body):
        return client.post(self.url("leads/bulk"), body, format="json")

    def test_bulk_assign_sends_one_mail_and_one_audit_row(self):
        mail.outbox.clear()
        res = self.bulk(self.owner.client, {"action": "assign", "ids": self.ids, "assignee_id": self.sam.member_id})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["ok"], res.data["failed"]), (4, 0))
        self.assertEqual(Lead.objects.filter(assignee_id=self.sam.member_id).count(), 4)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(self.audit_actions().count("lead.bulk_updated"), 1)
        self.assertEqual(self.audit_actions().count("lead.assigned"), 0)

    def test_bulk_status_and_independent_failures(self):
        ids = self.ids + ["00000000-0000-0000-0000-000000000000", "not-an-id"]
        res = self.bulk(self.owner.client, {"action": "status", "ids": ids, "status": "qualified"})
        self.assertEqual((res.data["ok"], res.data["failed"]), (4, 2))
        self.assertEqual(Lead.objects.filter(status="qualified").count(), 4)

    def test_employee_bulk_status_only_touches_visible_leads(self):
        own = [self.lead_for(self.eve, f"Own{i} Person") for i in range(4)]
        other = self.lead_for(self.sam, "Hidden Person")
        res = self.bulk(self.eve.client, {"action": "status", "ids": [str(l.id) for l in own] + [str(other.id)], "status": "lost"})
        self.assertEqual((res.data["ok"], res.data["failed"]), (4, 1))
        other.refresh_from_db()
        self.assertEqual(other.status, "new")

    def test_employee_cannot_bulk_assign(self):
        res = self.bulk(self.eve.client, {"action": "assign", "ids": self.ids, "assignee_id": self.sam.member_id})
        self.assertEqual(res.status_code, 403)

    def test_bad_requests(self):
        self.assertEqual(self.bulk(self.owner.client, {"action": "nope", "ids": self.ids}).status_code, 400)
        self.assertEqual(self.bulk(self.owner.client, {"action": "status", "ids": [], "status": "won"}).status_code, 400)
        self.assertEqual(self.bulk(self.owner.client, {"action": "status", "ids": self.ids, "status": "x"}).status_code, 400)
        self.assertEqual(self.bulk(self.owner.client, {"action": "status", "ids": ["a"] * 201, "status": "won"}).status_code, 400)
        self.assertEqual(self.bulk(self.owner.client, {"action": "assign", "ids": self.ids, "assignee_id": "zzz"}).status_code, 400)


class CsvTests(LeadWorkflowCase):
    def test_bom_formula_safety_assignee_and_notes(self):
        lead = self.lead_for(self.co, "=cmd Evil", note="+SUM(1)")
        self.patch(self.owner.client, lead, {"assignee_id": self.sam.member_id})
        self.owner.client.post(f"{API}leads/{lead.id}/notes", {"body": "@internal"}, format="json")
        res = self.owner.client.get(self.url("leads.csv"), {"notes": "1", "assignee": self.sam.member_id})
        raw = body(res)
        self.assertTrue(raw.startswith(b"\xef\xbb\xbf"))
        text = raw.decode("utf-8-sig")
        self.assertIn("internal_notes", text.splitlines()[0])
        self.assertIn("'=cmd Evil", text)
        self.assertIn("'+SUM(1)", text)
        self.assertIn("Olivia Owner: @internal", text)
        self.assertIn("Sam Seller", text)
        self.assertIn(",yes,", text)

    def test_tag_and_event_name_are_the_last_columns_and_safe(self):
        import csv
        import io

        from leads.models import Lead

        lead = self.lead_for(self.co, "Event Person")
        Lead.objects.filter(pk=lead.pk).update(tag="hot", event_name="=Expo 2026", client_ref="phone-ref-1", source="event")
        for notes, expected in (({}, ["tag", "event_name"]), ({"notes": "1"}, ["internal_notes", "tag", "event_name"])):
            res = self.owner.client.get(self.url("leads.csv"), notes)
            rows = list(csv.reader(io.StringIO(body(res).decode("utf-8-sig"))))
            self.assertEqual(rows[0][-len(expected):], expected)
            # the older columns keep their places
            self.assertEqual(rows[0][:8], ["created_at", "card", "name", "email", "phone", "company", "note", "source"])
            self.assertEqual(rows[0][15], "consented_at")
            mine = next(r for r in rows[1:] if r[2] == "Event Person")
            self.assertEqual(mine[7], "event")
            self.assertEqual(mine[-2:], ["hot", "'=Expo 2026"])
            self.assertNotIn("client_ref", rows[0])
            self.assertNotIn("phone-ref-1", ",".join(mine))

    def test_notes_column_is_optional_and_filters_apply(self):
        self.lead_for(self.co, "Keep Me")
        self.lead_for(self.sam, "Drop Me")
        res = self.owner.client.get(self.url("leads.csv"), {"card_id": self.co.card_id})
        text = body(res).decode("utf-8-sig")
        self.assertNotIn("internal_notes", text)
        self.assertIn("Keep Me", text)
        self.assertNotIn("Drop Me", text)


class WebhookEventsFromLeadsTests(LeadWorkflowCase):
    def test_events_are_queued_for_subscribed_endpoints_only(self):
        from leads.models import WebhookEndpoint

        ws = self.owner_member.workspace
        WebhookEndpoint.objects.create(workspace=ws, url="https://a.example.com/h", secret="s1", events=["lead.created", "lead.assigned"])
        WebhookEndpoint.objects.create(workspace=ws, url="https://b.example.com/h", secret="s2", events=["lead.updated"])
        WebhookEndpoint.objects.create(workspace=ws, url="https://c.example.com/h", secret="s3", events=["lead.created"], enabled=False)
        lead = self.lead_for(self.co)
        self.assertEqual(list(WebhookDelivery.objects.values_list("endpoint__url", "event_type")), [("https://a.example.com/h", "lead.created")])
        self.patch(self.owner.client, lead, {"assignee_id": self.sam.member_id, "status": "won"})
        got = sorted(WebhookDelivery.objects.values_list("endpoint__url", "event_type"))
        self.assertEqual(got, [
            ("https://a.example.com/h", "lead.assigned"), ("https://a.example.com/h", "lead.created"),
            ("https://b.example.com/h", "lead.updated"),
        ])
        payload = WebhookDelivery.objects.get(event_type="lead.assigned").payload
        self.assertEqual(payload["data"]["lead"]["assignee"]["email"], "sam@example.com")
        self.assertNotIn("notes", payload["data"]["lead"])


class ContactsLeaveOnlyAsTheCompanysOwnTests(LeadWorkflowCase):
    """An employee's contact is the employee's: it is not sent to the company's webhooks, and the company card's is."""

    def test_webhooks_get_the_company_cards_contacts_and_not_an_employees(self):
        from leads.models import WebhookEndpoint

        endpoint = WebhookEndpoint.objects.create(workspace_id=self.ws, url="https://hooks.example.com/in", secret="s", events=["lead.created"])
        self.lead_for(self.eve, "Eve Private")
        self.assertEqual(endpoint.deliveries.count(), 0)
        self.lead_for(self.co, "Company Open")
        self.assertEqual(endpoint.deliveries.count(), 1)

    def test_the_company_export_and_the_developer_key_see_the_company_cards_contacts_only(self):
        from leads.models import company_owned_leads

        self.lead_for(self.eve, "Eve Private")
        self.lead_for(self.co, "Company Open")
        names = set(company_owned_leads(self.owner_member.workspace).values_list("name", flat=True))
        self.assertEqual(names, {"Company Open"})


class RemovedEmployeeTests(LeadWorkflowCase):
    def remove(self, policy):
        res = self.owner.client.delete(self.url(f"members/{self.eve.member_id}"), {"card": policy}, format="json")
        self.assertEqual(res.status_code, 204, res.content)
        return res

    def test_a_kept_card_of_a_removed_employee_hands_its_contacts_to_the_company(self):
        lead = self.lead_for(self.eve, "Eve Old Contact")
        self.assertEqual(self.owner.client.get(f"{API}leads/{lead.id}").status_code, 404)
        self.remove("keep")
        # nobody holds the card now, so its contacts are the company's: owners and admins can work them
        for person in (self.owner, self.admin):
            self.assertEqual(person.client.get(f"{API}leads/{lead.id}").status_code, 200)
            self.assertIn("Eve Old Contact", {l["name"] for l in person.client.get(self.url("leads")).data["results"]})

    def test_a_deleted_card_keeps_its_contacts_with_the_company_too(self):
        lead = self.lead_for(self.eve, "Eve Gone Contact")
        self.remove("delete")
        self.assertEqual(self.owner.client.get(f"{API}leads/{lead.id}").status_code, 200)


class ActivityLogDoesNotCarryEmployeeContactsTests(LeadWorkflowCase):
    def test_what_an_employee_does_with_their_own_contact_is_not_in_the_company_log(self):
        from operations.models import AuditEvent

        lead = self.lead_for(self.eve, "Eve Private Name")
        self.assertEqual(self.patch(self.eve.client, lead, {"status": "contacted"}).status_code, 200)
        labels = " ".join(AuditEvent.objects.filter(workspace_id=self.ws).values_list("target_label", flat=True))
        self.assertNotIn("Eve Private Name", labels)

    def test_the_company_cards_contact_is_logged_as_before(self):
        from operations.models import AuditEvent

        lead = self.lead_for(self.co, "Company Open Name")
        self.assertEqual(self.patch(self.owner.client, lead, {"status": "contacted"}).status_code, 200)
        labels = " ".join(AuditEvent.objects.filter(workspace_id=self.ws).values_list("target_label", flat=True))
        self.assertIn("Company Open Name", labels)
