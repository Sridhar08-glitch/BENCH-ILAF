"""Documents a person uploads to their card (a PDF behind a "Download file" button)."""
import uuid

from django.core.files.base import ContentFile

from .errors import validation_error
from .items import MAX_DOWNLOAD_BYTES

# PDF features that run code or open other programs; a plain document never needs them.
_ACTIVE_MARKERS = (b"/JavaScript", b"/JS", b"/Launch", b"/EmbeddedFile", b"/RichMedia")


def process_pdf(upload, name_prefix):
    """A PDF up to 10 MB: the first bytes must be the PDF signature, and it must carry no scripts or embedded programs.
    Returns a ContentFile with a random name (the visitor's file name is never used)."""
    if upload is None:
        raise validation_error({"file": ["Choose a PDF file."]})
    if upload.size > MAX_DOWNLOAD_BYTES:
        raise validation_error({"file": ["The PDF must be under 10 MB."]})
    upload.seek(0)
    data = upload.read(MAX_DOWNLOAD_BYTES + 1)
    upload.seek(0)
    if not data.startswith(b"%PDF-") or b"%%EOF" not in data[-2048:]:
        raise validation_error({"file": ["Upload a PDF file."]})
    if any(marker in data for marker in _ACTIVE_MARKERS):
        raise validation_error({"file": ["This PDF contains scripts or embedded files. Export a plain PDF and try again."]})
    return ContentFile(data, name=f"{name_prefix}-{uuid.uuid4().hex}.pdf")
