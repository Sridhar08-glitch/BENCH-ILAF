"""Sending leads to the connected CRMs.

Workflow: a lead event (`leads.webhooks.enqueue` is the one place every lead event passes) calls `on_lead_event`,
which writes one `CrmSyncJob` per connected CRM. The management command `sync_crm` (cron, every minute) works through
the queue: it refreshes an expired token, finds or creates the contact by e-mail, adds one note per lead, optionally
sets the owner and the status, and records the result. A temporary failure is retried with a growing gap; a CRM that
refuses our access switches the connection off and tells the company's admins by e-mail.
"""
import time
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.db.models import F, Q
from django.utils import timezone

from ilaf.emails import send_brand_email
from ilaf.i18n import member_language, tr
from operations import audit

from . import crypto, http
from .errors import (
    AuthRevoked, BadMapping, CrmError, Forbidden, RateLimited, Rejected, TokenUnreadable, Unavailable,
)
from .models import CrmConnection, CrmLeadLink, CrmSyncJob, default_settings
from .vendors import CRM_FIELD_RE, LEAD_FIELDS, LEAD_STATUSES, build_fields, get_vendor, lead_values

MAX_ATTEMPTS = 8
BACKOFF = [60, 300, 1800, 7200, 21600, 43200, 86400]
LOCK_SECONDS = 120
PER_CONNECTION_BATCH = 10
RUN_BUDGET_SECONDS = 50
MAX_BACKFILL = 500
BACKFILL_DAYS = 30
FAILING_AFTER = 3
TOKEN_REFRESH_MARGIN = 90


# ---------------------------------------------------------------- the connection as seen by the vendor code
class Session:
    """Calls to one CRM with the connection's token: refreshes it when it is about to expire, once more on a 401, and
    turns the vendor's answers into the errors of `errors.py`."""

    def __init__(self, conn):
        self.conn = conn
        self.vendor = get_vendor(conn.vendor)
        self.refreshed = False

    def _token(self):
        try:
            return crypto.decrypt(self.conn.access_token)
        except crypto.CannotDecrypt:
            raise TokenUnreadable("The stored token cannot be read.")

    def refresh(self):
        try:
            refresh_token = crypto.decrypt(self.conn.refresh_token)
        except crypto.CannotDecrypt:
            raise TokenUnreadable("The stored token cannot be read.")
        if not refresh_token:
            raise AuthRevoked("There is no refresh token.")
        fresh = self.vendor.refresh(self.conn, refresh_token)
        self.conn.access_token = crypto.encrypt(fresh["access_token"])
        self.conn.refresh_token = crypto.encrypt(fresh["refresh_token"])
        self.conn.token_expires_at = timezone.now() + timedelta(seconds=fresh["expires_in"])
        self.conn.save(update_fields=["access_token", "refresh_token", "token_expires_at"])
        self.refreshed = True

    def request(self, method, url, json=None, params=None, conflict_retry=False):
        expires = self.conn.token_expires_at
        if expires is not None and expires <= timezone.now() + timedelta(seconds=TOKEN_REFRESH_MARGIN) and not self.refreshed:
            self.refresh()
        for attempt in (1, 2):
            headers = self.vendor.auth_header(self._token())
            try:
                res = http.call(method, url, self.vendor.host_ok(self.conn), headers=headers, json_body=json, params=params)
            except http.NetworkError as exc:
                raise Unavailable(f"Could not connect: {exc}")
            except http.BlockedHost as exc:
                raise Rejected(str(exc))
            if res.status == 401 and attempt == 1 and not self.refreshed:
                self.refresh()
                continue
            return self._check(res, conflict_retry)

    @staticmethod
    def _detail(res):
        data = res.data
        if isinstance(data, list) and data and isinstance(data[0], dict):
            data = data[0]
        if isinstance(data, dict):
            return str(data.get("message") or data.get("error_description") or data.get("error") or data.get("raw") or "")[:250]
        return ""

    def _check(self, res, conflict_retry):
        status = res.status
        if 200 <= status < 300:
            return res
        detail = self._detail(res)
        if status == 401:
            raise AuthRevoked(detail or "The CRM no longer accepts the connection.", status=status)
        if status == 429 or (status == 403 and "REQUEST_LIMIT_EXCEEDED" in str(res.data)):
            try:
                wait = int(res.headers.get("retry-after", 60))
            except ValueError:
                wait = 60
            raise RateLimited(detail or "Too many requests.", retry_after=min(max(wait, 30), 3600), status=status)
        if status == 403:
            raise Forbidden(detail or "The connection does not have the permission this needs.", status=status)
        if status >= 500 or (status == 409 and conflict_retry):
            raise Unavailable(detail or f"The CRM answered {status}.", status=status)
        raise Rejected(detail or f"The CRM refused the data ({status}).", status=status)


# ---------------------------------------------------------------- settings of a connection
def mapping_of(conn, vendor=None):
    vendor = vendor or get_vendor(conn.vendor)
    mapping = dict(vendor.default_mapping)
    mapping.update(conn.field_mapping or {})
    return mapping


def status_map_of(conn, vendor=None):
    vendor = vendor or get_vendor(conn.vendor)
    out = dict(vendor.default_status_map)
    out.update((conn.options or {}).get("status_map") or {})
    return out


def conn_settings(conn):
    out = default_settings()
    out.update(conn.options or {})
    return out


def clean_mapping(raw):
    """Validated field mapping: {lead field: CRM field name, or "" to skip}. Raises ValueError with the problem key."""
    if not isinstance(raw, dict):
        raise ValueError("mapping")
    out = {}
    for lead_field, crm_field in raw.items():
        if lead_field not in LEAD_FIELDS:
            raise ValueError("mapping")
        if crm_field is None:
            crm_field = ""
        if not isinstance(crm_field, str) or (crm_field and not CRM_FIELD_RE.match(crm_field.strip())):
            raise ValueError("mapping")
        out[lead_field] = crm_field.strip()
    return out


def clean_settings(raw, base):
    if not isinstance(raw, dict):
        raise ValueError("settings")
    out = dict(base)
    for key in ("sync_new_leads", "add_note", "assign_owner", "sync_status"):
        if key in raw:
            if not isinstance(raw[key], bool):
                raise ValueError("settings")
            out[key] = raw[key]
    if "status_map" in raw:
        status_map = raw["status_map"]
        if not isinstance(status_map, dict):
            raise ValueError("settings")
        clean = {}
        for status, value in status_map.items():
            if status not in LEAD_STATUSES or not isinstance(value, str) or len(value.strip()) > 80:
                raise ValueError("settings")
            if value.strip():
                clean[status] = value.strip()
        out["status_map"] = clean
    return out


# ---------------------------------------------------------------- queueing
def _owner_email(lead_payload, lead):
    assignee = lead_payload.get("assignee") or {}
    if assignee.get("email"):
        return assignee["email"]
    card = getattr(lead, "card", None)
    member = getattr(card, "member", None) if card is not None else None
    return member.email if member is not None else ""


def enqueue(conn, kind, lead_payload, lead_id=None, owner_email=""):
    """Add one job unless the same work is already waiting."""
    if lead_id and kind == "upsert" and CrmSyncJob.objects.filter(connection=conn, lead_id=lead_id, kind=kind, status="pending").exists():
        return None
    payload = {"lead": lead_payload, "owner_email": owner_email}
    return CrmSyncJob.objects.create(
        connection=conn, kind=kind, lead_id=lead_id, payload=payload, next_attempt_at=timezone.now(),
    )


def on_lead_event(workspace, event_type, lead, extra=None):
    """Called for every lead event of a company. Never raises: a CRM problem must not lose or block a lead."""
    try:
        from leads.webhooks import lead_payload

        if workspace is None or workspace.kind != "company":
            return 0
        connections = list(CrmConnection.objects.filter(workspace=workspace, status="connected"))
        if not connections:
            return 0
        payload = lead_payload(lead)
        owner = _owner_email(payload, lead)
        queued = 0
        for conn in connections:
            cfg = conn_settings(conn)
            if event_type == "lead.created" and cfg["sync_new_leads"]:
                queued += bool(enqueue(conn, "upsert", payload, lead.id, owner))
            elif event_type == "lead.updated" and cfg["sync_status"] and "status" in ((extra or {}).get("changes") or {}):
                queued += bool(enqueue(conn, "status", payload, lead.id, owner))
        return queued
    except Exception:
        return 0


def sample_lead():
    return {
        "id": "00000000-0000-0000-0000-000000000000", "name": "Sample Visitor", "email": "sample.visitor@example.com",
        "phone": "+974 5555 0000", "company": "Example Co", "message": "This is a test lead from your digital card.",
        "source": "exchange", "channel": "qr", "status": "new", "card_name": "Sample card", "assignee": None,
    }


def queue_backfill(conn, now=None):
    """Queue the company's leads of the last 30 days (newest first, at most 500) that this CRM has not received."""
    from leads.models import Lead
    from leads.webhooks import lead_payload

    now = now or timezone.now()
    sent = set(CrmLeadLink.objects.filter(connection=conn).values_list("lead_id", flat=True))
    waiting = set(CrmSyncJob.objects.filter(connection=conn, status="pending", kind="upsert").values_list("lead_id", flat=True))
    leads = (
        Lead.objects.filter(Q(workspace=conn.workspace) | Q(card__workspace=conn.workspace), created_at__gte=now - timedelta(days=BACKFILL_DAYS))
        .select_related("card", "card__member", "assignee").order_by("-created_at")[:MAX_BACKFILL]
    )
    count = 0
    for lead in leads:
        if lead.id in sent or lead.id in waiting:
            continue
        payload = lead_payload(lead)
        enqueue(conn, "upsert", payload, lead.id, _owner_email(payload, lead))
        count += 1
    return count


# ---------------------------------------------------------------- doing the work
def note_text(lead):
    lines = [f"New lead from the card \"{lead.get('card_name') or '-'}\" ({lead.get('source') or 'card'})"]
    for label, key in (("Name", "name"), ("Email", "email"), ("Phone", "phone"), ("Company", "company"), ("Message", "message")):
        if lead.get(key):
            lines.append(f"{label}: {lead[key]}")
    if lead.get("meeting_times"):
        lines.append("Preferred times: " + "; ".join(lead["meeting_times"]))
    return "\n".join(lines)[:4000]


def run_job(conn, job):
    """Do one job against the CRM. Returns (remote id, action). Raises a CrmError."""
    vendor = get_vendor(conn.vendor)
    session = Session(conn)
    cfg = conn_settings(conn)
    lead = job.payload.get("lead") or {}
    values = lead_values(lead)
    email = values["email"]
    mapping = mapping_of(conn, vendor)
    link = CrmLeadLink.objects.filter(connection=conn, lead_id=job.lead_id).first() if job.lead_id else None
    status_value = status_map_of(conn, vendor).get(lead.get("status")) if cfg["sync_status"] else None

    if job.kind == "status":
        if link is None:
            found = vendor.find_by_email(session, email) if email else None
            if found is None:
                job.kind = "upsert"  # the contact is not in the CRM yet: send it whole, with its current status
            else:
                link = CrmLeadLink.objects.create(connection=conn, lead_id=job.lead_id, remote_id=found[0], remote_type=found[1])
        if link is not None:
            if not status_value:
                raise BadMapping("There is no CRM value for the status %s." % lead.get("status"))
            vendor.set_status(session, link.remote_id, link.remote_type, status_value)
            return link.remote_id, "updated"

    fields = build_fields(mapping, values)
    if not fields and not email:
        raise BadMapping("No field is mapped, so there is nothing to send.")
    owner_id = None
    owner_email = job.payload.get("owner_email")
    if cfg["assign_owner"] and owner_email:
        owner_id = vendor.find_owner(session, owner_email)
    remote_id, remote_type, action = vendor.upsert(session, fields, email, owner_id, status_value, values)
    if job.lead_id:
        CrmLeadLink.objects.update_or_create(
            connection=conn, lead_id=job.lead_id, defaults={"remote_id": remote_id, "remote_type": remote_type},
        )
    if cfg["add_note"] and (link is None):
        vendor.add_note(session, remote_id, remote_type, note_text(lead))
    return remote_id, action


def _backoff(attempts):
    return BACKOFF[min(attempts, len(BACKOFF)) - 1]


def attempt(job, now=None):
    """Run one job once and record what happened on the job and on the connection."""
    now = now or timezone.now()
    conn = CrmConnection.objects.select_related("workspace").get(pk=job.connection_id)
    error = None
    remote_id = action = ""
    try:
        remote_id, action = run_job(conn, job)
    except CrmError as exc:
        error = exc
    except http.BlockedHost as exc:
        error = Rejected(str(exc))
    except Exception as exc:  # one odd answer must never abort the run or leave the job locked
        error = Unavailable(f"Unexpected error: {type(exc).__name__}")
    job.attempts += 1
    job.locked_until = None
    job.remote_id = remote_id
    job.action = action
    if error is None:
        job.status, job.finished_at, job.next_attempt_at = "success", timezone.now(), None
        job.error = job.error_code = ""
        job.save()
        CrmConnection.objects.filter(pk=conn.pk).update(
            last_sync_at=timezone.now(), last_success_at=timezone.now(), consecutive_failures=0, last_error="", last_error_code="", last_error_at=None,
        )
        return job
    job.error, job.error_code = error.message, error.code
    if isinstance(error, AuthRevoked):
        # A real job is paused and goes on after the owner connects again; a test is simply over.
        job.status, job.next_attempt_at = ("failed", None) if job.kind == "test" else ("pending", None)
        job.save()
        disable(conn, error.code, error.message)
        return job
    if error.retry and job.attempts < MAX_ATTEMPTS and job.kind != "test":
        wait = error.retry_after if isinstance(error, RateLimited) else _backoff(job.attempts)
        job.status, job.next_attempt_at = "pending", now + timedelta(seconds=wait)
    else:
        job.status, job.finished_at, job.next_attempt_at = "failed", timezone.now(), None
    job.save()
    CrmConnection.objects.filter(pk=conn.pk).update(
        last_sync_at=timezone.now(), consecutive_failures=F("consecutive_failures") + 1,
        last_error=error.message[:300], last_error_code=error.code, last_error_at=timezone.now(),
    )
    return job


def disable(conn, code, detail=""):
    """The CRM refuses our access: switch the connection off and tell the admins (once)."""
    switched = CrmConnection.objects.filter(pk=conn.pk, status="connected").update(
        status="disabled", disabled_reason=code, last_error=detail[:300], last_error_code=code, last_error_at=timezone.now(),
    )
    if switched:
        audit.log(None, conn.workspace, "crm.disabled", "crm", conn.id, get_vendor(conn.vendor).label, {"vendor": conn.vendor, "code": code})
        notify_disabled(conn)


def notify_disabled(conn):
    from workspaces.models import Member

    label = get_vendor(conn.vendor).label
    admins = Member.objects.filter(workspace_id=conn.workspace_id, role__in=("owner", "admin"), status="active").exclude(email="")
    for member in admins:
        try:
            lang = member_language(member)
            send_brand_email(
                member.email,
                tr(lang, "{crm} stopped syncing your contacts", crm=label),
                tr(lang, "{crm} stopped syncing your contacts", crm=label),
                [
                    tr(lang, "{crm} no longer accepts the connection, so new contacts are not being sent. This usually means "
                             "the connection was removed in {crm} or its permissions changed.", crm=label),
                    tr(lang, "Connect it again in Settings > Integrations. Contacts that arrive meanwhile are kept and are "
                             "sent after you reconnect."),
                ],
                button_text=tr(lang, "Open Integrations"), button_url=f"{settings.WEB_BASE_URL}/app/settings/integrations",
                lang=lang,
            )
        except Exception:
            pass


# ---------------------------------------------------------------- the queue
def _due(now):
    return CrmSyncJob.objects.filter(
        status="pending", next_attempt_at__lte=now, connection__status="connected",
        connection__workspace__deletion_due_at__isnull=True,
    ).filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now))


def _claim(pk, now):
    return CrmSyncJob.objects.filter(pk=pk, status="pending").filter(
        Q(locked_until__isnull=True) | Q(locked_until__lt=now)
    ).update(locked_until=now + timedelta(seconds=LOCK_SECONDS))


def process_queue(limit=200, now=None, run_budget=RUN_BUDGET_SECONDS):
    """Send what is due, a few jobs per connection in turn. Returns counts."""
    now = now or timezone.now()
    started = time.monotonic()
    stats = {"sent": 0, "failed": 0, "retry": 0, "skipped": 0}
    due = _due(now)
    connection_ids = list(
        due.order_by("next_attempt_at").values_list("connection_id", flat=True).distinct()[:100]
    )
    paused = set()
    done = 0
    batches = {
        cid: list(due.filter(connection_id=cid).order_by("created_at").values_list("pk", flat=True)[:PER_CONNECTION_BATCH])
        for cid in connection_ids
    }
    while done < limit and any(batches.values()):
        for cid in connection_ids:
            if not batches[cid] or cid in paused:
                continue
            if time.monotonic() - started > run_budget:
                return stats
            pk = batches[cid].pop(0)
            if not _claim(pk, now):
                stats["skipped"] += 1
                continue
            job = attempt(CrmSyncJob.objects.get(pk=pk), now)
            done += 1
            if job.status == "success":
                stats["sent"] += 1
            elif job.status == "failed":
                stats["failed"] += 1
            else:
                stats["retry"] += 1
                if job.error_code in ("crm_rate_limited", "crm_auth_revoked", "crm_token_unreadable"):
                    paused.add(cid)  # no point sending more to a CRM that told us to wait or refused us
            if done >= limit:
                break
        batches = {cid: rows for cid, rows in batches.items() if rows and cid not in paused}
        connection_ids = [cid for cid in connection_ids if cid in batches]
    return stats


def prune(days=90):
    """Forget finished jobs older than `days`."""
    cutoff = timezone.now() - timedelta(days=days)
    return CrmSyncJob.objects.filter(status__in=("success", "failed"), created_at__lt=cutoff).delete()[0]
