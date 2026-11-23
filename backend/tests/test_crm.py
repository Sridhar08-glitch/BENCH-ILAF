"""CRM connectors with mocked vendor HTTP: HubSpot, Salesforce and Zoho CRM. No test reaches a real vendor."""
import logging
from datetime import timedelta
from urllib.parse import parse_qs, urlsplit
from unittest import mock

from django.core import mail, signing
from django.core.cache import cache
from django.core.management import call_command
from django.db import connection
from django.test import override_settings
from django.utils import timezone

from crm import crypto, http, sync
from crm.models import CrmConnection, CrmLeadLink, CrmSyncJob
from crm.vendors import HubSpot, Salesforce, Zoho, get_vendor
from leads import webhooks, workflow
from operations.models import AuditEvent

from .base import API
from .crm_base import CRM_SETTINGS, CrmTestCase, FakeServer, ok


def run_queue():
    return sync.process_queue()


def last_job():
    return CrmSyncJob.objects.order_by("-created_at").first()


# ---------------------------------------------------------------- encryption
class CryptoTests(CrmTestCase):
    def test_round_trip_and_tamper_checks(self):
        token = crypto.encrypt("super-secret-token")
        self.assertTrue(token.startswith(("h1:", "f1:")))
        self.assertNotIn("super-secret", token)
        self.assertEqual(crypto.decrypt(token), "super-secret-token")
        self.assertNotEqual(crypto.encrypt("super-secret-token"), token)  # a fresh nonce every time
        self.assertEqual(crypto.encrypt(""), "")
        broken = token[:-6] + ("AAAAAA" if not token.endswith("AAAAAA") else "BBBBBB")
        with self.assertRaises(crypto.CannotDecrypt):
            crypto.decrypt(broken)
        with self.assertRaises(crypto.CannotDecrypt):
            crypto.decrypt("garbage")

    def test_another_key_cannot_read_it(self):
        token = crypto.encrypt("abc")
        with override_settings(CRM_ENCRYPTION_KEY="a-completely-different-key-123456"):
            with self.assertRaises(crypto.CannotDecrypt):
                crypto.decrypt(token)

    def test_tokens_are_not_stored_in_clear(self):
        conn = self.connect_direct("hubspot")
        with connection.cursor() as cursor:
            for table in connection.introspection.table_names(cursor):
                for col in [c.name for c in connection.introspection.get_table_description(cursor, table)]:
                    cursor.execute(f'SELECT COUNT(*) FROM "{table}" WHERE CAST("{col}" AS TEXT) LIKE %s', ["%access-hubspot%"])
                    self.assertEqual(cursor.fetchone()[0], 0, f"{table}.{col}")
        self.assertEqual(crypto.decrypt(conn.access_token), "access-hubspot")

    def test_an_unreadable_token_switches_the_connection_off(self):
        conn = self.connect_direct("hubspot")
        with override_settings(CRM_ENCRYPTION_KEY="rotated-key-that-is-long-enough-1234"):
            self.make_lead()
            run_queue()
        conn.refresh_from_db()
        self.assertEqual((conn.status, conn.disabled_reason), ("disabled", "crm_token_unreadable"))


# ---------------------------------------------------------------- the outbound allow-list
class AllowListTests(CrmTestCase):
    def test_vendor_host_rules(self):
        self.assertTrue(HubSpot().host_ok()("api.hubapi.com"))
        self.assertFalse(HubSpot().host_ok()("evil.example.com"))
        self.assertFalse(HubSpot().host_ok()("api.hubapi.com.evil.com"))
        conn = self.connect_direct("salesforce")
        ok_sf = Salesforce().host_ok(conn)
        self.assertTrue(ok_sf("acme.my.salesforce.com"))
        self.assertTrue(ok_sf("login.salesforce.com"))
        self.assertFalse(ok_sf("other.my.salesforce.com"))  # only this org's own address
        self.assertFalse(ok_sf("salesforce.com.evil.io"))
        zoho = Zoho().host_ok()
        self.assertTrue(zoho("accounts.zoho.eu"))
        self.assertTrue(zoho("www.zohoapis.in"))
        self.assertFalse(zoho("accounts.zoho.cn"))
        self.assertFalse(zoho("zohoapis.com.evil.com"))

    def test_real_call_refuses_other_hosts_plain_http_and_private_addresses(self):
        with mock.patch("crm.http.call", http_call_original):
            rule = HubSpot().host_ok()
            with self.assertRaises(http.BlockedHost):
                http.call("GET", "https://evil.example.com/x", rule)
            with self.assertRaises(http.BlockedHost):
                http.call("GET", "http://api.hubapi.com/x", rule)
            with self.assertRaises(http.BlockedHost):
                http.call("GET", "https://user:pw@api.hubapi.com/x", rule)
            # an allowed name that points at a private address (DNS rebinding) is refused too
            with mock.patch("leads.webhooks.resolve_host", return_value=["127.0.0.1"]):
                with self.assertRaises(http.BlockedHost):
                    http.call("GET", "https://api.hubapi.com/x", rule)

    def test_instance_addresses_from_the_vendor_are_checked(self):
        sf = Salesforce()
        self.assertTrue(sf.valid_instance("https://acme.my.salesforce.com"))
        self.assertFalse(sf.valid_instance("https://evil.example.com"))
        self.assertFalse(sf.valid_instance("http://acme.my.salesforce.com"))
        self.assertFalse(sf.valid_instance("https://acme.my.salesforce.com/extra"))
        self.assertTrue(Zoho().valid_api("https://www.zohoapis.eu"))
        self.assertFalse(Zoho().valid_api("https://www.zohoapis.evil.com"))


http_call_original = http.call


# ---------------------------------------------------------------- HubSpot
class HubSpotTests(CrmTestCase):
    def setUp(self):
        super().setUp()
        self.conn = self.connect_direct("hubspot")
        self.server.add("POST", "/crm/v3/objects/contacts/search", ok({"results": []}))
        self.server.add("POST", "/crm/v3/objects/contacts", ok({"id": "501"}, 201))
        self.server.add("POST", "/crm/v3/objects/notes", ok({"id": "n1"}, 201))

    def test_a_new_lead_creates_a_contact_and_a_note(self):
        lead = self.make_lead()
        stats = run_queue()
        self.assertEqual(stats["sent"], 1)
        create = self.server.find("POST", "/crm/v3/objects/contacts")[-1]
        self.assertEqual(create["json"]["properties"], {
            "firstname": "Lena", "lastname": "Lead", "email": "lena@example.com", "phone": "+97455550000", "company": "Lena Ltd",
        })
        self.assertEqual(create["headers"]["Authorization"], "Bearer access-hubspot")
        note = self.server.find("POST", "/crm/v3/objects/notes")[0]["json"]
        self.assertIn("Please call me", note["properties"]["hs_note_body"])
        self.assertEqual(note["associations"][0]["to"]["id"], "501")
        job = last_job()
        self.assertEqual((job.status, job.remote_id, job.action), ("success", "501", "created"))
        self.assertEqual(CrmLeadLink.objects.get(lead_id=lead.id).remote_id, "501")
        self.conn.refresh_from_db()
        self.assertIsNotNone(self.conn.last_success_at)
        self.assertEqual(self.conn.consecutive_failures, 0)

    def test_an_existing_contact_is_updated_not_duplicated(self):
        self.server.routes[0][2] = ok({"results": [{"id": "77"}]})
        self.server.add("PATCH", "/crm/v3/objects/contacts/77", ok({"id": "77"}))
        self.make_lead()
        run_queue()
        self.assertEqual(self.server.find("POST", "/crm/v3/objects/contacts"), [c for c in self.server.calls if c["url"].endswith("/search")])
        self.assertEqual(len(self.server.find("PATCH", "/contacts/77")), 1)
        self.assertEqual(last_job().action, "updated")
        search = self.server.find("POST", "/search")[0]["json"]
        self.assertEqual(search["filterGroups"][0]["filters"][0]["value"], "lena@example.com")

    def test_two_leads_with_the_same_email_make_one_contact(self):
        state = {"made": False}

        def search(call):
            return ok({"results": [{"id": "501"}] if state["made"] else []})

        def create(call):
            state["made"] = True
            return ok({"id": "501"}, 201)

        self.server.routes = [r for r in self.server.routes if r[1] != "/crm/v3/objects/contacts/search" and r[1] != "/crm/v3/objects/contacts"]
        self.server.routes.insert(0, ["POST", "/crm/v3/objects/contacts/search", search])
        self.server.routes.insert(1, ["POST", "/crm/v3/objects/contacts", create])
        self.server.add("PATCH", "/crm/v3/objects/contacts/501", ok({"id": "501"}))
        self.make_lead(note="first")
        self.make_lead(note="second")
        run_queue()
        creates = [c for c in self.server.find("POST", "/crm/v3/objects/contacts") if not c["url"].endswith("/search")]
        self.assertEqual(len(creates), 1)
        self.assertEqual(len(self.server.find("PATCH", "/contacts/501")), 1)
        self.assertEqual(len(self.server.find("POST", "/objects/notes")), 2)  # one note per lead

    def test_custom_mapping_and_skipped_fields(self):
        self.conn.field_mapping = {"phone": "mobilephone", "company": "", "message": "lead_message"}
        self.conn.save()
        self.make_lead()
        run_queue()
        props = self.server.find("POST", "/crm/v3/objects/contacts")[-1]["json"]["properties"]
        self.assertEqual(props["mobilephone"], "+97455550000")
        self.assertEqual(props["lead_message"], "Please call me")
        self.assertNotIn("company", props)
        self.assertNotIn("phone", props)

    def test_owner_assignment_by_email(self):
        self.conn.options = {**sync.conn_settings(self.conn), "assign_owner": True}
        self.conn.save()
        self.server.add("GET", "/crm/v3/owners", lambda c: ok({"results": [{"id": "9001"}]}))
        self.make_lead()
        run_queue()
        self.assertEqual(self.server.find("GET", "/crm/v3/owners")[0]["params"]["email"], "owner@example.com")
        self.assertEqual(self.server.find("POST", "/crm/v3/objects/contacts")[-1]["json"]["properties"]["hubspot_owner_id"], "9001")

    def test_owner_not_found_is_not_an_error(self):
        self.conn.options = {**sync.conn_settings(self.conn), "assign_owner": True}
        self.conn.save()
        self.server.add("GET", "/crm/v3/owners", ok({"results": []}))
        self.make_lead()
        run_queue()
        self.assertEqual(last_job().status, "success")
        self.assertNotIn("hubspot_owner_id", self.server.find("POST", "/crm/v3/objects/contacts")[-1]["json"]["properties"])

    def test_status_changes_are_sent_when_switched_on(self):
        self.conn.options = {**sync.conn_settings(self.conn), "sync_status": True}
        self.conn.save()
        self.server.add("PATCH", "/crm/v3/objects/contacts/501", ok({"id": "501"}))
        lead = self.make_lead()
        run_queue()
        self.assertEqual(self.server.find("POST", "/crm/v3/objects/contacts")[-1]["json"]["properties"]["hs_lead_status"], "NEW")
        workflow.set_status(None, lead, "qualified", self.owner_user())
        stats = run_queue()
        self.assertEqual(stats["sent"], 1)
        patch = self.server.find("PATCH", "/contacts/501")[-1]["json"]
        self.assertEqual(patch, {"properties": {"hs_lead_status": "OPEN"}})

    def owner_user(self):
        from accounts.models import User

        return User.objects.get(email="owner@example.com")

    def test_status_changes_are_not_sent_by_default(self):
        lead = self.make_lead()
        run_queue()
        workflow.set_status(None, lead, "won", self.owner_user())
        self.assertEqual(run_queue()["sent"], 0)
        self.assertEqual(CrmSyncJob.objects.count(), 1)

    def test_new_leads_can_be_switched_off(self):
        self.conn.options = {**sync.conn_settings(self.conn), "sync_new_leads": False}
        self.conn.save()
        self.make_lead()
        self.assertEqual(CrmSyncJob.objects.count(), 0)

    def test_note_can_be_switched_off(self):
        self.conn.options = {**sync.conn_settings(self.conn), "add_note": False}
        self.conn.save()
        self.make_lead()
        run_queue()
        self.assertEqual(self.server.find("POST", "/objects/notes"), [])

    def test_expired_token_is_refreshed_first(self):
        CrmConnection.objects.filter(pk=self.conn.pk).update(token_expires_at=timezone.now() - timedelta(minutes=1))
        self.server.add("POST", "/oauth/v1/token", ok({"access_token": "fresh-access", "refresh_token": "fresh-refresh", "expires_in": 1800}))
        self.make_lead()
        run_queue()
        form = self.server.find("POST", "/oauth/v1/token")[0]["form"]
        self.assertEqual((form["grant_type"], form["refresh_token"], form["client_id"], form["client_secret"]), ("refresh_token", "refresh-hubspot", "hs-id", "hs-secret"))
        self.assertEqual(self.server.find("POST", "/search")[0]["headers"]["Authorization"], "Bearer fresh-access")
        self.conn.refresh_from_db()
        self.assertEqual(crypto.decrypt(self.conn.access_token), "fresh-access")
        self.assertEqual(crypto.decrypt(self.conn.refresh_token), "fresh-refresh")
        self.assertGreater(self.conn.token_expires_at, timezone.now() + timedelta(minutes=20))

    def test_a_401_triggers_one_refresh_and_a_retry(self):
        self.server.routes[0][2] = [ok({"message": "expired"}, 401), ok({"results": []})]
        self.server.add("POST", "/oauth/v1/token", ok({"access_token": "fresh-access", "expires_in": 1800}))
        self.make_lead()
        run_queue()
        self.assertEqual(last_job().status, "success")
        self.assertEqual(len(self.server.find("POST", "/oauth/v1/token")), 1)
        self.assertEqual(self.server.find("POST", "/search")[-1]["headers"]["Authorization"], "Bearer fresh-access")

    def test_a_revoked_connection_is_disabled_and_the_admins_are_told(self):
        self.server.routes[0][2] = ok({"message": "expired"}, 401)
        self.server.add("POST", "/oauth/v1/token", ok({"error": "invalid_grant", "error_description": "refresh token revoked"}, 400))
        ada = self.add("ada@acme.test", "Ada Admin", role="admin")
        self.add("eve@acme.test", "Eve Employee")
        mail.outbox.clear()
        self.make_lead()
        run_queue()
        self.conn.refresh_from_db()
        self.assertEqual((self.conn.status, self.conn.disabled_reason), ("disabled", "crm_auth_revoked"))
        recipients = {m.to[0] for m in mail.outbox}
        self.assertEqual(recipients, {"owner@example.com", "ada@acme.test"})
        self.assertIn("HubSpot stopped syncing your contacts", mail.outbox[0].subject)
        self.assertEqual(last_job().status, "pending")  # kept for after reconnecting
        event = AuditEvent.objects.get(action="crm.disabled")
        self.assertEqual(event.details["vendor"], "hubspot")
        # a disabled connection is skipped and gets no new jobs
        before = len(self.server.calls)
        self.make_lead(email="two@example.com")
        run_queue()
        self.assertEqual(len(self.server.calls), before)
        self.assertEqual(CrmSyncJob.objects.count(), 1)
        mail.outbox.clear()
        sync.disable(self.conn, "crm_auth_revoked")  # already off: no second e-mail
        self.assertEqual(mail.outbox, [])

    def test_rate_limit_waits_and_pauses_the_connection(self):
        self.server.routes[0][2] = ok({"message": "slow down"}, 429, {"retry-after": "120"})
        a, b = self.make_lead(email="a@example.com"), self.make_lead(email="b@example.com")
        stats = run_queue()
        self.assertEqual(stats["retry"], 1)  # the second one is not even tried
        job = CrmSyncJob.objects.get(lead_id=a.id)
        self.assertEqual((job.status, job.error_code), ("pending", "crm_rate_limited"))
        self.assertGreater(job.next_attempt_at, timezone.now() + timedelta(seconds=100))
        self.assertEqual(len(self.server.find("POST", "/search")), 1)
        self.assertEqual(self.conn.status, "connected")

    def test_server_errors_back_off_and_eventually_fail(self):
        self.server.routes[0][2] = ok({"message": "boom"}, 502)
        self.make_lead()
        run_queue()
        job = last_job()
        self.assertEqual((job.status, job.attempts, job.error_code), ("pending", 1, "crm_unavailable"))
        self.assertGreater(job.next_attempt_at, timezone.now() + timedelta(seconds=50))
        for n in range(2, sync.MAX_ATTEMPTS + 1):
            CrmSyncJob.objects.filter(pk=job.pk).update(next_attempt_at=timezone.now() - timedelta(seconds=1), locked_until=None)
            run_queue()
        job.refresh_from_db()
        self.assertEqual((job.status, job.attempts), ("failed", sync.MAX_ATTEMPTS))
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.consecutive_failures, sync.MAX_ATTEMPTS)

    def test_a_refused_contact_fails_at_once_and_shows_the_reason(self):
        self.server.routes[0][2] = ok({"message": "Property \"phone\" does not exist"}, 400)
        self.make_lead()
        run_queue()
        job = last_job()
        self.assertEqual((job.status, job.attempts, job.error_code), ("failed", 1, "crm_rejected"))
        self.assertIn("phone", job.error)
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.last_error_code, "crm_rejected")
        self.assertEqual(self.conn.status, "connected")

    def test_a_missing_permission_is_reported(self):
        self.server.routes[0][2] = ok({"message": "missing scope"}, 403)
        self.make_lead()
        run_queue()
        self.assertEqual(last_job().error_code, "crm_forbidden")

    def test_a_create_conflict_is_retried_and_then_finds_the_contact(self):
        self.server.routes[1][2] = ok({"message": "Contact already exists"}, 409)
        self.make_lead()
        run_queue()
        self.assertEqual((last_job().status, last_job().error_code), ("pending", "crm_unavailable"))

    def test_nothing_secret_is_logged(self):
        self.server.routes[0][2] = ok({"message": "boom"}, 500)
        with self.assertNoLogs(level="WARNING"):
            self.make_lead()
            run_queue()
        job = last_job()
        self.assertNotIn("access-hubspot", job.error + str(job.payload))

    def test_leads_of_a_company_waiting_for_deletion_are_held(self):
        self.make_lead()
        self.workspace.deletion_due_at = timezone.now() + timedelta(days=5)
        self.workspace.save()
        self.assertEqual(run_queue()["sent"], 0)

    def test_the_sync_command_sends_the_queue(self):
        self.make_lead()
        from io import StringIO

        out = StringIO()
        call_command("sync_crm", stdout=out)
        self.assertIn("Sent 1", out.getvalue())
        self.assertEqual(last_job().status, "success")

    def test_a_crash_in_the_hook_never_loses_a_lead(self):
        with mock.patch("crm.sync.on_lead_event", side_effect=RuntimeError("x")):
            # the webhook queue calls the hook inside its own guard
            lead = self.make_lead()
        self.assertTrue(type(lead).objects.filter(pk=lead.pk).exists())

    def test_backfill_queues_the_last_30_days_once(self):
        old = self.make_lead(email="old@example.com")
        type(old).objects.filter(pk=old.pk).update(created_at=timezone.now() - timedelta(days=45))
        self.make_lead(email="new@example.com")
        CrmSyncJob.objects.all().delete()
        CrmLeadLink.objects.all().delete()
        self.assertEqual(sync.queue_backfill(self.conn), 1)
        self.assertEqual(sync.queue_backfill(self.conn), 0)  # already waiting
        run_queue()
        self.assertEqual(sync.queue_backfill(self.conn), 0)  # already sent


# ---------------------------------------------------------------- Salesforce
class SalesforceTests(CrmTestCase):
    def setUp(self):
        super().setUp()
        self.conn = self.connect_direct("salesforce")
        self.records = {"Lead": [], "Contact": [], "User": []}

        def query(call):
            q = call["params"]["q"]
            for name in ("Lead", "Contact", "User"):
                if f"FROM {name} " in q:
                    return ok({"records": self.records[name]})
            raise AssertionError(q)

        self.server.add("GET", "/query", query)
        self.server.add("POST", "/sobjects/Lead", ok({"id": "00Q1", "success": True}, 201))
        self.server.add("POST", "/sobjects/Task", ok({"id": "00T1"}, 201))

    def test_a_new_lead_becomes_a_salesforce_lead_with_a_task(self):
        self.make_lead()
        run_queue()
        body = self.server.find("POST", "/sobjects/Lead")[0]["json"]
        self.assertEqual(body, {
            "FirstName": "Lena", "LastName": "Lead", "Email": "lena@example.com", "Phone": "+97455550000",
            "Company": "Lena Ltd", "Description": "Please call me",
        })
        task = self.server.find("POST", "/sobjects/Task")[0]["json"]
        self.assertEqual((task["WhoId"], task["Status"]), ("00Q1", "Completed"))
        self.assertIn("Please call me", task["Description"])
        self.assertTrue(self.server.calls[0]["url"].startswith("https://acme.my.salesforce.com/services/data/"))
        self.assertEqual(last_job().action, "created")

    def test_required_fields_get_safe_defaults(self):
        self.conn.field_mapping = {"last_name": "", "company": ""}
        self.conn.save()
        self.make_lead(name="Madonna", company="")
        run_queue()
        body = self.server.find("POST", "/sobjects/Lead")[0]["json"]
        self.assertEqual((body["LastName"], body["Company"]), ("Madonna", "[not provided]"))

    def test_an_open_lead_with_the_same_email_is_updated(self):
        self.records["Lead"] = [{"Id": "00Q9"}]
        self.server.add("PATCH", "/sobjects/Lead/00Q9", ok(None, 204))
        self.make_lead()
        run_queue()
        self.assertEqual(self.server.find("POST", "/sobjects/Lead"), [])
        patch = self.server.find("PATCH", "/sobjects/Lead/00Q9")[0]["json"]
        self.assertEqual(patch["Email"], "lena@example.com")
        self.assertEqual(last_job().action, "updated")

    def test_an_existing_contact_is_never_duplicated_or_overwritten(self):
        self.records["Contact"] = [{"Id": "003A"}]
        self.make_lead()
        run_queue()
        self.assertEqual(self.server.find("POST", "/sobjects/Lead"), [])
        self.assertEqual(self.server.find("PATCH", "/sobjects"), [])
        self.assertEqual(self.server.find("POST", "/sobjects/Task")[0]["json"]["WhoId"], "003A")

    def test_the_email_is_escaped_in_the_query(self):
        self.make_lead(email="o'brien@example.com")
        run_queue()
        query = self.server.find("GET", "/query")[0]["params"]["q"]
        self.assertIn("'o\\'brien@example.com'", query)
        self.make_lead(email="x' OR Name != '")
        run_queue()
        queries = [c["params"]["q"] for c in self.server.find("GET", "/query")]
        self.assertTrue(any("x\\' or name != \\'" in q for q in queries))

    def test_owner_by_email_and_status(self):
        self.conn.options = {**sync.conn_settings(self.conn), "assign_owner": True, "sync_status": True}
        self.conn.save()
        self.records["User"] = [{"Id": "005U"}]
        self.make_lead()
        run_queue()
        body = self.server.find("POST", "/sobjects/Lead")[0]["json"]
        self.assertEqual((body["OwnerId"], body["Status"]), ("005U", "Open - Not Contacted"))

    def test_expired_session_refreshes_and_retries(self):
        self.server.routes[0][2] = [ok([{"errorCode": "INVALID_SESSION_ID", "message": "Session expired"}], 401), ok({"records": []})]
        self.server.add("POST", "/services/oauth2/token", ok({"access_token": "sf-new", "instance_url": "https://acme.my.salesforce.com"}))
        self.make_lead()
        run_queue()
        self.assertEqual(last_job().status, "success")
        form = self.server.find("POST", "/services/oauth2/token")[0]["form"]
        self.assertEqual((form["grant_type"], form["client_id"]), ("refresh_token", "sf-id"))
        self.conn.refresh_from_db()
        self.assertEqual(crypto.decrypt(self.conn.access_token), "sf-new")
        self.assertEqual(crypto.decrypt(self.conn.refresh_token), "refresh-salesforce")  # not replaced when the answer has none

    def test_daily_api_limit_is_a_rate_limit(self):
        self.server.routes[0][2] = ok([{"errorCode": "REQUEST_LIMIT_EXCEEDED", "message": "TotalRequests Limit exceeded."}], 403)
        self.make_lead()
        run_queue()
        job = last_job()
        self.assertEqual((job.status, job.error_code), ("pending", "crm_rate_limited"))

    def test_a_revoked_grant_disables_the_connection(self):
        self.server.routes[0][2] = ok([{"errorCode": "INVALID_SESSION_ID", "message": "x"}], 401)
        self.server.add("POST", "/services/oauth2/token", ok({"error": "invalid_grant", "error_description": "expired access/refresh token"}, 400))
        mail.outbox.clear()
        self.make_lead()
        run_queue()
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.status, "disabled")
        self.assertIn("Salesforce stopped syncing", mail.outbox[0].subject)

    def test_a_field_error_from_salesforce_is_shown(self):
        self.server.routes[1][2] = ok([{"errorCode": "REQUIRED_FIELD_MISSING", "message": "Required fields are missing: [Company]"}], 400)
        self.make_lead()
        run_queue()
        job = last_job()
        self.assertEqual((job.status, job.error_code), ("failed", "crm_rejected"))
        self.assertIn("Company", job.error)

    def test_other_salesforce_orgs_are_unreachable(self):
        CrmConnection.objects.filter(pk=self.conn.pk).update(instance_url="https://evil.example.com")
        self.make_lead()
        run_queue()
        self.assertEqual(last_job().error_code, "crm_rejected")
        self.assertEqual(self.server.calls, [])


# ---------------------------------------------------------------- Zoho
class ZohoTests(CrmTestCase):
    def setUp(self):
        super().setUp()
        self.conn = self.connect_direct("zoho")
        self.server.add("POST", "/Leads/upsert", ok({"data": [{"code": "SUCCESS", "status": "success", "action": "insert", "details": {"id": "z100"}}]}, 201))
        self.server.add("POST", "/crm/v6/Notes", ok({"data": [{"code": "SUCCESS", "status": "success", "details": {"id": "n1"}}]}, 201))

    def test_a_new_lead_is_upserted_by_email_with_a_note(self):
        self.make_lead()
        run_queue()
        call = self.server.find("POST", "/Leads/upsert")[0]
        self.assertEqual(call["json"]["duplicate_check_fields"], ["Email"])
        row = call["json"]["data"][0]
        self.assertEqual((row["First_Name"], row["Last_Name"], row["Email"], row["Company"], row["Description"]), ("Lena", "Lead", "lena@example.com", "Lena Ltd", "Please call me"))
        self.assertEqual(call["headers"]["Authorization"], "Zoho-oauthtoken access-zoho")
        self.assertTrue(call["url"].startswith("https://www.zohoapis.com/crm/v6/"))
        note = self.server.find("POST", "/crm/v6/Notes")[0]["json"]["data"][0]
        self.assertEqual(note["Parent_Id"], {"module": {"api_name": "Leads"}, "id": "z100"})
        self.assertEqual((last_job().action, last_job().remote_id), ("created", "z100"))

    def test_an_update_is_reported_as_updated(self):
        self.server.routes[0][2] = ok({"data": [{"code": "SUCCESS", "status": "success", "action": "update", "details": {"id": "z7"}}]})
        self.make_lead()
        run_queue()
        self.assertEqual((last_job().action, last_job().remote_id), ("updated", "z7"))

    def test_a_row_error_inside_a_200_answer_is_a_failure(self):
        self.server.routes[0][2] = ok({"data": [{"code": "INVALID_DATA", "status": "error", "message": "invalid data", "details": {"api_name": "Phone"}}]})
        self.make_lead()
        run_queue()
        job = last_job()
        self.assertEqual((job.status, job.error_code), ("failed", "crm_rejected"))
        self.assertIn("invalid data", job.error)

    def test_lead_without_email_is_created_plainly(self):
        self.server.add("POST", "/crm/v6/Leads", ok({"data": [{"code": "SUCCESS", "status": "success", "details": {"id": "z5"}}]}, 201))
        self.server.routes.insert(0, self.server.routes.pop())  # the plain route must win over the upsert fragment test
        self.make_lead(email="")
        run_queue()
        self.assertEqual(last_job().status, "success")
        self.assertEqual(self.server.find("POST", "/Leads/upsert"), [])

    def test_owner_and_status(self):
        self.conn.options = {**sync.conn_settings(self.conn), "assign_owner": True, "sync_status": True}
        self.conn.save()
        self.server.add("GET", "/crm/v6/users/search", ok({"users": [{"id": "u55"}]}))
        self.make_lead()
        run_queue()
        row = self.server.find("POST", "/Leads/upsert")[0]["json"]["data"][0]
        self.assertEqual((row["Owner"], row["Lead_Status"]), ({"id": "u55"}, "Not Contacted"))

    def test_status_update_uses_the_saved_link(self):
        self.conn.options = {**sync.conn_settings(self.conn), "sync_status": True}
        self.conn.save()
        self.server.add("PUT", "/crm/v6/Leads/z100", ok({"data": [{"code": "SUCCESS", "status": "success", "details": {"id": "z100"}}]}))
        lead = self.make_lead()
        run_queue()
        workflow.set_status(None, lead, "lost", __import__("accounts.models", fromlist=["User"]).User.objects.get(email="owner@example.com"))
        run_queue()
        self.assertEqual(self.server.find("PUT", "/Leads/z100")[0]["json"], {"data": [{"Lead_Status": "Lost Lead"}]})

    def test_token_refresh_uses_the_accounts_server_of_the_region(self):
        CrmConnection.objects.filter(pk=self.conn.pk).update(token_expires_at=timezone.now() - timedelta(seconds=5), region="eu", instance_url="https://www.zohoapis.eu")
        self.server.add("POST", "accounts.zoho.eu/oauth/v2/token", ok({"access_token": "z-new", "expires_in": 3600}))
        self.make_lead()
        run_queue()
        self.assertEqual(len(self.server.find("POST", "https://accounts.zoho.eu/oauth/v2/token")), 1)
        self.assertEqual(self.server.find("POST", "/Leads/upsert")[0]["headers"]["Authorization"], "Zoho-oauthtoken z-new")
        self.assertTrue(self.server.find("POST", "/Leads/upsert")[0]["url"].startswith("https://www.zohoapis.eu/"))

    def test_revoked_refresh_token(self):
        CrmConnection.objects.filter(pk=self.conn.pk).update(token_expires_at=timezone.now() - timedelta(seconds=5))
        self.server.add("POST", "/oauth/v2/token", ok({"error": "invalid_code"}))
        mail.outbox.clear()
        self.make_lead()
        run_queue()
        self.conn.refresh_from_db()
        self.assertEqual(self.conn.status, "disabled")
        self.assertIn("Zoho CRM stopped syncing", mail.outbox[0].subject)

    def test_zoho_rate_limit(self):
        self.server.routes[0][2] = ok({"code": "TOO_MANY_REQUESTS", "message": "too many"}, 429)
        self.make_lead()
        run_queue()
        self.assertEqual(last_job().error_code, "crm_rate_limited")


# ---------------------------------------------------------------- connecting, disconnecting and the settings page
class ConnectFlowTests(CrmTestCase):
    def url(self, path=""):
        return f"{API}workspaces/{self.ws}/crm{path}"

    def authorize(self, vendor, **body):
        res = self.owner.client.post(self.url(f"/{vendor}/connect"), body, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        parts = urlsplit(res.data["authorize_url"])
        return parts, {k: v[0] for k, v in parse_qs(parts.query).items()}

    def callback(self, vendor, state, code="the-code", **extra):
        from rest_framework.test import APIClient

        return APIClient().get(f"{API}crm/callback/{vendor}", {"code": code, "state": state, **extra})

    def test_overview_lists_the_vendors_and_what_is_available(self):
        res = self.owner.client.get(self.url())
        self.assertEqual(res.status_code, 200)
        vendors = {v["vendor"]: v for v in res.data["vendors"]}
        self.assertEqual(set(vendors), {"hubspot", "salesforce", "zoho"})
        self.assertTrue(all(v["available"] for v in vendors.values()))
        self.assertEqual(vendors["zoho"]["regions"], ["com", "eu", "in"])
        self.assertTrue(vendors["hubspot"]["redirect_uri"].endswith("/api/v1/crm/callback/hubspot"))
        self.assertEqual(vendors["hubspot"]["defaults"]["mapping"]["first_name"], "firstname")
        self.assertIsNone(vendors["hubspot"]["connection"])

    @override_settings(HUBSPOT_CLIENT_ID="", HUBSPOT_CLIENT_SECRET="")
    def test_a_vendor_without_server_credentials_is_unavailable_and_nothing_breaks(self):
        res = self.owner.client.get(self.url())
        vendors = {v["vendor"]: v for v in res.data["vendors"]}
        self.assertFalse(vendors["hubspot"]["available"])
        self.assertTrue(vendors["zoho"]["available"])
        res = self.owner.client.post(self.url("/hubspot/connect"), {}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "crm_not_configured"))

    def test_only_owner_and_admin_may_use_it(self):
        eve = self.add("eve@acme.test", "Eve Employee")
        self.assertEqual(eve.client.get(self.url()).status_code, 403)
        self.assertEqual(eve.client.post(self.url("/hubspot/connect"), {}, format="json").status_code, 403)
        ada = self.add("ada@acme.test", "Ada Admin", role="admin")
        self.assertEqual(ada.client.get(self.url()).status_code, 200)

    def test_personal_workspaces_have_no_crm(self):
        person = self.signup("solo@example.com", "Solo")
        self.assertEqual(person.client.get(f"{API}workspaces/{person.ws}/crm").status_code, 400)

    def test_connect_builds_the_vendor_sign_in_address(self):
        parts, q = self.authorize("hubspot")
        self.assertEqual((parts.netloc, parts.path), ("app.hubspot.com", "/oauth/authorize"))
        self.assertEqual(q["client_id"], "hs-id")
        self.assertEqual(q["redirect_uri"], "https://api.test/api/v1/crm/callback/hubspot")
        self.assertIn("crm.objects.contacts.write", q["scope"])
        self.assertNotIn("hs-secret", str(q))
        parts, q = self.authorize("salesforce")
        self.assertEqual((parts.netloc, parts.path), ("login.salesforce.com", "/services/oauth2/authorize"))
        self.assertEqual(q["scope"], "api refresh_token")
        parts, q = self.authorize("zoho", region="eu")
        self.assertEqual(parts.netloc, "accounts.zoho.eu")
        self.assertEqual((q["access_type"], q["prompt"]), ("offline", "consent"))
        self.assertIn("ZohoCRM.modules.leads.ALL", q["scope"])

    def test_zoho_needs_a_valid_region(self):
        res = self.owner.client.post(self.url("/zoho/connect"), {"region": "cn"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.owner.client.post(self.url("/zoho/connect"), {}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_unknown_vendor(self):
        self.assertEqual(self.owner.client.post(self.url("/pipedrive/connect"), {}, format="json").status_code, 404)

    def test_a_full_hubspot_connection(self):
        self.server.add("POST", "/oauth/v1/token", ok({"access_token": "ACC-1", "refresh_token": "REF-1", "expires_in": 1800}))
        self.server.add("GET", "/oauth/v1/access-tokens/", ok({"hub_domain": "acme.hubspot.com"}))
        _, q = self.authorize("hubspot")
        res = self.callback("hubspot", q["state"])
        self.assertEqual(res.status_code, 302)
        self.assertEqual(res["Location"], "https://web.test/app/settings/integrations?crm=hubspot&crm_status=connected")
        form = self.server.find("POST", "/oauth/v1/token")[0]["form"]
        self.assertEqual((form["grant_type"], form["code"], form["redirect_uri"]), ("authorization_code", "the-code", "https://api.test/api/v1/crm/callback/hubspot"))
        conn = CrmConnection.objects.get(workspace=self.workspace, vendor="hubspot")
        self.assertEqual((conn.status, conn.account_label), ("connected", "acme.hubspot.com"))
        self.assertEqual((crypto.decrypt(conn.access_token), crypto.decrypt(conn.refresh_token)), ("ACC-1", "REF-1"))
        self.assertNotIn("ACC-1", conn.access_token)
        event = AuditEvent.objects.get(action="crm.connected")
        self.assertEqual(event.actor.email, "owner@example.com")
        shown = self.owner.client.get(self.url()).data["vendors"][0]["connection"]
        self.assertEqual((shown["status"], shown["health"], shown["account"]), ("connected", "ok", "acme.hubspot.com"))
        self.assertNotIn("ACC-1", str(shown))
        self.assertNotIn("access_token", shown)

    def test_salesforce_connection_rejects_a_foreign_instance_address(self):
        self.server.add("POST", "/services/oauth2/token", ok({"access_token": "A", "refresh_token": "R", "instance_url": "https://evil.example.com"}))
        _, q = self.authorize("salesforce")
        res = self.callback("salesforce", q["state"])
        self.assertIn("crm_code=crm_oauth_failed", res["Location"])
        self.assertFalse(CrmConnection.objects.exists())

    def test_salesforce_and_zoho_store_their_addresses(self):
        self.server.add("POST", "/services/oauth2/token", ok({"access_token": "A", "refresh_token": "R", "instance_url": "https://acme.my.salesforce.com", "id": "x"}))
        _, q = self.authorize("salesforce")
        self.callback("salesforce", q["state"])
        self.assertEqual(CrmConnection.objects.get(vendor="salesforce").instance_url, "https://acme.my.salesforce.com")
        self.server.add("POST", "accounts.zoho.eu/oauth/v2/token", ok({"access_token": "A", "refresh_token": "R", "api_domain": "https://www.zohoapis.eu", "expires_in": 3600}))
        _, q = self.authorize("zoho", region="eu")
        self.callback("zoho", q["state"])
        zoho = CrmConnection.objects.get(vendor="zoho")
        self.assertEqual((zoho.region, zoho.instance_url), ("eu", "https://www.zohoapis.eu"))

    def test_bad_state_is_refused(self):
        res = self.callback("hubspot", "garbage")
        self.assertIn("crm_code=crm_invalid_state", res["Location"])
        self.assertFalse(CrmConnection.objects.exists())

    def test_a_state_works_once(self):
        self.server.add("POST", "/oauth/v1/token", ok({"access_token": "A", "refresh_token": "R", "expires_in": 100}))
        self.server.add("GET", "/oauth/v1/access-tokens/", ok({}))
        _, q = self.authorize("hubspot")
        self.assertIn("connected", self.callback("hubspot", q["state"])["Location"])
        again = self.callback("hubspot", q["state"])
        self.assertIn("crm_invalid_state", again["Location"])

    def test_a_state_for_another_vendor_or_expired_is_refused(self):
        _, q = self.authorize("hubspot")
        self.assertIn("crm_invalid_state", self.callback("zoho", q["state"])["Location"])
        _, q = self.authorize("hubspot")
        with mock.patch("django.core.signing.time.time", return_value=timezone.now().timestamp() + 3600):
            self.assertIn("crm_invalid_state", self.callback("hubspot", q["state"])["Location"])

    def test_a_person_who_lost_the_admin_role_cannot_finish_connecting(self):
        eve = self.add("eve@acme.test", "Eve Employee")
        from accounts.models import User

        state = signing.dumps({"ws": str(self.ws), "v": "hubspot", "u": str(User.objects.get(email="eve@acme.test").pk), "r": "", "n": "nonce1"}, salt="crm-oauth")
        cache.set("crm-state:nonce1", True, 600)
        self.assertIn("crm_invalid_state", self.callback("hubspot", state)["Location"])
        self.assertFalse(CrmConnection.objects.exists())

    def test_denied_by_the_user_at_the_vendor(self):
        _, q = self.authorize("hubspot")
        res = self.callback("hubspot", q["state"], code="", error="access_denied")
        self.assertIn("crm_oauth_denied", res["Location"])

    def test_vendor_failure_while_exchanging(self):
        self.server.add("POST", "/oauth/v1/token", ok({"error": "invalid_grant"}, 400))
        _, q = self.authorize("hubspot")
        self.assertIn("crm_oauth_failed", self.callback("hubspot", q["state"])["Location"])

    def test_already_connected(self):
        self.connect_direct("hubspot")
        res = self.owner.client.post(self.url("/hubspot/connect"), {}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "crm_already_connected"))

    def test_reconnecting_a_disabled_connection_keeps_the_mapping_and_resumes_waiting_jobs(self):
        conn = self.connect_direct("hubspot", status="disabled", disabled_reason="crm_auth_revoked", field_mapping={"phone": "mobilephone"})
        job = CrmSyncJob.objects.create(connection=conn, kind="upsert", payload={"lead": {"name": "X", "email": "x@example.com"}}, next_attempt_at=None)
        self.server.add("POST", "/oauth/v1/token", ok({"access_token": "NEW", "refresh_token": "NEWR", "expires_in": 1800}))
        self.server.add("GET", "/oauth/v1/access-tokens/", ok({"hub_domain": "acme.hubspot.com"}))
        _, q = self.authorize("hubspot")
        self.callback("hubspot", q["state"])
        conn.refresh_from_db()
        self.assertEqual((conn.status, conn.disabled_reason, conn.field_mapping), ("connected", "", {"phone": "mobilephone"}))
        job.refresh_from_db()
        self.assertIsNotNone(job.next_attempt_at)

    def test_disconnect_revokes_and_forgets(self):
        conn = self.connect_direct("hubspot")
        self.server.add("DELETE", "/oauth/v1/refresh-tokens/", ok(None, 204))
        res = self.owner.client.post(self.url("/hubspot/disconnect"))
        self.assertEqual(res.status_code, 204)
        self.assertEqual(len(self.server.find("DELETE", "/oauth/v1/refresh-tokens/refresh-hubspot")), 1)
        self.assertFalse(CrmConnection.objects.filter(pk=conn.pk).exists())
        self.assertTrue(AuditEvent.objects.filter(action="crm.disconnected").exists())
        self.assertEqual(self.owner.client.post(self.url("/hubspot/disconnect")).status_code, 404)

    def test_disconnect_works_even_when_the_vendor_is_down(self):
        self.connect_direct("salesforce")
        self.server.add("POST", "/services/oauth2/revoke", ok({"error": "boom"}, 500))
        self.assertEqual(self.owner.client.post(self.url("/salesforce/disconnect")).status_code, 204)
        self.assertFalse(CrmConnection.objects.exists())

    def test_mapping_and_settings_validation_and_audit(self):
        self.connect_direct("hubspot")
        patch = lambda body: self.owner.client.patch(self.url("/hubspot"), body, format="json")
        res = patch({"mapping": {"phone": "mobilephone", "message": "lead_message"}, "settings": {"assign_owner": True, "sync_status": True, "status_map": {"won": "CUSTOMER"}}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["mapping"]["phone"], "mobilephone")
        self.assertEqual(res.data["mapping"]["email"], "email")  # untouched defaults stay
        self.assertEqual(res.data["status_map"]["won"], "CUSTOMER")
        self.assertEqual(res.data["status_map"]["lost"], "UNQUALIFIED")
        self.assertTrue(res.data["settings"]["assign_owner"])
        self.assertEqual(patch({"mapping": {"nonsense": "x"}}).status_code, 400)
        self.assertEqual(patch({"mapping": {"phone": "bad field!"}}).status_code, 400)
        self.assertEqual(patch({"mapping": {"phone": "1abc"}}).status_code, 400)
        self.assertEqual(patch({"settings": {"assign_owner": "yes"}}).status_code, 400)
        self.assertEqual(patch({"settings": {"status_map": {"great": "X"}}}).status_code, 400)
        self.assertEqual(patch({}).status_code, 400)
        self.assertEqual(patch({"mapping": {"phone": ""}}).data["mapping"]["phone"], "")
        self.assertTrue(AuditEvent.objects.filter(action="crm.settings_changed").exists())

    def test_send_test_lead_reports_the_result(self):
        self.connect_direct("hubspot")
        self.server.add("POST", "/crm/v3/objects/contacts/search", ok({"results": []}))
        self.server.add("POST", "/crm/v3/objects/contacts", ok({"id": "9"}, 201))
        self.server.add("POST", "/crm/v3/objects/notes", ok({"id": "n"}, 201))
        res = self.owner.client.post(self.url("/hubspot/test"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["ok"])
        self.assertEqual(res.data["remote_id"], "9")
        self.assertEqual(res.data["connection"]["health"], "ok")
        props = self.server.find("POST", "/crm/v3/objects/contacts")[-1]["json"]["properties"]
        self.assertEqual(props["email"], "sample.visitor@example.com")

    def test_send_test_lead_shows_a_failure_by_code(self):
        self.connect_direct("hubspot")
        self.server.add("POST", "/crm/v3/objects/contacts/search", ok({"message": "bad scope"}, 403))
        res = self.owner.client.post(self.url("/hubspot/test"))
        self.assertFalse(res.data["ok"])
        self.assertEqual(res.data["code"], "crm_forbidden")
        self.assertEqual(res.data["connection"]["health"], "retrying")
        self.assertEqual(CrmSyncJob.objects.get().status, "failed")  # a test is never retried

    def test_test_lead_on_a_revoked_connection_disables_it(self):
        self.connect_direct("hubspot")
        self.server.add("POST", "/crm/v3/objects/contacts/search", ok({}, 401))
        self.server.add("POST", "/oauth/v1/token", ok({"error": "invalid_grant"}, 400))
        res = self.owner.client.post(self.url("/hubspot/test"))
        self.assertEqual(res.data["code"], "crm_auth_revoked")
        self.assertEqual(res.data["connection"]["health"], "needs_reconnect")
        self.assertEqual(self.owner.client.post(self.url("/hubspot/test")).status_code, 409)

    def test_backfill_endpoint(self):
        self.connect_direct("hubspot")
        self.make_lead(email="one@example.com")
        CrmSyncJob.objects.all().delete()
        res = self.owner.client.post(self.url("/hubspot/backfill"))
        self.assertEqual((res.status_code, res.data), (200, {"queued": 1, "days": 30}))

    def test_job_log(self):
        self.connect_direct("hubspot")
        self.server.add("POST", "/crm/v3/objects/contacts/search", ok({"message": "nope"}, 400))
        self.make_lead()
        run_queue()
        rows = self.owner.client.get(self.url("/hubspot/jobs")).data["results"]
        self.assertEqual((rows[0]["status"], rows[0]["error_code"], rows[0]["name"]), ("failed", "crm_rejected", "Lena Lead"))

    def test_health_levels(self):
        conn = self.connect_direct("hubspot")
        from crm.views import health_of

        self.assertEqual(health_of(conn), "ok")
        conn.consecutive_failures = 1
        self.assertEqual(health_of(conn), "retrying")
        conn.consecutive_failures = 3
        self.assertEqual(health_of(conn), "failing")
        conn.status = "disabled"
        self.assertEqual(health_of(conn), "needs_reconnect")

    def test_company_isolation(self):
        other = self.signup("other@example.com", "Otto Other")
        other_ws = self.company(other, "Other Ltd", seats=3)
        self.connect_direct("hubspot")
        self.assertEqual(other.client.get(f"{API}workspaces/{other_ws}/crm").data["vendors"][0]["connection"], None)
        self.assertEqual(other.client.post(f"{API}workspaces/{self.ws}/crm/hubspot/disconnect").status_code, 404)
        self.assertEqual(other.client.patch(f"{API}workspaces/{self.ws}/crm/hubspot", {"settings": {"add_note": False}}, format="json").status_code, 404)
        self.assertTrue(CrmConnection.objects.filter(vendor="hubspot").exists())
        # a lead of the other company never reaches this company's CRM
        from cards.models import Card
        from leads.models import Lead

        lead = Lead.objects.create(workspace_id=other_ws, name="Other Lead", email="ol@example.com")
        workflow.note_created(lead)
        self.assertEqual(CrmSyncJob.objects.count(), 0)

    def test_connection_json_never_holds_tokens(self):
        conn = self.connect_direct("hubspot")
        from crm.views import connection_json

        text = str(connection_json(conn))
        self.assertNotIn("access-hubspot", text)
        self.assertNotIn("refresh-hubspot", text)
        self.assertNotIn("h1:", text)
