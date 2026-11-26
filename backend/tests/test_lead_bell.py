"""The new-contacts bell: a personal unread count, the latest few contacts, and the seen marker."""
from datetime import timedelta

from django.utils import timezone
from rest_framework.test import APIClient

from leads.models import Lead, LeadSeen
from workspaces.models import Workspace

from .base import API
from .ops_base import OpsTestCase


class LeadBellCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.eve = self.add("eve@example.com", "Eve Employee")
        self.sam = self.add("sam@example.com", "Sam Seller")
        self.admin = self.add("ada@example.com", "Ada Admin", role="admin")
        for person in (self.eve, self.sam):
            res = self.owner.client.post(f"{API}cards/{person.card_id}/publish")
            self.assertEqual(res.status_code, 200, res.content)
            person.code = res.data["public_code"]
        # The company's own card: its contacts are the owner's and the admins'. An employee's contacts are never theirs to see.
        company = self.owner.client.post(f"{API}workspaces/{self.ws}/company-card")
        self.assertEqual(company.status_code, 201, company.content)
        published = self.owner.client.post(f"{API}cards/{company.data['id']}/publish")
        self.assertEqual(published.status_code, 200, published.content)
        self.co = type("Co", (), {"code": published.data["public_code"]})()

    def bell_url(self, ws=None, seen=False):
        return f"{API}workspaces/{ws or self.ws}/lead-bell" + ("/seen" if seen else "")

    def lead_for(self, person, name="Visitor One", **extra):
        body = {"name": name, "email": f"{name.split()[0].lower()}@example.com", "consent": True, **extra}
        res = APIClient().post(f"{API}public/cards/{person.code}/leads", body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return Lead.objects.filter(name=name).latest("created_at")

    def bell(self, client, ws=None):
        res = client.get(self.bell_url(ws))
        self.assertEqual(res.status_code, 200, res.content)
        return res.data


class BellVisibilityTests(LeadBellCase):
    def test_owner_and_admin_see_only_the_company_cards_leads(self):
        self.lead_for(self.eve, "Visitor One")
        self.lead_for(self.sam, "Visitor Two")
        self.lead_for(self.co, "Visitor Three")
        for person in (self.owner, self.admin):
            data = self.bell(person.client)
            self.assertEqual((data["unread"], [x["name"] for x in data["latest"]]), (1, ["Visitor Three"]))
        self.assertEqual(self.bell(self.eve.client)["unread"], 1)
        self.assertEqual(self.bell(self.sam.client)["unread"], 1)

    def test_employee_sees_own_card_and_assigned_leads_only(self):
        self.lead_for(self.eve, "Visitor One")
        other = self.lead_for(self.co, "Visitor Two")
        data = self.bell(self.eve.client)
        self.assertEqual([x["name"] for x in data["latest"]], ["Visitor One"])
        self.assertEqual(data["unread"], 1)
        res = self.owner.client.patch(f"{API}leads/{other.id}", {"assignee_id": self.eve.member_id}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.bell(self.eve.client)["unread"], 2)

    def test_personal_workspace_owner_sees_own_leads(self):
        person = self.signup("solo@example.com", "Solo Person")
        self.buy(person)
        card = self.published_card(person)
        self.assertEqual(self.bell(person.client, person.ws), {"unread": 0, "orders": 0, "bookings": 0, "latest": []})
        res = APIClient().post(
            f"{API}public/cards/{card['public_code']}/leads", {"name": "Solo Visitor", "email": "solo.visitor@example.com", "consent": True}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        data = self.bell(person.client, person.ws)
        self.assertEqual(data["unread"], 1)
        self.assertEqual(data["latest"][0]["name"], "Solo Visitor")
        self.assertEqual(data["latest"][0]["kind"], "contact")
        self.assertEqual(self.bell(self.owner.client)["unread"], 0)

    def test_other_companies_leads_are_not_counted(self):
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Ltd")
        card = self.published_card(other, other_ws)
        APIClient().post(f"{API}public/cards/{card['public_code']}/leads", {"name": "Elsewhere", "email": "else@example.com", "consent": True}, format="json")
        self.assertEqual(self.bell(self.owner.client)["unread"], 0)
        self.assertEqual(self.bell(other.client, other_ws)["unread"], 1)

    def test_stranger_gets_404(self):
        stranger = self.signup("stranger@example.com", "Stranger")
        self.assertEqual(stranger.client.get(self.bell_url()).status_code, 404)
        self.assertEqual(stranger.client.post(self.bell_url(seen=True)).status_code, 404)
        self.assertEqual(LeadSeen.objects.count(), 0)

    def test_anonymous_is_refused(self):
        self.assertEqual(APIClient().get(self.bell_url()).status_code, 401)

    def test_contacts_saved_by_hand_do_not_ring_the_bell(self):
        res = self.owner.client.post(
            f"{API}workspaces/{self.ws}/leads", {"name": "Paper Card", "source": "scanned_card"}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(self.bell(self.owner.client)["unread"], 0)


class BellCountTests(LeadBellCase):
    def test_latest_is_newest_first_capped_at_five_and_count_is_full(self):
        for n in range(7):
            lead = self.lead_for(self.co, f"Visitor N{n}")
            Lead.objects.filter(pk=lead.pk).update(created_at=timezone.now() - timedelta(minutes=10 - n))
        data = self.bell(self.owner.client)
        self.assertEqual(data["unread"], 7)
        self.assertEqual([x["name"] for x in data["latest"]], [f"Visitor N{n}" for n in (6, 5, 4, 3, 2)])
        self.assertEqual(set(data["latest"][0]), {"id", "name", "card_name", "source", "created_at", "kind"})

    def test_seen_resets_the_count_only_for_that_person(self):
        self.lead_for(self.co)
        self.assertEqual(self.owner.client.post(self.bell_url(seen=True)).status_code, 204)
        self.assertEqual(self.bell(self.owner.client), {"unread": 0, "orders": 0, "bookings": 0, "latest": []})
        self.assertEqual(self.bell(self.admin.client)["unread"], 1)
        self.lead_for(self.co, "Visitor Later")
        data = self.bell(self.owner.client)
        self.assertEqual((data["unread"], data["latest"][0]["name"]), (1, "Visitor Later"))
        # Marking seen twice keeps one row.
        self.owner.client.post(self.bell_url(seen=True))
        self.assertEqual(LeadSeen.objects.filter(workspace_id=self.ws).count(), 1)

    def test_seen_is_kept_per_workspace(self):
        self.lead_for(self.co)
        mine = self.owner.ws
        self.assertEqual(self.owner.client.post(self.bell_url(mine, seen=True)).status_code, 204)
        self.assertEqual(self.bell(self.owner.client)["unread"], 1)

    def test_never_seen_is_capped_to_the_last_thirty_days(self):
        old = self.lead_for(self.co, "Visitor Old")
        Lead.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=31))
        recent = self.lead_for(self.co, "Visitor Recent")
        Lead.objects.filter(pk=recent.pk).update(created_at=timezone.now() - timedelta(days=29))
        data = self.bell(self.owner.client)
        self.assertEqual(data["unread"], 1)
        self.assertEqual(data["latest"][0]["name"], "Visitor Recent")

    def test_an_old_seen_marker_does_not_widen_the_window(self):
        old = self.lead_for(self.co, "Visitor Old")
        Lead.objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=40))
        LeadSeen.objects.create(user_id=self.owner.user["id"], workspace_id=self.ws, seen_at=timezone.now() - timedelta(days=90))
        self.assertEqual(self.bell(self.owner.client)["unread"], 0)

    def test_meeting_request_kind_and_card_name(self):
        lead = self.lead_for(self.co, "Visitor Meet")
        Lead.objects.filter(pk=lead.pk).update(source="meeting_request")
        item = self.bell(self.owner.client)["latest"][0]
        self.assertEqual(item["kind"], "meeting_request")
        self.assertEqual(item["source"], "meeting_request")
        self.assertTrue(item["card_name"])

    def test_one_query_for_the_seen_marker_and_one_for_the_list(self):
        self.lead_for(self.co)
        with self.assertNumQueries(6):  # user, member and workspace, seen marker, latest list, orders count, bookings count
            self.owner.client.get(self.bell_url())


class BellClosedWorkspaceTests(LeadBellCase):
    def test_suspended_company_is_closed(self):
        self.lead_for(self.co)
        Workspace.objects.filter(pk=self.ws).update(suspended_at=timezone.now())
        self.assertEqual(self.owner.client.get(self.bell_url()).status_code, 403)
        self.assertEqual(self.owner.client.post(self.bell_url(seen=True)).status_code, 403)

    def test_company_waiting_for_deletion_is_closed_even_to_the_owner(self):
        Workspace.objects.filter(pk=self.ws).update(deletion_due_at=timezone.now() + timedelta(days=5))
        for client in (self.owner.client, self.admin.client):
            res = client.get(self.bell_url())
            self.assertEqual(res.status_code, 403)
            self.assertEqual(res.data["error"]["code"] if "error" in res.data else res.data.get("code"), "workspace_pending_deletion")
