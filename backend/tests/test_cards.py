from django.core.files.uploadedfile import SimpleUploadedFile
from PIL import Image
from rest_framework.test import APIClient

from cards.models import Card, SlugHistory
from cards.slugs import CODE_ALPHABET

from .base import API, ApiTestCase, png_upload


class CardCrudTests(ApiTestCase):
    def test_a_first_card_can_be_built_before_paying_but_not_published(self):
        person = self.signup()
        res = person.client.post(f"{API}workspaces/{person.ws}/cards", {"name": "A"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["status"], "draft")
        # the first publish starts the 7 free days (see FreeTrialTests); once they have ended, publishing needs a paid plan
        # without a plan there is room for one draft only
        second = person.client.post(f"{API}workspaces/{person.ws}/cards", {"name": "B"}, format="json")
        self.assertEqual((second.status_code, second.data["error"]["code"]), (403, "plan_limit"))

    def test_create_returns_full_card_shape(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        self.assertEqual(
            set(card),
            {"id", "workspace_id", "owner", "public_code", "public_url", "slug", "status", "name", "title", "company",
             "address", "bio", "photo_url", "cover_url", "video_url", "video_poster_url", "save_contact", "language",
             "hide_from_directory", "seo_indexable", "vc", "features", "design", "items", "created_at",
             "updated_at", "stats", "field_access", "pending_changes", "submitted_for_approval", "label", "sort_order", "is_default", "is_company"},
        )
        self.assertEqual(card["status"], "draft")
        self.assertEqual(card["owner"]["email"], person.email)
        self.assertEqual(card["stats"], {"views": 0, "scans": 0, "saves": 0, "leads": 0})
        self.assertEqual(card["public_url"], f"https://web.test/c/{card['public_code']}")
        self.assertEqual(card["design"], {
            "face": 1, "custom_face": None, "colour": 0, "below": 1, "intro": 1, "top": 0, "font": "face", "size": 100, "photo": True, "brand_colors": False, "foot": True,
        })
        self.assertIsNone(card["cover_url"])
        self.assertEqual(card["vc"]["note"], "Saved from my BENCH card")

    def test_name_is_required_on_create(self):
        person = self.signup()
        self.buy(person)
        res = person.client.post(f"{API}workspaces/{person.ws}/cards", {"title": "x"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("name", res.data["error"]["fields"])

    def test_personal_plan_limit(self):
        person = self.signup()
        self.buy(person, "personal")
        self.make_card(person)
        res = person.client.post(f"{API}workspaces/{person.ws}/cards", {"name": "Two"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")

    def test_business_plan_allows_five(self):
        person = self.signup()
        self.buy(person, "business")
        for n in range(5):
            self.make_card(person, name=f"Card {n}")
        res = person.client.post(f"{API}workspaces/{person.ws}/cards", {"name": "Six"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")
        self.assertEqual(len(person.client.get(f"{API}workspaces/{person.ws}/cards").data), 5)

    def test_patch_scalar_fields_and_keep_code(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        res = person.client.patch(
            f"{API}cards/{card['id']}",
            {"name": "New Name", "title": "CEO", "address": "Doha\nQatar", "save_contact": False, "public_code": "hack"},
            format="json",
        )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["name"], "New Name")
        self.assertEqual(res.data["address"], "Doha\nQatar")
        self.assertIs(res.data["save_contact"], False)
        self.assertEqual(res.data["public_code"], card["public_code"])

    def test_items_full_replacement_keeps_ids_and_order(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        items = [
            {"kind": "Mobile", "value": "+974 5555 1111", "label": "Work", "on": True},
            {"kind": "Email", "value": "a@b.co", "label": "", "on": True},
            {"kind": "Website", "value": "example.com", "label": "Site", "on": False},
        ]
        res = person.client.patch(f"{API}cards/{card['id']}", {"items": items}, format="json")
        self.assertEqual(res.status_code, 200)
        got = res.data["items"]
        self.assertEqual([i["kind"] for i in got], ["Mobile", "Email", "Website"])
        self.assertEqual([i["order"] for i in got], [0, 1, 2])
        self.assertIsNone(got[0]["icon"])
        self.assertEqual(set(got[0]), {"id", "kind", "value", "label", "on", "order", "icon"})
        keep_id = got[1]["id"]
        res = person.client.patch(
            f"{API}cards/{card['id']}",
            {"items": [{"id": keep_id, "kind": "Email", "value": "new@b.co"}, {"kind": "Mobile", "value": "123456"}]},
            format="json",
        )
        got = res.data["items"]
        self.assertEqual(len(got), 2)
        self.assertEqual(got[0]["id"], keep_id)
        self.assertEqual(got[0]["value"], "new@b.co")
        self.assertEqual(got[1]["kind"], "Mobile")
        res = person.client.patch(f"{API}cards/{card['id']}", {"items": []}, format="json")
        self.assertEqual(res.data["items"], [])

    def test_patch_without_items_keeps_them(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person, items=[{"kind": "Email", "value": "a@b.co"}])
        res = person.client.patch(f"{API}cards/{card['id']}", {"title": "X"}, format="json")
        self.assertEqual(len(res.data["items"]), 1)

    def test_max_forty_items(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        items = [{"kind": "Custom", "value": f"site{n}.com"} for n in range(41)]
        res = person.client.patch(f"{API}cards/{card['id']}", {"items": items}, format="json")
        self.assertEqual(res.status_code, 400)
        res = person.client.patch(f"{API}cards/{card['id']}", {"items": items[:40]}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_delete_card(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        self.assertEqual(person.client.delete(f"{API}cards/{card['id']}").status_code, 204)
        self.assertEqual(person.client.get(f"{API}cards/{card['id']}").status_code, 404)

    def test_publish_unpublish_duplicate(self):
        person = self.signup()
        self.buy(person, "business")
        card = self.make_card(person, items=[{"kind": "Email", "value": "a@b.co"}])
        res = person.client.post(f"{API}cards/{card['id']}/publish")
        self.assertEqual(res.data["status"], "published")
        res = person.client.post(f"{API}cards/{card['id']}/unpublish")
        self.assertEqual(res.data["status"], "draft")
        res = person.client.post(f"{API}cards/{card['id']}/duplicate")
        self.assertEqual(res.status_code, 201)
        copy = res.data
        self.assertNotEqual(copy["id"], card["id"])
        self.assertNotEqual(copy["public_code"], card["public_code"])
        self.assertEqual(copy["status"], "draft")
        self.assertEqual(copy["name"], "Alice Anderson (copy)")
        self.assertEqual(len(copy["items"]), 1)
        self.assertNotEqual(copy["items"][0]["id"], card["items"][0]["id"] if card["items"] else None)

    def test_duplicate_respects_plan_limit(self):
        person = self.signup()
        self.buy(person, "personal")
        card = self.make_card(person)
        res = person.client.post(f"{API}cards/{card['id']}/duplicate")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")

    def test_publish_needs_live_subscription(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        from billing.models import Subscription
        from datetime import timedelta
        from django.utils import timezone

        Subscription.objects.update(ends_at=timezone.now() - timedelta(days=30))
        res = person.client.post(f"{API}cards/{card['id']}/publish")
        self.assertEqual(res.status_code, 402)
        self.assertEqual(res.data["error"]["code"], "subscription_required")


class DesignTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person)
        self.card = self.make_card(self.person)

    def patch(self, body):
        return self.person.client.patch(f"{API}cards/{self.card['id']}", body, format="json")

    def test_valid_design_is_saved_and_merged(self):
        res = self.patch({"design": {"face": 314, "colour": 2, "brand_colors": True, "intro": 16}})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["design"]["face"], 314)
        self.assertEqual(res.data["design"]["colour"], 2)
        self.assertEqual(res.data["design"]["intro"], 16)
        self.assertIs(res.data["design"]["brand_colors"], True)
        res = self.patch({"design": {"below": 8}})
        self.assertEqual(res.data["design"]["face"], 314)  # earlier values survive a partial update
        self.assertEqual(res.data["design"]["below"], 8)

    def test_every_face_below_and_intro_number_passes_with_design_pack_2_making_500_faces(self):
        from ilaf.design import BELOW_COUNT, FACE_COUNT, INTRO_COUNT, PACK1_FACE_COUNT

        self.assertEqual((FACE_COUNT, PACK1_FACE_COUNT, BELOW_COUNT, INTRO_COUNT), (500, 400, 627, 406))
        for key, values in (("face", (1, 25, 26, 200, 201, 400, 401, 437, 500)), ("below", (1, 12, 200, 400, 401, 427, 428, 477, 478, 527, 528, 627)),
                            ("intro", (0, 1, 22, 400, 401, 406)), ("colour", (0, 1, 2, 3)), ("top", (0, 1, 27, 28, 77, 78, 127, 128, 177, 178, 227))):
            for value in values:
                res = self.patch({"design": {key: value}})
                self.assertEqual(res.status_code, 200, (key, value))
        res = self.patch({"design": {"photo": False, "foot": False}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIs(res.data["design"]["photo"], False)

    def test_pack_2_faces_are_refused_while_their_switch_is_off(self):
        from staff import flags
        from staff.models import FeatureFlag

        FeatureFlag.objects.create(key="pack2_faces", state="off")
        flags.clear_cache()
        try:
            res = self.patch({"design": {"face": 437}})
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_unavailable"))
            self.assertEqual(self.patch({"design": {"face": 401}}).status_code, 403)
            self.assertEqual(self.patch({"design": {"face": 400}}).status_code, 200)
            self.assertEqual(self.patch({"design": {"colour": 2}}).status_code, 200)
            # the switch is per company: a selected one keeps the pack
            FeatureFlag.objects.filter(key="pack2_faces").update(state="selected", company_ids=[str(self.card["workspace_id"])])
            flags.clear_cache()
            self.assertEqual(self.patch({"design": {"face": 500}}).status_code, 200)
        finally:
            FeatureFlag.objects.filter(key="pack2_faces").delete()
            flags.clear_cache()

    def test_invalid_design_values_rejected(self):
        for bad in (
            {"face": 0}, {"face": 501}, {"face": "classic"}, {"face": True}, {"colour": 4}, {"colour": -1},
            {"below": 0}, {"below": 628}, {"intro": -1}, {"intro": 407}, {"intro": "fade-up"}, {"face": 1.5},
            {"top": -1}, {"top": 228}, {"top": "popl"}, {"top": True},
            {"photo": "yes"}, {"brand_colors": 1}, {"foot": None},
        ):
            res = self.patch({"design": bad})
            self.assertEqual(res.status_code, 400, bad)
            self.assertEqual(res.data["error"]["code"], "validation_error")
            self.assertIn(f"design.{list(bad)[0]}", res.data["error"]["fields"])

    def test_old_and_unknown_keys_rejected(self):
        for key in ("layout", "bgm", "btn", "shape", "cover", "addr", "acts", "whatever", "acc", "bg", "details"):
            res = self.patch({"design": {key: "x"}})
            self.assertEqual(res.status_code, 400, key)
            self.assertIn(f"design.{key}", res.data["error"]["fields"])

    def test_new_card_has_the_face_font_and_normal_size(self):
        self.assertEqual(self.card["design"]["font"], "face")
        self.assertEqual(self.card["design"]["size"], 100)

    def test_font_and_size_are_saved_and_merged(self):
        res = self.patch({"design": {"font": "playfair", "size": 120}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["design"]["font"], res.data["design"]["size"]), ("playfair", 120))
        res = self.patch({"design": {"face": 9}})  # an unrelated change keeps both
        self.assertEqual((res.data["design"]["font"], res.data["design"]["size"]), ("playfair", 120))
        self.assertEqual(self.patch({"design": {"font": "face"}}).data["design"]["font"], "face")

    def test_every_listed_font_and_the_size_limits_pass(self):
        from ilaf.design import FONT_KEYS

        self.assertIn("face", FONT_KEYS)
        self.assertEqual(len(FONT_KEYS), 16)
        for key in FONT_KEYS:
            self.assertEqual(self.patch({"design": {"font": key}}).status_code, 200, key)
        for size in (60, 61, 100, 149, 150):
            self.assertEqual(self.patch({"design": {"size": size}}).status_code, 200, size)

    def test_invalid_font_and_size_rejected(self):
        for bad in (
            {"font": "comic-sans"}, {"font": ""}, {"font": None}, {"font": 3}, {"font": True}, {"font": ["poppins"]}, {"font": "Poppins"},
            {"size": 59}, {"size": 151}, {"size": 0}, {"size": -100}, {"size": 100.5}, {"size": "110"}, {"size": True}, {"size": None},
        ):
            res = self.patch({"design": bad})
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn(f"design.{list(bad)[0]}", res.data["error"]["fields"])
        self.assertEqual(self.patch({"design": {}}).data["design"]["size"], 100)  # nothing was half saved

    def test_font_and_size_problems_are_written_in_arabic_for_an_arabic_caller(self):
        url = f"{API}cards/{self.card['id']}"
        res = self.person.client.patch(url, {"design": {"font": "nope", "size": 10}}, format="json", HTTP_ACCEPT_LANGUAGE="ar")
        fields = res.data["error"]["fields"]
        self.assertEqual(res.status_code, 400)
        self.assertEqual(fields["design.size"], ["اختر عددًا صحيحًا من 60 إلى 150."])
        self.assertTrue(fields["design.font"][0].startswith("اختر أحد الخطوط"), fields["design.font"])
        res = self.person.client.patch(url, {"design": {"font": "nope"}}, format="json", HTTP_ACCEPT_LANGUAGE="en")
        self.assertTrue(res.data["error"]["fields"]["design.font"][0].startswith("Choose one of the available fonts"))

    def test_a_design_stored_before_font_and_size_existed_reads_with_the_defaults(self):
        from cards.models import Card

        Card.objects.filter(pk=self.card["id"]).update(design={"face": 5, "colour": 1, "below": 2, "intro": 3, "photo": True, "brand_colors": False, "foot": True})
        res = self.person.client.get(f"{API}cards/{self.card['id']}")
        self.assertEqual((res.data["design"]["font"], res.data["design"]["size"]), ("face", 100))
        self.assertEqual(res.data["design"]["face"], 5)

    def test_vc_options(self):
        res = self.patch({"vc": {"phones": False, "note": "Hello; there"}})
        self.assertIs(res.data["vc"]["phones"], False)
        self.assertIs(res.data["vc"]["emails"], True)
        self.assertEqual(res.data["vc"]["note"], "Hello; there")
        self.assertEqual(self.patch({"vc": {"social": "no"}}).status_code, 400)


class SlugTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.make_card(self.person)

    def patch(self, card, body):
        return self.person.client.patch(f"{API}cards/{card['id']}", body, format="json")

    def test_public_code_alphabet_length_and_uniqueness(self):
        codes = {self.card["public_code"]}
        for n in range(4):
            codes.add(self.make_card(self.person, name=f"C{n}")["public_code"])
        self.assertEqual(len(codes), 5)
        for code in codes:
            self.assertEqual(len(code), 10)
            self.assertTrue(set(code) <= set(CODE_ALPHABET))

    def test_set_slug_and_public_url(self):
        res = self.patch(self.card, {"slug": "Alice-Design"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["slug"], "alice-design")
        self.assertEqual(res.data["public_url"], "https://web.test/c/alice-design")

    def test_slug_taken_is_409_and_unique(self):
        other = self.make_card(self.person, name="Other")
        self.patch(self.card, {"slug": "taken-one"})
        res = self.patch(other, {"slug": "taken-one"})
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "slug_taken")
        self.assertEqual(Card.objects.filter(slug="taken-one").count(), 1)

    def test_old_slug_stays_reserved_and_working(self):
        self.patch(self.card, {"slug": "first-name"})
        self.patch(self.card, {"slug": "second-name"})
        self.assertTrue(SlugHistory.objects.filter(slug="first-name", card_id=self.card["id"]).exists())
        other = self.make_card(self.person, name="Other")
        res = self.patch(other, {"slug": "first-name"})
        self.assertEqual(res.status_code, 409)

    def test_card_can_take_back_its_own_old_slug(self):
        self.patch(self.card, {"slug": "one-slug"})
        self.patch(self.card, {"slug": "two-slug"})
        res = self.patch(self.card, {"slug": "one-slug"})
        self.assertEqual(res.status_code, 200)
        self.assertTrue(SlugHistory.objects.filter(slug="two-slug").exists())
        self.assertFalse(SlugHistory.objects.filter(slug="one-slug").exists())

    def test_invalid_and_reserved_slugs(self):
        for bad in ("ab", "has space", "-lead", "trail-", "UPPER_case!", "x" * 41):
            self.assertEqual(self.patch(self.card, {"slug": bad}).status_code, 400, bad)
        res = self.patch(self.card, {"slug": "admin"})
        self.assertEqual(res.status_code, 409)

    def test_slug_cannot_equal_another_cards_code(self):
        other = self.make_card(self.person, name="Other")
        res = self.patch(self.card, {"slug": other["public_code"]})
        self.assertEqual(res.status_code, 409)

    def test_clearing_slug_keeps_old_address(self):
        self.patch(self.card, {"slug": "going-away"})
        res = self.patch(self.card, {"slug": None})
        self.assertIsNone(res.data["slug"])
        self.assertTrue(SlugHistory.objects.filter(slug="going-away").exists())

    def test_slug_check(self):
        anon = APIClient()
        res = anon.get(API + "slugs/check", {"slug": "fresh-slug"})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data, {"available": True, "suggestion": None})
        self.patch(self.card, {"slug": "fresh-slug"})
        res = anon.get(API + "slugs/check", {"slug": "fresh-slug"})
        self.assertFalse(res.data["available"])
        self.assertEqual(res.data["suggestion"], "fresh-slug-2")
        res = anon.get(API + "slugs/check", {"slug": "fresh-slug", "card_id": self.card["id"]})
        self.assertTrue(res.data["available"])
        res = anon.get(API + "slugs/check", {"slug": "no way"})
        self.assertFalse(res.data["available"])
        self.assertIsNotNone(res.data["suggestion"])


class UploadTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person)
        self.card = self.make_card(self.person)

    def test_photo_resized_to_800_jpeg(self):
        res = self.person.client.post(f"{API}cards/{self.card['id']}/photo", {"file": png_upload((2000, 1000))}, format="multipart")
        self.assertEqual(res.status_code, 200)
        self.assertTrue(res.data["photo_url"].startswith("https://api.test/media/"))
        card = Card.objects.get(pk=self.card["id"])
        with Image.open(card.photo.path) as img:
            self.assertEqual(img.format, "JPEG")
            self.assertEqual(max(img.size), 800)
        self.assertEqual(self.person.client.get(f"{API}cards/{self.card['id']}").data["photo_url"], res.data["photo_url"])

    def test_small_photo_not_enlarged_and_non_image_rejected(self):
        res = self.person.client.post(f"{API}cards/{self.card['id']}/photo", {"file": png_upload((100, 60))}, format="multipart")
        card = Card.objects.get(pk=self.card["id"])
        with Image.open(card.photo.path) as img:
            self.assertEqual(img.size, (100, 60))
        bad = SimpleUploadedFile("x.png", b"not an image", content_type="image/png")
        res = self.person.client.post(f"{API}cards/{self.card['id']}/photo", {"file": bad}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "validation_error")
        res = self.person.client.post(f"{API}cards/{self.card['id']}/photo", {}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_icon_upload_is_128_png_and_usable_on_an_item(self):
        res = self.person.client.post(
            f"{API}cards/{self.card['id']}/icon", {"file": png_upload((400, 200), fmt="JPEG", name="i.jpg")}, format="multipart"
        )
        self.assertEqual(res.status_code, 200, res.content)
        url = res.data["image_url"]
        self.assertTrue(url.startswith("https://api.test/media/icons/"))
        from django.core.files.storage import default_storage

        path = default_storage.path(url.replace("https://api.test/media/", ""))
        with Image.open(path) as img:
            self.assertEqual(img.format, "PNG")
            self.assertEqual(img.size, (128, 128))
        item = {"kind": "Custom", "value": "shop.example.com", "label": "Shop", "icon": {"type": "upload", "image_url": url}}
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"items": [item]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["items"][0]["icon"], {"type": "upload", "key": None, "image_url": url})

    def test_icon_upload_rejects_svg_big_and_bogus_files(self):
        svg = SimpleUploadedFile("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", content_type="image/svg+xml")
        res = self.person.client.post(f"{API}cards/{self.card['id']}/icon", {"file": svg}, format="multipart")
        self.assertEqual(res.status_code, 400)
        big = SimpleUploadedFile("big.png", b"\x89PNG" + b"0" * (1024 * 1024 + 10), content_type="image/png")
        res = self.person.client.post(f"{API}cards/{self.card['id']}/icon", {"file": big}, format="multipart")
        self.assertEqual(res.status_code, 400)
        gif = png_upload((10, 10), fmt="GIF", name="a.gif")
        res = self.person.client.post(f"{API}cards/{self.card['id']}/icon", {"file": gif}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_icon_webp_accepted(self):
        res = self.person.client.post(
            f"{API}cards/{self.card['id']}/icon", {"file": png_upload((64, 64), fmt="WEBP", name="a.webp")}, format="multipart"
        )
        self.assertEqual(res.status_code, 200, res.content)

    def test_icon_upload_url_must_be_ours(self):
        item = {"kind": "Custom", "value": "a.com", "icon": {"type": "upload", "image_url": "https://evil.example/x.png"}}
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"items": [item]}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("items.0.icon", res.data["error"]["fields"])


    def test_cover_is_1280_by_800_jpeg(self):
        res = self.person.client.post(f"{API}cards/{self.card['id']}/cover", {"file": png_upload((2400, 900))}, format="multipart")
        self.assertEqual(res.status_code, 200, res.content)
        card = Card.objects.get(pk=self.card["id"])
        with Image.open(card.cover.path) as img:
            self.assertEqual((img.format, img.size), ("JPEG", (1280, 800)))
        self.assertEqual(self.person.client.get(f"{API}cards/{self.card['id']}").data["cover_url"], res.data["cover_url"])
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        data = APIClient().get(f"{API}public/cards/{self.card['public_code']}").data
        self.assertEqual(data["card"]["cover_url"], res.data["cover_url"])
        self.assertIn("photo_url", data["card"])

    def test_cover_rejects_svg_gif_big_and_junk(self):
        url = f"{API}cards/{self.card['id']}/cover"
        svg = SimpleUploadedFile("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>", content_type="image/svg+xml")
        self.assertEqual(self.person.client.post(url, {"file": svg}, format="multipart").status_code, 400)
        gif = png_upload((10, 10), fmt="GIF", name="a.gif")
        self.assertEqual(self.person.client.post(url, {"file": gif}, format="multipart").status_code, 400)
        big = SimpleUploadedFile("big.jpg", b"\xff\xd8" + b"0" * (3 * 1024 * 1024 + 10), content_type="image/jpeg")
        self.assertEqual(self.person.client.post(url, {"file": big}, format="multipart").status_code, 400)
        self.assertEqual(self.person.client.post(url, {}, format="multipart").status_code, 400)
        webp = png_upload((50, 50), fmt="WEBP", name="a.webp")
        self.assertEqual(self.person.client.post(url, {"file": webp}, format="multipart").status_code, 200)


class ItemValidationTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person)
        self.card = self.make_card(self.person)

    def put(self, *items):
        return self.person.client.patch(f"{API}cards/{self.card['id']}", {"items": list(items)}, format="json")

    def test_unsafe_schemes_rejected_on_every_kind(self):
        for value in (
            "javascript:alert(1)", "JaVaScRiPt:alert(1)", "  data:text/html;base64,AAA", "vbscript:msgbox", "file:///etc/passwd",
            "blob:https://x/1", "ftp://x.com", "about:blank",
        ):
            for kind in ("Website", "Custom", "Instagram", "Location"):
                res = self.put({"kind": kind, "value": value})
                self.assertEqual(res.status_code, 400, (kind, value))
                self.assertEqual(res.data["error"]["code"], "validation_error")
                self.assertIn("items.0.value", res.data["error"]["fields"])

    def test_error_names_the_bad_item(self):
        res = self.put({"kind": "Email", "value": "ok@b.co"}, {"kind": "Website", "value": "javascript:1"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("items.1.value", res.data["error"]["fields"])
        self.assertNotIn("items.0.value", res.data["error"]["fields"])

    def test_allowed_schemes_pass(self):
        for value in (
            "https://a.com", "http://a.com", "tel:+97455551111", "mailto:a@b.co", "sms:+97455551111", "skype:live.name?call",
            "tg://resolve?domain=x", "viber://chat?number=1", "facetime:a@b.co", "facetime-audio:a@b.co", "geo:25.2,51.5",
        ):
            res = self.put({"kind": "Custom", "value": value})
            self.assertEqual(res.status_code, 200, (value, res.content))

    def test_host_with_port_is_not_a_scheme(self):
        res = self.put({"kind": "Custom", "value": "example.com:8080/path"})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["items"][0]["value"], "https://example.com:8080/path")

    def test_control_characters_rejected(self):
        for value in ("a\x00b.com", "line\nbreak.com", "tab\there.com", "bell\x07.com", "x y.com"):
            self.assertEqual(self.put({"kind": "Website", "value": value}).status_code, 400, repr(value))
        self.assertEqual(self.put({"kind": "Email", "value": "a@b.co", "label": "bad\nlabel"}).status_code, 400)

    def test_custom_is_normalised(self):
        cases = {
            "someone@example.com": "mailto:someone@example.com",
            "+974 5555 1111": "tel:+97455551111",
            "00974 5555 1111": "tel:+97455551111",
            "shop.example.com/menu": "https://shop.example.com/menu",
            "https://already.ok/x": "https://already.ok/x",
        }
        for value, expected in cases.items():
            res = self.put({"kind": "Custom", "value": value, "label": "L"})
            self.assertEqual(res.status_code, 200, value)
            self.assertEqual(res.data["items"][0]["value"], expected)

    def test_custom_rejects_plain_text(self):
        res = self.put({"kind": "Custom", "value": "just some words"})
        self.assertEqual(res.status_code, 400)

    def test_label_max_40(self):
        self.assertEqual(self.put({"kind": "Email", "value": "a@b.co", "label": "x" * 40}).status_code, 200)
        self.assertEqual(self.put({"kind": "Email", "value": "a@b.co", "label": "x" * 41}).status_code, 400)

    def test_kind_specific_checks(self):
        self.assertEqual(self.put({"kind": "Email", "value": "nope"}).status_code, 400)
        self.assertEqual(self.put({"kind": "Mobile", "value": "call me"}).status_code, 400)
        self.assertEqual(self.put({"kind": "Bogus", "value": "x"}).status_code, 400)
        self.assertEqual(self.put({"kind": "Mobile", "value": ""}).status_code, 200)  # empty rows are allowed while editing

    def test_icon_validation(self):
        ok = self.put({"kind": "Custom", "value": "a.com", "icon": {"type": "brand", "key": "github"}})
        self.assertEqual(ok.data["items"][0]["icon"], {"type": "brand", "key": "github", "image_url": None})
        ok = self.put({"kind": "Custom", "value": "a.com", "icon": {"type": "lucide", "key": "map-pin"}})
        self.assertEqual(ok.status_code, 200)
        ok = self.put({"kind": "Custom", "value": "a.com", "icon": {"type": "auto"}})
        self.assertEqual(ok.data["items"][0]["icon"]["type"], "auto")
        ok = self.put({"kind": "Custom", "value": "a.com", "icon": None})
        self.assertIsNone(ok.data["items"][0]["icon"])
        for bad in (
            {"type": "weird"}, {"type": "brand"}, {"type": "brand", "key": "bad key!"}, {"type": "lucide", "key": "x" * 61},
            {"type": "upload"}, "str",
        ):
            res = self.put({"kind": "Custom", "value": "a.com", "icon": bad})
            self.assertEqual(res.status_code, 400, bad)


class FreeTrialTests(ApiTestCase):
    def make(self, person, name="A"):
        res = person.client.post(f"{API}workspaces/{person.ws}/cards", {"name": name}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return res.data

    def test_first_publish_starts_seven_free_days(self):
        from datetime import timedelta
        from django.utils import timezone
        from billing.models import Subscription

        person = self.signup()
        card = self.make(person)
        self.assertFalse(Subscription.objects.filter(workspace_id=person.ws).exists())
        res = person.client.post(f"{API}cards/{card['id']}/publish")
        self.assertEqual(res.status_code, 200, res.content)
        sub = Subscription.objects.get(workspace_id=person.ws)
        self.assertEqual(sub.plan_id, "free")
        self.assertAlmostEqual((sub.ends_at - timezone.now()).total_seconds(), 7 * 86400, delta=60)
        ws = person.client.get(f"{API}workspaces/{person.ws}").data
        self.assertEqual((ws["subscription"]["plan_code"], ws["subscription"]["live"]), ("free", True))
        # after the seven days the card goes offline with no grace days
        Subscription.objects.update(ends_at=timezone.now() - timedelta(minutes=1))
        self.assertFalse(person.client.get(f"{API}workspaces/{person.ws}").data["subscription"]["live"])
        again = person.client.post(f"{API}cards/{card['id']}/publish")
        self.assertEqual((again.status_code, again.data["error"]["code"]), (402, "subscription_required"))  # no second trial
        public = self.anon_get_card(card)
        self.assertEqual(public.data.get("state"), "paused")

    def anon_get_card(self, card):
        from rest_framework.test import APIClient
        return APIClient().get(f"{API}public/cards/{card['public_code']}")

    def test_free_plan_sees_only_the_first_fifty_designs_and_no_page_styles(self):
        person = self.signup()
        card = self.make(person)
        url = f"{API}cards/{card['id']}"
        for design in ({"face": 51}, {"below": 51}, {"intro": 51}, {"top": 3}, {"below": 410}):
            res = person.client.patch(url, {"design": design}, format="json")
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"), design)
        for design in ({"face": 50}, {"below": 50}, {"intro": 50}, {"intro": 0}):
            self.assertEqual(person.client.patch(url, {"design": design}, format="json").status_code, 200, design)

    def test_a_paid_personal_plan_unlocks_everything_and_the_trial_days_are_not_added(self):
        from billing.models import Subscription

        person = self.signup()
        card = self.make(person)
        person.client.post(f"{API}cards/{card['id']}/publish")
        self.buy(person, "personal")
        sub = Subscription.objects.get(workspace_id=person.ws)
        self.assertEqual(sub.plan_id, "personal")
        self.assertGreater((sub.ends_at - sub.starts_at).days, 360)
        self.assertAlmostEqual((sub.starts_at - __import__("django.utils.timezone", fromlist=["now"]).now()).total_seconds(), 0, delta=60)
        res = person.client.patch(f"{API}cards/{card['id']}", {"design": {"face": 400, "below": 300, "intro": 300}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_the_free_and_retired_plans_are_not_for_sale(self):
        person = self.signup()
        listed = {p["code"]: p["purchasable"] for p in person.client.get(f"{API}plans").data}
        self.assertEqual((listed["personal"], listed["company"]), (True, True))
        self.assertEqual(listed["business"], False)
