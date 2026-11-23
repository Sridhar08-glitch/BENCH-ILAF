"""Services of the staff back office: the e-mail log, scheduled-job markers, storage sizes, company facts."""
import os
import time
from datetime import timedelta
from pathlib import Path

from django.conf import settings
from django.core.cache import cache
from django.core.mail import EmailMultiAlternatives
from django.db import connection
from django.db.models import Count
from django.utils import timezone

from .models import EmailLog

RETRY_KEEP_DAYS = 14

# The scheduled jobs of deploy/cron/bench-cron: (name, what it does, how often, minutes after which it counts as late).
JOBS = [
    ("deliver_webhooks", "Send lead webhooks", "Every minute", 10),
    ("sync_crm", "Send new leads to the connected CRMs", "Every minute", 10),
    ("sync_wallet_passes", "Update saved Google Wallet passes", "Every 5 minutes", 30),
    ("fetch_support_mail", "Read the support mailbox", "Every minute", 10),
    ("support_tick", "Support clock (chats, presence, alerts)", "Every minute", 10),
    ("send_announcements", "Send announcement e-mails", "Every 5 minutes", 30),
    ("expire_support_views", "End support views that ran out", "Every 5 minutes", 30),
    ("process_data_requests", "Build big data exports", "Every 5 minutes", 30),
    ("cleanup_data_exports", "Delete old export files", "Every hour", 150),
    ("purge_deleted_accounts", "Erase accounts and companies past their grace period", "Every day", 1560),
    ("expire_subscriptions", "Close finished plan periods", "Every day", 1560),
    ("flushexpiredtokens", "Clear expired sign-in tokens", "Every day", 1560),
    ("prune_analytics", "Roll up old visit records", "Every day", 1560),
    ("prune_api_idempotency", "Clear old API request keys", "Every day", 1560),
    ("prune_back_office", "Clear old staff metrics and e-mail log", "Every day", 1560),
    ("send_renewal_reminders", "Remind about renewals", "Every day", 1560),
    ("send_weekly_reports", "Weekly report e-mails", "Every week", 10200),
    ("clearsessions", "Remove expired admin sessions", "Every week", 10200),
]


# ---------------------------------------------------------------- e-mail log
def record_email(message, kind, ok, exc):
    to = ", ".join(message.to or [])[:254]
    row = EmailLog(to_email=to, subject=(message.subject or "")[:200], kind=kind if kind in ("transactional", "marketing", "staff") else "transactional")
    if ok:
        row.status = "sent"
    else:
        row.status = "failed"
        row.error = f"{type(exc).__name__}: {exc}"[:200]
        row.retry_text = message.body or ""
        for body, mimetype in getattr(message, "alternatives", []) or []:
            if mimetype == "text/html":
                row.retry_html = body
        row.retry_headers = {k: str(v) for k, v in (message.extra_headers or {}).items()}
    row.save()


def resend_email(row):
    """Send a failed e-mail again from its saved body. Returns True when the server took it."""
    if row.status != "failed" or not row.retry_text:
        return False
    message = EmailMultiAlternatives(row.subject, row.retry_text, settings.DEFAULT_FROM_EMAIL, [a.strip() for a in row.to_email.split(",") if a.strip()], headers=row.retry_headers or {})
    if row.retry_html:
        message.attach_alternative(row.retry_html, "text/html")
    try:
        message.send(fail_silently=False)
    except Exception as exc:
        row.error = f"{type(exc).__name__}: {exc}"[:200]
        row.save(update_fields=["error"])
        return False
    row.status = "resent"
    row.resent_at = timezone.now()
    row.retry_text = row.retry_html = ""
    row.retry_headers = {}
    row.save()
    return True


def email_counts(hours=24, now=None):
    now = now or timezone.now()
    out = {"sent": 0, "failed": 0, "resent": 0}
    for row in EmailLog.objects.filter(created_at__gte=now - timedelta(hours=hours)).values("status").annotate(n=Count("id")).order_by():
        out[row["status"]] = row["n"]
    out["sent"] += out["resent"]
    return out


def prune_back_office(now=None):
    """Remove bodies of failed mails after two weeks, e-mail log rows after 90 days and old metrics."""
    from .metrics import KEEP_DAYS
    from .models import RequestMetric

    now = now or timezone.now()
    EmailLog.objects.filter(created_at__lt=now - timedelta(days=RETRY_KEEP_DAYS)).update(retry_text="", retry_html="", retry_headers={})
    EmailLog.objects.filter(created_at__lt=now - timedelta(days=90)).delete()
    RequestMetric.objects.filter(minute__lt=now - timedelta(days=KEEP_DAYS)).delete()


def resend_all_failed(limit=100):
    """Send the failed e-mails that still have their text saved again, newest first. Returns (tried, sent)."""
    tried = sent = 0
    for row in EmailLog.objects.filter(status="failed").exclude(retry_text="").order_by("-created_at")[:limit]:
        tried += 1
        if resend_email(row):
            sent += 1
    return tried, sent


# ---------------------------------------------------------------- work queues
QUEUE_RED_ABOVE = 50


def queue_counts():
    """How much work waits in each queue: support requests nobody answered, lead webhooks, data exports, wallet pass updates and
    failed e-mails. `waiting` is what is still to do, `failing` what already went wrong; `state` is bad above QUEUE_RED_ABOVE."""
    from leads.models import WebhookDelivery
    from privacy.models import DataRequest

    rows = []
    try:
        from support.models import SupportTicket

        rows.append(("support", "Support requests without an answer", SupportTicket.objects.filter(status="new", spam=False).count(), 0))
    except ImportError:
        pass
    rows.append(("webhooks", "Lead webhooks to send", WebhookDelivery.objects.filter(status="pending").count(), WebhookDelivery.objects.filter(status="failed").count()))
    rows.append(("exports", "Data exports to build", DataRequest.objects.filter(kind="export", status__in=("pending", "processing")).count(), DataRequest.objects.filter(kind="export", status="failed").count()))
    try:
        from wallet.models import WalletPass

        rows.append(("wallet", "Wallet passes to update", WalletPass.objects.filter(dirty=True).count(), WalletPass.objects.exclude(last_error="").count()))
    except ImportError:
        pass
    rows.append(("email", "Failed e-mails to send again", EmailLog.objects.filter(status="failed").exclude(retry_text="").count(), 0))
    return [
        {"key": k, "label": label, "waiting": waiting, "failing": failing, "state": "bad" if waiting > QUEUE_RED_ABOVE else "warn" if failing else "ok"}
        for k, label, waiting, failing in rows
    ]


# ---------------------------------------------------------------- scheduled jobs
def job_states(now=None):
    """Last run and state of every job, read from the markers run_job.sh leaves in BENCH_STATE_DIR.
    State: ok, late (no success for longer than expected), failed (the last run failed) or unknown (no markers here)."""
    now = time.time() if now is None else now
    state = Path(settings.BENCH_STATE_DIR)
    present = state.is_dir()
    out = []
    for name, label, every, late_after in JOBS:
        row = {"name": name, "label": label, "every": every, "state": "unknown", "last_ok_at": None, "duration_s": None, "note": ""}
        if present:
            ok_file, fail_file, last_file = state / f"ok-{name}", state / f"fail-{name}", state / f"last-{name}"
            if ok_file.exists():
                age = (now - ok_file.stat().st_mtime) / 60
                row["last_ok_at"] = _iso(ok_file.stat().st_mtime)
                row["state"] = "ok" if age <= late_after else "late"
            else:
                row["state"] = "late"
            if fail_file.exists():
                row["state"] = "failed"
                row["note"] = _read(fail_file)[:200]
            if last_file.exists():
                parts = _read(last_file).split()
                if len(parts) >= 3 and parts[2].isdigit():
                    row["duration_s"] = int(parts[2])
        out.append(row)
    return out


def _read(path):
    try:
        return Path(path).read_text(encoding="utf-8", errors="replace").strip()
    except OSError:
        return ""


def _iso(epoch):
    from datetime import datetime, timezone as tz

    return datetime.fromtimestamp(epoch, tz.utc).isoformat().replace("+00:00", "Z")


# ---------------------------------------------------------------- storage
def _folder_size(path, limit_seconds=3.0):
    started, total = time.monotonic(), 0
    for root, _dirs, files in os.walk(path):
        for name in files:
            try:
                total += os.path.getsize(os.path.join(root, name))
            except OSError:
                pass
        if time.monotonic() - started > limit_seconds:
            break
    return total


def storage_usage():
    """Sizes in bytes of the pictures folder, the private files and the database. Cached for five minutes."""
    cached = cache.get("staff:storage")
    if cached is not None:
        return cached
    db_bytes = None
    try:
        with connection.cursor() as cur:
            if connection.vendor == "postgresql":
                cur.execute("select pg_database_size(current_database())")
                db_bytes = int(cur.fetchone()[0])
            elif connection.vendor == "sqlite":
                name = str(connection.settings_dict.get("NAME") or "")
                db_bytes = os.path.getsize(name) if name and os.path.exists(name) else None
    except Exception:
        db_bytes = None
    media, private, exports = str(settings.MEDIA_ROOT), str(settings.PRIVATE_FILES_ROOT), str(settings.EXPORT_ROOT)

    def size_of(*folders):
        return sum(_folder_size(f) for f in folders if os.path.isdir(f))

    # Sizes by kind of file, from the folders each kind is saved in.
    categories = [
        {"key": "card_photos", "label": "Card photos", "bytes": size_of(os.path.join(media, "cards"), os.path.join(media, "covers"), os.path.join(media, "users"))},
        {"key": "logos", "label": "Logos and brand files", "bytes": size_of(os.path.join(media, "logos"), os.path.join(media, "brand"))},
        {"key": "exports", "label": "Data exports", "bytes": size_of(exports)},
        {"key": "design_files", "label": "Design request files", "bytes": size_of(os.path.join(private, "design-requests"))},
    ]
    result = {
        "categories": categories,
        "media_bytes": _folder_size(settings.MEDIA_ROOT) if os.path.isdir(settings.MEDIA_ROOT) else 0,
        "private_bytes": sum(_folder_size(p) for p in {str(settings.PRIVATE_FILES_ROOT), str(settings.EXPORT_ROOT)} if os.path.isdir(p)),
        "database_bytes": db_bytes,
    }
    cache.set("staff:storage", result, 300)
    return result


# ---------------------------------------------------------------- companies
def company_country_guess(workspace):
    """The country most of a company's visitors come from over the last 90 days, or "". Only a guess about where the company is."""
    from analytics.models import Event

    since = timezone.now() - timedelta(days=90)
    row = (
        Event.objects.filter(card__workspace=workspace, created_at__gte=since).exclude(country__in=("unknown", ""))
        .values("country").annotate(n=Count("id")).order_by("-n").first()
    )
    return row["country"] if row else ""


def company_country_info(workspace):
    """(country, guessed): the country the company chose, else the visitor-based guess, else ("", False)."""
    if workspace.country:
        return workspace.country, False
    guess = company_country_guess(workspace)
    return guess, bool(guess)


def company_country(workspace):
    """The company's own country when it has set one, otherwise the visitor-based guess, or ""."""
    return company_country_info(workspace)[0]


def customer_event(request, workspace, action, target_type="", target_id="", target_label="", details=None):
    """A line in the company's own Activity log written by the product team. It shows "<product> support", never a name."""
    from operations.audit import ip_hash
    from operations.models import AuditEvent

    return AuditEvent.objects.create(
        workspace=workspace, actor=None, actor_email="", actor_name=f"{settings.PRODUCT_NAME} support", action=action,
        target_type=target_type, target_id=str(target_id or "")[:64], target_label=(target_label or "")[:200], details=details or {},
        ip_hash=ip_hash(request),
    )
