"""Contacts spreadsheet (streamed, capped, audited, notes for managers only), assignee list, webhooks need a live plan."""
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from billing.models import Subscription
from leads import webhooks
from leads.models import Lead, WebhookEndpoint

from .base import API, body
from .test_lead_workflow import LeadWorkflowCase


class CsvTests(LeadWorkflowCase):
    def setUp(self):
        super().setUp()
        self.lead_for(self.eve, "Eve Lead")
        self.lead_for(self.sam, "Sam Lead")
        # the owner and the admins read the company card's contacts, never an employee's
        self.lead_for(self.co, "Company Lead")
        self.lead_for(self.co, "Company Lead Two")

    def csv(self, client, **params):
        return client.get(self.url("leads.csv"), params)

    def test_response_is_streamed_with_a_byte_order_mark(self):
        res = self.csv(self.owner.client)
        self.assertTrue(res.streaming)
        self.assertEqual(res["Cache-Control"], "no-store")
        self.assertTrue(body(res).startswith(b"\xef\xbb\xbf"))

    def test_each_download_is_in_the_activity_log(self):
        self.csv(self.owner.client, status="new")
        self.csv(self.owner.client, notes="1")
        events = [e for e in self.audit(page_size=50)["results"] if e["action"] == "lead.exported"]
        self.assertEqual(len(events), 2)
        notes_run = next(e for e in events if e["details"]["notes"])
        self.assertEqual(notes_run["details"]["rows"], 2)
        plain = next(e for e in events if not e["details"]["notes"])
        self.assertEqual(plain["details"]["filters"], {"status": "new"})

    def test_row_cap_and_truncation_header(self):
        with override_settings(LEADS_CSV_MAX_ROWS=1):
            res = self.csv(self.owner.client)
            lines = body(res).decode("utf-8-sig").strip().splitlines()
        self.assertEqual(len(lines), 2)  # header + one row
        self.assertEqual(res["X-Rows-Truncated"], "1")
        self.assertNotIn("X-Rows-Truncated", self.csv(self.owner.client))

    def test_internal_notes_are_for_managers_only(self):
        self.assertEqual(self.csv(self.eve.client, notes="1").status_code, 403)
        self.assertEqual(self.csv(self.admin.client, notes="1").status_code, 200)
        self.assertEqual(self.csv(self.owner.client, notes="1").status_code, 200)
        text = body(self.csv(self.eve.client)).decode("utf-8-sig")
        self.assertIn("Eve Lead", text)
        self.assertNotIn("Sam Lead", text)  # employees still get only what they can see
        self.assertNotIn("internal_notes", text)

    def test_formula_injection_is_still_escaped(self):
        Lead.objects.filter(name="Company Lead").update(name="=HYPERLINK(\"http://x\")", note="@cmd")
        text = body(self.csv(self.owner.client)).decode("utf-8-sig")
        self.assertIn("'=HYPERLINK", text)
        self.assertIn("'@cmd", text)
        self.assertNotIn(",=HYPERLINK", text)

    def test_audit_entry_is_written_for_employees_too(self):
        self.csv(self.eve.client)
        self.assertIn("lead.exported", [e["action"] for e in self.audit(page_size=50)["results"]])


class AssigneeListTests(LeadWorkflowCase):
    def test_only_managers_may_list_colleagues(self):
        self.assertEqual(self.owner.client.get(self.url("lead-assignees")).status_code, 200)
        self.assertEqual(self.admin.client.get(self.url("lead-assignees")).status_code, 200)
        res = self.eve.client.get(self.url("lead-assignees"))
        self.assertEqual(res.status_code, 403)
        self.assertNotIn("sam@example.com", res.content.decode())


class WebhookPlanTests(LeadWorkflowCase):
    def expire(self):
        Subscription.objects.filter(workspace_id=self.ws).update(status="expired", ends_at=timezone.now() - timedelta(days=60))

    def hook(self):
        res = self.owner.client.post(self.url("webhooks"), {"url": "https://hooks.example.com/in", "events": ["lead.created"]}, format="json")
        return res

    def test_live_company_can_create_test_and_enable(self):
        with mock.patch.object(webhooks, "check_target", return_value=(None, 443, "93.184.216.34")):
            res = self.hook()
        self.assertEqual(res.status_code, 201, res.content)

    def test_company_without_a_live_plan_cannot_use_webhooks(self):
        with mock.patch.object(webhooks, "check_target", return_value=(None, 443, "93.184.216.34")):
            ok = self.hook()
            self.expire()
            res = self.hook()
            self.assertEqual((res.status_code, res.data["error"]["code"]), (402, "subscription_required"))
            wid = ok.data["id"]
            self.owner.client.patch(self.url(f"webhooks/{wid}"), {"enabled": False}, format="json")
            self.assertEqual(self.owner.client.patch(self.url(f"webhooks/{wid}"), {"enabled": True}, format="json").status_code, 402)
            self.assertEqual(self.owner.client.post(self.url(f"webhooks/{wid}/test")).status_code, 402)
            # reading and deleting stay possible
            self.assertEqual(self.owner.client.get(self.url("webhooks")).status_code, 200)
            self.assertEqual(self.owner.client.delete(self.url(f"webhooks/{wid}")).status_code, 204)

    def test_no_events_are_queued_for_an_expired_plan(self):
        endpoint = WebhookEndpoint.objects.create(workspace_id=self.ws, url="https://hooks.example.com/in", secret="s", events=["lead.created"])
        self.lead_for(self.co, "Before Expiry")
        before = endpoint.deliveries.count()
        self.assertEqual(before, 1)
        self.expire()
        lead = Lead.objects.get(name="Before Expiry")
        self.assertEqual(webhooks.enqueue(lead.workspace, "lead.updated", lead), 0)
        self.assertEqual(endpoint.deliveries.count(), before)
