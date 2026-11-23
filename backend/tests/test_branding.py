import io

from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image

from ilaf.branding import contrast_ratio

from .base import API, ApiTestCase, png_upload

PALETTE = {"bg": "#0f2d5c", "bg2": "#173d78", "fg": "#ffffff", "acc": "#d2a63b", "on": "#101010"}
COLOURS = {"primary": "#0f2d5c", "accent": "#d2a63b", "mode": "brand"}
SVG = b'<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'


class BrandingBase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@example.com")
        self.ws = self.company(self.owner)

    def patch_brand(self, brand, client=None, ws=None):
        return (client or self.owner.client).patch(f"{API}workspaces/{ws or self.ws}", {"brand": brand}, format="json")

    def brand(self):
        return self.owner.client.get(f"{API}workspaces/{self.ws}").data["brand"]

    def upload(self, path, file, client=None, ws=None):
        return (client or self.owner.client).post(
            f"{API}workspaces/{ws or self.ws}/{path}", {"file": file}, format="multipart"
        )

    def employee(self):
        member = self.invite(self.owner, self.ws, "eve@example.com")
        return self.join(member), member


class BrandDefaultsAndPaletteTests(BrandingBase):
    def test_new_company_has_all_defaults_and_null_urls(self):
        brand = self.brand()
        self.assertIsNone(brand["colours"])
        self.assertIsNone(brand["palette"])
        self.assertEqual(brand["logo_display"], "auto")
        self.assertEqual(brand["logo_placement"], "both")
        self.assertEqual(brand["logo_corner"], "auto")
        self.assertEqual(brand["logo_chip"], "auto")
        self.assertIs(brand["show_company_name"], True)
        self.assertEqual(brand["artwork"]["mode"], "none")
        self.assertEqual(brand["artwork"]["background"], {"kind": "none", "sample": None, "strength": 60})
        self.assertEqual(brand["artwork"]["pattern"]["opacity"], 18)
        self.assertEqual(brand["artwork"]["template"]["zone"], "A")
        for key in ("logo_url", "symbol_url", "background_url", "template_front_url", "template_back_url"):
            self.assertIsNone(brand[key])

    def test_old_stored_brand_gets_defaults_lazily(self):
        from workspaces.models import Workspace

        Workspace.objects.filter(pk=self.ws).update(brand={"company_name": "Old", "website": ""})
        brand = self.brand()
        self.assertEqual(brand["logo_display"], "auto")
        self.assertEqual(brand["artwork"]["mode"], "none")
        self.assertEqual(brand["design"]["face"], 1)

    def test_valid_palette_and_colours_saved(self):
        res = self.patch_brand({"colours": COLOURS, "palette": PALETTE})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["brand"]["palette"], PALETTE)
        self.assertEqual(res.data["brand"]["colours"], COLOURS)

    def test_palette_contrast_refusals_name_the_pair(self):
        cases = (
            ({**PALETTE, "fg": "#1a3a6e"}, "main background"),
            ({**PALETTE, "bg2": "#ffffff", "fg": "#ffffff"}, "second background"),
            ({**PALETTE, "on": "#d2a63c"}, "accent"),
        )
        for palette, words in cases:
            res = self.patch_brand({"palette": palette})
            self.assertEqual(res.status_code, 400, palette)
            self.assertEqual(res.data["error"]["code"], "validation_error")
            messages = res.data["error"]["fields"]["brand.palette"]
            self.assertTrue(any(words in m for m in messages), messages)
        self.assertIsNone(self.brand()["palette"])

    def test_contrast_helper_matches_wcag(self):
        self.assertAlmostEqual(contrast_ratio("#000000", "#ffffff"), 21.0, places=1)
        self.assertAlmostEqual(contrast_ratio("#777777", "#ffffff"), 4.48, places=1)

    def test_palette_bad_values(self):
        for palette in ({**PALETTE, "bg": "red"}, {**PALETTE, "fg": "#fff"}, {"bg": "#000000"}, "dark",
                        {**PALETTE, "extra": "#000000"}):
            res = self.patch_brand({"palette": palette})
            self.assertEqual(res.status_code, 400, palette)
            self.assertIn("brand.palette", " ".join(res.data["error"]["fields"]))

    def test_colours_bad_values(self):
        for colours in ({"primary": "#0f2d5c"}, {**COLOURS, "mode": "neon"}, {**COLOURS, "accent": "gold"}, "x"):
            res = self.patch_brand({"colours": colours})
            self.assertEqual(res.status_code, 400, colours)

    def test_palette_null_removes_company_colours(self):
        self.patch_brand({"palette": PALETTE})
        res = self.patch_brand({"palette": None})
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["brand"]["palette"])


class SimpleOptionTests(BrandingBase):
    def test_each_option_accepts_listed_values_and_refuses_others(self):
        good = {
            "logo_display": ("symbol", "symbol_name", "full", "auto"),
            "logo_placement": ("card", "above", "both"),
            "logo_corner": ("tl", "tr", "bl", "br", "auto"),
            "logo_chip": ("always", "never", "white", "black", "auto"),
        }
        for key, values in good.items():
            for value in values:
                res = self.patch_brand({key: value})
                self.assertEqual(res.status_code, 200, (key, value))
                self.assertEqual(res.data["brand"][key], value)
            res = self.patch_brand({key: "nope"})
            self.assertEqual(res.status_code, 400)
            self.assertIn(f"brand.{key}", res.data["error"]["fields"])
        res = self.patch_brand({"show_company_name": False})
        self.assertIs(res.data["brand"]["show_company_name"], False)
        self.assertEqual(self.patch_brand({"show_company_name": "no"}).status_code, 400)

    def test_artwork_values(self):
        art = {
            "mode": "pattern",
            "background": {"kind": "sample", "sample": "mesh", "strength": 40},
            "pattern": {"enabled": True, "size": "l", "spacing": "wide", "angle": -30, "opacity": 25,
                        "combine_with_background": True},
            "template": {"kind": "sample", "sample": "night", "zone": "C", "text_colour": "#ffffff", "text_size": "s"},
        }
        res = self.patch_brand({"artwork": art})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["brand"]["artwork"], art)

    def test_artwork_refusals(self):
        bad = (
            {"mode": "poster"},
            {"background": {"kind": "sample", "sample": "unknown"}},
            {"background": {"kind": "sample", "sample": None}},
            {"background": {"strength": 101}},
            {"background": {"strength": -1}},
            {"pattern": {"opacity": 4}}, {"pattern": {"opacity": 61}}, {"pattern": {"angle": 45}},
            {"pattern": {"size": "xl"}}, {"pattern": {"spacing": "x"}}, {"pattern": {"enabled": "yes"}},
            {"template": {"zone": "E"}}, {"template": {"text_colour": "blue"}}, {"template": {"text_size": "xl"}},
            {"template": {"kind": "sample", "sample": "harbour"}},
            {"background": {"kind": "upload"}},  # no picture uploaded yet
            {"template": {"kind": "upload"}},
            {"nope": 1}, {"pattern": {"nope": 1}},
        )
        for art in bad:
            res = self.patch_brand({"artwork": art})
            self.assertEqual(res.status_code, 400, art)
            self.assertTrue(any(k.startswith("brand.artwork") for k in res.data["error"]["fields"]), art)

    def test_partial_patch_merges_nested_values(self):
        self.patch_brand({"logo_chip": "white", "artwork": {"pattern": {"enabled": True, "opacity": 30}}})
        res = self.patch_brand({"artwork": {"pattern": {"size": "s"}}, "website": "https://acme.test"})
        brand = res.data["brand"]
        self.assertEqual(brand["artwork"]["pattern"], {
            "enabled": True, "size": "s", "spacing": "normal", "angle": 0, "opacity": 30,
            "combine_with_background": False,
        })
        self.assertEqual(brand["logo_chip"], "white")
        self.assertEqual(brand["website"], "https://acme.test")
        res = self.patch_brand({"design": {"face": 20}})
        self.assertEqual(res.data["brand"]["logo_chip"], "white")
        self.assertEqual(res.data["brand"]["artwork"]["pattern"]["opacity"], 30)


class CompanyColourTests(BrandingBase):
    def test_colour_four_needs_a_palette(self):
        res = self.patch_brand({"design": {"colour": 4}})
        self.assertEqual(res.status_code, 400)
        self.assertIn("brand.design.colour", res.data["error"]["fields"])
        res = self.patch_brand({"palette": PALETTE, "design": {"colour": 4}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["brand"]["design"]["colour"], 4)

    def test_card_colour_four_rules(self):
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {}}, format="json")
        eve, member = self.employee()
        url = f"{API}cards/{member['card_id']}"
        res = eve.client.patch(url, {"design": {"colour": 4}}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("design.colour", res.data["error"]["fields"])
        self.patch_brand({"palette": PALETTE})
        res = eve.client.patch(url, {"design": {"colour": 4}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["design"]["colour"], 4)

    def test_personal_card_cannot_use_colour_four(self):
        person = self.signup("solo@example.com")
        self.buy(person)
        card = self.make_card(person)
        res = person.client.patch(f"{API}cards/{card['id']}", {"design": {"colour": 4}}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("design.colour", res.data["error"]["fields"])

    def test_removing_palette_falls_back_to_zero_everywhere(self):
        eve, member = self.employee()
        self.patch_brand({"palette": PALETTE, "design": {"colour": 4}})
        url = f"{API}cards/{member['card_id']}"
        eve.client.patch(url, {"design": {"colour": 4}}, format="json")
        res = self.patch_brand({"palette": None})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["brand"]["design"]["colour"], 0)
        card = eve.client.get(url).data
        self.assertEqual(card["design"]["colour"], 0)  # no error, falls back at read time
        from cards.models import Card

        self.assertEqual(Card.objects.get(pk=member["card_id"]).design["colour"], 4)  # stored value kept
        # Back again with a palette: the card shows company colours again.
        self.patch_brand({"palette": PALETTE})
        self.assertEqual(eve.client.get(url).data["design"]["colour"], 4)

    def test_company_design_takes_font_and_size_and_locks_them(self):
        eve, member = self.employee()
        res = self.patch_brand({"lock_design": True, "design": {"font": "cormorant", "size": 85}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["brand"]["design"]["font"], res.data["brand"]["design"]["size"]), ("cormorant", 85))
        url = f"{API}cards/{member['card_id']}"
        res = eve.client.patch(url, {"design": {"font": "lora", "size": 130}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["design"]["font"], res.data["design"]["size"]), ("cormorant", 85))
        for bad in ({"font": "nope"}, {"size": 59}, {"size": 150.0}):
            res = self.patch_brand({"design": bad})
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn(f"brand.design.{list(bad)[0]}", res.data["error"]["fields"])
        self.patch_brand({"lock_design": False})
        res = eve.client.patch(url, {"design": {"font": "lora", "size": 130}}, format="json")
        self.assertEqual((res.data["design"]["font"], res.data["design"]["size"]), ("lora", 130))

    def test_locked_company_design_colour_four(self):
        eve, member = self.employee()
        res = self.patch_brand({"palette": PALETTE, "lock_design": True, "design": {"colour": 4, "face": 14}})
        self.assertEqual(res.status_code, 200, res.content)
        url = f"{API}cards/{member['card_id']}"
        card = eve.client.get(url).data
        self.assertEqual((card["design"]["face"], card["design"]["colour"]), (14, 4))
        res = eve.client.patch(url, {"design": {"colour": 1, "photo": False}}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["design"]["colour"], 4)  # locked colour wins
        self.assertIs(res.data["design"]["photo"], False)
        # A new invite starts from the company design, colour four included.
        newer = self.invite(self.owner, self.ws, "zed@example.com")
        self.assertEqual(self.owner.client.get(f"{API}cards/{newer['card_id']}").data["design"]["colour"], 4)
        self.patch_brand({"palette": None})
        self.assertEqual(eve.client.get(url).data["design"]["colour"], 0)

    def test_new_invite_without_palette_never_gets_colour_four(self):
        newer = self.invite(self.owner, self.ws, "zed@example.com")
        self.assertEqual(self.owner.client.get(f"{API}cards/{newer['card_id']}").data["design"]["colour"], 0)


class BrandFileTests(BrandingBase):
    slots = (
        ("symbol", "symbol_url", ".png"),
        ("background", "background_url", ".jpg"),
        ("template-front", "template_front_url", ".jpg"),
        ("template-back", "template_back_url", ".jpg"),
    )

    def test_upload_and_delete_each_slot(self):
        for path, key, ext in self.slots:
            res = self.upload(path, png_upload((2400, 1200)))
            self.assertEqual(res.status_code, 200, (path, res.content))
            self.assertTrue(res.data[key].endswith(ext), res.data)
            self.assertEqual(self.brand()[key], res.data[key])
        for path, key, ext in self.slots:
            res = self.owner.client.delete(f"{API}workspaces/{self.ws}/{path}")
            self.assertEqual(res.status_code, 204)
            self.assertIsNone(self.brand()[key])
            self.assertEqual(self.owner.client.delete(f"{API}workspaces/{self.ws}/{path}").status_code, 204)

    def test_images_are_resized(self):
        res = self.upload("background", png_upload((3000, 1500)))
        from workspaces.models import Workspace

        with Image.open(Workspace.objects.get(pk=self.ws).background.path) as img:
            self.assertEqual(img.format, "JPEG")
            self.assertEqual(max(img.size), 1600)
        res = self.upload("symbol", png_upload((2000, 2000), mode="RGBA", color=(10, 20, 30, 0)))
        with Image.open(Workspace.objects.get(pk=self.ws).symbol.path) as img:
            self.assertEqual(img.format, "PNG")
            self.assertEqual(max(img.size), 1024)
            self.assertEqual(img.mode, "RGBA")
        self.assertEqual(res.status_code, 200)

    def test_webp_and_jpeg_accepted_names_unguessable(self):
        a = self.upload("background", png_upload((800, 600), fmt="WEBP", name="a.webp"))
        self.assertEqual(a.status_code, 200)
        b = self.upload("background", png_upload((800, 600), fmt="JPEG", name="b.jpg"))
        self.assertEqual(b.status_code, 200)
        self.assertNotEqual(a.data["background_url"], b.data["background_url"])
        self.assertRegex(b.data["background_url"], r"-[0-9a-f]{32}\.jpg$")

    def test_replacing_removes_the_old_file(self):
        from workspaces.models import Workspace

        self.upload("symbol", png_upload((100, 100)))
        old = Workspace.objects.get(pk=self.ws).symbol.path
        self.upload("symbol", png_upload((120, 120)))
        import os

        self.assertFalse(os.path.exists(old))

    def test_refusals(self):
        for path, _, _ in self.slots:
            res = self.upload(path, SimpleUploadedFile("x.svg", SVG, content_type="image/svg+xml"))
            self.assertEqual(res.status_code, 400, path)
            self.assertIn("SVG", res.data["error"]["fields"]["file"][0])
            res = self.upload(path, SimpleUploadedFile("x.png", b"not an image", content_type="image/png"))
            self.assertEqual(res.status_code, 400)
            res = self.owner.client.post(f"{API}workspaces/{self.ws}/{path}", {}, format="multipart")
            self.assertEqual(res.status_code, 400)

    def test_gif_refused(self):
        buffer = io.BytesIO()
        Image.new("RGB", (20, 20), "red").save(buffer, format="GIF")
        res = self.upload("symbol", SimpleUploadedFile("a.gif", buffer.getvalue(), content_type="image/gif"))
        self.assertEqual(res.status_code, 400)

    def test_size_limit_three_megabytes(self):
        big = SimpleUploadedFile("big.png", b"\x89PNG" + b"0" * (3 * 1024 * 1024 + 10), content_type="image/png")
        res = self.upload("background", big)
        self.assertEqual(res.status_code, 400)
        self.assertIn("3 MB", res.data["error"]["fields"]["file"][0])

    def test_permissions_by_role(self):
        eve, _ = self.employee()
        for path, _, _ in self.slots:
            self.assertEqual(self.upload(path, png_upload((50, 50)), client=eve.client).status_code, 403)
            self.assertEqual(eve.client.delete(f"{API}workspaces/{self.ws}/{path}").status_code, 403)
        stranger = self.signup("stranger@example.com")
        self.assertEqual(self.upload("symbol", png_upload((50, 50)), client=stranger.client).status_code, 404)
        self.assertEqual(stranger.client.delete(f"{API}workspaces/{self.ws}/symbol").status_code, 404)
        anon = self.client_for()
        self.assertEqual(self.upload("symbol", png_upload((50, 50)), client=anon).status_code, 401)

    def test_admin_may_upload(self):
        member = self.invite(self.owner, self.ws, "ada@example.com", role="admin")
        ada = self.join(member, full_name="Ada Admin")
        self.assertEqual(self.upload("background", png_upload((50, 50)), client=ada.client).status_code, 200)

    def test_personal_workspace_refuses_branding_uploads(self):
        person = self.signup("solo@example.com")
        for path, _, _ in self.slots:
            res = self.upload(path, png_upload((50, 50)), client=person.client, ws=person.ws)
            self.assertEqual(res.status_code, 400, path)
            self.assertEqual(res.data["error"]["code"], "validation_error")
            self.assertEqual(person.client.delete(f"{API}workspaces/{person.ws}/{path}").status_code, 400)

    def test_upload_kind_needs_file_and_delete_resets_it(self):
        self.upload("background", png_upload((300, 200)))
        res = self.patch_brand({"artwork": {"mode": "background", "background": {"kind": "upload"}}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["brand"]["artwork"]["background"]["kind"], "upload")
        self.owner.client.delete(f"{API}workspaces/{self.ws}/background")
        art = self.brand()["artwork"]
        self.assertEqual(art["background"]["kind"], "none")
        self.upload("template-front", png_upload((300, 200)))
        self.patch_brand({"artwork": {"mode": "template", "template": {"kind": "upload", "zone": "B"}}})
        self.owner.client.delete(f"{API}workspaces/{self.ws}/template-front")
        tpl = self.brand()["artwork"]["template"]
        self.assertEqual((tpl["kind"], tpl["zone"]), ("none", "B"))

    def test_logo_delete(self):
        self.upload("logo", png_upload((300, 200)))
        self.assertIsNotNone(self.brand()["logo_url"])
        self.assertEqual(self.owner.client.delete(f"{API}workspaces/{self.ws}/logo").status_code, 204)
        self.assertIsNone(self.brand()["logo_url"])
        self.assertEqual(self.owner.client.delete(f"{API}workspaces/{self.ws}/logo").status_code, 204)
        eve, _ = self.employee()
        self.assertEqual(eve.client.delete(f"{API}workspaces/{self.ws}/logo").status_code, 403)


class PersonalWorkspaceTests(ApiTestCase):
    def test_personal_brand_output_has_defaults_and_explicit_writes_are_refused(self):
        person = self.signup()
        ws = person.client.get(f"{API}workspaces/{person.ws}").data
        self.assertIsNone(ws["brand"]["palette"])
        self.assertEqual(ws["brand"]["logo_display"], "auto")
        self.assertIsNone(ws["brand"]["symbol_url"])
        for brand in ({"palette": PALETTE}, {"logo_display": "full"}, {"artwork": {"mode": "pattern"}},
                      {"show_company_name": False}, {"colours": COLOURS}):
            res = person.client.patch(f"{API}workspaces/{person.ws}", {"brand": brand}, format="json")
            self.assertEqual(res.status_code, 400, brand)
            self.assertIn(f"brand.{list(brand)[0]}", res.data["error"]["fields"])
        # Writes that do not mention branding keys still work.
        res = person.client.patch(f"{API}workspaces/{person.ws}", {"brand": {"website": "https://a.test"}}, format="json")
        self.assertEqual(res.status_code, 200)


class PublicBrandTests(BrandingBase):
    def test_public_payload_for_company_and_personal_cards(self):
        eve, member = self.employee()
        eve.client.patch(f"{API}cards/{member['card_id']}", {"items": [{"kind": "Email", "value": "e@x.com"}]}, format="json")
        card = eve.client.post(f"{API}cards/{member['card_id']}/publish").data
        self.upload("logo", png_upload((400, 200)))
        self.upload("symbol", png_upload((100, 100)))
        self.upload("background", png_upload((800, 400)))
        self.upload("template-front", png_upload((800, 400)))
        self.upload("template-back", png_upload((800, 400)))
        self.patch_brand({
            "palette": PALETTE, "logo_display": "symbol_name", "logo_chip": "white", "show_company_name": False,
            "artwork": {"mode": "background", "background": {"kind": "upload", "strength": 70}},
            "design": {"colour": 4},
        })
        eve.client.patch(f"{API}cards/{member['card_id']}", {"design": {"colour": 4}}, format="json")
        data = self.client_for().get(f"{API}public/cards/{card['public_code']}").data["card"]
        brand = data["brand"]
        self.assertEqual(set(brand), {
            "company_name", "logo_url", "symbol_url", "palette", "logo_display", "logo_placement", "logo_corner",
            "logo_chip", "show_company_name", "artwork", "background_url", "template_front_url", "template_back_url",
            "verified_domain",
        })
        self.assertEqual(brand["palette"], PALETTE)
        self.assertEqual(brand["logo_display"], "symbol_name")
        self.assertIs(brand["show_company_name"], False)
        self.assertEqual(brand["artwork"]["background"]["kind"], "upload")
        for key in ("logo_url", "symbol_url", "background_url", "template_front_url", "template_back_url"):
            self.assertTrue(brand[key].startswith("https://api.test/media/"), (key, brand[key]))
        self.assertEqual(data["design"]["colour"], 4)
        # Palette removed: the effective design falls back and the payload carries no palette.
        self.patch_brand({"palette": None})
        data = self.client_for().get(f"{API}public/cards/{card['public_code']}").data["card"]
        self.assertEqual(data["design"]["colour"], 0)
        self.assertIsNone(data["brand"]["palette"])

        person = self.signup("solo@example.com")
        self.buy(person)
        mine = self.published_card(person)
        self.assertIsNone(self.client_for().get(f"{API}public/cards/{mine['public_code']}").data["card"]["brand"])
