"""Browser push notifications and the daily summary e-mail."""
import hashlib
import json
import logging
import socket
import urllib.error
import urllib.request
from datetime import datetime, time as dtime, timedelta
from html import escape
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core import signing
from django.db.models import Count, Q
from django.utils import timezone

from ilaf.emails import brand_html_page, send_brand_html
from ilaf.errors import ApiError
from ilaf.i18n import normalise_language, tr
from ilaf.netsafety import is_public_ip

from . import webpush
from .models import NotificationPrefs, PushSubscription

log = logging.getLogger(__name__)

DEFAULT_TIMEZONE = "Asia/Qatar"
MAX_SUBSCRIPTIONS = 10
MAX_FAILURES = 10
# Push services the browsers use. A subscription from anywhere else is refused, so the server never posts to a stranger's address.
ALLOWED_HOST_SUFFIXES = (
    "googleapis.com", "push.services.mozilla.com", "mozilla.com", "push.apple.com", "notify.windows.com",
)
KINDS = {"lead": "push_leads", "support": "push_support"}
SUMMARY_FIRST_HOUR = 7
SUMMARY_LAST_HOUR = 11  # a summary missed all morning is skipped rather than sent in the afternoon


# ---------------------------------------------------------------- switch and preferences
def push_enabled():
    return bool(settings.VAPID_PUBLIC_KEY and settings.VAPID_PRIVATE_KEY)


def prefs_for(user):
    row, _ = NotificationPrefs.objects.get_or_create(user=user)
    return row


def prefs_json(user):
    row = prefs_for(user)
    return {
        "push_available": push_enabled(),
        "vapid_public_key": settings.VAPID_PUBLIC_KEY if push_enabled() else None,
        "push_leads": row.push_leads,
        "push_support": row.push_support,
        "daily_summary": row.daily_summary,
        "timezone": row.timezone or DEFAULT_TIMEZONE,
        "subscriptions": user.push_subscriptions.count(),
    }


def valid_timezone(name):
    try:
        ZoneInfo(name)
        return True
    except Exception:
        return False


# ---------------------------------------------------------------- subscriptions
def _host_allowed(host):
    host = (host or "").lower()
    allowed = tuple(getattr(settings, "WEBPUSH_ALLOWED_HOST_SUFFIXES", ALLOWED_HOST_SUFFIXES))
    return any(host == s or host.endswith("." + s) for s in allowed)


def subscribe(user, data, user_agent=""):
    """Save (or move to this person) a browser subscription: {endpoint, keys: {p256dh, auth}}."""
    data = data if isinstance(data, dict) else {}
    keys = data.get("keys") if isinstance(data.get("keys"), dict) else {}
    endpoint = str(data.get("endpoint") or "").strip()
    parts = urlsplit(endpoint)
    if not endpoint or len(endpoint) > 1000 or parts.scheme != "https" or not _host_allowed(parts.hostname):
        raise ApiError("push_endpoint_invalid", "This browser's push address is not accepted.", 400)
    try:
        p256dh, auth = str(keys.get("p256dh") or ""), str(keys.get("auth") or "")
        webpush.decode_point(webpush.b64d(p256dh))
        if len(webpush.b64d(auth)) != 16:
            raise ValueError
    except Exception:
        raise ApiError("push_endpoint_invalid", "This browser's push address is not accepted.", 400)
    digest = hashlib.sha256(endpoint.encode("utf-8")).hexdigest()
    row = PushSubscription.objects.filter(endpoint_hash=digest).first()
    if row is None:
        extra = PushSubscription.objects.filter(user=user).order_by("-created_at")[MAX_SUBSCRIPTIONS - 1:]
        for old in extra:
            old.delete()
        row = PushSubscription(endpoint=endpoint, endpoint_hash=digest)
    row.user = user
    row.p256dh, row.auth = p256dh, auth
    row.user_agent = (user_agent or "")[:300]
    from security.devices import device_label

    row.label = device_label(user_agent)
    row.failure_count = 0
    row.save()
    return row


def unsubscribe(user, endpoint):
    digest = hashlib.sha256(str(endpoint or "").strip().encode("utf-8")).hexdigest()
    return PushSubscription.objects.filter(user=user, endpoint_hash=digest).delete()[0]


# ---------------------------------------------------------------- sending
class HttpTransport:
    """POST to the push service. Returns the HTTP status (0 when it could not be reached). No redirects are followed."""

    def __call__(self, url, headers, body, timeout=8):
        parts = urlsplit(url)
        try:
            for info in socket.getaddrinfo(parts.hostname, parts.port or 443, proto=socket.IPPROTO_TCP):
                import ipaddress

                if not is_public_ip(ipaddress.ip_address(info[4][0])):
                    return 0
        except OSError:
            return 0

        class NoRedirect(urllib.request.HTTPRedirectHandler):
            def redirect_request(self, *args, **kwargs):
                return None

        request = urllib.request.Request(url, data=body, headers=headers, method="POST")
        try:
            with urllib.request.build_opener(NoRedirect).open(request, timeout=timeout) as res:
                return res.status
        except urllib.error.HTTPError as exc:
            return exc.code
        except Exception:
            return 0


# Replaceable (tests, or a pywebpush-based sender): a callable (url, headers, body) -> HTTP status.
transport = HttpTransport()


def send_to_subscription(sub, payload, ttl=86400):
    """Send one message. True when the push service accepted it. A 404 or 410 means the browser is gone: the row is deleted."""
    body = webpush.encrypt_message(
        json.dumps(payload, separators=(",", ":")).encode("utf-8"), webpush.b64d(sub.p256dh), webpush.b64d(sub.auth)
    )
    headers = {
        "Content-Encoding": "aes128gcm", "Content-Type": "application/octet-stream", "TTL": str(ttl), "Urgency": "normal",
        "Authorization": webpush.vapid_headers(sub.endpoint, settings.VAPID_PRIVATE_KEY, settings.VAPID_SUBJECT),
    }
    status = transport(sub.endpoint, headers, body)
    now = timezone.now()
    if 200 <= status < 300:
        PushSubscription.objects.filter(pk=sub.pk).update(last_success_at=now, failure_count=0)
        return True
    if status in (404, 410):
        sub.delete()
        return False
    sub.failure_count += 1
    if sub.failure_count >= MAX_FAILURES:
        sub.delete()
    else:
        PushSubscription.objects.filter(pk=sub.pk).update(last_failure_at=now, failure_count=sub.failure_count)
    return False


def notify_user(user, kind, title, body, url="/app", tag=""):
    """Push one notification to every subscribed browser of a person who wants this kind. Never raises. Returns how many were sent."""
    sent = 0
    try:
        if not push_enabled() or kind not in KINDS or not url.startswith("/") or url.startswith("//"):
            return 0
        prefs = NotificationPrefs.objects.filter(user=user).first()
        if prefs is not None and not getattr(prefs, KINDS[kind]):
            return 0
        payload = {"title": title[:80], "body": body[:200], "url": url, "tag": tag or kind, "kind": kind}
        for sub in list(user.push_subscriptions.all()):
            try:
                sent += 1 if send_to_subscription(sub, payload) else 0
            except Exception:
                log.exception("push to one browser failed")
    except Exception:
        log.exception("push notification failed")
    return sent


def notify_new_lead(card, lead, addresses):
    """Tell the people who get the lead's e-mail (card holder, company admins) in their browser too."""
    from accounts.models import User

    if not push_enabled():
        return 0
    sent = 0
    for user in User.objects.filter(email__in=[a.lower() for a in addresses], is_active=True):
        lang = normalise_language(user.language) or "en"
        if lead.source == "meeting_request":
            title = tr(lang, "{name} would like to meet", name=lead.name[:40])
        else:
            title = tr(lang, "{name} shared their details", name=lead.name[:40])
        sent += notify_user(user, "lead", title, tr(lang, "Card: {card}", card=card.name or tr(lang, "Your card")), "/app/contacts", "lead")
    return sent


def notify_support_reply(ticket, agent_name=""):
    user = ticket.requester
    if user is None:
        return 0
    lang = normalise_language(user.language) or "en"
    return notify_user(
        user, "support", tr(lang, "We replied to your request"), ticket.subject[:100], f"/app/support/{ticket.id}", f"support-{ticket.id}",
    )


# ---------------------------------------------------------------- the daily summary
SUMMARY_SALT = "bench.daily-summary"


def unsubscribe_token(user_id):
    return signing.dumps({"u": str(user_id)}, salt=SUMMARY_SALT)


def read_unsubscribe_token(token):
    try:
        return signing.loads(token, salt=SUMMARY_SALT)["u"]
    except (signing.BadSignature, KeyError, TypeError):
        return None


def unsubscribe_url(user_id):
    base = settings.API_BASE_URL or "http://localhost:8100"
    return f"{base}/api/v1/notifications/unsubscribe?token={unsubscribe_token(user_id)}"


def local_zone(prefs):
    try:
        return ZoneInfo(prefs.timezone or DEFAULT_TIMEZONE)
    except Exception:
        return ZoneInfo(DEFAULT_TIMEZONE)


def summary_window(local_now):
    """The UTC span of the local day before `local_now`."""
    day = local_now.date()
    start = datetime.combine(day - timedelta(days=1), dtime.min, tzinfo=local_now.tzinfo)
    end = datetime.combine(day, dtime.min, tzinfo=local_now.tzinfo)
    return start.astimezone(ZoneInfo("UTC")), end.astimezone(ZoneInfo("UTC"))


def summary_data(user, window):
    """What happened in the span, per workspace the person belongs to, plus requests waiting for them."""
    from analytics.models import Event, event_count
    from leads.models import Lead
    from operations.models import ChangeRequest
    from support.models import SupportTicket
    from workspaces.access import visible_cards
    from workspaces.models import Member

    start, end = window
    spaces = []
    members = Member.objects.filter(
        user=user, status="active", workspace__deleted_at__isnull=True, workspace__suspended_at__isnull=True,
    ).select_related("workspace")
    for member in members:
        cards = visible_cards(member)
        ids = list(cards.values_list("id", flat=True))
        events = Event.objects.filter(card_id__in=ids, created_at__gte=start, created_at__lt=end)
        views = events.filter(type="view").aggregate(n=event_count())["n"]
        scans = events.filter(type="view", source="qr").aggregate(n=event_count())["n"]
        leads = Lead.objects.filter(card_id__in=ids, created_at__gte=start, created_at__lt=end).count()
        pending = 0
        if member.role in ("owner", "admin") and member.workspace.kind == "company":
            pending = ChangeRequest.objects.filter(workspace_id=member.workspace_id, status="pending").count()
        spaces.append({"name": member.workspace.name, "kind": member.workspace.kind, "views": views, "scans": scans, "leads": leads, "pending": pending})
    tickets = SupportTicket.objects.filter(requester=user, status="waiting_customer").count()
    return {"spaces": spaces, "tickets": tickets}


def has_news(data):
    return bool(data["tickets"]) or any(s["views"] or s["scans"] or s["leads"] or s["pending"] for s in data["spaces"])


def render_summary(user, data, lang, unsub_url):
    """(subject, text, html) of the daily e-mail."""
    heading = tr(lang, "Your daily summary")
    subtitle = tr(lang, "Yesterday at a glance")
    text_lines = [heading, subtitle, ""]
    blocks = []
    for space in data["spaces"]:
        if not (space["views"] or space["scans"] or space["leads"] or space["pending"]):
            continue
        rows = [
            (tr(lang, "New leads"), space["leads"]), (tr(lang, "Card views"), space["views"]),
            (tr(lang, "QR scans"), space["scans"]),
        ]
        if space["pending"]:
            rows.append((tr(lang, "Changes waiting for your approval"), space["pending"]))
        text_lines.append(space["name"])
        text_lines += [f"  {label}: {value}" for label, value in rows]
        cells = "".join(
            f'<tr><td style="padding:6px 0;font-size:14px;color:{settings.BRAND_MUTED};">{escape(label)}</td>'
            f'<td style="padding:6px 0;font-size:16px;font-weight:700;text-align:end;">{value}</td></tr>'
            for label, value in rows
        )
        blocks.append(
            f'<h2 style="margin:22px 0 6px;font-size:16px;font-weight:700;" dir="auto">{escape(space["name"])}</h2>'
            f'<table role="presentation" width="100%" cellpadding="0" cellspacing="0">{cells}</table>'
        )
    if data["tickets"]:
        line = tr(lang, "Support requests waiting for your reply: {n}", n=data["tickets"])
        text_lines.append(line)
        blocks.append(f'<p style="margin:22px 0 6px;font-size:14px;">{escape(line)}</p>')
    button_url = f"{settings.WEB_BASE_URL}/app"
    blocks.append(
        f'<p style="margin:24px 0;"><a href="{escape(button_url, quote=True)}" style="display:inline-block;background:{settings.BRAND_ORANGE};'
        f'color:{settings.BRAND_BLACK};text-decoration:none;font-weight:700;font-size:15px;padding:13px 26px;border-radius:999px;">'
        f'{escape(tr(lang, "Open your dashboard"))}</a></p>'
    )
    settings_url = f"{settings.WEB_BASE_URL}/app/settings/notifications"
    footer = (
        f'<p style="margin:0 0 10px;font-size:12px;color:{settings.BRAND_MUTED};">{escape(tr(lang, "You get this because the daily summary is on."))} '
        f'<a href="{escape(unsub_url, quote=True)}" style="color:{settings.BRAND_MUTED};">{escape(tr(lang, "Unsubscribe in one click"))}</a> '
        f'{escape(tr(lang, "or"))} <a href="{escape(settings_url, quote=True)}" style="color:{settings.BRAND_MUTED};">{escape(tr(lang, "change your notification settings"))}</a>.</p>'
    )
    text_lines += ["", f"{tr(lang, 'Unsubscribe in one click')}: {unsub_url}"]
    html = brand_html_page(heading, "".join(blocks), footer, subtitle, lang)
    subject = tr(lang, "Your daily {product} summary", product=settings.PRODUCT_NAME)
    return subject, "\n".join(text_lines), html


def run_daily_summary(now=None, dry_run=False):
    """Send today's summary to everyone who switched it on and whose local morning it is. Safe to run every hour:
    a person gets at most one a day (the last local date is stored). Returns counts."""
    now = now or timezone.now()
    stats = {"sent": 0, "quiet": 0, "not_yet": 0, "already": 0, "failed": 0}
    for prefs in NotificationPrefs.objects.filter(daily_summary=True, user__is_active=True, user__deleted_at__isnull=True).select_related("user"):
        local_now = now.astimezone(local_zone(prefs))
        if not (SUMMARY_FIRST_HOUR <= local_now.hour <= SUMMARY_LAST_HOUR):
            stats["not_yet"] += 1
            continue
        if prefs.last_summary_date == local_now.date():
            stats["already"] += 1
            continue
        data = summary_data(prefs.user, summary_window(local_now))
        if not has_news(data):
            stats["quiet"] += 1
            if not dry_run:
                prefs.last_summary_date = local_now.date()
                prefs.save(update_fields=["last_summary_date"])
            continue
        if dry_run:
            stats["sent"] += 1
            continue
        lang = normalise_language(prefs.user.language) or "en"
        url = unsubscribe_url(prefs.user_id)
        subject, text, html = render_summary(prefs.user, data, lang, url)
        try:
            send_brand_html(
                prefs.user.email, subject, text, html,
                headers={"List-Unsubscribe": f"<{url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
            )
        except Exception:
            stats["failed"] += 1
            continue
        prefs.last_summary_date = local_now.date()
        prefs.save(update_fields=["last_summary_date"])
        stats["sent"] += 1
    return stats


def prune_subscriptions(now=None):
    """Delete browsers that have not accepted a push for 60 days after failing."""
    now = now or timezone.now()
    cutoff = now - timedelta(days=60)
    return PushSubscription.objects.filter(failure_count__gt=0).filter(
        Q(last_success_at__lt=cutoff) | Q(last_success_at__isnull=True, created_at__lt=cutoff)
    ).delete()[0]
