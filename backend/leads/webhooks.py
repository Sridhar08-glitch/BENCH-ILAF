"""Sending lead events to a company's own web addresses.

Workflow: a lead event is written to the queue (`WebhookDelivery`, one row per subscribed endpoint). The
management command `deliver_webhooks` (run every minute from cron) sends what is due. A failed send is
retried later with a growing gap; after too many failures in a row the endpoint is switched off and the
company admins are told.

Every request is signed: `X-BENCH-Signature: sha256=<hex>` is the HMAC-SHA256 of `<timestamp>.<body>`
with the endpoint's secret, and `X-BENCH-Timestamp` is that timestamp (seconds since 1970).

The receiver must be a public https address. The name is looked up, every address it points to must be
public, and the connection goes to that checked address (so the name cannot change between the check and
the send). Redirects are not followed, the wait is 5 seconds and only the start of the answer is kept.
"""
import hashlib
import hmac
import http.client
import ipaddress
import json
import os
import secrets
import socket
import ssl
import threading
import time
import uuid
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.db.models import F, Min, Q
from django.utils import timezone

from ilaf.emails import send_brand_email
from ilaf.i18n import member_language, tr
from ilaf.netsafety import is_public_ip  # noqa: F401 (also used by the tests)
from ilaf.utils import iso

from .models import WebhookDelivery, WebhookEndpoint

SIGNATURE_HEADER = "X-BENCH-Signature"
TIMESTAMP_HEADER = "X-BENCH-Timestamp"
EVENT_ID_HEADER = "X-BENCH-Event-Id"
EVENT_TYPE_HEADER = "X-BENCH-Event"

EVENT_TYPES = ("lead.created", "lead.updated", "lead.assigned")
TEST_EVENT = "lead.test"
CONNECT_TIMEOUT_SECONDS = 3
# The whole exchange (connect, send, headers, body) must finish inside this many seconds. A watchdog closes the
# socket at the deadline, so a receiver that answers one byte at a time cannot hold the sender.
TOTAL_DEADLINE_SECONDS = 8
TIMEOUT_SECONDS = CONNECT_TIMEOUT_SECONDS  # kept for callers that read the old name
RESPONSE_CAP = 1000
# Fairness inside one run of the queue: at most this many deliveries per endpoint, this many seconds spent on one
# endpoint, and this many seconds for the whole run (cron starts a run every minute).
PER_ENDPOINT_BATCH = 5
ENDPOINT_BUDGET_SECONDS = 15
RUN_BUDGET_SECONDS = 50
MAX_ENDPOINTS_PER_RUN = 200
# The "Send test" button is limited per endpoint.
TEST_SENDS_PER_MINUTE = 5
MAX_ENDPOINTS = 10
MAX_ATTEMPTS = 8
# Seconds to wait after the 1st, 2nd, ... failed attempt.
BACKOFF = [60, 300, 1800, 7200, 21600, 43200, 86400]
DISABLE_AFTER = 20
# A claimed delivery is skipped by other workers for this long; it outlasts the longest single send.
LOCK_SECONDS = 60


class UnsafeTarget(Exception):
    """The address is not allowed as a webhook target."""


def allow_private_targets():
    """Development switch: lets webhooks reach http and private addresses (a receiver on this computer)."""
    if bool(getattr(settings, "WEBHOOK_ALLOW_PRIVATE_TARGETS", False)):
        return True
    # The environment variable counts only while DEBUG is on, so it cannot be left switched on in production.
    return bool(settings.DEBUG) and os.environ.get("WEBHOOK_ALLOW_PRIVATE_TARGETS", "").lower() in ("1", "true", "yes")


def resolve_host(host, port):
    """All addresses a name points to (a seam so tests can avoid the network)."""
    try:
        infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    except (socket.gaierror, UnicodeError, ValueError, OSError):
        raise UnsafeTarget("That address could not be found.")
    return list(dict.fromkeys(info[4][0] for info in infos))


def split_url(url):
    try:
        parts = urlsplit((url or "").strip())
        hostname = parts.hostname
    except ValueError:
        raise UnsafeTarget("Enter a full web address.")
    allowed = ("https", "http") if allow_private_targets() else ("https",)
    if parts.scheme not in allowed:
        raise UnsafeTarget("The address must start with https://")
    if not hostname:
        raise UnsafeTarget("Enter a full web address.")
    if parts.username or parts.password:
        raise UnsafeTarget("Remove the user name and password from the address.")
    try:
        port = parts.port or (443 if parts.scheme == "https" else 80)
    except ValueError:
        raise UnsafeTarget("The port in the address is not valid.")
    return parts, port


def check_target(url):
    """Return (parts, port, ip) when the address is allowed, else raise UnsafeTarget."""
    parts, port = split_url(url)
    addresses = resolve_host(parts.hostname, port)
    if not addresses:
        raise UnsafeTarget("That address could not be found.")
    if not allow_private_targets():
        for raw in addresses:
            try:
                ip = ipaddress.ip_address(raw.split("%")[0])
            except ValueError:
                raise UnsafeTarget("That address could not be found.")
            if not is_public_ip(ip):
                raise UnsafeTarget("That address points to a private or internal network, which is not allowed.")
    return parts, port, addresses[0]


# ---------------------------------------------------------------- the request
class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self.raw_sock = self._context.wrap_socket(sock, server_hostname=self.host)
        self.sock.settimeout(TOTAL_DEADLINE_SECONDS)


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout)
        self._ip = ip

    def connect(self):
        self.sock = self.raw_sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock.settimeout(TOTAL_DEADLINE_SECONDS)


def send_request(url, body, headers):
    """POST `body` and return (status, start of the answer). Never follows a redirect.

    The connect step has its own short limit. After that a watchdog timer shuts the socket at the total deadline, so
    even a receiver that trickles bytes cannot keep the call alive past TOTAL_DEADLINE_SECONDS."""
    parts, port, ip = check_target(url)
    conn_class = _PinnedHTTPS if parts.scheme == "https" else _PinnedHTTP
    conn = conn_class(parts.hostname, ip, port, CONNECT_TIMEOUT_SECONDS)
    path = parts.path or "/"
    if parts.query:
        path += "?" + parts.query
    deadline = time.monotonic() + TOTAL_DEADLINE_SECONDS
    expired = threading.Event()

    def cut():
        expired.set()
        sock = getattr(conn, "raw_sock", None)  # conn.sock is dropped once the answer says Connection: close
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

    watchdog = threading.Timer(TOTAL_DEADLINE_SECONDS, cut)
    watchdog.daemon = True
    watchdog.start()
    try:
        conn.request("POST", path, body=body, headers=headers)
        response = conn.getresponse()
        chunks, size = [], 0
        while size < RESPONSE_CAP:
            if time.monotonic() > deadline:
                raise socket.timeout("deadline")
            chunk = response.read(min(512, RESPONSE_CAP - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        return response.status, b"".join(chunks).decode("utf-8", "replace")
    except (OSError, http.client.HTTPException, ValueError):
        if expired.is_set():
            raise socket.timeout("deadline")
        raise
    finally:
        watchdog.cancel()
        conn.close()


def sign(secret, timestamp, body):
    mac = hmac.new(secret.encode("utf-8"), f"{timestamp}.".encode("utf-8") + body, hashlib.sha256)
    return "sha256=" + mac.hexdigest()


def new_secret():
    return "whsec_" + secrets.token_urlsafe(32)


# ---------------------------------------------------------------- events
def lead_payload(lead):
    """What a receiver is told about a lead. Internal notes are never included."""
    assignee = lead.assignee
    return {
        "id": str(lead.id),
        "name": lead.name,
        "email": lead.email,
        "phone": lead.phone,
        "company": lead.company,
        "message": lead.note,
        "source": lead.source,
        "channel": lead.channel,
        "status": lead.status,
        "meeting_times": lead.meeting_times or [],
        "card_id": str(lead.card_id) if lead.card_id else None,
        "card_name": lead.card.name if lead.card_id else lead.card_name,
        "assignee": (
            {"id": str(assignee.id), "name": assignee.full_name, "email": assignee.email} if assignee else None
        ),
        "consent": {"given": lead.consented_at is not None, "at": iso(lead.consented_at) if lead.consented_at else None},
        "created_at": iso(lead.created_at),
    }


def sample_lead_payload():
    return {
        "id": str(uuid.uuid4()), "name": "Sample Visitor", "email": "visitor@example.com", "phone": "+974 5555 0000",
        "company": "Example Co", "message": "This is a test event.", "source": "exchange", "channel": "qr",
        "status": "new", "meeting_times": [], "card_id": None, "card_name": "Sample card", "assignee": None,
        "consent": {"given": True, "at": iso(timezone.now())}, "created_at": iso(timezone.now()),
    }


def envelope(event_type, workspace_id, data, event_id=None):
    return {
        "id": str(event_id or uuid.uuid4()),
        "type": event_type,
        "created_at": iso(timezone.now()),
        "workspace_id": str(workspace_id),
        "data": data,
    }


def enqueue(workspace, event_type, lead, extra=None):
    """Queue one event for every enabled endpoint of the company that asked for it. Never raises."""
    try:
        if workspace is None or workspace.kind != "company":
            return 0
        from .models import is_company_owned

        if not is_company_owned(lead):  # an employee's contact is the employee's: it is not sent to the company's systems
            return 0
        from billing.services import enterprise_allowed, is_live

        if not is_live(workspace) or not enterprise_allowed(workspace):  # webhooks and CRM connectors belong to a live Enterprise plan
            return 0
        from crm import sync as crm_sync

        crm_sync.on_lead_event(workspace, event_type, lead, extra)  # CRM connectors get the same events
        endpoints = [e for e in WebhookEndpoint.objects.filter(workspace=workspace, enabled=True) if event_type in e.events]
        if not endpoints:
            return 0
        data = {"lead": lead_payload(lead)}
        data.update(extra or {})
        event = envelope(event_type, workspace.id, data)
        now = timezone.now()
        WebhookDelivery.objects.bulk_create([
            WebhookDelivery(
                endpoint=e, event_id=event["id"], event_type=event_type, payload=event, next_attempt_at=now
            )
            for e in endpoints
        ])
        return len(endpoints)
    except Exception:  # a queue problem must never lose or block the lead
        return 0


def queue_test(endpoint):
    event = envelope(TEST_EVENT, endpoint.workspace_id, {"lead": sample_lead_payload()})
    return WebhookDelivery.objects.create(
        endpoint=endpoint, event_id=event["id"], event_type=TEST_EVENT, payload=event,
        next_attempt_at=timezone.now(), is_test=True,
    )


# ---------------------------------------------------------------- sending
def attempt(delivery, now=None):
    """Send one delivery once and record the result, the retry time and the endpoint's failure count."""
    now = now or timezone.now()
    endpoint = delivery.endpoint
    body = json.dumps(delivery.payload, separators=(",", ":"), ensure_ascii=False).encode("utf-8")
    timestamp = str(int(time.time()))
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "User-Agent": f"{settings.PRODUCT_NAME}-Webhooks/1",
        SIGNATURE_HEADER: sign(endpoint.secret, timestamp, body),
        TIMESTAMP_HEADER: timestamp,
        EVENT_ID_HEADER: str(delivery.event_id),
        EVENT_TYPE_HEADER: delivery.event_type,
    }
    started = time.monotonic()
    status, text, error = None, "", ""
    try:
        status, text = send_request(endpoint.url, body, headers)
        ok = 200 <= status < 300
        if not ok:
            error = f"The receiver answered {status}."
    except UnsafeTarget as exc:
        ok, error = False, str(exc)
    except socket.timeout:
        ok, error = False, f"The receiver did not answer within {TOTAL_DEADLINE_SECONDS} seconds."
    except (OSError, http.client.HTTPException, ssl.SSLError) as exc:
        ok, error = False, f"Could not connect: {type(exc).__name__}"
    except Exception as exc:  # one odd receiver must never abort the run or leave the row locked
        ok, error = False, f"Unexpected error: {type(exc).__name__}"
    delivery.attempts += 1
    delivery.response_status = status
    delivery.response_body = text[:RESPONSE_CAP]
    delivery.error = error[:300]
    delivery.duration_ms = int((time.monotonic() - started) * 1000)
    delivery.locked_until = None
    if ok:
        delivery.status = "success"
        delivery.delivered_at = timezone.now()
        delivery.next_attempt_at = None
    elif delivery.is_test or delivery.attempts >= MAX_ATTEMPTS:
        delivery.status = "failed"
        delivery.next_attempt_at = None
    else:
        delivery.status = "pending"
        delivery.next_attempt_at = now + timedelta(seconds=BACKOFF[min(delivery.attempts, len(BACKOFF)) - 1])
    delivery.save()
    if not delivery.is_test:
        _count(endpoint, ok)
    return delivery


def _count(endpoint, ok):
    """Success clears the failure streak; the 20th failure in a row switches the endpoint off and tells the admins."""
    if ok:
        WebhookEndpoint.objects.filter(pk=endpoint.pk).update(consecutive_failures=0, last_success_at=timezone.now())
        return
    WebhookEndpoint.objects.filter(pk=endpoint.pk).update(
        consecutive_failures=F("consecutive_failures") + 1, last_failure_at=timezone.now()
    )
    reason = f"Switched off after {DISABLE_AFTER} failed sends in a row."
    switched = WebhookEndpoint.objects.filter(
        pk=endpoint.pk, enabled=True, consecutive_failures__gte=DISABLE_AFTER
    ).update(enabled=False, disabled_reason=reason)
    if switched:
        notify_disabled(endpoint)


def notify_disabled(endpoint):
    from workspaces.models import Member

    admins = Member.objects.filter(
        workspace_id=endpoint.workspace_id, role__in=("owner", "admin"), status="active"
    ).exclude(email="")
    for member in admins:
        try:
            lang = member_language(member)
            send_brand_email(
                member.email,
                tr(lang, "A webhook was switched off"),
                tr(lang, "A webhook was switched off"),
                [
                    tr(lang, "We could not reach {url} for {count} sends in a row, so it was switched off "
                       "to protect your company's data from being retried forever.", url=endpoint.url, count=DISABLE_AFTER),
                    tr(lang, "Fix the receiver, then switch the webhook back on in Settings > Integrations."),
                ],
                button_text=tr(lang, "Open Integrations"), button_url=f"{settings.WEB_BASE_URL}/app/settings/integrations",
                lang=lang,
            )
        except Exception:
            pass


def _due_filter(now):
    # Contact data is not sent out while a company waits to be deleted; the rows stay queued and go out if it is restored.
    return WebhookDelivery.objects.filter(
        status="pending", next_attempt_at__lte=now, endpoint__workspace__deletion_due_at__isnull=True
    ).filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now))


def _release(pk):
    WebhookDelivery.objects.filter(pk=pk, status="pending").update(locked_until=None)


def _plan_round_robin(now, limit):
    """Delivery ids to try in this run, one endpoint after the other. Endpoints whose oldest delivery has waited
    longest go first, each endpoint contributes at most PER_ENDPOINT_BATCH, and the lists are interleaved so no
    endpoint (and no company) can use up the whole run."""
    due = _due_filter(now)
    endpoints = list(
        due.values("endpoint_id").annotate(oldest=Min("next_attempt_at")).order_by("oldest")[:MAX_ENDPOINTS_PER_RUN]
    )
    lanes = []
    for row in endpoints:
        ids = list(
            due.filter(endpoint_id=row["endpoint_id"]).order_by("next_attempt_at").values_list("id", flat=True)[:PER_ENDPOINT_BATCH]
        )
        lanes.append((row["endpoint_id"], ids))
    plan = []
    for position in range(PER_ENDPOINT_BATCH):
        for endpoint_id, ids in lanes:
            if position < len(ids):
                plan.append((endpoint_id, ids[position]))
    return plan[:limit]


def process_queue(limit=200, now=None, run_budget=None, endpoint_budget=None):
    """Send what is due. Safe to run from several processes at once: each delivery is claimed first.

    One slow or failing receiver cannot stall the others: deliveries are taken round-robin per endpoint with a small
    batch each, an endpoint that has used up its time budget (or just timed out) is skipped for the rest of the run,
    the whole run stops at its time budget, and an unexpected error on one delivery is recorded and the run goes on.
    Whatever is left stays pending for the next run."""
    now = now or timezone.now()
    run_budget = RUN_BUDGET_SECONDS if run_budget is None else run_budget
    endpoint_budget = ENDPOINT_BUDGET_SECONDS if endpoint_budget is None else endpoint_budget
    started = time.monotonic()
    spent = {}
    stopped = set()
    stats = {"sent": 0, "failed": 0, "skipped": 0}
    for endpoint_id, pk in _plan_round_robin(now, limit):
        if time.monotonic() - started >= run_budget:
            break
        if endpoint_id in stopped:
            stats["skipped"] += 1
            continue
        claimed = (
            WebhookDelivery.objects.filter(pk=pk, status="pending")
            .filter(Q(locked_until__isnull=True) | Q(locked_until__lt=now))
            .update(locked_until=now + timedelta(seconds=LOCK_SECONDS))
        )
        if not claimed:
            stats["skipped"] += 1
            continue
        try:
            delivery = WebhookDelivery.objects.select_related("endpoint").get(pk=pk)
            if not delivery.endpoint.enabled:
                delivery.status = "failed"
                delivery.error = "The webhook is switched off."
                delivery.locked_until = None
                delivery.next_attempt_at = None
                delivery.save()
                stats["skipped"] += 1
                continue
            tick = time.monotonic()
            attempt(delivery, now=now)
            took = time.monotonic() - tick
        except Exception:
            _release(pk)
            stopped.add(endpoint_id)
            stats["failed"] += 1
            continue
        stats["sent" if delivery.status == "success" else "failed"] += 1
        spent[endpoint_id] = spent.get(endpoint_id, 0) + took
        timed_out = delivery.status != "success" and "did not answer" in (delivery.error or "")
        if spent[endpoint_id] >= endpoint_budget or timed_out:
            stopped.add(endpoint_id)
    return stats


def prune(days=90):
    """Forget delivery rows older than `days` days that are finished."""
    cutoff = timezone.now() - timedelta(days=days)
    return WebhookDelivery.objects.filter(created_at__lt=cutoff).exclude(status="pending").delete()[0]
