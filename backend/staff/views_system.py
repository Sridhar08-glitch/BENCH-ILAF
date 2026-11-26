"""Platform: system health (health, e-mail, jobs, errors, storage) and feature switches. Billing is in views_billing."""
import os
from datetime import timedelta

from django.conf import settings
from django.db.models import Count
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from ilaf.errors import ApiError, validation_error
from ilaf.utils import iso
from workspaces.models import Workspace

from . import flags, metrics, ops_services, services
from .common import paged
from .models import EmailLog, ErrorLogEntry, FeatureFlag, FeatureFlagChange
from .perms_map import roles_for
from .permissions import StaffView
from .views_overview import health
from .views_customers import get_company


class SystemHealthView(StaffView):
    perm = "view"

    def get(self, request):
        return Response({"health": health(), "series": metrics.series(24), "storage": ops_services.storage_usage(), "queues": ops_services.queue_counts()})


class SystemJobsView(StaffView):
    perm = "view"

    def get(self, request):
        from wallet import sync as wallet_sync

        return Response({"jobs": ops_services.job_states(), "state_dir_found": os.path.isdir(settings.BENCH_STATE_DIR), "wallet": wallet_sync.summary()})


def email_json(e):
    return {"id": str(e.id), "to": e.to_email, "subject": e.subject, "kind": e.kind, "status": e.status, "error": e.error, "created_at": iso(e.created_at), "can_resend": e.status == "failed" and bool(e.retry_text)}


class SystemEmailView(StaffView):
    perm = "view"

    def get(self, request):
        now = timezone.now()
        days = []
        for back in range(6, -1, -1):
            start = (now - timedelta(days=back)).replace(hour=0, minute=0, second=0, microsecond=0)
            rows = {r["status"]: r["n"] for r in EmailLog.objects.filter(created_at__gte=start, created_at__lt=start + timedelta(days=1)).values("status").annotate(n=Count("id")).order_by()}
            days.append({"day": start.date().isoformat(), "sent": rows.get("sent", 0) + rows.get("resent", 0), "failed": rows.get("failed", 0)})
        failed = EmailLog.objects.filter(status="failed").order_by("-created_at")
        body = paged(request, failed, email_json, 20)
        body.update({"last_24h": ops_services.email_counts(24, now), "days": days, "bounce": bounce_summary(now), "resendable": EmailLog.objects.filter(status="failed").exclude(retry_text="").count()})
        return Response(body)


def bounce_summary(now):
    """Bounced e-mails of the last 24 hours and the bounce rate. Bounces only exist when the mail provider reports them back;
    until then `connected` is false and no numbers are given."""
    if not getattr(settings, "EMAIL_BOUNCE_TRACKING", False):
        return {"connected": False, "bounced": None, "rate": None}
    rows = {r["status"]: r["n"] for r in EmailLog.objects.filter(created_at__gte=now - timedelta(hours=24)).values("status").annotate(n=Count("id")).order_by()}
    bounced, total = rows.get("bounced", 0), sum(rows.values())
    return {"connected": True, "bounced": bounced, "rate": round(100 * bounced / total, 2) if total else None}


class SystemEmailResendAllView(StaffView):
    """Send every failed e-mail that still has its text saved again (at most 100 at a time)."""

    perm = "view"
    write_roles = roles_for("resend")

    def post(self, request):
        tried, sent = ops_services.resend_all_failed(100)
        services.log(request, "email.resent_all", "email", "", f"{sent} of {tried} failed e-mails", {"tried": tried, "sent": sent})
        return Response({"tried": tried, "sent": sent, "failed": tried - sent})


class SystemEmailResendView(StaffView):
    perm = "view"
    write_roles = roles_for("resend")

    def post(self, request, email_id):
        row = EmailLog.objects.filter(pk=email_id).first()
        if row is None:
            raise Http404
        ok = ops_services.resend_email(row)
        services.log(request, "email.resent", "email", row.id, row.subject, {"ok": ok})
        if not ok:
            raise ApiError("resend_failed", "The e-mail could not be sent again. The reason is in the list.", 502)
        return Response(email_json(row))


class SystemErrorsView(StaffView):
    perm = "view"

    def get(self, request):
        qs = ErrorLogEntry.objects.all()
        groups = list(ErrorLogEntry.objects.values("trace_hash", "message", "path").annotate(n=Count("id")).order_by("-n")[:10])
        body = paged(request, qs, lambda e: {"id": e.id, "at": iso(e.created_at), "source": e.source, "path": e.path, "status": e.status, "message": e.message, "trace_hash": e.trace_hash}, 30)
        body["groups"] = groups
        return Response(body)


# ---------------------------------------------------------------- feature switches
def flag_json(key, row, changes):
    ids = [str(c) for c in (row.company_ids if row else [])]
    names = dict(Workspace.objects.filter(id__in=ids).values_list("id", "name")) if ids else {}
    return {
        "key": key, "description": flags.KNOWN.get(key) or (row.description if row else ""), "known": key in flags.KNOWN,
        "state": row.state if row else "everyone", "rollout_percent": row.rollout_percent if row else 100,
        "companies": [{"id": i, "name": next((n for k, n in names.items() if str(k) == i), i)} for i in ids],
        "history": [{"at": iso(c.created_at), "who": c.actor_email, "text": c.summary, "reason": c.reason} for c in changes],
    }


class FlagsView(StaffView):
    perm = "view"
    write_roles = roles_for("flags")

    def get(self, request):
        rows = {f.key: f for f in FeatureFlag.objects.prefetch_related("changes")}
        keys = list(flags.KNOWN) + [k for k in rows if k not in flags.KNOWN]
        out = [flag_json(k, rows.get(k), list(rows[k].changes.all()[:8]) if k in rows else []) for k in keys]
        recent = FeatureFlagChange.objects.select_related("flag").order_by("-created_at")[:20]
        return Response({"flags": out, "history": [{"at": iso(c.created_at), "who": c.actor_email, "text": f"{c.flag_id}: {c.summary}", "reason": c.reason} for c in recent]})


class FlagDetailView(StaffView):
    perm = "view"
    write_roles = roles_for("flags")

    def patch(self, request, key):
        if key not in flags.KNOWN and not FeatureFlag.objects.filter(pk=key).exists():
            raise Http404
        data = request.data if isinstance(request.data, dict) else {}
        row, _ = FeatureFlag.objects.get_or_create(key=key, defaults={"description": flags.KNOWN.get(key, ""), "state": "everyone", "rollout_percent": 100})
        before = (row.state, row.rollout_percent, list(row.company_ids))
        state = data.get("state", row.state)
        if state not in ("off", "selected", "everyone"):
            raise validation_error({"state": ["Choose off, selected or everyone."]})
        percent = data.get("rollout_percent", row.rollout_percent)
        if not isinstance(percent, int) or isinstance(percent, bool) or not 0 <= percent <= 100:
            raise validation_error({"rollout_percent": ["Enter a whole number from 0 to 100."]})
        company_ids = data.get("company_ids", row.company_ids)
        if not isinstance(company_ids, list) or len(company_ids) > 500:
            raise validation_error({"company_ids": ["Choose companies from the list."]})
        if state == "selected":
            valid = {str(i) for i in Workspace.objects.filter(id__in=[c for c in company_ids if c], kind="company").values_list("id", flat=True)} if company_ids else set()
            company_ids = [str(c) for c in company_ids if str(c) in valid]
        row.state, row.rollout_percent, row.company_ids = state, percent, [str(c) for c in company_ids]
        row.save()
        parts = []
        if before[0] != state:
            parts.append(f"state {before[0]} to {state}")
        if before[1] != percent:
            parts.append(f"rollout {before[1]}% to {percent}%")
        if before[2] != row.company_ids:
            parts.append(f"chosen companies {len(before[2])} to {len(row.company_ids)}")
        summary = ", ".join(parts) or "saved without changes"
        reason = services.reason_details(data).get("reason", "")
        FeatureFlagChange.objects.create(flag=row, actor_email=request.user.email, summary=summary, reason=reason)
        flags.clear_cache()
        services.log(request, "flag.changed", "flag", key, key, {"summary": summary, **services.reason_details(data)})
        return Response(flag_json(key, row, list(row.changes.all()[:8])))
