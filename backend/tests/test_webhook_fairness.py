"""One slow or failing webhook receiver must not stall the others."""
import socket
import threading
import time
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from leads import webhooks
from leads.models import WebhookDelivery, WebhookEndpoint

from .ops_base import OpsTestCase


class QueueFairnessTests(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.ws = self.owner_member.workspace

    def endpoint(self, name):
        return WebhookEndpoint.objects.create(
            workspace=self.ws, url=f"https://{name}.example.com/in", secret="whsec_" + name, events=list(webhooks.EVENT_TYPES)
        )

    def queue(self, endpoint, count, age=10):
        for i in range(count):
            WebhookDelivery.objects.create(
                endpoint=endpoint, event_type="lead.created", payload={"id": f"{endpoint.id}-{i}", "type": "lead.created"},
                next_attempt_at=timezone.now() - timedelta(seconds=age - i * 0.001),
            )

    def test_big_backlog_of_one_endpoint_does_not_starve_another(self):
        noisy, quiet = self.endpoint("noisy"), self.endpoint("quiet")
        self.queue(noisy, 50, age=100)
        self.queue(quiet, 2, age=1)
        urls = []

        def fake(url, body, headers):
            urls.append(url)
            return 200, "ok"

        with mock.patch.object(webhooks, "send_request", fake):
            webhooks.process_queue(limit=8)
        self.assertEqual(sum("quiet" in u for u in urls), 2)
        self.assertLessEqual(sum("noisy" in u for u in urls), webhooks.PER_ENDPOINT_BATCH)

    def test_order_is_round_robin(self):
        a, b = self.endpoint("a"), self.endpoint("b")
        self.queue(a, 3, age=30)
        self.queue(b, 3, age=20)
        order = []
        with mock.patch.object(webhooks, "send_request", lambda url, body, headers: (order.append(url[8]) or (200, ""))):
            webhooks.process_queue()
        self.assertEqual(order, ["a", "b", "a", "b", "a", "b"])

    def test_batch_per_endpoint_is_bounded_and_rest_waits(self):
        a = self.endpoint("a")
        self.queue(a, webhooks.PER_ENDPOINT_BATCH + 4)
        with mock.patch.object(webhooks, "send_request", return_value=(200, "")):
            stats = webhooks.process_queue()
        self.assertEqual(stats["sent"], webhooks.PER_ENDPOINT_BATCH)
        self.assertEqual(WebhookDelivery.objects.filter(status="pending").count(), 4)
        with mock.patch.object(webhooks, "send_request", return_value=(200, "")):
            webhooks.process_queue()
        self.assertEqual(WebhookDelivery.objects.filter(status="pending").count(), 0)

    def test_a_receiver_that_times_out_is_skipped_for_the_rest_of_the_run(self):
        slow, fine = self.endpoint("slow"), self.endpoint("fine")
        self.queue(slow, 5, age=50)
        self.queue(fine, 3, age=40)
        calls = []

        def fake(url, body, headers):
            calls.append(url)
            if "slow" in url:
                raise socket.timeout("deadline")
            return 200, ""

        with mock.patch.object(webhooks, "send_request", fake):
            stats = webhooks.process_queue()
        self.assertEqual(sum("slow" in u for u in calls), 1)
        self.assertEqual(sum("fine" in u for u in calls), 3)
        self.assertEqual(stats["sent"], 3)

    def test_endpoint_time_budget(self):
        a, b = self.endpoint("a"), self.endpoint("b")
        self.queue(a, 5, age=50)
        self.queue(b, 2, age=40)
        calls = []

        def fake(url, body, headers):
            calls.append(url[8])
            time.sleep(0.05)
            return 200, ""

        with mock.patch.object(webhooks, "send_request", fake):
            webhooks.process_queue(endpoint_budget=0.04)
        self.assertEqual(sorted(calls), ["a", "b"])  # one slow-ish send each, then both lanes stop

    def test_run_time_budget_stops_the_run(self):
        a = self.endpoint("a")
        self.queue(a, 5)
        with mock.patch.object(webhooks, "send_request", return_value=(200, "")):
            stats = webhooks.process_queue(run_budget=0)
        self.assertEqual(stats["sent"], 0)
        self.assertEqual(WebhookDelivery.objects.filter(status="pending", locked_until__isnull=True).count(), 5)

    def test_unexpected_error_does_not_abort_the_run_or_leave_the_row_locked(self):
        bad, good = self.endpoint("bad"), self.endpoint("good")
        self.queue(bad, 1, age=50)
        self.queue(good, 1, age=40)

        def fake(url, body, headers):
            if "bad" in url:
                raise RuntimeError("surprise")
            return 200, ""

        with mock.patch.object(webhooks, "send_request", fake):
            stats = webhooks.process_queue()
        self.assertEqual(stats["sent"], 1)
        row = WebhookDelivery.objects.get(endpoint=bad)
        self.assertIsNone(row.locked_until)
        self.assertEqual(row.attempts, 1)
        self.assertIn("Unexpected error", row.error)
        self.assertEqual(row.status, "pending")  # retried later with the normal back-off

    def test_failure_inside_attempt_machinery_releases_the_lock(self):
        bad = self.endpoint("bad")
        self.queue(bad, 1)
        with mock.patch.object(webhooks, "attempt", side_effect=RuntimeError("db gone")):
            webhooks.process_queue()
        self.assertIsNone(WebhookDelivery.objects.get(endpoint=bad).locked_until)

    def test_locked_delivery_is_skipped_by_a_second_run(self):
        a = self.endpoint("a")
        self.queue(a, 1)
        WebhookDelivery.objects.update(locked_until=timezone.now() + timedelta(seconds=30))
        with mock.patch.object(webhooks, "send_request") as send:
            webhooks.process_queue()
        send.assert_not_called()


class SendRequestDeadlineTests(OpsTestCase):
    """A real local receiver that answers one byte at a time cannot hold the sender past the total deadline."""

    def start_server(self, handler):
        server = socket.socket()
        server.bind(("127.0.0.1", 0))
        server.listen(1)
        threading.Thread(target=handler, args=(server,), daemon=True).start()
        return server, server.getsockname()[1]

    @override_settings(WEBHOOK_ALLOW_PRIVATE_TARGETS=True)
    def test_trickling_receiver_is_cut_off(self):
        def trickle(server):
            conn, _ = server.accept()
            conn.recv(65536)
            try:
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 100\r\n\r\n")
                for _ in range(100):
                    time.sleep(0.3)
                    conn.sendall(b"x")
            except OSError:
                pass

        server, port = self.start_server(trickle)
        started = time.monotonic()
        with mock.patch.object(webhooks, "TOTAL_DEADLINE_SECONDS", 1):
            with self.assertRaises(socket.timeout):
                webhooks.send_request(f"http://127.0.0.1:{port}/", b"{}", {})
        self.assertLess(time.monotonic() - started, 3)
        server.close()

    @override_settings(WEBHOOK_ALLOW_PRIVATE_TARGETS=True)
    def test_trickling_receiver_that_closes_the_connection_after_its_answer_is_cut_off(self):
        def trickle(server):
            conn, _ = server.accept()
            conn.recv(65536)
            try:
                conn.sendall(b"HTTP/1.1 200 OK\r\nConnection: close\r\n\r\n")  # no length: the body runs until close
                for _ in range(100):
                    time.sleep(0.3)
                    conn.sendall(b"x")
            except OSError:
                pass

        server, port = self.start_server(trickle)
        started = time.monotonic()
        with mock.patch.object(webhooks, "TOTAL_DEADLINE_SECONDS", 1):
            with self.assertRaises(socket.timeout):
                webhooks.send_request(f"http://127.0.0.1:{port}/", b"{}", {})
        self.assertLess(time.monotonic() - started, 3)
        server.close()

    @override_settings(WEBHOOK_ALLOW_PRIVATE_TARGETS=True)
    def test_receiver_that_never_answers_is_cut_off(self):
        def silent(server):
            conn, _ = server.accept()
            conn.recv(65536)
            time.sleep(5)

        server, port = self.start_server(silent)
        started = time.monotonic()
        with mock.patch.object(webhooks, "TOTAL_DEADLINE_SECONDS", 1):
            with self.assertRaises(socket.timeout):
                webhooks.send_request(f"http://127.0.0.1:{port}/", b"{}", {})
        self.assertLess(time.monotonic() - started, 3)
        server.close()


class TargetSafetyTests(OpsTestCase):
    def test_crafted_urls_are_refused_not_500(self):
        for url in ("https://[::1/x", "https://exa mple.com\u0000/", "https://" + "a" * 300 + ".com/", "https://℀.example/"):
            with self.assertRaises(webhooks.UnsafeTarget):
                webhooks.check_target(url)

    def test_translation_ranges_are_not_public(self):
        import ipaddress

        for text in ("64:ff9b::7f00:1", "64:ff9b::a00:1", "2002:7f00:1::1", "::127.0.0.1", "::ffff:10.0.0.1", "100.64.0.1", "fe80::1"):
            self.assertFalse(webhooks.is_public_ip(ipaddress.ip_address(text)), text)
        self.assertTrue(webhooks.is_public_ip(ipaddress.ip_address("93.184.216.34")))
        self.assertTrue(webhooks.is_public_ip(ipaddress.ip_address("2606:2800:220:1:248:1893:25c8:1946")))

    def test_environment_switch_is_ignored_without_debug(self):
        with mock.patch.dict("os.environ", {"WEBHOOK_ALLOW_PRIVATE_TARGETS": "true"}):
            with override_settings(DEBUG=False, WEBHOOK_ALLOW_PRIVATE_TARGETS=False):
                self.assertFalse(webhooks.allow_private_targets())
            with override_settings(DEBUG=True, WEBHOOK_ALLOW_PRIVATE_TARGETS=False):
                self.assertTrue(webhooks.allow_private_targets())


class TestButtonLimitTests(OpsTestCase):
    def test_test_button_is_limited_per_endpoint(self):
        ws = self.owner_member.workspace
        endpoint = WebhookEndpoint.objects.create(
            workspace=ws, url="https://hooks.example.com/in", secret="whsec_x", events=list(webhooks.EVENT_TYPES)
        )
        other = WebhookEndpoint.objects.create(
            workspace=ws, url="https://other.example.com/in", secret="whsec_y", events=list(webhooks.EVENT_TYPES)
        )
        with mock.patch.object(webhooks, "send_request", return_value=(200, "ok")):
            for _ in range(webhooks.TEST_SENDS_PER_MINUTE):
                self.assertEqual(self.owner.client.post(self.url(f"webhooks/{endpoint.id}/test")).status_code, 200)
            res = self.owner.client.post(self.url(f"webhooks/{endpoint.id}/test"))
            self.assertEqual(res.status_code, 429)
            self.assertEqual(res["Retry-After"], "60")
            self.assertEqual(self.owner.client.post(self.url(f"webhooks/{other.id}/test")).status_code, 200)
