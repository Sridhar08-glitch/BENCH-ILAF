import json
import os
import tempfile
from pathlib import Path

from django.test import SimpleTestCase, override_settings
from rest_framework.test import APIClient

from ilaf import rsa
from wallet import passes
from workspaces.models import Member

from .base import API, ApiTestCase, png_upload
from .keys import KEY_ONE, KEY_TWO

ISSUER = "3388000000022000001"
SA_EMAIL = "bench-wallet@project-x.iam.gserviceaccount.com"
SERVICE_ACCOUNT = json.dumps({"type": "service_account", "client_email": SA_EMAIL, "private_key": KEY_ONE})
PUBLIC = rsa.PrivateKey.from_pem(KEY_ONE).public()
WALLET = dict(GOOGLE_WALLET_ISSUER_ID=ISSUER, GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=SERVICE_ACCOUNT, GOOGLE_WALLET_SERVICE_ACCOUNT_FILE="")


def decode(save_url, key=PUBLIC):
    assert save_url.startswith("https://pay.google.com/gp/v/save/")
    token = save_url.rsplit("/", 1)[1]
    header, claims, signing_input, signature = rsa.jwt_split(token)
    return header, claims, rsa.verify(signing_input, signature, key)


class ColourTests(SimpleTestCase):
    def test_valid_colours_pass_and_bad_ones_fall_back(self):
        self.assertEqual(passes.safe_background("#101114"), "#101114")
        self.assertEqual(passes.safe_background("#ffffff"), "#FFFFFF")
        self.assertEqual(passes.safe_background("red"), "#101114")
        self.assertEqual(passes.safe_background(None), "#101114")
        self.assertEqual(passes.safe_background("#12345"), "#101114")

    def test_unreadable_middle_tones_are_darkened(self):
        from ilaf.branding import contrast_ratio

        for colour in ("#FF6B35", "#3B82F6", "#808080", "#10B981"):
            out = passes.safe_background(colour)
            self.assertTrue(contrast_ratio(out, "#FFFFFF") >= 4.5 or contrast_ratio(out, "#000000") >= 7, (colour, out))
            self.assertRegex(out, r"^#[0-9A-F]{6}$")


@override_settings(**WALLET)
class WalletEndpointTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        passes._key_cache.clear()
        self.alice = self.signup("alice@example.com", "Alice Anderson")
        self.buy(self.alice)

    def url(self, card):
        return f"{API}cards/{card['id']}/wallet/google"

    def test_save_link_is_a_signed_jwt_with_the_card(self):
        card = self.published_card(self.alice, name="Alice Anderson", title="Designer", company="Studio North")
        self.alice.client.patch(f"{API}cards/{card['id']}", {"items": [
            {"kind": "Mobile", "value": "+971 50 123 4567", "label": "", "on": True},
            {"kind": "Email", "value": "alice@studio.com", "label": "", "on": True},
            {"kind": "Website", "value": "https://studio.com", "label": "", "on": True},
            {"kind": "LinkedIn", "value": "https://linkedin.com/in/alice", "label": "", "on": True},
        ]}, format="json")
        res = self.alice.client.get(self.url(card))
        self.assertEqual(res.status_code, 200, res.content)
        header, claims, valid = decode(res.data["save_url"])
        self.assertTrue(valid)
        self.assertEqual(header["alg"], "RS256")
        self.assertEqual((claims["iss"], claims["aud"], claims["typ"]), (SA_EMAIL, "google", "savetowallet"))
        self.assertEqual(claims["origins"], ["https://web.test"])
        self.assertIsInstance(claims["iat"], int)
        payload = claims["payload"]
        self.assertEqual(payload["genericClasses"], [{"id": f"{ISSUER}.bench_card"}])
        obj = payload["genericObjects"][0]
        self.assertEqual(obj["id"], f"{ISSUER}.{card['public_code']}")
        self.assertEqual(obj["classId"], f"{ISSUER}.bench_card")
        self.assertEqual(obj["state"], "ACTIVE")
        self.assertEqual(obj["header"]["defaultValue"]["value"], "Alice Anderson")
        self.assertEqual(obj["subheader"]["defaultValue"]["value"], "Designer")
        self.assertEqual(obj["cardTitle"]["defaultValue"]["value"], "Studio North")
        self.assertEqual(obj["barcode"]["type"], "QR_CODE")
        self.assertEqual(obj["barcode"]["value"], f"https://web.test/c/{card['public_code']}?s=qr")
        self.assertRegex(obj["hexBackgroundColor"], r"^#[0-9A-F]{6}$")
        modules = {m["id"]: m["body"] for m in obj["textModulesData"]}
        self.assertEqual(modules["phone"], "+971 50 123 4567")
        self.assertEqual(modules["email"], "alice@studio.com")
        self.assertEqual(modules["website"], "https://studio.com")
        uris = [u["uri"] for u in obj["linksModuleData"]["uris"]]
        self.assertEqual(uris[0], f"https://web.test/c/{card['public_code']}")
        self.assertIn("https://linkedin.com/in/alice", uris)
        self.assertNotIn("_warnings", obj)

    def test_signature_fails_under_another_key(self):
        card = self.published_card(self.alice)
        res = self.alice.client.get(self.url(card))
        _, _, valid = decode(res.data["save_url"], rsa.PrivateKey.from_pem(KEY_TWO).public())
        self.assertFalse(valid)

    def test_not_configured_is_503_and_nothing_else_is_revealed(self):
        card = self.published_card(self.alice)
        with override_settings(GOOGLE_WALLET_ISSUER_ID="", GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=""):
            res = self.alice.client.get(self.url(card))
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["error"]["code"], "wallet_not_configured")
        with override_settings(GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=""):
            self.assertEqual(self.alice.client.get(self.url(card)).status_code, 503)

    def test_broken_key_is_503(self):
        card = self.published_card(self.alice)
        passes._key_cache.clear()
        bad = json.dumps({"client_email": SA_EMAIL, "private_key": "nonsense"})
        with override_settings(GOOGLE_WALLET_SERVICE_ACCOUNT_JSON=bad):
            res = self.alice.client.get(self.url(card))
        self.assertEqual(res.status_code, 503)
        self.assertEqual(res.data["error"]["code"], "wallet_not_configured")
        with override_settings(GOOGLE_WALLET_SERVICE_ACCOUNT_JSON="{not json"):
            self.assertEqual(self.alice.client.get(self.url(card)).status_code, 503)

    def test_key_from_a_file(self):
        card = self.published_card(self.alice)
        handle = tempfile.NamedTemporaryFile("w", suffix=".json", delete=False)
        handle.write(SERVICE_ACCOUNT)
        handle.close()
        self.addCleanup(os.unlink, handle.name)
        with override_settings(GOOGLE_WALLET_SERVICE_ACCOUNT_JSON="", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE=handle.name):
            res = self.alice.client.get(self.url(card))
        self.assertEqual(res.status_code, 200)
        self.assertTrue(decode(res.data["save_url"])[2])
        with override_settings(GOOGLE_WALLET_SERVICE_ACCOUNT_JSON="", GOOGLE_WALLET_SERVICE_ACCOUNT_FILE="/no/such/file.json"):
            self.assertEqual(self.alice.client.get(self.url(card)).status_code, 503)

    def test_draft_cards_are_refused(self):
        card = self.make_card(self.alice)
        res = self.alice.client.get(self.url(card))
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "card_not_published")

    def test_permissions(self):
        card = self.published_card(self.alice)
        bob = self.signup("bob@example.com")
        self.assertEqual(bob.client.get(self.url(card)).status_code, 404)
        self.assertEqual(APIClient().get(self.url(card)).status_code, 401)

    def test_company_roles(self):
        owner = self.signup("owner@acme.com")
        ws = self.company(owner)
        emp_a = self.join(self.invite(owner, ws, "a@acme.com"), "emp-pass-a1")
        emp_b = self.join(self.invite(owner, ws, "b@acme.com"), "emp-pass-b1")
        card_a = {"id": str(Member.objects.get(email="a@acme.com").cards.get().id)}
        owner.client.post(f"{API}cards/{card_a['id']}/publish")
        self.assertEqual(emp_a.client.get(self.url(card_a)).status_code, 200)
        self.assertEqual(emp_b.client.get(self.url(card_a)).status_code, 404)  # not their card
        self.assertEqual(owner.client.get(self.url(card_a)).status_code, 200)

    def test_company_palette_colours_the_pass_and_logo_is_included(self):
        owner = self.signup("owner@acme.com")
        ws = self.company(owner)
        owner.client.post(f"{API}workspaces/{ws}/logo", {"file": png_upload()}, format="multipart")
        palette = {"bg": "#0B3D91", "bg2": "#1E56B8", "fg": "#FFFFFF", "acc": "#FFC21A", "on": "#101114"}
        res = owner.client.patch(f"{API}workspaces/{ws}", {"brand": {"colours": {"primary": "#0B3D91", "accent": "#FFC21A", "mode": "brand"}, "palette": palette}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        card = self.published_card(owner, ws=ws)
        res = owner.client.patch(f"{API}cards/{card['id']}", {"design": {"colour": 4}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        res = owner.client.get(self.url(card))
        obj = decode(res.data["save_url"])[1]["payload"]["genericObjects"][0]
        self.assertEqual(obj["hexBackgroundColor"], "#0B3D91")
        self.assertTrue(obj["logo"]["sourceUri"]["uri"].startswith("https://api.test/media/logos/"))
        self.assertEqual(res.data["warnings"], [])

    @override_settings(API_BASE_URL="http://localhost:8100")
    def test_pictures_that_google_cannot_load_are_left_out_with_a_warning(self):
        card = self.published_card(self.alice)
        self.alice.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload()}, format="multipart")
        res = self.alice.client.get(self.url(card))
        obj = decode(res.data["save_url"])[1]["payload"]["genericObjects"][0]
        self.assertEqual(obj["logo"]["sourceUri"]["uri"], "https://web.test/brand/icon-512.png")
        self.assertTrue(any("https" in w for w in res.data["warnings"]), res.data["warnings"])

    def test_no_banner_picture_and_a_logo_is_always_present(self):
        card = self.published_card(self.alice)
        res = self.alice.client.get(self.url(card))
        obj = decode(res.data["save_url"])[1]["payload"]["genericObjects"][0]
        self.assertNotIn("heroImage", obj)
        self.assertEqual(obj["logo"]["sourceUri"]["uri"], "https://web.test/brand/icon-512.png")

    def test_the_pass_colour_follows_the_cards_own_colour_set(self):
        table = passes._colour_table()
        card = self.published_card(self.alice)
        for face, colour in ((14, 0), (14, 1), (44, 2), (250, 3)):
            res = self.alice.client.patch(f"{API}cards/{card['id']}", {"design": {"face": face, "colour": colour}}, format="json")
            self.assertEqual(res.status_code, 200, res.content)
            res = self.alice.client.get(self.url(card))
            obj = decode(res.data["save_url"])[1]["payload"]["genericObjects"][0]
            wanted = passes.safe_background(table["palettes"][table["faces"][face - 1][colour]]["bg"])
            self.assertEqual(obj["hexBackgroundColor"], wanted, (face, colour))

    def test_the_colour_table_matches_the_web_library(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location("build_wallet_colours", Path(__file__).resolve().parent.parent / "scripts" / "build_wallet_colours.py")
        builder = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(builder)
        if not builder.META.exists():
            self.skipTest("the web app is not next to the backend")
        self.assertEqual(passes._colour_table(), builder.read_table(), "run: python scripts/build_wallet_colours.py")

    def test_links_do_not_repeat_the_website_and_address_boxes(self):
        card = self.published_card(self.alice, address="West Bay, Doha")
        self.alice.client.patch(f"{API}cards/{card['id']}", {"items": [
            {"kind": "Website", "value": "https://studio.com", "label": "", "on": True},
            {"kind": "Location", "value": "https://maps.example.com/x", "label": "", "on": True},
            {"kind": "LinkedIn", "value": "https://linkedin.com/in/alice", "label": "", "on": True},
        ]}, format="json")
        res = self.alice.client.get(self.url(card))
        obj = decode(res.data["save_url"])[1]["payload"]["genericObjects"][0]
        uris = [u["uri"] for u in obj["linksModuleData"]["uris"]]
        self.assertEqual(uris, [f"https://web.test/c/{card['public_code']}", "https://linkedin.com/in/alice"])

    def test_big_cards_are_trimmed_to_a_short_link(self):
        card = self.published_card(self.alice, address="1 Long Street " * 8)
        items = [
            {"kind": "Website", "value": f"https://example.com/a/very/long/path/number/{n}/" + "x" * 150, "label": f"Link {n}", "on": True}
            for n in range(8)
        ]
        self.alice.client.patch(f"{API}cards/{card['id']}", {"items": items}, format="json")
        res = self.alice.client.get(self.url(card))
        token = res.data["save_url"].rsplit("/", 1)[1]
        self.assertLessEqual(len(token), passes.MAX_JWT_CHARS)
        self.assertTrue(decode(res.data["save_url"])[2])
