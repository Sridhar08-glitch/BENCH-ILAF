"""The staff overview: health strip, key numbers, growth chart, what needs attention, recent staff activity."""
from datetime import timedelta

from django.db import connection
from django.db.models import Sum
from django.utils import timezone
from rest_framework.response import Response

from analytics.models import Event
from cards.models import Card
from privacy.models import DataRequest
from workspaces.models import Workspace

from . import metrics, ops_services
from .common import weekly_counts
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
    return {
        "api_up": True, "db_ok": db_ok, "db_ms": took_ms, "p95_ms": recent["p95_ms"], "requests_10m": recent["requests"],
        "errors_last_hour": errors_hour,
    }


def key_numbers(now):
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    companies = Workspace.objects.filter(kind="company", deleted_at__isnull=True)
    views = Event.objects.filter(type="view", created_at__gte=midnight).aggregate(n=Sum("weight"))["n"] or 0
    return {
        "companies": companies.count(),
        "active_cards": Card.objects.filter(status="published", workspace__deleted_at__isnull=True).count(),
        "views_today": views,
        "new_companies_week": companies.filter(created_at__gte=now - timedelta(days=7)).count(),
        "open_reports": open_reports().count(),
        "open_data_requests": open_data_requests().count(),
        "open_support_tickets": open_support_tickets(),
    }


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
    sessions = SupportViewSession.objects.filter(ended_at__isnull=True, expires_at__gt=now).count()
    if sessions:
        items.append({"kind": "support_views", "level": "info", "count": sessions, "text": f"{sessions} support view{'s' if sessions != 1 else ''} open now", "path": "/staff/support-view"})
    return items


class OverviewView(StaffView):
    perm = "view"

    def get(self, request):
        now = timezone.now()
        companies = Workspace.objects.filter(kind="company", deleted_at__isnull=True)
        return Response({
            "health": health(),
            "jobs": [{"name": j["name"], "label": j["label"], "state": j["state"]} for j in ops_services.job_states()],
            "email": ops_services.email_counts(24, now),
            "numbers": key_numbers(now),
            "growth": weekly_counts(companies.values_list("created_at", flat=True), 12, now),
            "attention": attention(now),
            "recent_activity": [audit_json(e) for e in StaffAuditEvent.objects.all()[:8]],
        })
