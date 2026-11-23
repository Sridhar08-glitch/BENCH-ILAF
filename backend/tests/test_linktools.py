"""The link resolver fetches user-supplied addresses, so the refusals matter most."""
import io
import socket
from unittest import mock

from django.core.files.storage import default_storage
from django.test import SimpleTestCase
from PIL import Image
from rest_framework.test import APIClient

from cards import linktools

from .base import API, ApiTestCase

REAL_GETADDRINFO = socket.getaddrinfo


def fake_dns(mapping):
    """A getaddrinfo that answers listed names and passes everything else (IP literals) through."""
    def fake(host, port, *args, **kwargs):
        if host in mapping:
            return [(socket.AF_INET, socket.SOCK_STREAM, 6, "", (ip, port)) for ip in mapping[host]]
        return REAL_GETADDRINFO(host, port, *args, **kwargs)
    return mock.patch("cards.linktools.socket.getaddrinfo", side_effect=fake)


def png_bytes():
    buffer = io.BytesIO()
    Image.new("RGB", (32, 32), (10, 120, 200)).save(buffer, format="PNG")
    return buffer.getvalue()


class AddressRuleTests(SimpleTestCase):
    def test_public_and_private_addresses(self):
        for ok in ("93.184.216.34", "8.8.8.8", "2606:4700:4700::1111"):
            self.assertTrue(linktools.is_public_address(ok), ok)
        for bad in (
            "127.0.0.1", "10.1.2.3", "172.16.5.5", "192.168.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0",
            "224.0.0.1", "::1", "fe80::1", "fc00::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1", "not-an-ip",
        ):
            self.assertFalse(linktools.is_public_address(bad), bad)


class SafeGetRefusalTests(SimpleTestCase):
    def test_private_and_odd_targets_are_refused_without_connecting(self):
        urls = [
            "http://127.0.0.1/", "http://localhost/", "http://[::1]/", "http://10.0.0.5/", "http://192.168.1.1/",
            "http://172.16.0.1/", "http://169.254.169.254/latest/meta-data/", "http://100.64.0.1/", "http://0.0.0.0/",
            "http://2130706433/", "http://0x7f.0.0.1/", "http://[::ffff:127.0.0.1]/", "http://127.1/",
            "ftp://93.184.216.34/", "file:///etc/passwd", "gopher://93.184.216.34/", "javascript:alert(1)",
            "http://user:pass@93.184.216.34/", "http://93.184.216.34:22/", "http://93.184.216.34:6379/", "http:///nohost",
        ]
        with mock.patch("cards.linktools._request_once") as request:
            for url in urls:
                self.assertIsNone(linktools.safe_get(url), url)
            request.assert_not_called()

    def test_name_resolving_to_a_private_address_is_refused(self):
        with fake_dns({"evil.test": ["127.0.0.1"], "mixed.test": ["93.184.216.34", "10.0.0.9"]}), \
                mock.patch("cards.linktools._request_once") as request:
            self.assertIsNone(linktools.safe_get("http://evil.test/"))
            self.assertIsNone(linktools.safe_get("https://mixed.test/"))
            request.assert_not_called()

    def test_redirect_to_a_private_literal_is_refused(self):
        with fake_dns({"public.test": ["93.184.216.34"]}), mock.patch(
            "cards.linktools._request_once", return_value=(302, {"location": "http://127.0.0.1/admin"}, b"")
        ) as request:
            self.assertIsNone(linktools.safe_get("http://public.test/start"))
            self.assertEqual(request.call_count, 1)  # the second hop was never attempted

    def test_redirect_to_a_name_that_resolves_private_is_refused(self):
        dns = {"public.test": ["93.184.216.34"], "rebind.test": ["169.254.169.254"]}
        with fake_dns(dns), mock.patch(
            "cards.linktools._request_once", return_value=(301, {"location": "http://rebind.test/meta"}, b"")
        ) as request:
            self.assertIsNone(linktools.safe_get("http://public.test/"))
            self.assertEqual(request.call_count, 1)

    def test_relative_and_scheme_changing_redirects(self):
        dns = {"public.test": ["93.184.216.34"]}
        responses = [(302, {"location": "gopher://public.test/"}, b"")]
        with fake_dns(dns), mock.patch("cards.linktools._request_once", side_effect=responses) as request:
            self.assertIsNone(linktools.safe_get("http://public.test/"))
            self.assertEqual(request.call_count, 1)

    def test_at_most_three_redirects(self):
        with fake_dns({"public.test": ["93.184.216.34"]}), mock.patch(
            "cards.linktools._request_once", return_value=(302, {"location": "/again"}, b"")
        ) as request:
            self.assertIsNone(linktools.safe_get("http://public.test/"))
            self.assertEqual(request.call_count, 4)  # the first request plus three redirects

    def test_follows_good_redirect_and_pins_the_validated_address(self):
        responses = [
            (302, {"location": "/final"}, b""),
            (200, {"content-type": "text/html"}, b"<title>Hi</title>"),
        ]
        with fake_dns({"public.test": ["93.184.216.34"]}), mock.patch(
            "cards.linktools._request_once", side_effect=responses
        ) as request:
            final, headers, body = linktools.safe_get("https://public.test/start")
        self.assertEqual(final, "https://public.test/final")
        self.assertEqual(body, b"<title>Hi</title>")
        scheme, host, ip, port, path, _accept = request.call_args_list[0].args
        self.assertEqual((scheme, host, ip, port, path), ("https", "public.test", "93.184.216.34", 443, "/start"))
        self.assertEqual(request.call_args_list[1].args[4], "/final")

    def test_errors_and_non_200_become_none(self):
        with fake_dns({"public.test": ["93.184.216.34"]}):
            with mock.patch("cards.linktools._request_once", side_effect=OSError("boom")):
                self.assertIsNone(linktools.safe_get("http://public.test/"))
            with mock.patch("cards.linktools._request_once", return_value=(404, {}, b"")):
                self.assertIsNone(linktools.safe_get("http://public.test/"))
            with mock.patch("cards.linktools._request_once", return_value=(302, {}, b"")):
                self.assertIsNone(linktools.safe_get("http://public.test/"))

    def test_unresolvable_name_is_none(self):
        with mock.patch("cards.linktools.socket.getaddrinfo", side_effect=socket.gaierror):
            self.assertIsNone(linktools.safe_get("http://nope.invalid/"))


class ParsingTests(SimpleTestCase):
    def test_title_extraction(self):
        self.assertEqual(linktools.extract_title("<html><TITLE>\n Hello &amp; welcome \n</TITLE>"), "Hello & welcome")
        self.assertEqual(linktools.extract_title('<meta property="og:title" content="OG Name"><title>Other</title>'), "OG Name")
        self.assertIsNone(linktools.extract_title("<p>none</p>"))
        self.assertEqual(len(linktools.extract_title("<title>" + "x" * 500 + "</title>")), 120)

    def test_icon_href_and_normalise(self):
        self.assertEqual(linktools.extract_icon_href('<link rel="shortcut icon" href="/f.ico">'), "/f.ico")
        self.assertIsNone(linktools.extract_icon_href('<link rel="icon" href="/f.svg">'))
        self.assertEqual(linktools.normalise_link("example.com"), "https://example.com")
        self.assertIsNone(linktools.normalise_link("javascript:alert(1)"))
        self.assertIsNone(linktools.normalise_link("two words.com"))
        self.assertEqual(linktools.normalise_link("mailto:a@b.co"), "mailto:a@b.co")


class ResolveLinkEndpointTests(ApiTestCase):
    html = b'<html><head><title>Shop Home</title><link rel="icon" href="/icon.png"></head></html>'

    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.url = API + "tools/resolve-link"

    def responder(self, calls):
        def respond(scheme, host, ip, port, path, accept):
            calls.append((host, ip, path))
            if path == "/icon.png":
                return 200, {"content-type": "image/png"}, png_bytes()
            return 200, {"content-type": "text/html; charset=utf-8"}, self.html
        return respond

    def test_requires_login(self):
        self.assertEqual(APIClient().post(self.url, {"url": "example.com"}, format="json").status_code, 401)

    def test_title_and_favicon_are_returned_and_stored_locally(self):
        calls = []
        with fake_dns({"shop.test": ["93.184.216.34"]}), mock.patch("cards.linktools._request_once", side_effect=self.responder(calls)):
            res = self.person.client.post(self.url, {"url": "shop.test"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["url"], "https://shop.test")
        self.assertEqual(res.data["title"], "Shop Home")
        self.assertTrue(res.data["favicon_url"].startswith("https://api.test/media/icons/fav-"))
        self.assertEqual([c[2] for c in calls], ["/", "/icon.png"])
        name = res.data["favicon_url"].replace("https://api.test/media/", "")
        with Image.open(default_storage.path(name)) as img:
            self.assertEqual(img.size, (128, 128))
        # A second lookup reuses the stored favicon instead of fetching it again.
        calls.clear()
        with fake_dns({"shop.test": ["93.184.216.34"]}), mock.patch("cards.linktools._request_once", side_effect=self.responder(calls)):
            again = self.person.client.post(self.url, {"url": "https://shop.test/"}, format="json")
        self.assertEqual(again.data["favicon_url"], res.data["favicon_url"])
        self.assertEqual(len(calls), 1)  # only the page: the icon is already stored
        self.assertEqual(len([n for n in default_storage.listdir("icons")[1] if n.startswith("fav-")]), 1)

    def test_known_brand_gets_title_but_no_favicon_fetch(self):
        calls = []
        with fake_dns({"instagram.com": ["93.184.216.34"], "www.instagram.com": ["93.184.216.34"]}), \
                mock.patch("cards.linktools._request_once", side_effect=self.responder(calls)):
            res = self.person.client.post(self.url, {"url": "https://www.instagram.com/x"}, format="json")
        self.assertEqual(res.data["title"], "Shop Home")
        self.assertIsNone(res.data["favicon_url"])
        self.assertEqual(len(calls), 1)

    def test_private_target_returns_nulls_not_an_error(self):
        with mock.patch("cards.linktools._request_once") as request:
            for target in ("http://127.0.0.1/", "http://169.254.169.254/", "localhost", "http://10.0.0.1:8080/x"):
                res = self.person.client.post(self.url, {"url": target}, format="json")
                self.assertEqual(res.status_code, 200, target)
                self.assertIsNone(res.data["title"])
                self.assertIsNone(res.data["favicon_url"])
            request.assert_not_called()

    def test_redirect_into_private_space_returns_nulls(self):
        with fake_dns({"shop.test": ["93.184.216.34"]}), mock.patch(
            "cards.linktools._request_once", return_value=(302, {"location": "http://169.254.169.254/latest"}, b"")
        ) as request:
            res = self.person.client.post(self.url, {"url": "shop.test"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual((res.data["title"], res.data["favicon_url"]), (None, None))
        self.assertEqual(request.call_count, 1)

    def test_network_failure_returns_nulls(self):
        with fake_dns({"shop.test": ["93.184.216.34"]}), mock.patch("cards.linktools._request_once", side_effect=OSError):
            res = self.person.client.post(self.url, {"url": "shop.test"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, {"url": "https://shop.test", "title": None, "favicon_url": None})

    def test_unsafe_scheme_and_missing_url_are_validation_errors(self):
        self.assertEqual(self.person.client.post(self.url, {"url": "javascript:alert(1)"}, format="json").status_code, 400)
        self.assertEqual(self.person.client.post(self.url, {}, format="json").status_code, 400)

    def test_mailto_is_returned_without_fetching(self):
        with mock.patch("cards.linktools._request_once") as request:
            res = self.person.client.post(self.url, {"url": "mailto:a@b.co"}, format="json")
        self.assertEqual(res.data, {"url": "mailto:a@b.co", "title": None, "favicon_url": None})
        request.assert_not_called()

    def test_throttled_per_user(self):
        from django.test import override_settings

        from .base import BIG_RATES

        with override_settings(ILAF_THROTTLE_RATES=dict(BIG_RATES, resolve_link="2/min")):
            codes = [self.person.client.post(self.url, {"url": "mailto:a@b.co"}, format="json").status_code for _ in range(3)]
        self.assertEqual(codes, [200, 200, 429])
