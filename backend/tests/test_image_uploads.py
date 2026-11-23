"""Image uploads accept only JPEG, PNG and WebP, still pictures of sane size, decided by content."""
import io
import struct
import zlib

from django.core.files.uploadedfile import SimpleUploadedFile
from django.test import SimpleTestCase, override_settings
from PIL import Image
from ilaf.errors import ApiError

from ilaf import images

from .base import API, ApiTestCase


def encoded(fmt, size=(40, 30), mode="RGB", **save):
    buffer = io.BytesIO()
    Image.new(mode, size, (10, 120, 200) if mode == "RGB" else 0).save(buffer, format=fmt, **save)
    return buffer.getvalue()


def upload(data, name="x.png"):
    return SimpleUploadedFile(name, data, content_type="image/png")


def refused(data, max_bytes=8 * 1024 * 1024, allowed=None):
    try:
        images._open(upload(data), max_bytes, allowed)
    except ApiError as exc:
        return exc.message
    return None


def png_with_header_size(width, height):
    """A tiny PNG whose header claims a huge canvas (a decompression bomb shape)."""
    def chunk(kind, body):
        return struct.pack(">I", len(body)) + kind + body + struct.pack(">I", zlib.crc32(kind + body) & 0xFFFFFFFF)

    ihdr = struct.pack(">IIBBBBB", width, height, 8, 0, 0, 0, 0)
    idat = zlib.compress(b"\x00" * 10)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", ihdr) + chunk(b"IDAT", idat) + chunk(b"IEND", b"")


class FormatTests(SimpleTestCase):
    def test_jpeg_png_webp_are_accepted(self):
        for fmt in ("JPEG", "PNG", "WEBP"):
            self.assertIsNone(refused(encoded(fmt)), fmt)

    def test_other_formats_are_refused(self):
        for fmt in ("GIF", "TIFF", "BMP", "ICO", "PPM", "PDF"):
            try:
                data = encoded(fmt, size=(32, 32))
            except Exception:
                continue
            self.assertIn("PNG, JPG or WebP", refused(data) or "", fmt)

    def test_renamed_file_is_judged_by_content(self):
        self.assertIsNotNone(refused(encoded("GIF")))
        self.assertIsNotNone(refused(b"<svg xmlns='http://www.w3.org/2000/svg'></svg>"))
        self.assertIsNotNone(refused(b"%!PS-Adobe-3.0 EPSF-3.0\n%%BoundingBox: 0 0 10 10\n"))
        self.assertIsNotNone(refused(b"MZ\x90\x00" + b"\x00" * 64))
        self.assertIsNotNone(refused(b""))

    def test_magic_bytes_must_match_a_real_image(self):
        self.assertIn("not a valid image", refused(b"\x89PNG\r\n\x1a\n" + b"garbage" * 20))
        self.assertIn("not a valid image", refused(b"\xff\xd8\xff" + b"garbage" * 20))
        self.assertIn("not a valid image", refused(b"RIFF\x10\x00\x00\x00WEBPjunkjunkjunk"))

    def test_truncated_image_is_refused(self):
        data = encoded("PNG", size=(200, 200))
        self.assertIsNotNone(refused(data[: len(data) // 2]))

    def test_animated_images_are_refused(self):
        frames = [Image.new("RGB", (20, 20), c) for c in ("red", "blue", "green")]
        for fmt in ("WEBP", "PNG"):
            buffer = io.BytesIO()
            frames[0].save(buffer, format=fmt, save_all=True, append_images=frames[1:], duration=100, loop=0)
            self.assertIn("Animated", refused(buffer.getvalue()) or "", fmt)

    def test_still_webp_and_png_with_alpha_pass(self):
        self.assertIsNone(refused(encoded("PNG", mode="RGBA")))
        self.assertIsNone(refused(encoded("WEBP", mode="RGBA")))

    def test_size_limit_and_allowed_subset(self):
        self.assertIn("under", refused(encoded("PNG", size=(200, 200)), max_bytes=100))
        self.assertIn("PNG, JPG or WebP", refused(encoded("PNG"), allowed=("JPEG",)))


class PixelLimitTests(SimpleTestCase):
    @override_settings(IMAGE_MAX_PIXELS=1000)
    def test_pixel_count_over_limit_refused_before_decoding(self):
        self.assertIn("too large", refused(encoded("PNG", size=(50, 50))))

    def test_header_claiming_a_huge_canvas_is_refused(self):
        self.assertIn("too large", refused(png_with_header_size(20000, 20000)) or "")
        self.assertIsNotNone(refused(png_with_header_size(100000, 100000)))
        self.assertIn("too large", refused(png_with_header_size(7000, 7000)) or "")  # 49 MP

    def test_one_side_cap(self):
        self.assertIn("too large", refused(png_with_header_size(13000, 10)) or "")


class FaviconTests(SimpleTestCase):
    def test_favicon_formats(self):
        self.assertIsNotNone(images.icon_from_bytes(encoded("PNG", size=(32, 32))))
        self.assertIsNotNone(images.icon_from_bytes(encoded("ICO", size=(32, 32))))
        self.assertIsNone(images.icon_from_bytes(encoded("GIF", size=(32, 32))))
        self.assertIsNone(images.icon_from_bytes(b"<svg></svg>"))
        self.assertIsNone(images.icon_from_bytes(b"x" * (2 * 1024 * 1024)))


class UploadEndpointTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.person = self.signup()
        self.buy(self.person)
        self.card = self.make_card(self.person)

    def post(self, path, data):
        return self.person.client.post(f"{API}cards/{self.card['id']}/{path}", {"file": upload(data)}, format="multipart")

    def test_photo_cover_icon_accept_png_and_refuse_gif_and_ico(self):
        for path in ("photo", "cover", "icon"):
            self.assertEqual(self.post(path, encoded("PNG")).status_code, 200, path)
            self.assertEqual(self.post(path, encoded("GIF")).status_code, 400, path)
            self.assertEqual(self.post(path, encoded("ICO", size=(32, 32))).status_code, 400, path)
            self.assertEqual(self.post(path, encoded("TIFF")).status_code, 400, path)

    def test_photo_refuses_bomb(self):
        self.assertEqual(self.post("photo", png_with_header_size(30000, 30000)).status_code, 400)
