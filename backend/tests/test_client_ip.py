"""Client address detection: forwarded headers count only from trusted proxies."""
from django.test import RequestFactory, SimpleTestCase, override_settings

from ilaf.utils import client_ip, sign_client_ip, throttle_ident

BASE = dict(
    TRUST_PROXY_HEADERS=True,
    TRUSTED_PROXY_IPS=["127.0.0.1", "::1", "10.0.0.0/8"],
    NUM_PROXIES=0,
    CLIENT_IP_HEADER_SECRET="",
    TRUST_CLOUDFLARE_HEADER=False,
)


def req(remote="127.0.0.1", **headers):
    meta = {"REMOTE_ADDR": remote}
    meta.update(headers)
    return RequestFactory().get("/", **meta)


@override_settings(**BASE)
class ClientIpTests(SimpleTestCase):
    def test_plain_connection_uses_remote_addr(self):
        self.assertEqual(client_ip(req("203.0.113.5")), "203.0.113.5")

    def test_untrusted_peer_cannot_forge_headers(self):
        r = req("203.0.113.5", HTTP_X_FORWARDED_FOR="1.2.3.4", HTTP_CF_CONNECTING_IP="5.6.7.8", HTTP_X_BENCH_CLIENT_IP="9.9.9.9")
        self.assertEqual(client_ip(r), "203.0.113.5")

    def test_trust_switch_off_ignores_headers(self):
        with override_settings(TRUST_PROXY_HEADERS=False):
            self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="1.2.3.4")), "127.0.0.1")

    def test_xff_single_entry_from_nginx(self):
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="198.51.100.7")), "198.51.100.7")

    def test_xff_forged_left_entries_are_ignored(self):
        # nginx appended the real address on the right; the visitor's own claim is on the left
        r = req(HTTP_X_FORWARDED_FOR="6.6.6.6, 198.51.100.7")
        self.assertEqual(client_ip(r), "198.51.100.7")

    def test_xff_skips_trusted_hops(self):
        r = req(HTTP_X_FORWARDED_FOR="198.51.100.7, 10.1.2.3, 127.0.0.1")
        self.assertEqual(client_ip(r), "198.51.100.7")

    def test_num_proxies_skips_extra_hops(self):
        with override_settings(NUM_PROXIES=1):
            r = req(HTTP_X_FORWARDED_FOR="198.51.100.7, 172.16.0.9")
            self.assertEqual(client_ip(r), "198.51.100.7")

    def test_garbage_xff_falls_back_to_peer(self):
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="not-an-ip")), "127.0.0.1")
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="1.2.3.4, <script>")), "127.0.0.1")
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="x" * 500)), "127.0.0.1")

    def test_cloudflare_header_ignored_by_default(self):
        r = req(HTTP_CF_CONNECTING_IP="8.8.8.8", HTTP_X_FORWARDED_FOR="198.51.100.7")
        self.assertEqual(client_ip(r), "198.51.100.7")

    def test_cloudflare_header_when_enabled(self):
        with override_settings(TRUST_CLOUDFLARE_HEADER=True):
            self.assertEqual(client_ip(req(HTTP_CF_CONNECTING_IP="8.8.8.8")), "8.8.8.8")
            self.assertEqual(client_ip(req(HTTP_CF_CONNECTING_IP="junk", HTTP_X_FORWARDED_FOR="198.51.100.7")), "198.51.100.7")

    def test_web_server_header_from_loopback(self):
        r = req(HTTP_X_BENCH_CLIENT_IP="198.51.100.9", HTTP_X_FORWARDED_FOR="1.1.1.1")
        self.assertEqual(client_ip(r), "198.51.100.9")

    def test_web_server_header_needs_signature_when_secret_set(self):
        with override_settings(CLIENT_IP_HEADER_SECRET="s3cret"):
            unsigned = req(HTTP_X_BENCH_CLIENT_IP="198.51.100.9", HTTP_X_FORWARDED_FOR="198.51.100.1")
            self.assertEqual(client_ip(unsigned), "198.51.100.1")
            wrong = req(HTTP_X_BENCH_CLIENT_IP="198.51.100.9", HTTP_X_BENCH_CLIENT_IP_SIGNATURE="00" * 32)
            self.assertEqual(client_ip(wrong), "127.0.0.1")
            sig = sign_client_ip("198.51.100.9", "s3cret")
            good = req(HTTP_X_BENCH_CLIENT_IP="198.51.100.9", HTTP_X_BENCH_CLIENT_IP_SIGNATURE=sig)
            self.assertEqual(client_ip(good), "198.51.100.9")
            # a signature for another address does not transfer
            moved = req(HTTP_X_BENCH_CLIENT_IP="198.51.100.10", HTTP_X_BENCH_CLIENT_IP_SIGNATURE=sig)
            self.assertEqual(client_ip(moved), "127.0.0.1")

    def test_signed_header_from_untrusted_peer_is_ignored(self):
        with override_settings(CLIENT_IP_HEADER_SECRET="s3cret"):
            sig = sign_client_ip("198.51.100.9", "s3cret")
            r = req("203.0.113.5", HTTP_X_BENCH_CLIENT_IP="198.51.100.9", HTTP_X_BENCH_CLIENT_IP_SIGNATURE=sig)
            self.assertEqual(client_ip(r), "203.0.113.5")

    def test_ipv6_and_ports(self):
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="2001:db8::1")), "2001:db8::1")
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="[2001:db8::1]:443")), "2001:db8::1")
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="198.51.100.7:5000")), "198.51.100.7")
        self.assertEqual(client_ip(req(HTTP_X_FORWARDED_FOR="::ffff:198.51.100.7")), "198.51.100.7")

    def test_missing_remote_addr(self):
        r = RequestFactory().get("/")
        r.META.pop("REMOTE_ADDR", None)
        self.assertEqual(client_ip(r), "0.0.0.0")

    def test_throttle_ident_groups_ipv6_by_64(self):
        a = throttle_ident(req(HTTP_X_FORWARDED_FOR="2001:db8:1:2::1"))
        b = throttle_ident(req(HTTP_X_FORWARDED_FOR="2001:db8:1:2:ffff::9"))
        c = throttle_ident(req(HTTP_X_FORWARDED_FOR="2001:db8:1:3::1"))
        self.assertEqual(a, b)
        self.assertNotEqual(a, c)
        self.assertEqual(throttle_ident(req(HTTP_X_FORWARDED_FOR="198.51.100.7")), "198.51.100.7")
