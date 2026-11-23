"""The extra button kinds: per-kind link rules, and the uploaded PDF behind a "Download file" button."""
import io
import shutil
import tempfile

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from rest_framework.exceptions import ValidationError
from rest_framework.test import APIClient

from ilaf.items import KINDS, item_href, validate_value

from .base import API, ApiTestCase

GOOD = {
    "Document": "https://northgate.com/catalogue.pdf",
    "Menu": "https://northgate.com/menu",
    "Vimeo": "vimeo.com/12345",
    "Loom": "https://www.loom.com/share/abc",
    "GoogleReview": "https://g.page/r/CabC/review",
    "Trustpilot": "https://www.trustpilot.com/review/northgate.com",
    "TripAdvisor": "https://www.tripadvisor.co.uk/Hotel_Review-g1",
    "AppleMaps": "https://maps.apple.com/?q=cafe",
    "WhatsAppChannel": "https://whatsapp.com/channel/0029Vabc",
    "Airbnb": "https://www.airbnb.com/rooms/1",
    "Etsy": "https://www.etsy.com/shop/north",
    "Shopify": "https://north.myshopify.com",
    "Amazon": "https://www.amazon.ae/dp/B0",
}


def pdf_bytes(extra=b""):
    return b"%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\n" + extra + b"\ntrailer\n<< >>\n%%EOF\n"


class KindRuleTests(SimpleTestCase):
    def test_every_new_kind_accepts_a_good_link(self):
        for kind, value in GOOD.items():
            self.assertIn(kind, KINDS)
            out = validate_value(kind, value)
            self.assertTrue(out.startswith("https://"), kind)
            self.assertEqual(item_href(kind, out), out)

    def test_http_and_other_schemes_are_refused(self):
        for kind in GOOD:
            for bad in ("http://example.com/x", "javascript:alert(1)", "ftp://example.com/x", "https://user:pw@example.com/x", "not a link"):
                with self.assertRaises(ValidationError, msg=f"{kind} {bad}"):
                    validate_value(kind, bad)

    def test_the_host_must_belong_to_the_site(self):
        for kind, bad in (
            ("Vimeo", "https://youtube.com/watch?v=1"), ("Loom", "https://evil-loom.com/x"), ("GoogleReview", "https://example.com/r"),
            ("Trustpilot", "https://trustpilot.com.evil.io/x"), ("TripAdvisor", "https://example.com/x"), ("AppleMaps", "https://maps.google.com/x"),
            ("Airbnb", "https://example.com/x"), ("Etsy", "https://etsy.evil.com/x"), ("Amazon", "https://example.com/dp/1"),
            ("WhatsAppChannel", "https://whatsapp.com/send?phone=1"),
        ):
            with self.assertRaises(ValidationError, msg=kind):
                validate_value(kind, bad)

    def test_whatsapp_community_invites_are_fine(self):
        self.assertEqual(validate_value("WhatsAppChannel", "https://chat.whatsapp.com/Abc123"), "https://chat.whatsapp.com/Abc123")

    def test_menu_document_and_shopify_take_any_https_site(self):
        for kind in ("Menu", "Document", "Shopify"):
            self.assertEqual(validate_value(kind, "https://anything.example.org/x"), "https://anything.example.org/x")

    def test_download_value_must_look_like_an_uploaded_pdf(self):
        self.assertEqual(validate_value("DownloadFile", "https://api.test/media/files/ab/doc.pdf"), "https://api.test/media/files/ab/doc.pdf")
        for bad in ("https://api.test/media/files/ab/doc.exe", "javascript:alert(1)", "doc.pdf", "https://x/a b.pdf"):
            with self.assertRaises(ValidationError, msg=bad):
                validate_value("DownloadFile", bad)


MEDIA = tempfile.mkdtemp(prefix="bench-files-")


def tearDownModule():  # pragma: no cover
    shutil.rmtree(MEDIA, ignore_errors=True)


@override_settings(MEDIA_ROOT=MEDIA, API_BASE_URL="https://api.test")
class ButtonApiTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup("a@example.com")
        self.buy(self.person, "business")
        self.card = self.make_card(self.person)

    def save_items(self, items, card=None, client=None):
        return (client or self.person.client).patch(f"{API}cards/{(card or self.card)['id']}", {"items": items}, format="json")

    def upload(self, content=None, name="a.pdf", card=None, client=None):
        file = SimpleUploadedFile(name, content if content is not None else pdf_bytes(), content_type="application/pdf")
        return (client or self.person.client).post(f"{API}cards/{(card or self.card)['id']}/file", {"file": file}, format="multipart")

    def test_all_new_kinds_save_and_come_back_with_links(self):
        res = self.save_items([{"kind": k, "value": v} for k, v in GOOD.items()])
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual({i["kind"] for i in res.data["items"]}, set(GOOD))
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        public = APIClient().get(f"{API}public/cards/{self.card['public_code']}").data["card"]["items"]
        self.assertTrue(all(i["href"].startswith("https://") for i in public))

    def test_bad_link_is_a_field_error(self):
        res = self.save_items([{"kind": "Vimeo", "value": "https://youtube.com/x"}])
        self.assertEqual(res.status_code, 400)

    def test_upload_returns_a_random_url_in_the_cards_own_folder(self):
        res = self.upload(name="../../evil name.pdf")
        self.assertEqual(res.status_code, 201, res.content)
        url = res.data["file_url"]
        self.assertTrue(url.startswith("https://api.test/media/files/" + self.card["id"].replace("-", "") + "/doc-"), url)
        self.assertTrue(url.endswith(".pdf"))
        self.assertNotIn("evil", url)
        again = self.upload().data["file_url"]
        self.assertNotEqual(url, again)

    def test_the_uploaded_file_can_be_used_as_a_download_button_with_the_download_flag(self):
        url = self.upload().data["file_url"]
        res = self.save_items([{"kind": "DownloadFile", "value": url, "label": "Brochure"}])
        self.assertEqual(res.status_code, 200, res.content)
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        public = APIClient().get(f"{API}public/cards/{self.card['public_code']}").data["card"]["items"][0]
        self.assertEqual((public["kind"], public["href"], public["download"]), ("DownloadFile", url, True))

    def test_another_cards_file_and_foreign_addresses_cannot_be_used(self):
        other = self.make_card(self.person, name="Second")
        theirs = self.upload(card=other).data["file_url"]
        self.assertEqual(self.save_items([{"kind": "DownloadFile", "value": theirs}]).status_code, 400)
        self.assertEqual(self.save_items([{"kind": "DownloadFile", "value": "https://evil.example/files/x/doc.pdf"}]).status_code, 400)
        stranger = self.signup("b@example.com")
        self.buy(stranger, "personal")
        foreign = self.make_card(stranger)
        self.assertEqual(self.upload(card=foreign).status_code, 404)

    def test_only_real_pdfs_without_active_content_under_ten_megabytes(self):
        self.assertEqual(self.upload(b"MZ\x90\x00 not a pdf", "x.pdf").status_code, 400)
        self.assertEqual(self.upload(b"%PDF-1.4 no end marker", "x.pdf").status_code, 400)
        self.assertEqual(self.upload(pdf_bytes(b"<< /JavaScript (app.alert(1)) >>")).status_code, 400)
        self.assertEqual(self.upload(pdf_bytes(b"<< /Launch >>")).status_code, 400)
        big = pdf_bytes(b"x" * (10 * 1024 * 1024))
        self.assertEqual(self.upload(big).status_code, 400)
        ok = pdf_bytes(b"x" * (9 * 1024 * 1024))
        self.assertEqual(self.upload(ok).status_code, 201)

    def test_a_card_holds_at_most_five_files(self):
        for _ in range(5):
            self.assertEqual(self.upload().status_code, 201)
        res = self.upload()
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "file_limit"))

    def test_duplicate_copies_the_file_and_delete_removes_it(self):
        url = self.upload().data["file_url"]
        self.save_items([{"kind": "DownloadFile", "value": url}])
        copy = self.person.client.post(f"{API}cards/{self.card['id']}/duplicate").data
        copied = copy["items"][0]["value"]
        self.assertIn(copy["id"].replace("-", ""), copied)
        self.assertNotEqual(copied, url)
        self.assertEqual(self.save_items([{"kind": "DownloadFile", "value": copied}], card=copy).status_code, 200)
        from django.core.files.storage import default_storage

        self.person.client.delete(f"{API}cards/{self.card['id']}")
        self.assertEqual(default_storage.listdir("files/" + self.card["id"].replace("-", ""))[1], [])
        self.assertEqual(len(default_storage.listdir("files/" + copy["id"].replace("-", ""))[1]), 1)

    def test_upload_needs_sign_in(self):
        file = SimpleUploadedFile("a.pdf", pdf_bytes(), content_type="application/pdf")
        res = APIClient().post(f"{API}cards/{self.card['id']}/file", {"file": file}, format="multipart")
        self.assertEqual(res.status_code, 401)

    def test_no_file_is_a_clear_error(self):
        res = self.person.client.post(f"{API}cards/{self.card['id']}/file", {}, format="multipart")
        self.assertEqual(res.status_code, 400)
