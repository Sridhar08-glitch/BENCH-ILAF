"""The link fetcher has one clock for the whole request and a limit on name look-ups; extra address ranges are refused."""
import socket
import threading
import time
from unittest import mock

from django.test import SimpleTestCase

from cards import linktools


def serve(handler):
    server = socket.socket()
    server.bind(("127.0.0.1", 0))
    server.listen(1)
    threading.Thread(target=handler, args=(server,), daemon=True).start()
    return server, server.getsockname()[1]


class DeadlineTests(SimpleTestCase):
    def test_trickling_server_is_cut_off_at_the_budget(self):
        def trickle(server):
            conn, _ = server.accept()
            conn.recv(65536)
            try:
                conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Type: text/html\r\n\r\n")
                for _ in range(200):
                    time.sleep(0.25)
                    conn.sendall(b"x")
            except OSError:
                pass

        server, port = serve(trickle)
        started = time.monotonic()
        with mock.patch.object(linktools, "OVERALL_BUDGET", 1):
            with self.assertRaises(OSError):
                linktools._request_once("http", "example.test", "127.0.0.1", port, "/", "*/*")
        self.assertLess(time.monotonic() - started, 3)
        server.close()

    def test_silent_server_is_cut_off(self):
        def silent(server):
            conn, _ = server.accept()
            conn.recv(65536)
            time.sleep(5)

        server, port = serve(silent)
        started = time.monotonic()
        with mock.patch.object(linktools, "OVERALL_BUDGET", 1):
            with self.assertRaises(OSError):
                linktools._request_once("http", "example.test", "127.0.0.1", port, "/", "*/*")
        self.assertLess(time.monotonic() - started, 3)
        server.close()

    def test_normal_answer_still_works(self):
        def ok(server):
            conn, _ = server.accept()
            conn.recv(65536)
            conn.sendall(b"HTTP/1.1 200 OK\r\nContent-Length: 5\r\n\r\nhello")
            conn.close()

        server, port = serve(ok)
        status, headers, body = linktools._request_once("http", "example.test", "127.0.0.1", port, "/", "*/*")
        self.assertEqual((status, body), (200, b"hello"))
        server.close()

    def test_a_slow_name_lookup_gives_up(self):
        def slow(*args, **kwargs):
            time.sleep(2)
            return [(2, 1, 6, "", ("93.184.216.34", 80))]

        with mock.patch.object(linktools, "DNS_TIMEOUT", 0.2), mock.patch("cards.linktools.socket.getaddrinfo", slow):
            started = time.monotonic()
            self.assertIsNone(linktools.resolve_public("slow.example", 80))
        self.assertLess(time.monotonic() - started, 1.5)

    def test_a_failing_lookup_is_none(self):
        with mock.patch("cards.linktools.socket.getaddrinfo", side_effect=socket.gaierror):
            self.assertIsNone(linktools.resolve_public("nope.example", 80))
        with mock.patch("cards.linktools.socket.getaddrinfo", side_effect=UnicodeError):
            self.assertIsNone(linktools.resolve_public("℀.example", 80))


class AddressRangeTests(SimpleTestCase):
    def test_translation_ranges_are_refused(self):
        for bad in ("64:ff9b::7f00:1", "64:ff9b::808:808", "2002:7f00:1::1", "2002:0808:0808::1", "::127.0.0.1", "100.64.0.1", "::ffff:10.0.0.1", "169.254.169.254", "fd00::1"):
            self.assertFalse(linktools.is_public_address(bad), bad)

    def test_ordinary_addresses_are_accepted(self):
        for ok in ("93.184.216.34", "2606:2800:220:1:248:1893:25c8:1946", "8.8.8.8"):
            self.assertTrue(linktools.is_public_address(ok), ok)
