"""The employee's switch "share my new contacts with the company": off by default, a snapshot taken when a contact arrives, and one
definition used by every channel (list, export, webhooks, CRM, developer API, company export, reports, e-mail, activity log)."""
import io
import json
import zipfile
from datetime import datetime, timezone as dt_tz
from unittest.mock import patch

from django.core import mail
from rest_framework.test import APIClient

from analytics import weekly
from cards.models import Booking, Card
from leads.models import Lead, WebhookEndpoint, company_owned_leads, is_company_owned
from operations.models import AuditEvent
from orders.models import Order
from workspaces.models import Member, Workspace
from workspaces.sharing import card_shares_with_company

from .base import API, body
from .ops_base import OpsTestCase
from .test_public_api import PUB, api_client


class ShareCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.eve = self.add("eve@example.com", "Eve Employee")
        self.sam = self.add("sam@example.com", "Sam Seller")
        self.admin = self.add("ada@example.com", "Ada Admin", role="admin")
        for person in (self.eve, self.sam):
            res = self.owner.client.post(f"{API}cards/{person.card_id}/publish")
            self.assertEqual(res.status_code, 200, res.content)
            person.code = res.data["public_code"]
        co = self.owner.client.post(f"{API}workspaces/{self.ws}/company-card")
        published = self.owner.client.post(f"{API}cards/{co.data['id']}/publish")
        self.co = type("Co", (), {"code": published.data["public_code"], "card_id": co.data["id"]})()
        mail.outbox.clear()

    def switch(self, person, value):
        return person.client.patch(self.url("me"), {"share_contacts": value}, format="json")

    def lead_for(self, person, name):
        data = {"name": name, "email": f"{name.split()[0].lower()}@example.com", "consent": True}
        res = APIClient().post(f"{API}public/cards/{person.code}/leads", data, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return Lead.objects.filter(name=name).latest("created_at")

    def names(self, client):
        return {l["name"] for l in client.get(self.url("leads?page_size=100")).data["results"]}


class SwitchApiTests(ShareCase):
    def test_off_by_default_and_the_employee_can_read_and_set_it(self):
        res = self.eve.client.get(self.url("me"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["can_share_contacts"], res.data["share_contacts"]), (True, False))
        res = self.switch(self.eve, True)
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["share_contacts"])
        self.assertIsNotNone(res.data["share_contacts_changed_at"])
        self.assertTrue(Member.objects.get(pk=self.eve.member_id).share_contacts)
        self.assertFalse(self.switch(self.eve, False).data["share_contacts"])

    def test_owner_and_admin_have_no_switch(self):
        for person in (self.owner, self.admin):
            res = person.client.get(self.url("me"))
            self.assertEqual((res.data["can_share_contacts"], res.data["share_contacts"]), (False, False))
            self.assertEqual(self.switch(person, True).status_code, 403)

    def test_a_value_that_is_not_on_or_off_is_refused(self):
        self.assertEqual(self.eve.client.patch(self.url("me"), {"share_contacts": "yes"}, format="json").status_code, 400)
        self.assertEqual(self.eve.client.patch(self.url("me"), {}, format="json").status_code, 400)

    def test_nobody_can_turn_it_on_for_someone_else(self):
        for person in (self.owner, self.admin):
            person.client.patch(self.url(f"members/{self.eve.member_id}"), {"share_contacts": True}, format="json")
            self.assertFalse(Member.objects.get(pk=self.eve.member_id).share_contacts)
        # the employee's own route never takes someone else's id
        res = self.sam.client.patch(self.url("me"), {"share_contacts": True, "member_id": self.eve.member_id}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Member.objects.get(pk=self.eve.member_id).share_contacts)
        self.assertTrue(Member.objects.get(pk=self.sam.member_id).share_contacts)

    def test_managers_see_who_shares_but_the_list_has_no_way_to_set_it(self):
        self.switch(self.eve, True)
        rows = {m["email"]: m for m in self.owner.client.get(self.url("members")).data}
        self.assertIs(rows["eve@example.com"]["share_contacts"], True)
        self.assertIs(rows["sam@example.com"]["share_contacts"], False)
        self.assertIsNone(rows["ada@example.com"]["share_contacts"])

    def test_a_stranger_is_not_a_member(self):
        outsider = self.signup("out@example.com", "Out Sider")
        self.assertEqual(outsider.client.get(self.url("me")).status_code, 404)

    def test_personal_workspace_has_no_switch(self):
        person = self.signup("solo@example.com", "Solo Person")
        res = person.client.get(f"{API}workspaces/{person.ws}/me")
        self.assertEqual((res.status_code, res.data["can_share_contacts"]), (200, False))
        self.assertEqual(person.client.patch(f"{API}workspaces/{person.ws}/me", {"share_contacts": True}, format="json").status_code, 403)

    def test_the_toggle_is_in_the_log_without_any_contact_name(self):
        self.lead_for(self.eve, "Before Visitor")
        self.switch(self.eve, True)
        self.lead_for(self.eve, "Visitor Named Secretly")
        self.switch(self.eve, False)
        self.switch(self.eve, False)  # no change, no second entry
        rows = AuditEvent.objects.filter(action="member.share_contacts_changed")
        self.assertEqual([r.details for r in rows.order_by("created_at")], [{"share_contacts": True}, {"share_contacts": False}])
        blob = json.dumps(list(rows.values("target_label", "details", "actor_name")))
        self.assertNotIn("Visitor", blob)
        listed = [e["action"] for e in self.audit(page_size=100)["results"]]
        self.assertEqual(listed.count("member.share_contacts_changed"), 2)

    def test_changing_role_switches_it_off(self):
        self.switch(self.eve, True)
        res = self.owner.client.patch(self.url(f"members/{self.eve.member_id}"), {"role": "admin"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertFalse(Member.objects.get(pk=self.eve.member_id).share_contacts)
        self.assertFalse(card_shares_with_company(Card.objects.get(pk=self.eve.card_id)))


class SnapshotTests(ShareCase):
    def test_a_contact_while_off_is_private_for_ever(self):
        lead = self.lead_for(self.eve, "Eve Private")
        self.assertFalse(lead.shared_with_company)
        self.switch(self.eve, True)  # turning it on later does not reach back
        lead.refresh_from_db()
        self.assertFalse(lead.shared_with_company)
        for person in (self.owner, self.admin):
            self.assertEqual(person.client.get(f"{API}leads/{lead.id}").status_code, 404)
            self.assertNotIn("Eve Private", self.names(person.client))

    def test_a_contact_while_on_is_the_companys_and_stays_after_switching_off(self):
        self.switch(self.eve, True)
        lead = self.lead_for(self.eve, "Eve Shared")
        self.assertTrue(lead.shared_with_company)
        self.switch(self.eve, False)
        after = self.lead_for(self.eve, "Eve After")
        self.assertFalse(after.shared_with_company)
        lead.refresh_from_db()
        self.assertTrue(lead.shared_with_company)
        for person in (self.owner, self.admin):
            self.assertEqual(person.client.get(f"{API}leads/{lead.id}").status_code, 200)
            names = self.names(person.client)
            self.assertIn("Eve Shared", names)
            self.assertNotIn("Eve After", names)
            self.assertEqual(person.client.get(f"{API}leads/{after.id}").status_code, 404)
        # the employee still sees both
        self.assertTrue({"Eve Shared", "Eve After"} <= self.names(self.eve.client))

    def test_one_employees_switch_does_not_touch_another(self):
        self.switch(self.eve, True)
        sam_lead = self.lead_for(self.sam, "Sam Private")
        self.assertFalse(sam_lead.shared_with_company)
        self.assertNotIn("Sam Private", self.names(self.owner.client))
        self.assertEqual(self.sam.client.get(f"{API}leads/{sam_lead.id}").status_code, 200)

    def test_one_definition_everywhere(self):
        self.switch(self.eve, True)
        lead = self.lead_for(self.eve, "Eve Shared")
        self.assertTrue(is_company_owned(lead))
        self.assertIn(lead.id, set(company_owned_leads(Workspace.objects.get(pk=self.ws)).values_list("id", flat=True)))

    def test_hand_added_contact_follows_the_switch(self):
        res = self.eve.client.post(self.url("leads"), {"name": "Hand Added", "card_id": self.eve.card_id}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertFalse(res.data["shared_with_company"])
        self.switch(self.eve, True)
        res = self.eve.client.post(self.url("leads"), {"name": "Hand Shared", "card_id": self.eve.card_id}, format="json")
        self.assertTrue(res.data["shared_with_company"])
        self.assertEqual(self.names(self.owner.client) & {"Hand Added", "Hand Shared"}, {"Hand Shared"})

    def test_company_card_and_owner_cards_are_not_affected(self):
        lead = self.lead_for(self.co, "Company Open")
        self.assertFalse(lead.shared_with_company)
        self.assertTrue(is_company_owned(lead))
        self.assertIn("Company Open", self.names(self.owner.client))
        self.assertFalse(card_shares_with_company(Card.objects.get(pk=self.co.card_id)))
        self.assertFalse(card_shares_with_company(None))

    def test_removal_keeps_what_was_shared(self):
        self.switch(self.eve, True)
        shared = self.lead_for(self.eve, "Eve Shared")
        self.switch(self.eve, False)
        res = self.owner.client.delete(self.url(f"members/{self.eve.member_id}"), {"card": "keep"}, format="json")
        self.assertEqual(res.status_code, 204, res.content)
        self.assertEqual(self.owner.client.get(f"{API}leads/{shared.id}").status_code, 200)

    def test_personal_workspace_leads_are_never_marked(self):
        person = self.signup("solo@example.com", "Solo Person")
        self.buy(person)
        card = self.published_card(person)
        res = APIClient().post(
            f"{API}public/cards/{card['public_code']}/leads", {"name": "Solo Visitor", "email": "sv@example.com", "consent": True}, format="json"
        )
        self.assertEqual(res.status_code, 201)
        self.assertFalse(Lead.objects.get(name="Solo Visitor").shared_with_company)
        self.assertEqual(person.client.get(f"{API}workspaces/{person.ws}/leads").data["count"], 1)


class ChannelTests(ShareCase):
    def setUp(self):
        super().setUp()
        self.switch(self.eve, True)
        self.shared = self.lead_for(self.eve, "Eve Shared")
        self.switch(self.eve, False)
        self.private = self.lead_for(self.eve, "Eve Private")
        mail.outbox.clear()

    def test_csv_export(self):
        text = body(self.owner.client.get(self.url("leads.csv"))).decode("utf-8-sig")
        self.assertIn("Eve Shared", text)
        self.assertNotIn("Eve Private", text)

    def test_bulk_actions_reach_shared_only(self):
        res = self.owner.client.post(
            self.url("leads/bulk"), {"action": "status", "status": "contacted", "ids": [str(self.shared.id), str(self.private.id)]}, format="json"
        )
        self.assertEqual((res.data["ok"], res.data["failed"]), (1, 1), res.content)

    def test_webhooks_get_the_shared_contact_only(self):
        endpoint = WebhookEndpoint.objects.create(workspace_id=self.ws, url="https://hooks.example.com/in", secret="s", events=["lead.created"])
        self.switch(self.eve, True)
        self.lead_for(self.eve, "Eve SharedTwo")
        self.switch(self.eve, False)
        self.lead_for(self.eve, "Eve PrivateTwo")
        names = [d.payload["data"]["lead"]["name"] for d in endpoint.deliveries.all()]
        self.assertEqual(names, ["Eve SharedTwo"])

    def test_crm_backfill_uses_the_same_definition(self):
        names = set(company_owned_leads(Workspace.objects.get(pk=self.ws)).values_list("name", flat=True))
        self.assertEqual(names, {"Eve Shared"})

    def test_email_goes_to_admins_for_a_shared_contact_when_the_company_asks(self):
        Workspace.objects.filter(pk=self.ws).update(lead_settings={"privacy_url": "", "notify_admins": True})
        self.switch(self.eve, True)
        mail.outbox.clear()
        self.lead_for(self.eve, "Eve SharedMail")
        self.assertEqual({a for m in mail.outbox for a in m.to}, {"eve@example.com", "owner@example.com", "ada@example.com"})
        self.switch(self.eve, False)
        mail.outbox.clear()
        self.lead_for(self.eve, "Eve PrivateMail")
        self.assertEqual({a for m in mail.outbox for a in m.to}, {"eve@example.com"})

    def test_email_stays_with_the_holder_when_the_company_does_not_ask(self):
        self.switch(self.eve, True)
        mail.outbox.clear()
        self.lead_for(self.eve, "Eve SharedQuiet")
        self.assertEqual({a for m in mail.outbox for a in m.to}, {"eve@example.com"})

    def test_bell(self):
        data = self.owner.client.get(self.url("lead-bell")).data
        self.assertEqual([x["name"] for x in data["latest"]], ["Eve Shared"])

    def test_company_data_export(self):
        from privacy.exporter import build_workspace_export, estimate_size

        tmp = build_workspace_export(Workspace.objects.get(pk=self.ws))
        tmp.seek(0)
        archive = zipfile.ZipFile(io.BytesIO(tmp.read()))
        leads = json.loads(archive.read("leads.json"))
        self.assertEqual([l["name"] for l in leads], ["Eve Shared"])
        self.assertEqual(estimate_size(workspace=Workspace.objects.get(pk=self.ws))[1], 1)

    def test_status_change_of_a_shared_contact_is_logged_like_a_company_contact(self):
        self.assertEqual(self.owner.client.patch(f"{API}leads/{self.shared.id}", {"status": "contacted"}, format="json").status_code, 200)
        self.assertTrue(AuditEvent.objects.filter(action="lead.status_changed", workspace_id=self.ws).exists())
        # what the employee does with the one they kept stays out of the log
        self.assertEqual(self.eve.client.patch(f"{API}leads/{self.private.id}", {"status": "contacted"}, format="json").status_code, 200)
        labels = " ".join(AuditEvent.objects.filter(workspace_id=self.ws).values_list("target_label", flat=True))
        self.assertNotIn("Eve Private", labels)

    def test_analytics_and_people_counts(self):
        res = self.owner.client.get(self.url("analytics?days=7"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["totals"]["leads"], 1)
        eve_row = next(c for c in res.data["cards"] if c["card_id"] == self.eve.card_id)
        self.assertEqual((eve_row["leads"], eve_row["leads_visible"]), (1, True))
        sam_row = next(c for c in res.data["cards"] if c["card_id"] == self.sam.card_id)
        self.assertFalse(sam_row["leads_visible"])
        people = self.owner.client.get(self.url("analytics/people?days=7")).data["rows"]
        eve = next(r for r in people if r["member_id"] == self.eve.member_id)
        self.assertEqual((eve["totals"]["leads"], eve["leads_visible"]), (1, True))
        # the employee sees both of theirs
        mine = self.eve.client.get(self.url("analytics?days=7")).data
        self.assertEqual(mine["totals"]["leads"], 2)

    def test_weekly_report_counts_what_the_reader_may_see(self):
        owner_member = Member.objects.get(pk=self.owner_member.pk)
        data = weekly.company_data(owner_member, weekly.last_full_week())
        self.assertEqual(sum(data["leads_by_status"].values()), 1)

    def test_developer_api(self):
        from publicapi import keys
        from publicapi.models import SCOPES

        _, secret = keys.create_key(Workspace.objects.get(pk=self.ws), None, "K", list(SCOPES))
        client = api_client(secret)
        rows = client.get(PUB + "leads").data["data"]
        self.assertEqual([r["name"] for r in rows], ["Eve Shared"])
        self.assertEqual(client.get(PUB + f"leads/{self.private.id}").status_code, 404)


class OrdersAndBookingsTests(ShareCase):
    def setUp(self):
        super().setUp()
        res = self.eve.client.post(f"{API}cards/{self.eve.card_id}/products", {"title": "Coffee", "price": "10"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.product = res.data["id"]
        self.public = f"{API}public/cards/{self.eve.code}"

    def order(self, name):
        res = APIClient().post(
            f"{self.public}/orders",
            {"items": [{"product_id": self.product, "qty": 1}], "name": name, "phone": "+974 5555 1234", "email": "v@example.com", "consent": True},
            format="json",
        )
        self.assertEqual(res.status_code, 201, res.content)
        return Order.objects.filter(customer_name=name).latest("created_at")

    def test_orders_follow_the_same_snapshot(self):
        private = self.order("Visitor Private")
        self.switch(self.eve, True)
        shared = self.order("Visitor Shared")
        self.switch(self.eve, False)
        self.assertEqual((private.shared_with_company, shared.shared_with_company), (False, True))
        rows = self.owner.client.get(self.url("orders")).data["results"]
        self.assertEqual([r["customer_name"] for r in rows], ["Visitor Shared"])
        self.assertEqual(self.owner.client.get(self.url(f"orders/{private.id}")).status_code, 404)
        self.assertEqual(self.owner.client.get(self.url(f"orders/{shared.id}")).status_code, 200)
        self.assertEqual(self.sam.client.get(self.url(f"orders/{shared.id}")).status_code, 404)
        self.assertEqual(len(self.eve.client.get(self.url("orders")).data["results"]), 2)
        self.assertEqual(self.owner.client.get(self.url("lead-bell")).data["orders"], 1)

    def test_bookings_follow_the_same_snapshot(self):
        hours = [{"d": d, "from": "09:00", "to": "11:00"} for d in range(7)]
        payload = {"enabled": True, "timezone": "Asia/Qatar", "slot_minutes": 30, "buffer_minutes": 0, "days_ahead": 14, "weekly": hours}
        now = datetime(2027, 1, 4, 6, 0, tzinfo=dt_tz.utc)
        with patch("cards.booking_slots.now", return_value=now):
            self.assertEqual(self.eve.client.put(f"{API}cards/{self.eve.card_id}/booking-settings", payload, format="json").status_code, 200)

            def book(time, name):
                res = APIClient().post(
                    f"{self.public}/bookings", {"date": "2027-01-05", "time": time, "name": name, "email": "v@example.com", "consent": True}, format="json"
                )
                self.assertEqual(res.status_code, 201, res.content)

            book("09:00", "Booker Private")
            self.switch(self.eve, True)
            book("09:30", "Booker Shared")
        rows = {b.name: b for b in Booking.objects.all()}
        self.assertEqual((rows["Booker Private"].shared_with_company, rows["Booker Shared"].shared_with_company), (False, True))
        listed = self.owner.client.get(self.url("bookings")).data["results"]
        self.assertEqual([r["name"] for r in listed], ["Booker Shared"])
        self.assertEqual(self.owner.client.get(self.url(f"bookings/{rows['Booker Private'].id}")).status_code, 404)
        self.assertEqual(self.owner.client.get(self.url(f"bookings/{rows['Booker Shared'].id}")).status_code, 200)
        self.assertEqual(self.owner.client.get(self.url("lead-bell")).data["bookings"], 1)
