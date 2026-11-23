"""The staff overview: health strip, key numbers, growth chart, what needs attention, recent staff activity."""
from datetime import timedelta

from django.db import connection
from django.db.models import Count, Sum
from django.utils import timezone
from rest_framework.response import Response

from analytics.models import Event
from billing.models import Payment, Subscription
from cards.models import Card
from ilaf.utils import iso
from privacy.models import DataRequest
from workspaces.models import Workspace

from . import metrics, ops_services
from .common import week_start, weekly_counts
from .models import AbuseReport, CompanyLead, EmailLog, ErrorLogEntry, StaffAuditEvent, SupportViewSession
from .permissions import StaffView
from .views import audit_json

OPEN_DATA_STATUSES = ("pending", "processing", "failed")


def open_reports():
    return AbuseReport.objects.filter(status__in=("new", "reviewing"))


def open_data_requests():
    return DataRequest.objects.filter(status__in=OPEN_DATA_STATUSES)


def open_support_tickets():
    """The number of open support tickets, or None when the support app is not installed."""
    try:
        from support.models import OPEN_STATUSES, SupportTicket
    except ImportError:
        return None
    return SupportTicket.objects.filter(status__in=OPEN_STATUSES).count()


def health():
    started = timezone.now()
    db_ok = True
    try:
        with connection.cursor() as cur:
            cur.execute("select 1")
    except Exception:
        db_ok = False
    took_ms = int((timezone.now() - started).total_seconds() * 1000)
    recent = metrics.summary(10)
    hour = metrics.summary(60)
    errors_hour = max(hour["server_errors"], ErrorLogEntry.objects.filter(created_at__gte=timezone.now() - timedelta(hours=1)).count())
    week = metrics.availability(7)
    return {
        "api_up": True, "db_ok": db_ok, "db_ms": took_ms, "p95_ms": recent["p95_ms"], "requests_10m": recent["requests"],
        "errors_last_hour": errors_hour, "p50_ms": hour["p50_ms"], "requests_1h": hour["requests"],
        "error_rate_1h": round(100 * hour["server_errors"] / hour["requests"], 2) if hour["requests"] else None,
        "success_rate_7d": week["success_rate"], "requests_7d": week["requests"],
    }


def key_numbers(now):
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    companies = Workspace.objects.filter(kind="company", deleted_at__isnull=True)
    views = Event.objects.filter(type="view", created_at__gte=midnight).aggregate(n=Sum("weight"))["n"] or 0
    views_yesterday = Event.objects.filter(type="view", created_at__gte=midnight - timedelta(days=1), created_at__lt=midnight).aggregate(n=Sum("weight"))["n"] or 0
    return {
        "companies": companies.count(),
        "active_cards": Card.objects.filter(status="published", workspace__deleted_at__isnull=True).count(),
        "views_today": views,
        "new_companies_week": companies.filter(created_at__gte=now - timedelta(days=7)).count(),
        "open_reports": open_reports().count(),
        "open_data_requests": open_data_requests().count(),
        "open_support_tickets": open_support_tickets(),
        # What each tile is compared with: the same figure for the period before, or the part of it that needs a look.
        "deltas": {
            "companies_4w": companies.filter(created_at__gte=now - timedelta(days=28)).count(),
            "active_cards_4w": Card.objects.filter(status="published", workspace__deleted_at__isnull=True, created_at__gte=now - timedelta(days=28)).count(),
            "views_yesterday": views_yesterday,
            "new_companies_prev_week": companies.filter(created_at__gte=now - timedelta(days=14), created_at__lt=now - timedelta(days=7)).count(),
            "reports_late": open_reports().filter(due_at__lt=now).count(),
            "data_due_soon": open_data_requests().filter(due_at__lt=now + timedelta(days=5)).count(),
        },
    }


def growth_total(growth, now):
    """The running total of companies at the end of each week of `growth` (the weekly new-company counts)."""
    first = week_start(now) - timedelta(weeks=len(growth) - 1)
    total = Workspace.objects.filter(kind="company", deleted_at__isnull=True, created_at__lt=first).count()
    out = []
    for row in growth:
        total += row["n"]
        out.append({"week": row["week"], "n": total})
    return out


SEAT_WARN_SHARE = 0.9


def companies_near_seat_limit(now):
    """Companies whose paid plan is live and where the people use 90% or more of the paid seats."""
    rows = (
        Subscription.objects.filter(status="active", ends_at__gt=now, seats_total__gt=0, workspace__deleted_at__isnull=True)
        .annotate(used=Count("workspace__members")).values("workspace_id", "workspace__name", "seats_total", "used")
    )
    return [r for r in rows if r["used"] >= r["seats_total"] * SEAT_WARN_SHARE]


def customer_events(now, limit=12):
    """The newest things customers did, merged and newest first: sign-ups, cards, payments and support requests."""
    since = now - timedelta(days=30)
    events = []
    for ws in Workspace.objects.filter(kind="company", deleted_at__isnull=True, created_at__gte=since).order_by("-created_at")[:limit]:
        events.append({"kind": "signup", "at": ws.created_at, "text": f"New company: {ws.name}", "path": f"/staff/companies/{ws.id}"})
    for card in Card.objects.filter(created_at__gte=since, workspace__deleted_at__isnull=True).select_related("workspace").order_by("-created_at")[:limit]:
        events.append({"kind": "card", "at": card.created_at, "text": f"New card: {card.name or 'Unnamed'} ({card.workspace.name})", "path": f"/staff/companies/{card.workspace_id}"})
    for pay in Payment.objects.filter(paid_at__gte=since).exclude(source="manual").select_related("workspace", "plan").order_by("-paid_at")[:limit]:
        events.append({"kind": "upgrade", "at": pay.paid_at, "text": f"{pay.workspace.name} paid for {pay.plan.name}", "path": f"/staff/companies/{pay.workspace_id}"})
    try:
        from support.models import SupportTicket
    except ImportError:
        SupportTicket = None
    if SupportTicket is not None:
        for t in SupportTicket.objects.filter(created_at__gte=since, spam=False).order_by("-created_at")[:limit]:
            events.append({"kind": "support", "at": t.created_at, "text": f"Support request {t.label}: {t.subject[:80]}", "path": "/staff/support"})
    events.sort(key=lambda e: e["at"], reverse=True)
    return [{**e, "at": iso(e["at"])} for e in events[:limit]]


def attention(now):
    """What a person on the team should look at first, most urgent first."""
    items = []
    late = open_reports().filter(due_at__lt=now).count()
    if late:
        items.append({"kind": "reports_late", "level": "bad", "count": late, "text": f"{late} card report{'s' if late != 1 else ''} past the answer time", "path": "/staff/abuse"})
    overdue = open_data_requests().filter(due_at__lt=now).count()
    if overdue:
        items.append({"kind": "data_overdue", "level": "bad", "count": overdue, "text": f"{overdue} data request{'s' if overdue != 1 else ''} past the legal due date", "path": "/staff/data-requests"})
    soon = open_data_requests().filter(due_at__gte=now, due_at__lt=now + timedelta(days=5)).count()
    if soon:
        items.append({"kind": "data_soon", "level": "warn", "count": soon, "text": f"{soon} data request{'s' if soon != 1 else ''} due within 5 days", "path": "/staff/data-requests"})
    failed_jobs = [j for j in ops_services.job_states() if j["state"] in ("failed", "late")]
    if failed_jobs:
        names = ", ".join(j["label"] for j in failed_jobs[:3])
        items.append({"kind": "jobs", "level": "bad", "count": len(failed_jobs), "text": f"Scheduled jobs not running well: {names}", "path": "/staff/system"})
    failed_mail = EmailLog.objects.filter(status="failed", created_at__gte=now - timedelta(days=1)).count()
    if failed_mail:
        items.append({"kind": "emails", "level": "warn", "count": failed_mail, "text": f"{failed_mail} e-mail{'s' if failed_mail != 1 else ''} failed in the last day", "path": "/staff/system"})
    stale = CompanyLead.objects.filter(status="new", created_at__lt=now - timedelta(days=2)).count()
    if stale:
        items.append({"kind": "applications", "level": "warn", "count": stale, "text": f"{stale} application{'s' if stale != 1 else ''} waiting more than 2 days", "path": "/staff/applications"})
    near = companies_near_seat_limit(now)
    if near:
        names = ", ".join(r["workspace__name"] for r in near[:3])
        items.append({"kind": "seats_near", "level": "warn", "count": len(near), "text": f"{len(near)} compan{'ies' if len(near) != 1 else 'y'} near the seat limit: {names}", "path": "/staff/companies"})
    sessions = SupportViewSession.objects.filter(ended_at__isnull=True, expires_at__gt=now).count()
    if sessions:
        items.append({"kind": "support_views", "level": "info", "count": sessions, "text": f"{sessions} support view{'s' if sessions != 1 else ''} open now", "path": "/staff/support-view"})
    return items


class OverviewView(StaffView):
    perm = "view"

    def get(self, request):
        now = timezone.now()
        companies = Workspace.objects.filter(kind="company", deleted_at__isnull=True)
        growth = weekly_counts(companies.values_list("created_at", flat=True), 12, now)
        return Response({
            "health": health(),
            "jobs": [{"name": j["name"], "label": j["label"], "state": j["state"]} for j in ops_services.job_states()],
            "email": ops_services.email_counts(24, now),
            "numbers": key_numbers(now),
            "growth": growth,
            "growth_total": growth_total(growth, now),
            "customer_events": customer_events(now),
            "attention": attention(now),
            "recent_activity": [audit_json(e) for e in StaffAuditEvent.objects.all()[:8]],
        })
