"""While a company waits to be deleted its contacts are closed; only the owner may still download them."""
from unittest import mock

from django.utils import timezone

from leads import webhooks
from leads.models import WebhookDelivery, WebhookEndpoint
from workspaces.models import Member

from .base import API
from .test_lead_workflow import LeadWorkflowCase


class LeadLockTests(LeadWorkflowCase):
    def setUp(self):
        super().setUp()
        self.lead = self.lead_for(self.eve)

    def lock(self):
        res = self.owner.client.post(
            f"{API}privacy/workspaces/{self.ws}/delete", {"confirm_name": "Acme Ltd", "password": self.password}, format="json"
        )
        self.assertEqual(res.status_code, 202, res.content)

    def test_everything_works_before_the_lock(self):
        for person in (self.owner, self.admin, self.eve):
            self.assertEqual(person.client.get(f"{API}workspaces/{self.ws}/leads").status_code, 200)
        self.assertEqual(self.owner.client.get(f"{API}leads/{self.lead.id}").status_code, 200)

    def test_nobody_reads_or_changes_contacts_while_locked(self):
        self.lock()
        for person in (self.owner, self.admin, self.eve):
            c = person.client
            self.assertEqual(c.get(f"{API}workspaces/{self.ws}/leads").status_code, 403, person)
            self.assertEqual(c.get(f"{API}leads/{self.lead.id}").status_code, 403, person)
            self.assertEqual(c.patch(f"{API}leads/{self.lead.id}", {"status": "won"}, format="json").status_code, 403)
            self.assertEqual(c.post(f"{API}leads/{self.lead.id}/notes", {"body": "x"}, format="json").status_code, 403)
            self.assertEqual(
                c.post(f"{API}workspaces/{self.ws}/leads/bulk", {"action": "status", "ids": [str(self.lead.id)], "status": "won"}, format="json").status_code,
                403,
            )
            self.assertEqual(c.get(f"{API}workspaces/{self.ws}/lead-assignees").status_code, 403)
            self.assertEqual(c.post(f"{API}workspaces/{self.ws}/leads", {"name": "New"}, format="json").status_code, 403)
        res = self.owner.client.get(f"{API}workspaces/{self.ws}/leads")
        self.assertEqual(res.data["error"]["code"], "workspace_pending_deletion")

    def test_only_the_owner_can_export_and_the_file_has_the_data(self):
        self.lock()
        self.assertEqual(self.admin.client.get(f"{API}workspaces/{self.ws}/leads.csv").status_code, 403)
        self.assertEqual(self.eve.client.get(f"{API}workspaces/{self.ws}/leads.csv").status_code, 403)
        res = self.owner.client.get(f"{API}workspaces/{self.ws}/leads.csv")
        self.assertEqual(res.status_code, 200)
        self.assertIn("Visitor One", b"".join(res.streaming_content if res.streaming else [res.content]).decode("utf-8"))

    def test_everything_returns_after_restore(self):
        self.lock()
        res = self.owner.client.post(f"{API}privacy/workspaces/{self.ws}/restore", {}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(self.admin.client.get(f"{API}workspaces/{self.ws}/leads").status_code, 200)
        self.assertEqual(self.eve.client.get(f"{API}leads/{self.lead.id}").status_code, 200)

    def test_webhooks_pause_while_locked_and_resume_after_restore(self):
        endpoint = WebhookEndpoint.objects.create(
            workspace_id=self.ws, url="https://hooks.example.com/in", secret="whsec_k", events=list(webhooks.EVENT_TYPES)
        )
        WebhookDelivery.objects.create(
            endpoint=endpoint, event_type="lead.created", payload={"id": "e1"}, next_attempt_at=timezone.now()
        )
        self.lock()
        with mock.patch.object(webhooks, "send_request", return_value=(200, "")) as send:
            webhooks.process_queue()
        send.assert_not_called()
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}/webhooks/{endpoint.id}/deliveries").status_code, 403)
        self.owner.client.post(f"{API}privacy/workspaces/{self.ws}/restore", {}, format="json")
        with mock.patch.object(webhooks, "send_request", return_value=(200, "")) as send:
            webhooks.process_queue()
        send.assert_called_once()


class InviteLockTests(LeadWorkflowCase):
    def test_invite_to_a_locked_company_is_dead(self):
        invited = self.invited("late@example.com")
        self.owner.client.post(
            f"{API}privacy/workspaces/{self.ws}/delete", {"confirm_name": "Acme Ltd", "password": self.password}, format="json"
        )
        from rest_framework.test import APIClient

        c = APIClient()
        self.assertEqual(c.get(f"{API}invites/{invited.token}").status_code, 410)
        res = c.post(f"{API}invites/{invited.token}/accept", {"password": "employee-pass-1", "full_name": "Late"}, format="json")
        self.assertEqual(res.status_code, 410)
        self.assertEqual(Member.objects.get(pk=invited.member_id).status, "invited")
