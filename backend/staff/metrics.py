"""Request metrics: a middleware that counts API requests per minute with a speed histogram, and the reader that turns the
table into the health numbers of the staff overview.

Each process keeps the current minute in memory and writes one row when the minute changes, so a request costs no query.
Rows older than a week are removed when a minute is written."""
import threading
import time
from datetime import timedelta

from django.db import transaction
from django.utils import timezone

BUCKETS = (50, 100, 250, 500, 1000, 2500, 5000)  # upper bounds in milliseconds; slower requests count in "10000"
KEEP_DAYS = 7

_lock = threading.Lock()
_state = {"minute": None, "requests": 0, "errors": 0, "buckets": {}}


def _bucket_of(ms):
    for bound in BUCKETS:
        if ms <= bound:
            return str(bound)
    return "10000"


def _take(minute):
    """Hand back the finished minute (if any) and start counting `minute`. Call with the lock held."""
    done = None
    if _state["minute"] is not None and _state["minute"] != minute:
        done = dict(_state)
        done["buckets"] = dict(_state["buckets"])
        _state.update({"minute": minute, "requests": 0, "errors": 0, "buckets": {}})
    elif _state["minute"] is None:
        _state["minute"] = minute
    return done


def record(status, ms, now=None):
    now = now or timezone.now()
    minute = now.replace(second=0, microsecond=0)
    with _lock:
        done = _take(minute)
        _state["requests"] += 1
        if status >= 500:
            _state["errors"] += 1
        key = _bucket_of(ms)
        _state["buckets"][key] = _state["buckets"].get(key, 0) + 1
    if done is not None:
        _write(done)


def flush():
    """Write the minute being counted now (the staff overview and the tests call this)."""
    with _lock:
        if _state["minute"] is None or not _state["requests"]:
            return
        done = {"minute": _state["minute"], "requests": _state["requests"], "errors": _state["errors"], "buckets": dict(_state["buckets"])}
        _state.update({"requests": 0, "errors": 0, "buckets": {}})
    _write(done)


def reset():
    with _lock:
        _state.update({"minute": None, "requests": 0, "errors": 0, "buckets": {}})


def _write(done):
    from .models import RequestMetric

    try:
        with transaction.atomic():
            row, _ = RequestMetric.objects.select_for_update().get_or_create(minute=done["minute"])
            merged = dict(row.buckets or {})
            for key, count in done["buckets"].items():
                merged[key] = merged.get(key, 0) + count
            row.buckets = merged
            row.requests += done["requests"]
            row.server_errors += done["errors"]
            row.save()
            RequestMetric.objects.filter(minute__lt=done["minute"] - timedelta(days=KEEP_DAYS)).delete()
    except Exception:  # a metrics problem must never reach a visitor
        pass


class RequestMetricsMiddleware:
    def __init__(self, get_response):
        self.get_response = get_response

    def __call__(self, request):
        started = time.monotonic()
        response = self.get_response(request)
        try:
            if not request.path.startswith(("/static/", "/media/")):
                record(response.status_code, (time.monotonic() - started) * 1000)
        except Exception:
            pass
        return response


# ---------------------------------------------------------------- reading
def percentile(buckets, share=0.95):
    """The speed (ms) that `share` of the requests were faster than, from merged histogram buckets."""
    total = sum(buckets.values())
    if not total:
        return None
    need = total * share
    seen = 0
    for bound in list(BUCKETS) + [10000]:
        seen += buckets.get(str(bound), 0)
        if seen >= need:
            return bound
    return 10000


def summary(minutes=10, now=None):
    """Requests, server errors and the p95 speed over the last `minutes`."""
    from .models import RequestMetric

    flush()
    now = now or timezone.now()
    rows = RequestMetric.objects.filter(minute__gte=now - timedelta(minutes=minutes))
    merged, requests, errors = {}, 0, 0
    for row in rows:
        requests += row.requests
        errors += row.server_errors
        for key, count in (row.buckets or {}).items():
            merged[key] = merged.get(key, 0) + count
    return {"requests": requests, "server_errors": errors, "p95_ms": percentile(merged)}


def series(hours=24, now=None):
    """Per-hour request counts, server errors and p95 for the system health chart."""
    from .models import RequestMetric

    now = now or timezone.now()
    start = (now - timedelta(hours=hours - 1)).replace(minute=0, second=0, microsecond=0)
    out = {}
    for row in RequestMetric.objects.filter(minute__gte=start):
        hour = row.minute.replace(minute=0)
        slot = out.setdefault(hour, {"requests": 0, "errors": 0, "buckets": {}})
        slot["requests"] += row.requests
        slot["errors"] += row.server_errors
        for key, count in (row.buckets or {}).items():
            slot["buckets"][key] = slot["buckets"].get(key, 0) + count
    points = []
    for i in range(hours):
        hour = start + timedelta(hours=i)
        slot = out.get(hour, {"requests": 0, "errors": 0, "buckets": {}})
        points.append({"hour": hour.isoformat().replace("+00:00", "Z"), "requests": slot["requests"], "errors": slot["errors"], "p95_ms": percentile(slot["buckets"])})
    return points
