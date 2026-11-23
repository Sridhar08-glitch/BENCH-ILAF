import base64
import re

from rest_framework.test import APIClient

from cards.vcard import escape_text, fold

from .base import API, ApiTestCase, png_upload


def unfold(text):
    return text.replace("\r\n ", "")


class VcardUnitTests(ApiTestCase):
    def test_escape_text(self):
        self.assertEqual(escape_text("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne")
        self.assertEqual(escape_text("one\r\ntwo\rthree"), "one\\ntwo\\nthree")
        self.assertEqual(escape_text(None), "")

    def test_fold_never_splits_multibyte_characters(self):
        line = "NOTE:" + "é" * 80 + "ツ" * 30
        folded = fold(line)
        for physical in folded.split("\r\n"):
            self.assertLessEqual(len(physical.encode("utf-8")), 75)
        self.assertEqual(unfold(folded), line)
        self.assertEqual(fold("short"), "short")


class VcardEndpointTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.anon = APIClient()

    def card(self, items, **fields):
        return self.published_card(self.person, items=items, **fields)

    def vcard(self, card):
        res = self.anon.get(f"{API}public/cards/{card['public_code']}/vcard")
        self.assertEqual(res.status_code, 200)
        return res, unfold(res.content.decode())

    def test_headers_and_basic_fields(self):
        card = self.card(
            [{"kind": "Mobile", "value": "+974 5555 1111"}, {"kind": "Landline", "value": "+974 4444 0000"},
             {"kind": "Email", "value": "alice@example.com"}, {"kind": "Website", "value": "https://alice.example"}],
            name="Alice Anderson", title="Lead, Design; R&D", company="Smith, Jones; & Co", address="1 Main St\nDoha",
            slug="alice-card",
        )
        res, text = self.vcard(card)
        self.assertEqual(res["Content-Type"], "text/vcard; charset=utf-8")
        self.assertIn('attachment; filename="alice-card.vcf"', res["Content-Disposition"])
        self.assertTrue(text.startswith("BEGIN:VCARD\r\nVERSION:3.0\r\n"))
        self.assertTrue(text.endswith("END:VCARD\r\n"))
        self.assertIn("\r\nFN:Alice Anderson\r\n", text)
        self.assertIn("\r\nN:Anderson;Alice;;;\r\n", text)
        self.assertIn("\r\nORG:Smith\\, Jones\\; & Co\r\n", text)
        self.assertIn("\r\nTITLE:Lead\\, Design\\; R&D\r\n", text)
        self.assertIn("\r\nTEL;TYPE=CELL:+974 5555 1111\r\n", text)
        self.assertIn("\r\nTEL;TYPE=WORK,VOICE:+974 4444 0000\r\n", text)
        self.assertIn("\r\nEMAIL;TYPE=INTERNET:alice@example.com\r\n", text)
        self.assertIn("\r\nURL:https://alice.example\r\n", text)
        self.assertIn("\r\nADR;TYPE=WORK:;;1 Main St\\nDoha;;;;\r\n", text)
        self.assertIn("\r\nNOTE:Saved from my BENCH card\r\n", text)
        self.assertNotIn("\n\n", text.replace("\r\n", "\n"))

    def test_whatsapp_is_a_tel_and_not_duplicated(self):
        card = self.card([
            {"kind": "Mobile", "value": "+974 5555 1111"},
            {"kind": "WhatsApp", "value": "+97455551111"},
            {"kind": "WhatsApp", "value": "+974 6666 2222"},
            {"kind": "SMS", "value": "+974-5555-1111"},
        ])
        _, text = self.vcard(card)
        tel_lines = re.findall(r"^TEL[^\r]*", text, re.M)
        self.assertEqual(len(tel_lines), 2)
        self.assertIn("TEL;TYPE=CELL:+974 6666 2222", tel_lines)
        self.assertNotIn("wa.me", text)

    def test_social_links_use_itemN_url_with_label(self):
        card = self.card([
            {"kind": "Instagram", "value": "@alice"}, {"kind": "LinkedIn", "value": "https://linkedin.com/in/alice"},
            {"kind": "Website", "value": "alice.example"},
            {"kind": "Custom", "value": "shop.example.com/menu", "label": "Our shop"},
        ])
        _, text = self.vcard(card)
        self.assertIn("\r\nitem1.URL:https://shop.example.com/menu\r\nitem1.X-ABLabel:Our shop\r\n", text)
        self.assertIn("\r\nitem2.URL:https://instagram.com/alice\r\nitem2.X-ABLabel:Instagram\r\n", text)
        self.assertIn("\r\nitem3.URL:https://linkedin.com/in/alice\r\nitem3.X-ABLabel:LinkedIn\r\n", text)
        self.assertIn("\r\nURL:https://alice.example\r\n", text)

    def test_custom_email_and_phone_are_saved_as_such(self):
        card = self.card([
            {"kind": "Custom", "value": "team@example.com", "label": "Team"}, {"kind": "Custom", "value": "+974 7777 3333"},
        ])
        _, text = self.vcard(card)
        self.assertIn("EMAIL;TYPE=INTERNET:team@example.com", text)
        self.assertIn("TEL;TYPE=CELL:+97477773333", text)

    def test_off_and_empty_items_are_left_out(self):
        card = self.card([
            {"kind": "Email", "value": "hidden@example.com", "on": False}, {"kind": "Mobile", "value": ""},
            {"kind": "Email", "value": "shown@example.com"},
        ])
        _, text = self.vcard(card)
        self.assertNotIn("hidden@example.com", text)
        self.assertIn("shown@example.com", text)
        self.assertNotIn("TEL", text)

    def test_options_are_respected(self):
        items = [
            {"kind": "Mobile", "value": "+97455551111"}, {"kind": "Email", "value": "a@example.com"},
            {"kind": "Website", "value": "https://w.example"}, {"kind": "Instagram", "value": "alice"},
        ]
        card = self.card(items, address="Somewhere")
        self.person.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload((600, 600))}, format="multipart")
        _, full = self.vcard(card)
        self.assertIn("PHOTO;ENCODING=b;TYPE=JPEG:", full)
        off = {"company": False, "photo": False, "phones": False, "emails": False, "urls": False, "social": False, "addr": False, "note": ""}
        self.person.client.patch(f"{API}cards/{card['id']}", {"vc": off}, format="json")
        _, text = self.vcard(card)
        for absent in ("ORG:", "PHOTO", "TEL", "EMAIL", "URL", "ADR", "NOTE", "item1"):
            self.assertNotIn(absent, text, absent)
        self.assertIn("FN:Alice Anderson", text)
        self.person.client.patch(f"{API}cards/{card['id']}", {"vc": {"social": True, "note": "Met at expo"}}, format="json")
        _, text = self.vcard(card)
        self.assertIn("item1.URL:https://instagram.com/alice", text)
        self.assertIn("NOTE:Met at expo", text)
        self.assertNotIn("TEL", text)

    def test_photo_is_base64_jpeg_max_256(self):
        card = self.card([])
        self.person.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload((900, 900))}, format="multipart")
        _, text = self.vcard(card)
        encoded = re.search(r"PHOTO;ENCODING=b;TYPE=JPEG:([A-Za-z0-9+/=]+)", text).group(1)
        import io

        from PIL import Image

        img = Image.open(io.BytesIO(base64.b64decode(encoded)))
        self.assertEqual(img.format, "JPEG")
        self.assertEqual(max(img.size), 256)

    def test_physical_lines_are_folded_to_75_octets(self):
        card = self.card([], address="x" * 290)
        res, _ = self.vcard(card)
        for physical in res.content.decode().split("\r\n"):
            self.assertLessEqual(len(physical.encode("utf-8")), 75)

    def test_single_word_name_and_unicode(self):
        card = self.card([], name="Zoë", title="Café – Ünïcode")
        _, text = self.vcard(card)
        self.assertIn("\r\nN:;Zoë;;;\r\n", text)
        self.assertIn("TITLE:Café – Ünïcode", text)
