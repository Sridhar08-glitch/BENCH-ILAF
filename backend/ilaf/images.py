"""Image upload processing with Pillow: validate, strip metadata, resize, re-encode."""
import io
import uuid
import warnings

from django.conf import settings
from django.core.files.base import ContentFile
from PIL import Image, ImageOps, UnidentifiedImageError

from .errors import validation_error

# Only these three formats are ever decoded. Pillow can open dozens of formats (EPS can even call Ghostscript),
# so the format list is passed to Image.open and the first bytes are checked before Pillow sees the file.
ALLOWED_FORMATS = ("JPEG", "PNG", "WEBP")
FORMAT_MESSAGE = "Use a PNG, JPG or WebP image."
TOO_LARGE_MESSAGE = "That image is too large. Use one under 40 megapixels."
MAGIC = (
    (bytes.fromhex("ffd8ff"), "JPEG"),
    (bytes.fromhex("89504e470d0a1a0a"), "PNG"),
)
MAX_SIDE_PX = 12000


def max_pixels():
    return int(getattr(settings, "IMAGE_MAX_PIXELS", 40_000_000))


# Pillow warns at this many pixels and refuses at twice this many; the warning is turned into an error below.
Image.MAX_IMAGE_PIXELS = max_pixels()


def sniff_format(head):
    """Format name from the first bytes of a file ('JPEG', 'PNG', 'WEBP') or None. Extension and content type are never used."""
    for prefix, name in MAGIC:
        if head.startswith(prefix):
            return name
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "WEBP"
    return None


def _is_animated(img):
    if getattr(img, "is_animated", False) or getattr(img, "n_frames", 1) > 1:
        return True
    return img.format == "PNG" and "default_image" in img.info


def decode_safely(read_bytes, allowed=ALLOWED_FORMATS):
    """Open and fully decode an image from a fresh file-like object factory, enforcing the format list,
    the magic bytes, no animation, and the pixel limits. Returns the loaded image. Raises ValueError with a
    user-facing reason on every refusal."""
    head = read_bytes().read(16)
    sniffed = sniff_format(head)
    if sniffed is None or sniffed not in allowed:
        raise ValueError(FORMAT_MESSAGE)
    with warnings.catch_warnings():
        warnings.simplefilter("error", Image.DecompressionBombWarning)
        try:
            img = Image.open(read_bytes(), formats=[sniffed])
            if img.format not in allowed or img.format != sniffed:
                raise ValueError(FORMAT_MESSAGE)
            width, height = img.size
            if width < 1 or height < 1 or width > MAX_SIDE_PX or height > MAX_SIDE_PX or width * height > max_pixels():
                raise ValueError(TOO_LARGE_MESSAGE)
            if _is_animated(img):
                raise ValueError("Animated images are not accepted. Use a still PNG, JPG or WebP image.")
            Image.open(read_bytes(), formats=[sniffed]).verify()
            img.load()
        except ValueError:
            raise
        except (Image.DecompressionBombError, Image.DecompressionBombWarning):
            raise ValueError(TOO_LARGE_MESSAGE)
        except (UnidentifiedImageError, OSError, SyntaxError, EOFError, MemoryError):
            raise ValueError("That file is not a valid image.")
    return img


def _open(upload, max_bytes, allowed_formats=None):
    if upload is None:
        raise validation_error({"file": ["Choose an image file."]})
    if upload.size > max_bytes:
        raise validation_error({"file": [f"The image must be under {max_bytes // (1024 * 1024) or 1} MB."]})

    def reader():
        upload.seek(0)
        return upload

    try:
        img = decode_safely(reader, tuple(allowed_formats) if allowed_formats else ALLOWED_FORMATS)
    except ValueError as exc:
        raise validation_error({"file": [str(exc)]})
    finally:
        upload.seek(0)
    return ImageOps.exif_transpose(img)


def _flatten_alpha(img):
    """Put transparent images on a white background so they survive JPEG encoding."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.split()[3])
        return background
    return img.convert("RGB")


def process_jpeg(upload, max_px, name_prefix):
    """Resize so neither side exceeds max_px and return a JPEG ContentFile."""
    img = _flatten_alpha(_open(upload, settings.MAX_UPLOAD_BYTES))
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=86, optimize=True)
    return ContentFile(buffer.getvalue(), name=f"{name_prefix}-{uuid.uuid4().hex}.jpg")


def process_logo_png(upload, max_px, name_prefix):
    """Resize a logo and keep transparency by re-encoding as PNG."""
    img = _open(upload, settings.MAX_UPLOAD_BYTES)
    img = img.convert("RGBA")
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    return ContentFile(buffer.getvalue(), name=f"{name_prefix}-{uuid.uuid4().hex}.png")


def process_icon_png(upload, size, name_prefix, max_bytes=1024 * 1024):
    """Item icon: PNG, JPG or WebP only (never SVG), max 1 MB, fitted into a size x size transparent square."""
    img = _open(upload, max_bytes, ("PNG", "JPEG", "WEBP")).convert("RGBA")
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG", optimize=True)
    return ContentFile(buffer.getvalue(), name=f"{name_prefix}-{uuid.uuid4().hex}.png")


FAVICON_FORMATS = ("JPEG", "PNG", "WEBP", "ICO")


def icon_from_bytes(data, size=128):
    """Same as process_icon_png but for bytes fetched from a website (favicons). Returns None on failure.
    A favicon may also be a classic .ico file (the usual /favicon.ico); nothing else beyond the upload formats."""
    try:
        if len(data) > 1024 * 1024:
            return None
        head = data[:16]
        if head[:4] == b"\x00\x00\x01\x00":
            with warnings.catch_warnings():
                warnings.simplefilter("error", Image.DecompressionBombWarning)
                img = Image.open(io.BytesIO(data), formats=["ICO"])
                if img.width > 512 or img.height > 512:
                    return None
                img.load()
        else:
            img = decode_safely(lambda: io.BytesIO(data))
        img = img.convert("RGBA")
    except Exception:
        return None
    img.thumbnail((size, size), Image.LANCZOS)
    canvas = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    canvas.paste(img, ((size - img.width) // 2, (size - img.height) // 2))
    buffer = io.BytesIO()
    canvas.save(buffer, format="PNG", optimize=True)
    return ContentFile(buffer.getvalue(), name=f"fav-{uuid.uuid4().hex[:10]}.png")


def process_cover(upload, name_prefix):
    """Cover picture: JPG, PNG or WebP (no SVG or GIF), max 3 MB, fitted and cropped to 1280x800 JPEG."""
    img = _flatten_alpha(_open(upload, 3 * 1024 * 1024, ("PNG", "JPEG", "WEBP")))
    img = ImageOps.fit(img, (1280, 800), Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=84, optimize=True)
    return ContentFile(buffer.getvalue(), name=f"{name_prefix}-{uuid.uuid4().hex}.jpg")


BRAND_PICTURE_MAX_BYTES = 3 * 1024 * 1024


def _refuse_svg(upload):
    """SVG can carry scripts, so it is refused with a clear message instead of the generic one."""
    if upload is None:
        return
    head = upload.read(512).lstrip().lower()
    upload.seek(0)
    if head.startswith(b"<svg") or (head.startswith(b"<?xml") and b"<svg" in head) or head.startswith(b"<!doctype svg"):
        raise validation_error({"file": ["SVG files are not accepted. Use a PNG, JPG or WebP image."]})


def process_brand_picture(upload, max_px, name_prefix):
    """Company background or template picture: PNG, JPG or WebP up to 3 MB, fitted inside max_px, JPEG."""
    _refuse_svg(upload)
    img = _flatten_alpha(_open(upload, BRAND_PICTURE_MAX_BYTES, ("PNG", "JPEG", "WEBP")))
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="JPEG", quality=86, optimize=True)
    return ContentFile(buffer.getvalue(), name=f"{name_prefix}-{uuid.uuid4().hex}.jpg")


def process_brand_symbol(upload, max_px, name_prefix):
    """Company symbol: PNG, JPG or WebP up to 3 MB, fitted inside max_px, PNG keeping transparency."""
    _refuse_svg(upload)
    img = _open(upload, BRAND_PICTURE_MAX_BYTES, ("PNG", "JPEG", "WEBP")).convert("RGBA")
    img.thumbnail((max_px, max_px), Image.LANCZOS)
    buffer = io.BytesIO()
    img.save(buffer, format="PNG", optimize=True)
    return ContentFile(buffer.getvalue(), name=f"{name_prefix}-{uuid.uuid4().hex}.png")
