"""Sections: the rich blocks under a card, their settings per kind, limits, order, the gallery, and the public page."""
from cards.models import Card, CardSection

from .base import API, ApiTestCase, png_upload
from .ops_base import OpsTestCase
from .test_page_styles import SwitchOff, move_to_free_plan

WEEK = [{"d": d, "open": "08:00", "close": "18:00", "closed": d == 4} for d in range(7)]


class SectionsBase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.make_card(self.person)
        self.url = f"{API}cards/{self.card['id']}/sections"
        self.anon = self.client_for()

    def add(self, kind, data=None, **extra):
        body = {"kind": kind, **extra}
        if data is not None:
            body["data"] = data
        return self.person.client.post(self.url, body, format="json")

    def added(self, kind, data=None, **extra):
        res = self.add(kind, data, **extra)
        self.assertEqual(res.status_code, 201, res.content)
        return res.data

    def patch(self, section_id, body):
        return self.person.client.patch(f"{self.url}/{section_id}", body, format="json")

    def public(self):
        return self.anon.get(f"{API}public/cards/{self.card['public_code']}").data["card"]


class SectionCrudTests(SectionsBase):
    def test_create_list_patch_delete(self):
        section = self.added("video", {"title": "  Watch our story  "})
        self.assertEqual(set(section), {"id", "kind", "order", "on", "data", "created_at", "updated_at"})
        self.assertEqual((section["kind"], section["order"], section["on"]), ("video", 0, True))
        self.assertEqual(section["data"], {"title": "Watch our story"})
        listing = self.person.client.get(self.url).data
        self.assertEqual([s["id"] for s in listing], [section["id"]])
        res = self.patch(section["id"], {"data": {"title": "Our story"}, "on": False})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["data"]["title"], res.data["on"]), ("Our story", False))
        res = self.patch(section["id"], {"kind": "map"})
        self.assertEqual(res.status_code, 400)
        self.assertIn("kind", res.data["error"]["fields"])
        self.assertEqual(self.person.client.delete(f"{self.url}/{section['id']}").status_code, 204)
        self.assertEqual(self.person.client.get(self.url).data, [])
        self.assertEqual(self.person.client.delete(f"{self.url}/{section['id']}").status_code, 404)

    def test_every_kind_has_defaults_and_needs_no_data(self):
        for kind in ("video", "products", "hours", "booking", "team", "gallery", "event", "map"):
            res = self.add(kind)
            self.assertEqual(res.status_code, 201, (kind, res.content))
            self.assertEqual(res.data["data"]["title"], "")
        products = [s for s in self.person.client.get(self.url).data if s["kind"] == "products"][0]
        self.assertEqual(products["data"]["layout"], "grid")
        hours = [s for s in self.person.client.get(self.url).data if s["kind"] == "hours"][0]
        self.assertEqual(hours["data"]["timezone"], "Asia/Qatar")
        self.assertEqual(len(hours["data"]["days"]), 7)
        self.assertTrue(hours["data"]["days"][4]["closed"])

    def test_unknown_kind_and_unknown_setting(self):
        res = self.add("carousel")
        self.assertEqual(res.status_code, 400)
        self.assertIn("kind", res.data["error"]["fields"])
        res = self.add("video", {"title": "x", "autoplay": True})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"], {"data.autoplay": ["This section setting does not exist."]})
        res = self.add("video", "not an object")
        self.assertEqual(res.status_code, 400)
        res = self.add("video", {"title": 5})
        self.assertEqual(res.data["error"]["fields"], {"data.title": ["Must be text."]})
        res = self.add("video", {"title": "x" * 81})
        self.assertIn("data.title", res.data["error"]["fields"])
        res = self.add("video", {"title": "bad\x00text"})
        self.assertIn("data.title", res.data["error"]["fields"])
        res = self.add("video", on="yes")
        self.assertEqual(res.data["error"]["fields"], {"on": ["Must be true or false."]})

    def test_limits_eight_sections_one_per_kind_three_products(self):
        self.added("products", {"layout": "grid"})
        self.added("products", {"layout": "menu", "title": "Menu"})
        self.added("products", {"layout": "listings"})
        res = self.add("products", {"layout": "carousel"})
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["kind"], ["A card can have up to 3 products sections."])
        self.added("video")
        res = self.add("video")
        self.assertEqual(res.status_code, 400)
        self.assertIn("already has", res.data["error"]["fields"]["kind"][0])
        for kind in ("hours", "booking", "team", "gallery"):
            self.added(kind)
        self.assertEqual(len(self.person.client.get(self.url).data), 8)
        res = self.add("event")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["kind"], ["A card can have up to 8 sections."])

    def test_reorder(self):
        a, b, c = (self.added(k)["id"] for k in ("video", "hours", "map"))
        res = self.person.client.post(f"{self.url}/reorder", {"ids": [c, a, b]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([(s["id"], s["order"]) for s in res.data], [(c, 0), (a, 1), (b, 2)])
        for bad in ([a, b], [a, a, b], [a, b, c, "x"], "abc", None):
            res = self.person.client.post(f"{self.url}/reorder", {"ids": bad}, format="json")
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn("ids", res.data["error"]["fields"])

    def test_only_people_with_card_access(self):
        section = self.added("video")
        other = self.signup("other@example.com", "Oscar Other")
        self.buy(other, "business")
        self.assertEqual(other.client.get(self.url).status_code, 404)
        self.assertEqual(other.client.post(self.url, {"kind": "map"}, format="json").status_code, 404)
        self.assertEqual(other.client.delete(f"{self.url}/{section['id']}").status_code, 404)
        self.assertEqual(self.anon.get(self.url).status_code, 401)

    def test_free_plan_and_switch_off_refuse_writes_but_not_reads(self):
        section = self.added("video", {"title": "Keep me"})
        with SwitchOff():
            res = self.add("map")
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_unavailable"))
            self.assertEqual(self.person.client.get(self.url).status_code, 200)
        move_to_free_plan(self.person.ws)
        for res in (
            self.add("map"),
            self.patch(section["id"], {"data": {"title": "x"}}),
            self.person.client.delete(f"{self.url}/{section['id']}"),
            self.person.client.post(f"{self.url}/reorder", {"ids": [section["id"]]}, format="json"),
        ):
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        self.assertEqual(self.person.client.get(self.url).data[0]["data"]["title"], "Keep me")
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        self.assertEqual(self.public()["sections"][0]["data"]["title"], "Keep me")


class SectionKindTests(SectionsBase):
    def test_products_layouts(self):
        for layout in ("grid", "carousel", "menu", "listings"):
            res = self.add("products", {"layout": layout})
            self.assertEqual(res.status_code, 201, layout)
            CardSection.objects.filter(pk=res.data["id"]).delete()
        res = self.add("products", {"layout": "table"})
        self.assertEqual(res.data["error"]["fields"], {"data.layout": ["Choose one of: grid, carousel, menu, listings."]})

    def test_hours(self):
        res = self.add("hours", {"title": "Opening hours", "timezone": "Europe/Berlin", "days": WEEK, "note": "Closed on public holidays"})
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["data"]["timezone"], "Europe/Berlin")
        self.assertEqual(res.data["data"]["days"][4], {"d": 4, "open": "08:00", "close": "18:00", "closed": True})
        sid = res.data["id"]
        for bad, key in (
            ({"timezone": "Mars/Olympus"}, "data.timezone"),
            ({"timezone": 3}, "data.timezone"),
            ({"days": WEEK[:6]}, "data.days"),
            ({"days": WEEK[:6] + [{"d": 0, "open": "08:00", "close": "18:00", "closed": False}]}, "data.days"),
            ({"days": [{**d, "open": "8am"} for d in WEEK]}, "data.days"),
            ({"days": [{**d, "close": "25:00"} for d in WEEK]}, "data.days"),
            ({"days": [{**d, "closed": "no"} for d in WEEK]}, "data.days"),
            ({"days": "always"}, "data.days"),
            ({"note": "n" * 121}, "data.note"),
        ):
            res = self.patch(sid, {"data": bad})
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn(key, res.data["error"]["fields"])
        # A closed day may leave its times empty; the days come back ordered Monday to Sunday.
        shuffled = [{"d": 6, "open": "", "close": "", "closed": True}] + [d for d in WEEK if d["d"] != 6]
        res = self.patch(sid, {"data": {"days": shuffled}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([d["d"] for d in res.data["data"]["days"]], list(range(7)))
        self.assertEqual(res.data["data"]["days"][6], {"d": 6, "open": "", "close": "", "closed": True})

    def test_event(self):
        res = self.add("event", {
            "title": "See us at", "event_name": "Web Summit Qatar", "starts_at": "2026-03-01T09:00:00+03:00",
            "ends_at": "2026-03-03T18:00:00+03:00", "venue": "DECC", "hall": "Hall 4", "stand": "B12",
            "talk_title": "Cards that sell", "talk_time": "Tue 14:00", "slides_url": "https://example.com/deck.pdf",
        })
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["data"]["starts_at"], "2026-03-01T06:00:00Z")
        self.assertEqual(res.data["data"]["ends_at"], "2026-03-03T15:00:00Z")
        sid = res.data["id"]
        for bad, key in (
            ({"starts_at": "next tuesday"}, "data.starts_at"),
            ({"starts_at": ""}, "data.starts_at"),
            ({"starts_at": None}, "data.starts_at"),
            ({"ends_at": "2026-02-01T09:00:00Z"}, "data.ends_at"),
            ({"slides_url": "http://example.com/deck.pdf"}, "data.slides_url"),
            ({"slides_url": "javascript:alert(1)"}, "data.slides_url"),
            ({"slides_url": "https://user:pw@example.com/x"}, "data.slides_url"),
            ({"stand": "s" * 41}, "data.stand"),
            ({"hall": "h" * 61}, "data.hall"),
        ):
            res = self.patch(sid, {"data": bad})
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn(key, res.data["error"]["fields"])
        res = self.patch(sid, {"data": {"ends_at": None, "slides_url": ""}})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.data["data"]["ends_at"])
        self.assertEqual(res.data["data"]["slides_url"], "")
        # A time without a zone counts as UTC.
        res = self.patch(sid, {"data": {"starts_at": "2026-03-01T09:00:00"}})
        self.assertEqual(res.data["data"]["starts_at"], "2026-03-01T09:00:00Z")

    def test_map(self):
        res = self.add("map", {
            "title": "Find us", "address": "Building 5\nWest Bay\nDoha", "maps_url": "https://maps.app.goo.gl/abc",
            "directions_note": "Parking behind the building",
        })
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["data"]["address"], "Building 5\nWest Bay\nDoha")
        sid = res.data["id"]
        for bad, key in (
            ({"maps_url": "maps.google.com/x"}, "data.maps_url"),
            ({"address": "a" * 301}, "data.address"),
            ({"directions_note": "d" * 81}, "data.directions_note"),
        ):
            res = self.patch(sid, {"data": bad})
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn(key, res.data["error"]["fields"])

    def test_team_cards_must_be_published_visible_cards_of_the_same_workspace(self):
        mine = self.published_card(self.person, name="Colleague One")
        draft = self.make_card(self.person, name="Draft Two")
        hidden = self.published_card(self.person, name="Hidden Three", hide_from_directory=True)
        other = self.signup("other@example.com", "Oscar Other")
        self.buy(other, "business")
        theirs = self.published_card(other, name="Stranger")
        res = self.add("team", {"title": "The team", "cards": [mine["public_code"]]})
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["data"]["cards"], [mine["public_code"]])
        sid = res.data["id"]
        for bad in ([draft["public_code"]], [hidden["public_code"]], [theirs["public_code"]], ["nope123456"]):
            res = self.patch(sid, {"data": {"cards": bad}})
            self.assertEqual(res.status_code, 400, bad)
            self.assertIn("data.cards", res.data["error"]["fields"])
        res = self.patch(sid, {"data": {"cards": [mine["public_code"]] * 13}})
        self.assertEqual(res.status_code, 200)  # repeats collapse to one entry
        self.assertEqual(res.data["data"]["cards"], [mine["public_code"]])
        res = self.patch(sid, {"data": {"cards": [f"code{n:06d}" for n in range(13)]}})
        self.assertEqual(res.data["error"]["fields"]["data.cards"], ["Choose up to 12 team cards."])
        res = self.patch(sid, {"data": {"cards": "all"}})
        self.assertEqual(res.status_code, 400)


class GalleryTests(SectionsBase):
    def setUp(self):
        super().setUp()
        self.gallery = f"{API}cards/{self.card['id']}/gallery"

    def upload(self, caption=None, **png):
        body = {"file": png_upload(**png)}
        if caption is not None:
            body["caption"] = caption
        return self.person.client.post(self.gallery, body, format="multipart")

    def test_upload_patch_reorder_delete(self):
        first = self.upload("Our shop")
        self.assertEqual(first.status_code, 201, first.content)
        self.assertEqual(set(first.data), {"id", "url", "caption", "order"})
        self.assertEqual((first.data["caption"], first.data["order"]), ("Our shop", 0))
        self.assertTrue(first.data["url"].startswith("https://api.test/media/gallery/"))
        second = self.upload().data
        self.assertEqual((second["caption"], second["order"]), ("", 1))
        res = self.person.client.patch(f"{self.gallery}/{second['id']}", {"caption": " Inside ", "order": 0}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["caption"], res.data["order"]), ("Inside", 0))
        res = self.person.client.patch(f"{self.gallery}/{second['id']}", {"caption": "c" * 81}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.person.client.patch(f"{self.gallery}/{second['id']}", {"order": 9}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.person.client.post(f"{self.gallery}/reorder", {"ids": [first.data["id"], second["id"]]}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual([i["order"] for i in res.data], [0, 1])
        self.assertEqual(self.person.client.get(self.gallery).data[0]["id"], first.data["id"])
        res = self.person.client.delete(f"{self.gallery}/{first.data['id']}")
        self.assertEqual(res.status_code, 204)
        self.assertEqual(len(self.person.client.get(self.gallery).data), 1)
        self.assertEqual(self.person.client.delete(f"{self.gallery}/{first.data['id']}").status_code, 404)

    def test_nine_pictures_at_most_and_only_pictures(self):
        for _ in range(9):
            self.assertEqual(self.upload(size=(300, 200)).status_code, 201)
        res = self.upload(size=(300, 200))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["file"], ["A gallery holds up to 9 pictures. Remove one first."])
        from django.core.files.uploadedfile import SimpleUploadedFile

        res = self.person.client.post(self.gallery, {"file": SimpleUploadedFile("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>")}, format="multipart")
        self.assertEqual(res.status_code, 400)

    def test_free_plan_refuses_uploads(self):
        move_to_free_plan(self.person.ws)
        res = self.upload()
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))


class PublicSectionsTests(SectionsBase):
    def test_only_switched_on_sections_in_order_with_expansions(self):
        colleague = self.published_card(self.person, name="Colleague One", title="Baker")
        off = self.added("video", {"title": "Hidden"}, on=False)
        team = self.added("team", {"title": "Meet us", "cards": [colleague["public_code"]]})
        gallery = self.added("gallery", {"title": "Pictures"})
        picture = self.person.client.post(f"{API}cards/{self.card['id']}/gallery", {"file": png_upload(), "caption": "Shop"}, format="multipart").data
        products = self.added("products", {"title": "Menu", "layout": "menu"})
        self.person.client.post(f"{self.url}/reorder", {"ids": [products["id"], gallery["id"], team["id"], off["id"]]}, format="json")
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        card = self.public()
        self.assertEqual(card["bio"], "")
        self.assertEqual([s["kind"] for s in card["sections"]], ["products", "gallery", "team"])
        self.assertEqual(set(card["sections"][0]), {"id", "kind", "order", "data"})
        self.assertEqual(card["sections"][0]["data"]["layout"], "menu")
        self.assertEqual(card["sections"][0]["data"]["items"], [])
        self.assertEqual(card["sections"][1]["data"]["images"], [{"id": picture["id"], "url": picture["url"], "caption": "Shop", "order": 0}])
        members = card["sections"][2]["data"]["members"]
        self.assertEqual(members, [{
            "code": colleague["public_code"], "name": "Colleague One", "title": "Baker", "photo_url": None,
            "url": f"https://web.test/c/{colleague['public_code']}",
        }])
        self.assertEqual(card["sections"][2]["data"]["cards"], [colleague["public_code"]])

    def test_team_cards_that_stop_being_listed_disappear_from_the_page(self):
        colleague = self.published_card(self.person, name="Colleague One")
        self.added("team", {"cards": [colleague["public_code"]]})
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        self.assertEqual(len(self.public()["sections"][0]["data"]["members"]), 1)
        self.person.client.post(f"{API}cards/{colleague['id']}/unpublish")
        self.assertEqual(self.public()["sections"][0]["data"]["members"], [])
        Card.objects.filter(pk=colleague["id"]).update(status="published", hide_from_directory=True)
        self.assertEqual(self.public()["sections"][0]["data"]["members"], [])

    def test_a_card_without_sections_has_an_empty_list(self):
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        self.assertEqual(self.public()["sections"], [])


class BioTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.make_card(self.person)

    def test_bio_is_saved_trimmed_and_capped(self):
        self.assertEqual(self.card["bio"], "")
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"bio": "  I bake bread.\r\nSince 1999.  "}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["bio"], "I bake bread.\nSince 1999.")
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"bio": "b" * 301}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("bio", res.data["error"]["fields"])
        res = self.person.client.patch(f"{API}cards/{self.card['id']}", {"bio": "b" * 300}, format="json")
        self.assertEqual(res.status_code, 200)

    def test_bio_reaches_the_public_page_and_the_copy(self):
        self.person.client.patch(f"{API}cards/{self.card['id']}", {"bio": "Hello there"}, format="json")
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        public = self.client_for().get(f"{API}public/cards/{self.card['public_code']}").data["card"]
        self.assertEqual(public["bio"], "Hello there")
        copy = self.person.client.post(f"{API}cards/{self.card['id']}/duplicate").data
        self.assertEqual(copy["bio"], "Hello there")


class BioRulesTests(OpsTestCase):
    """The bio follows the company's address rule: locked, approval or free."""

    def setUp(self):
        super().setUp()
        self.bob = self.add("bob@example.com", "Bob Builder")

    def set_rules(self, **rules):
        res = self.owner.client.patch(self.url("field-rules"), rules, format="json")
        self.assertEqual(res.status_code, 200, res.content)

    def test_locked_address_locks_the_bio(self):
        self.set_rules(address="locked")
        card = self.bob.client.get(f"{API}cards/{self.bob.card_id}").data
        self.assertEqual((card["field_access"]["address"], card["field_access"]["bio"]), ("locked", "locked"))
        res = self.bob.client.patch(f"{API}cards/{self.bob.card_id}", {"bio": "New"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "field_locked"))
        self.assertIn("the bio", res.data["error"]["fields"]["bio"][0])
        self.assertEqual(self.owner.client.patch(f"{API}cards/{self.bob.card_id}", {"bio": "By admin"}, format="json").data["bio"], "By admin")

    def test_approval_address_queues_the_bio(self):
        self.set_rules(address="approval")
        res = self.bob.client.patch(f"{API}cards/{self.bob.card_id}", {"bio": "Waiting"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["bio"], "")
        self.assertEqual(res.data["submitted_for_approval"], ["bio"])
        pending = self.owner.client.get(self.url("change-requests")).data["results"]
        self.assertEqual((pending[0]["field"], pending[0]["old"], pending[0]["new"]), ("bio", "", "Waiting"))
        res = self.owner.client.post(self.url(f"change-requests/{pending[0]['id']}/approve"))
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(Card.objects.get(pk=self.bob.card_id).bio, "Waiting")
