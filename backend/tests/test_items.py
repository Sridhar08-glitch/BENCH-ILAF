"""Unit tests for link rules (no database needed)."""
from django.test import SimpleTestCase

from ilaf.items import ALLOWED_SCHEMES, has_unsafe_scheme, item_href, normalise_custom, scheme_of
from rest_framework.exceptions import ValidationError


class SchemeTests(SimpleTestCase):
    def test_allowed_list_is_the_documented_one(self):
        self.assertEqual(
            set(ALLOWED_SCHEMES),
            {"http", "https", "tel", "mailto", "sms", "skype", "tg", "viber", "facetime", "facetime-audio", "geo"},
        )

    def test_unsafe_schemes(self):
        for value in ("javascript:alert(1)", "DATA:text/html,x", "vbscript:x", "file:///x", "blob:abc", "ftp://x", "about:blank"):
            self.assertTrue(has_unsafe_scheme(value), value)

    def test_safe_values(self):
        for value in ("https://a.com", "tel:+1", "mailto:a@b.co", "example.com", "example.com:8080/x", "+974 555", "@handle", "a@b.co", ""):
            self.assertFalse(has_unsafe_scheme(value), value)

    def test_scheme_of(self):
        self.assertEqual(scheme_of("HTTPS://x"), "https")
        self.assertIsNone(scheme_of("example.com:80"))
        self.assertIsNone(scheme_of("plain"))

    def test_normalise_custom_errors(self):
        with self.assertRaises(ValidationError):
            normalise_custom("hello world")


class HrefTests(SimpleTestCase):
    def test_phone_kinds(self):
        self.assertEqual(item_href("Mobile", "+974 5555-1111"), "tel:+97455551111")
        self.assertEqual(item_href("Landline", "00974 4444 0000"), "tel:+97444440000")
        self.assertEqual(item_href("Mobile", "055 123 4567"), "tel:0551234567")
        self.assertEqual(item_href("SMS", "+974 5555 1111"), "sms:+97455551111")
        self.assertEqual(item_href("Mobile", "tel:+97455551111"), "tel:+97455551111")

    def test_whatsapp(self):
        self.assertEqual(item_href("WhatsApp", "+974 5555 1111"), "https://wa.me/97455551111")
        self.assertEqual(item_href("WhatsApp", "https://wa.me/97455551111"), "https://wa.me/97455551111")

    def test_email(self):
        self.assertEqual(item_href("Email", "a@b.co"), "mailto:a@b.co")
        self.assertEqual(item_href("Email", "mailto:a@b.co"), "mailto:a@b.co")

    def test_location(self):
        self.assertEqual(item_href("Location", "https://maps.app.goo.gl/abc"), "https://maps.app.goo.gl/abc")
        self.assertEqual(
            item_href("Location", "Doha Corniche, Qatar"),
            "https://www.google.com/maps/search/?api=1&query=Doha%20Corniche%2C%20Qatar",
        )
        self.assertEqual(item_href("Location", "geo:25.2,51.5"), "geo:25.2,51.5")

    def test_social_handles_become_profile_urls(self):
        cases = {
            ("Instagram", "@jane"): "https://instagram.com/jane",
            ("Facebook", "jane"): "https://facebook.com/jane",
            ("X", "jane"): "https://x.com/jane",
            ("TikTok", "@jane"): "https://tiktok.com/@jane",
            ("LinkedIn", "jane-doe"): "https://linkedin.com/in/jane-doe",
            ("YouTube", "janetv"): "https://youtube.com/@janetv",
            ("Snapchat", "jane"): "https://snapchat.com/add/jane",
            ("Telegram", "jane"): "https://t.me/jane",
            ("GitHub", "jane"): "https://github.com/jane",
        }
        for (kind, value), expected in cases.items():
            self.assertEqual(item_href(kind, value), expected, (kind, value))

    def test_urls_and_domains(self):
        self.assertEqual(item_href("Website", "example.com"), "https://example.com")
        self.assertEqual(item_href("Website", "http://example.com/a?b=1"), "http://example.com/a?b=1")
        self.assertEqual(item_href("Instagram", "instagram.com/jane"), "https://instagram.com/jane")
        self.assertEqual(item_href("Website", "//evil.example"), "https://evil.example")
        self.assertEqual(item_href("Custom", "skype:live.name?call"), "skype:live.name?call")
        self.assertEqual(item_href("Calendly", "jane/30min"), "https://calendly.com/jane/30min")

    def test_never_returns_a_script_link(self):
        for kind in ("Website", "Custom", "Instagram", "Location", "Email", "Mobile"):
            self.assertEqual(item_href(kind, "javascript:alert(1)"), "")
            self.assertEqual(item_href(kind, "data:text/html,x"), "")

    def test_text_with_spaces_has_no_link(self):
        self.assertEqual(item_href("Website", "my web site"), "")
        self.assertEqual(item_href("Website", ""), "")
