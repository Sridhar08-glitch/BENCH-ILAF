"""The card video: judged by its first bytes, capped in size, removable, and shown on the public page by URL."""
from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import override_settings

from cards.models import Card

from .base import API, ApiTestCase, png_upload
from .test_page_styles import SwitchOff, move_to_free_plan


def mp4_upload(size=4096, name="clip.mp4"):
    """The smallest thing that looks like an MP4: a box size, `ftyp`, a brand, then padding."""
    head = (24).to_bytes(4, "big") + b"ftyp" + b"isom" + (0).to_bytes(4, "big") + b"isomiso2mp41"
    return SimpleUploadedFile(name, head + b"\0" * max(0, size - len(head)), content_type="video/mp4")


class VideoUploadTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person, "business")
        self.card = self.make_card(self.person)
        self.url = f"{API}cards/{self.card['id']}/video"
        self.anon = self.client_for()

    def upload(self, file, url=None):
        return self.person.client.post(url or self.url, {"file": file}, format="multipart")

    def test_mp4_is_stored_as_is_and_served_by_url(self):
        res = self.upload(mp4_upload())
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["video_url"].startswith("https://api.test/media/videos/"))
        self.assertTrue(res.data["video_url"].endswith(".mp4"))
        self.assertIsNone(res.data["video_poster_url"])
        card = Card.objects.get(pk=self.card["id"])
        with card.video.open("rb") as handle:
            self.assertEqual(handle.read()[4:8], b"ftyp")
        self.assertEqual(self.person.client.get(f"{API}cards/{self.card['id']}").data["video_url"], res.data["video_url"])

    def test_a_new_upload_replaces_the_old_file(self):
        first = self.upload(mp4_upload()).data["video_url"]
        card = Card.objects.get(pk=self.card["id"])
        old_name = card.video.name
        second = self.upload(mp4_upload(name="other.mp4")).data["video_url"]
        self.assertNotEqual(first, second)
        self.assertFalse(card.video.storage.exists(old_name))

    def test_other_files_are_refused_by_content_not_by_name(self):
        for data, name in (
            (b"\x89PNG\r\n\x1a\n" + b"\0" * 100, "movie.mp4"),
            (b"RIFF\0\0\0\0WEBMxxxx" + b"\0" * 100, "clip.mp4"),
            (b"<html><body>hi</body></html>" + b"\0" * 100, "clip.mp4"),
            (b"\x1aE\xdf\xa3" + b"\0" * 100, "clip.webm"),
            (b"", "empty.mp4"),
        ):
            res = self.upload(SimpleUploadedFile(name, data, content_type="video/mp4"))
            self.assertEqual(res.status_code, 400, name)
            self.assertEqual(res.data["error"]["code"], "validation_error")
            self.assertIn("MP4", res.data["error"]["fields"]["file"][0])
        res = self.person.client.post(self.url, {}, format="multipart")
        self.assertEqual(res.status_code, 400)
        self.assertIn("file", res.data["error"]["fields"])

    def test_a_renamed_mp4_passes(self):
        res = self.upload(mp4_upload(name="holiday.bin"))
        self.assertEqual(res.status_code, 200, res.content)

    @override_settings(VIDEO_MAX_UPLOAD_BYTES=2 * 1024 * 1024)
    def test_the_size_cap_comes_from_settings(self):
        self.assertEqual(self.upload(mp4_upload(size=2 * 1024 * 1024)).status_code, 200)
        res = self.upload(mp4_upload(size=2 * 1024 * 1024 + 1))
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["file"], ["The video must be under 2 MB."])

    def test_the_default_cap_is_100_mb(self):
        from django.conf import settings

        self.assertEqual(settings.VIDEO_MAX_UPLOAD_BYTES, 100 * 1024 * 1024)

    def test_poster_is_a_cover_sized_picture(self):
        self.upload(mp4_upload())
        res = self.upload(png_upload(), f"{API}cards/{self.card['id']}/video-poster")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["video_poster_url"].endswith(".jpg"))
        self.assertIn("/media/videos/", res.data["video_poster_url"])
        res = self.upload(SimpleUploadedFile("x.svg", b"<svg xmlns='http://www.w3.org/2000/svg'/>"), f"{API}cards/{self.card['id']}/video-poster")
        self.assertEqual(res.status_code, 400)

    def test_delete_removes_video_and_poster(self):
        self.upload(mp4_upload())
        self.upload(png_upload(), f"{API}cards/{self.card['id']}/video-poster")
        card = Card.objects.get(pk=self.card["id"])
        names = (card.video.name, card.video_poster.name)
        self.assertTrue(all(names))
        res = self.person.client.delete(self.url)
        self.assertEqual(res.status_code, 204)
        card.refresh_from_db()
        self.assertFalse(card.video)
        self.assertFalse(card.video_poster)
        self.assertFalse(any(card.video.storage.exists(n) for n in names))
        data = self.person.client.get(f"{API}cards/{self.card['id']}").data
        self.assertIsNone(data["video_url"])
        self.assertIsNone(data["video_poster_url"])
        self.assertEqual(self.person.client.delete(self.url).status_code, 204)  # nothing to remove is fine

    def test_public_page_carries_the_urls(self):
        public = f"{API}public/cards/{self.card['public_code']}"
        self.person.client.post(f"{API}cards/{self.card['id']}/publish")
        card = self.anon.get(public).data["card"]
        self.assertIsNone(card["video_url"])
        self.assertIsNone(card["video_poster_url"])
        video = self.upload(mp4_upload()).data["video_url"]
        poster = self.upload(png_upload(), f"{API}cards/{self.card['id']}/video-poster").data["video_poster_url"]
        card = self.anon.get(public).data["card"]
        self.assertEqual((card["video_url"], card["video_poster_url"]), (video, poster))

    def test_only_people_with_card_access(self):
        other = self.signup("other@example.com", "Oscar Other")
        self.buy(other, "business")
        self.assertEqual(other.client.post(self.url, {"file": mp4_upload()}, format="multipart").status_code, 404)
        self.assertEqual(self.anon.post(self.url, {"file": mp4_upload()}, format="multipart").status_code, 401)

    def test_free_plan_and_switch_off_refuse_the_upload(self):
        with SwitchOff():
            res = self.upload(mp4_upload())
            self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "feature_unavailable"))
        move_to_free_plan(self.person.ws)
        res = self.upload(mp4_upload())
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
