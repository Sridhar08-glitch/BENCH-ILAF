"""Keeps a saved Google Wallet pass in step with its card.

When someone asks for the save link the pass is stored at Google through the Wallet REST API and the link carries
only a reference to it. Afterwards every card change marks the pass "dirty" (one cheap query, never an error), and
the `sync_wallet_passes` job sends the changed pass to Google. A pass whose data did not change is never sent again.
If Google cannot be reached when a link is made, the link falls back to the whole pass inside the link, so the
button keeps working, and the problem is recorded on the pass.
"""
import hashlib
import json
import logging
import time
from datetime import timedelta
from urllib.parse import quote

from django.conf import settings
from django.db.models import Max
from django.utils import timezone

from . import client, passes
from ilaf.utils import iso

from .client import WalletApiError
from .models import WalletPass

log = logging.getLogger(__name__)

MAX_BACKOFF_SECONDS = 6 * 3600
STOP_AFTER_FAILURES = 3
# Fields that may disappear from a card; a PATCH must clear them explicitly or Google keeps the old value.
CLEARABLE = ("subheader", "logo", "linksModuleData")
# Card writes that cannot change the pass.
IRRELEVANT_FIELDS = {"is_default", "sort_order", "hide_from_directory", "seo_indexable"}


# ---------------------------------------------------------------- settings and bodies

def rest_enabled():
    return bool(settings.GOOGLE_WALLET_REST_UPDATES) and passes.is_configured()


def digest(body):
    return hashlib.sha256(json.dumps(body, sort_keys=True, separators=(",", ":")).encode("utf-8")).hexdigest()


def pass_body(card, request=None):
    """(object, warnings) as Google should hold it: the full pass, switched off while the card is not published."""
    obj = passes.build_object(card, request, 0)
    warnings = obj.pop("_warnings")
    if card.status != "published":
        obj["state"] = "INACTIVE"
    return obj, warnings


def patch_body(obj, notify_hash=""):
    """The PATCH body: everything but the ids, with removed optional parts cleared. Optionally a phone message."""
    body = {k: v for k, v in obj.items() if k not in ("id", "classId")}
    for key in CLEARABLE:
        body.setdefault(key, None)
    if notify_hash and settings.GOOGLE_WALLET_NOTIFY_ON_UPDATE:
        body["notifyPreference"] = "ENABLE_NOTIFICATIONS"
        body["messages"] = [{"id": "u" + notify_hash[:12], "header": "Card updated", "body": "This card has new details."}]
    return body


def _path(object_id):
    return "genericObject/" + quote(object_id, safe="")


# ---------------------------------------------------------------- Google calls

_class_ready = set()


def ensure_class(email, key):
    """The pass class exists at Google (created with just its id when missing, like the inline class had)."""
    cid = passes.class_id(settings.GOOGLE_WALLET_ISSUER_ID)
    if cid in _class_ready:
        return
    status, data = client.api("GET", "genericClass/" + quote(cid, safe=""), email, key)
    if status == 404:
        status, data = client.api("POST", "genericClass", email, key, {"id": cid})
        if status == 409:
            status = 200
    if status not in (200, 201):
        raise WalletApiError(status, client.error_text(status, data))
    _class_ready.add(cid)


def send_object(obj, patch_first, email, key, notify_hash=""):
    """Create or update the object at Google. Returns the final (status, data); 404 on update and 409 on create are handled."""
    def insert():
        return client.api("POST", "genericObject", email, key, obj)

    def update():
        return client.api("PATCH", _path(obj["id"]), email, key, patch_body(obj, notify_hash))

    if patch_first:
        status, data = update()
        if status == 404:
            status, data = insert()
    else:
        status, data = insert()
        if status == 409:
            status, data = update()
    return status, data


# ---------------------------------------------------------------- bookkeeping

def _backoff(attempts):
    return timedelta(seconds=min(60 * 2 ** max(attempts - 1, 0), MAX_BACKOFF_SECONDS))


def _recheck(now):
    return now + timedelta(hours=max(settings.GOOGLE_WALLET_RECHECK_HOURS, 1))


def _row_for(card, object_id):
    row, _ = WalletPass.objects.get_or_create(card=card, defaults={"object_id": object_id})
    if row.object_id != object_id:
        # The pass id setting changed: this is a different pass at Google.
        row.object_id = object_id
        row.remote_exists, row.last_synced_hash = False, ""
        row.save(update_fields=["object_id", "remote_exists", "last_synced_hash", "updated_at"])
    return row


def _synced(row, digest_, now, remote_exists=True):
    row.last_synced_hash, row.last_synced_at, row.remote_exists = digest_, now, remote_exists
    row.dirty, row.last_error, row.attempts, row.next_try_at = False, "", 0, _recheck(now)
    row.save()


def _failed(row, error, now, retryable=True):
    row.last_error = str(error)[:300]
    row.attempts += 1
    if not retryable or row.attempts >= max(settings.GOOGLE_WALLET_MAX_ATTEMPTS, 1):
        row.last_error = ("Gave up: " + row.last_error)[:300]
        row.attempts, row.dirty, row.next_try_at = 0, False, _recheck(now)
        row.save()
        return True
    row.dirty, row.next_try_at = True, now + _backoff(row.attempts)
    row.save()
    return False


def _safe_message(exc):
    return exc.message if isinstance(exc, WalletApiError) else f"Unexpected error ({type(exc).__name__})."


# ---------------------------------------------------------------- marking changes

def mark_dirty(card, now=None):
    """The card changed: the saved pass must be compared with it. Never raises, never waits for Google."""
    try:
        WalletPass.objects.filter(card_id=getattr(card, "pk", card)).update(
            dirty=True, attempts=0, next_try_at=now or timezone.now())
    except Exception:
        log.warning("wallet: could not mark a pass changed", exc_info=True)


def mark_workspace_dirty(workspace, now=None):
    try:
        WalletPass.objects.filter(card__workspace_id=getattr(workspace, "pk", workspace), dirty=False).update(
            dirty=True, attempts=0, next_try_at=now or timezone.now())
    except Exception:
        log.warning("wallet: could not mark passes changed", exc_info=True)


def mark_deleted(card, now=None):
    try:
        WalletPass.objects.filter(card_id=card.pk).update(
            dirty=True, card_deleted=True, attempts=0, next_try_at=now or timezone.now())
    except Exception:
        log.warning("wallet: could not mark a pass removed", exc_info=True)


# ---------------------------------------------------------------- the save link

def rest_link(card, request=None, now=None):
    """Store the current pass at Google and return (object id, warnings) for a short save link.
    Raises WalletApiError (or any other error) when that is not possible; the caller falls back to the inline pass."""
    now = now or timezone.now()
    email, key = passes.load_service_account()
    obj, warnings = pass_body(card, request)
    row = _row_for(card, obj["id"])
    h = digest(obj)
    try:
        if not (row.remote_exists and row.last_synced_hash == h and not row.dirty):
            ensure_class(email, key)
            status, data = send_object(obj, row.remote_exists, email, key)
            if status not in (200, 201):
                raise WalletApiError(status, client.error_text(status, data))
            _synced(row, h, now)
    except Exception as exc:
        row.refresh_from_db()
        row.last_error, row.dirty = _safe_message(exc)[:300], True
        row.next_try_at = now + timedelta(minutes=1)
        row.save(update_fields=["last_error", "dirty", "next_try_at", "updated_at"])
        raise
    return obj["id"], warnings


# ---------------------------------------------------------------- the job

def _finish(row, obj):
    """A switched-off pass of a deleted card is done for good: it is not compared again."""
    if obj is None:
        row.next_try_at = None
        row.save(update_fields=["next_try_at", "updated_at"])


def _sync_one(row, email, key, now, notify):
    """One pass. Returns 'sent', 'unchanged', 'missing', 'failed' or 'gave_up'."""
    card = row.card
    if card is None or row.card_deleted:
        body = {"state": "EXPIRED"}
        obj = None
    else:
        obj, _ = pass_body(card)
        body = obj
    h = digest(body)
    if row.last_synced_hash == h:
        _synced(row, h, now, row.remote_exists)
        _finish(row, obj)
        return "unchanged"
    try:
        if obj is not None:
            status, data = client.api("PATCH", _path(row.object_id), email, key,
                                      patch_body(obj, h if notify and row.remote_exists else ""))
        else:
            status, data = client.api("PATCH", _path(row.object_id), email, key, body)
    except Exception as exc:
        gave_up = _failed(row, _safe_message(exc), now, retryable=not isinstance(exc, WalletApiError) or exc.retryable)
        return "gave_up" if gave_up else "failed"
    if status in (200, 201):
        _synced(row, h, now)
        _finish(row, obj)
        return "sent"
    if status == 404:
        # Nobody saved this pass, so there is nothing to update; a later save link creates it.
        _synced(row, h, now, remote_exists=False)
        _finish(row, obj)
        return "missing"
    retryable = status == 429 or status >= 500
    gave_up = _failed(row, client.error_text(status, data), now, retryable=retryable)
    return "gave_up" if gave_up else "failed"


def process_due(limit=100, budget_seconds=50, now=None):
    """Send the changed passes that are due. Returns a dict of counts."""
    now = now or timezone.now()
    stats = {"sent": 0, "unchanged": 0, "missing": 0, "failed": 0, "gave_up": 0, "configured": True, "stopped_early": False}
    if not settings.GOOGLE_WALLET_REST_UPDATES:
        stats["configured"] = False
        return stats
    try:
        email, key = passes.load_service_account()
    except Exception:
        stats["configured"] = False
        return stats
    started, failures = time.monotonic(), 0
    rows = WalletPass.objects.filter(next_try_at__lte=now).select_related("card__workspace").order_by("next_try_at")[:limit]
    for row in rows:
        if time.monotonic() - started > budget_seconds or failures >= STOP_AFTER_FAILURES:
            stats["stopped_early"] = True
            break
        outcome = _sync_one(row, email, key, now, settings.GOOGLE_WALLET_NOTIFY_ON_UPDATE)
        stats[outcome] += 1
        failures = failures + 1 if outcome in ("failed", "gave_up") else 0
    return stats


# ---------------------------------------------------------------- staff summary

def summary():
    rows = WalletPass.objects
    failing = rows.exclude(last_error="")
    last = failing.order_by("-updated_at").first()
    return {
        "rest_updates": bool(settings.GOOGLE_WALLET_REST_UPDATES) and passes.is_configured(),
        "passes": rows.count(),
        "waiting": rows.filter(dirty=True).count(),
        "failing": failing.count(),
        "last_error": last.last_error if last else "",
        "last_synced_at": iso(rows.aggregate(m=Max("last_synced_at"))["m"]),
    }
