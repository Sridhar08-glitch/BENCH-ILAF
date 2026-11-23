"""A log handler that keeps the last 500 server errors for the staff "Errors" tab, with personal details removed."""
import hashlib
import logging
import re
import threading

KEEP = 500
_guard = threading.local()
_count = {"n": 0}

_EMAIL = re.compile(r"[\w.+-]+@[\w-]+(?:\.[\w-]+)+")
_UUID = re.compile(r"[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")
_TOKEN = re.compile(r"\b[A-Za-z0-9_\-]{24,}\b")
_NUMBER = re.compile(r"\b\d{4,}\b")


def scrub(text):
    """Remove e-mail addresses, tokens, ids and long numbers from a message."""
    text = _EMAIL.sub("[email]", str(text or ""))
    text = _UUID.sub("{id}", text)
    text = _TOKEN.sub("[token]", text)
    return _NUMBER.sub("[n]", text)


def scrub_path(path):
    path = str(path or "").split("?")[0]
    path = _UUID.sub("{id}", path)
    return re.sub(r"/\d+(?=/|$)", "/{id}", path)[:200]


def trace_hash(exc_info):
    """A short fingerprint of where an error happened (exception type and innermost frame), the same for repeats."""
    if not exc_info or not exc_info[0]:
        return ""
    tb = exc_info[2]
    last = None
    while tb is not None:
        last = tb
        tb = tb.tb_next
    where = f"{last.tb_frame.f_code.co_filename.split('/')[-1].split(chr(92))[-1]}:{last.tb_lineno}" if last else ""
    return hashlib.sha256(f"{exc_info[0].__name__}|{where}".encode()).hexdigest()[:16]


class RecentErrorHandler(logging.Handler):
    def __init__(self, level=logging.ERROR):
        super().__init__(level)

    def emit(self, record):
        if getattr(_guard, "on", False) or record.levelno < logging.ERROR:
            return
        _guard.on = True
        try:
            from django.db import transaction

            from .models import ErrorLogEntry

            request = getattr(record, "request", None)
            path = scrub_path(getattr(request, "path", "")) if request is not None else ""
            message = scrub(record.getMessage())[:300] or record.name
            fingerprint = trace_hash(record.exc_info) or hashlib.sha256(f"{record.name}|{message}".encode()).hexdigest()[:16]
            with transaction.atomic():
                ErrorLogEntry.objects.create(
                    source=record.name[:60], path=path, status=str(getattr(record, "status_code", "") or "")[:10],
                    message=message, trace_hash=fingerprint,
                )
                _count["n"] += 1
                if _count["n"] % 25 == 0:
                    prune()
        except Exception:  # logging must never break the request that is being logged
            pass
        finally:
            _guard.on = False


def prune(keep=KEEP):
    from .models import ErrorLogEntry

    ids = list(ErrorLogEntry.objects.order_by("-created_at", "-id").values_list("id", flat=True)[keep:keep + 5000])
    if ids:
        ErrorLogEntry.objects.filter(id__in=ids).delete()
