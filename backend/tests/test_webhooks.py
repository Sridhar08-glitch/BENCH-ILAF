"""Webhooks: endpoint management, the SSRF rules, signing, the delivery queue, retries and auto-disable."""
import hashlib
import hmac
import json
import threading
from datetime import timedelta
from http.server import BaseHTTPRequestHandler, HTTPServer
from unittest import mock

from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from leads import webhooks
from leads.models import Lead, WebhookDelivery, WebhookEndpoint

from .base import API
from .ops_base import OpsTestCase

PUBLIC_IP = "93.184.216.34"


def resolves_to(*addresses):
    return mock.patch.object(webhooks, "resolve_host", return_value=list(addresses))


class EndpointApiTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.eve = self.add("eve@example.com", "Eve Employee")
        self.admin = self.add("ada@example.com", "Ada Admin", role="admin")

    def create(self, client=None, **body):
        body = {"url": "https://hooks.example.com/in", "name": "CRM", **body}
        with resolves_to(PUBLIC_IP):
            return (client or self.owner.client).post(self.url("webhooks"), body, format="json")

    def test_create_shows_the_secret_once(self):
        res = self.create()
        self.assertEqual(res.status_code, 201, res.content)
        secret = res.data["secret"]
        self.assertTrue(secret.startswith("whsec_"))
        self.assertEqual(res.data["events"], ["lead.created", "lead.updated", "lead.assigned"])
        listing = self.owner.client.get(self.url("webhooks")).data
        self.assertNotIn("secret", listing["results"][0])
        self.assertEqual(listing["results"][0]["secret_hint"], "..." + secret[-4:])
        self.assertNotIn(secret, json.dumps(listing))

    def test_only_owner_and_admin(self):
        self.assertEqual(self.eve.client.get(self.url("webhooks")).status_code, 403)
        self.assertEqual(self.create(client=self.eve.client).status_code, 403)
        self.assertEqual(self.create(client=self.admin.client).status_code, 201)

    def test_other_company_cannot_touch_it(self):
        wid = self.create().data["id"]
        other = self.signup("other@example.com", "Other Owner")
        other_ws = self.company(other, "Other Ltd")
        res = other.client.get(f"{API}workspaces/{self.ws}/webhooks/{wid}")
        self.assertEqual(res.status_code, 404)
        res = other.client.get(f"{API}workspaces/{other_ws}/webhooks/{wid}")
        self.assertEqual(res.status_code, 404)

    def test_url_rules(self):
        for url in ("http://hooks.example.com/in", "ftp://x.example.com", "", "https://user:pw@hooks.example.com/", "javascript:alert(1)"):
            self.assertEqual(self.create(url=url).status_code, 400, url)

    def test_private_targets_are_refused_after_name_lookup(self):
        for ip in ("127.0.0.1", "10.0.0.5", "192.168.1.1", "172.16.0.9", "169.254.169.254", "::1", "fe80::1", "fd00::1",
                   "100.64.0.1", "0.0.0.0", "::ffff:127.0.0.1", "224.0.0.1"):
            with resolves_to(ip):
                res = self.owner.client.post(self.url("webhooks"), {"url": "https://evil.example.com/x"}, format="json")
            self.assertEqual(res.status_code, 400, ip)
            self.assertIn("private", res.data["error"]["fields"]["url"][0])

    def test_one_private_address_among_public_ones_is_refused(self):
        with resolves_to(PUBLIC_IP, "10.1.1.1"):
            res = self.owner.client.post(self.url("webhooks"), {"url": "https://mixed.example.com/x"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_ip_literals_are_checked_too(self):
        res = self.owner.client.post(self.url("webhooks"), {"url": "https://169.254.169.254/latest/meta-data"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.owner.client.post(self.url("webhooks"), {"url": "https://127.0.0.1:8200/x"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_events_must_be_known(self):
        self.assertEqual(self.create(events=["lead.deleted"]).status_code, 400)
        self.assertEqual(self.create(events=[]).status_code, 400)
        self.assertEqual(self.create(events=["lead.updated"]).data["events"], ["lead.updated"])

    def test_limit_per_company(self):
        for _ in range(webhooks.MAX_ENDPOINTS):
            self.assertEqual(self.create().status_code, 201)
        self.assertEqual(self.create().status_code, 400)

    def test_patch_delete_rotate_and_audit(self):
        data = self.create().data
        wid, old = data["id"], data["secret"]
        with resolves_to(PUBLIC_IP):
            res = self.owner.client.patch(self.url(f"webhooks/{wid}"), {"enabled": False, "events": ["lead.created"]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(res.data["enabled"])
        new = self.owner.client.post(self.url(f"webhooks/{wid}/secret")).data["secret"]
        self.assertNotEqual(new, old)
        self.assertEqual(self.owner.client.delete(self.url(f"webhooks/{wid}")).status_code, 204)
        self.assertEqual(WebhookEndpoint.objects.count(), 0)
        actions = self.audit_actions()
        for key in ("webhook.created", "webhook.updated", "webhook.secret_rotated", "webhook.deleted"):
            self.assertIn(key, actions)

    def test_switching_back_on_clears_the_failure_streak(self):
        wid = self.create().data["id"]
        WebhookEndpoint.objects.filter(pk=wid).update(enabled=False, consecutive_failures=20, disabled_reason="x")
        res = self.owner.client.patch(self.url(f"webhooks/{wid}"), {"enabled": True}, format="json")
        self.assertEqual((res.data["enabled"], res.data["consecutive_failures"], res.data["disabled_reason"]), (True, 0, ""))


class DeliveryTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.endpoint = WebhookEndpoint.objects.create(
            workspace=self.owner_member.workspace, url="https://hooks.example.com/in", secret="whsec_known",
            events=list(webhooks.EVENT_TYPES),
        )

    def queue(self, **extra):
        return WebhookDelivery.objects.create(
            endpoint=self.endpoint, event_type="lead.created", payload={"id": "e1", "type": "lead.created"},
            next_attempt_at=timezone.now() - timedelta(seconds=1), **extra,
        )

    def test_signature_is_hmac_of_timestamp_dot_body(self):
        seen = {}

        def fake(url, body, headers):
            seen.update(url=url, body=body, headers=headers)
            return 200, "ok"

        d = self.queue()
        with mock.patch.object(webhooks, "send_request", fake):
            webhooks.process_queue()
        d.refresh_from_db()
        self.assertEqual((d.status, d.attempts, d.response_status), ("success", 1, 200))
        h = seen["headers"]
        expected = hmac.new(b"whsec_known", h["X-BENCH-Timestamp"].encode() + b"." + seen["body"], hashlib.sha256).hexdigest()
        self.assertEqual(h["X-BENCH-Signature"], "sha256=" + expected)
        self.assertEqual(h["X-BENCH-Event-Id"], str(d.event_id))
        self.assertEqual(h["X-BENCH-Event"], "lead.created")
        self.assertEqual(json.loads(seen["body"])["type"], "lead.created")

    def test_failure_keeps_it_pending_and_records_the_reason(self):
        d = self.queue()
        with mock.patch.object(webhooks, "send_request", return_value=(500, "boom")):
            webhooks.process_queue()
        d.refresh_from_db()
        self.assertEqual((d.status, d.attempts, d.response_body), ("pending", 1, "boom"))
        self.assertEqual(d.error, "The receiver answered 500.")

    def test_backoff_values(self):
        d = self.queue()
        base = timezone.now()
        with mock.patch.object(webhooks, "send_request", return_value=(503, "")):
            for expected in webhooks.BACKOFF[:3]:
                webhooks.process_queue(now=base)
                d.refresh_from_db()
                self.assertEqual(d.next_attempt_at, base + timedelta(seconds=expected))
                base = d.next_attempt_at

    def test_not_due_yet_is_left_alone(self):
        d = self.queue()
        WebhookDelivery.objects.filter(pk=d.pk).update(next_attempt_at=timezone.now() + timedelta(hours=1))
        with mock.patch.object(webhooks, "send_request") as send:
            webhooks.process_queue()
        send.assert_not_called()

    def test_gives_up_after_max_attempts(self):
        d = self.queue()
        with mock.patch.object(webhooks, "send_request", return_value=(500, "")):
            for i in range(webhooks.MAX_ATTEMPTS + 2):
                webhooks.process_queue(now=timezone.now() + timedelta(days=10 * (i + 1)))
        d.refresh_from_db()
        self.assertEqual((d.status, d.attempts), ("failed", webhooks.MAX_ATTEMPTS))

    def test_a_claimed_delivery_is_not_sent_twice(self):
        d = self.queue()
        WebhookDelivery.objects.filter(pk=d.pk).update(locked_until=timezone.now() + timedelta(seconds=60))
        with mock.patch.object(webhooks, "send_request") as send:
            webhooks.process_queue()
        send.assert_not_called()

    def test_command_runs_and_is_safe_to_repeat(self):
        self.queue()
        with mock.patch.object(webhooks, "send_request", return_value=(204, "")) as send:
            call_command("deliver_webhooks", verbosity=0)
            call_command("deliver_webhooks", verbosity=0)
        self.assertEqual(send.call_count, 1)

    def test_success_resets_the_streak(self):
        WebhookEndpoint.objects.filter(pk=self.endpoint.pk).update(consecutive_failures=7)
        self.queue()
        with mock.patch.object(webhooks, "send_request", return_value=(200, "")):
            webhooks.process_queue()
        self.endpoint.refresh_from_db()
        self.assertEqual(self.endpoint.consecutive_failures, 0)
        self.assertIsNotNone(self.endpoint.last_success_at)

    def test_twenty_failures_in_a_row_switch_it_off_and_mail_the_admins_once(self):
        admin = self.add("ada@example.com", "Ada Admin", role="admin")
        WebhookEndpoint.objects.filter(pk=self.endpoint.pk).update(consecutive_failures=19)
        mail.outbox.clear()
        with mock.patch.object(webhooks, "send_request", return_value=(500, "")):
            for _ in range(3):
                self.queue()
            webhooks.process_queue()
        self.endpoint.refresh_from_db()
        self.assertFalse(self.endpoint.enabled)
        self.assertIn("20", self.endpoint.disabled_reason)
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["ada@example.com", "owner@example.com"])
        self.assertEqual(len(mail.outbox), 2)

    def test_queued_events_of_a_switched_off_endpoint_are_dropped(self):
        d = self.queue()
        WebhookEndpoint.objects.filter(pk=self.endpoint.pk).update(enabled=False)
        with mock.patch.object(webhooks, "send_request") as send:
            webhooks.process_queue()
        send.assert_not_called()
        d.refresh_from_db()
        self.assertEqual(d.status, "failed")

    def test_unsafe_address_at_send_time_is_a_failure_without_a_request(self):
        d = self.queue()
        with resolves_to("10.0.0.1"), mock.patch.object(webhooks.socket, "create_connection") as conn:
            webhooks.process_queue()
        conn.assert_not_called()
        d.refresh_from_db()
        self.assertIn("private", d.error)

    def test_test_button_sends_now_and_does_not_count_toward_the_streak(self):
        with mock.patch.object(webhooks, "send_request", return_value=(500, "bad")):
            res = self.owner.client.post(self.url(f"webhooks/{self.endpoint.id}/test"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["status"], res.data["response_status"], res.data["is_test"]), ("failed", 500, True))
        self.assertEqual(res.data["payload"]["type"], "lead.test")
        self.endpoint.refresh_from_db()
        self.assertEqual(self.endpoint.consecutive_failures, 0)

    def test_delivery_log_and_detail(self):
        d = self.queue()
        with mock.patch.object(webhooks, "send_request", return_value=(200, "fine")):
            webhooks.process_queue()
        log = self.owner.client.get(self.url(f"webhooks/{self.endpoint.id}/deliveries")).data
        self.assertEqual(log["count"], 1)
        self.assertNotIn("payload", log["results"][0])
        one = self.owner.client.get(self.url(f"webhooks/{self.endpoint.id}/deliveries/{d.id}")).data
        self.assertEqual(one["response_body"], "fine")
        self.assertEqual(self.owner.client.get(self.url(f"webhooks/{self.endpoint.id}/deliveries"), {"status": "failed"}).data["count"], 0)


class _Receiver(BaseHTTPRequestHandler):
    log = []
    answer = 200
    redirect = False

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(length)
        _Receiver.log.append((self.path, dict(self.headers), body))
        if _Receiver.redirect:
            self.send_response(302)
            self.send_header("Location", "http://127.0.0.1:1/elsewhere")
            self.end_headers()
            return
        self.send_response(_Receiver.answer)
        self.end_headers()
        self.wfile.write(b"x" * 5000)

    def log_message(self, *args):
        pass


class RealRequestTests(OpsTestCase):
    """The real HTTP path against a receiver on this computer (allowed only by the development switch)."""

    def setUp(self):
        super().setUp()
        _Receiver.log, _Receiver.answer, _Receiver.redirect = [], 200, False
        self.server = HTTPServer(("127.0.0.1", 0), _Receiver)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.addCleanup(self.server.server_close)
        self.addCleanup(self.server.shutdown)
        self.url_ = f"http://127.0.0.1:{self.server.server_address[1]}/hook?x=1"

    def test_refused_without_the_development_switch(self):
        with self.assertRaises(webhooks.UnsafeTarget):
            webhooks.send_request(self.url_, b"{}", {})

    @override_settings(WEBHOOK_ALLOW_PRIVATE_TARGETS=True)
    def test_post_is_signed_and_the_answer_is_capped(self):
        body = b'{"a":1}'
        status, text = webhooks.send_request(self.url_, body, {"X-BENCH-Signature": webhooks.sign("k", "1", body)})
        self.assertEqual(status, 200)
        self.assertEqual(len(text), webhooks.RESPONSE_CAP)
        path, headers, got = _Receiver.log[0]
        self.assertEqual((path, got), ("/hook?x=1", body))
        self.assertTrue(headers["X-BENCH-Signature"].startswith("sha256="))

    @override_settings(WEBHOOK_ALLOW_PRIVATE_TARGETS=True)
    def test_redirects_are_not_followed(self):
        _Receiver.redirect = True
        status, _ = webhooks.send_request(self.url_, b"{}", {})
        self.assertEqual(status, 302)
        self.assertEqual(len(_Receiver.log), 1)
