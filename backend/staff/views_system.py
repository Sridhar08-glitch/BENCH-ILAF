"""Platform: system health (health, e-mail, jobs, errors, storage), feature switches and the billing placeholder."""
import os
from datetime import timedelta

from django.conf import settings
from django.db.models import Count
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from billing.models import Payment, Plan, Subscription
from billing.services import grant_period
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
        return Response({"health": health(), "series": metrics.series(24), "storage": ops_services.storage_usage()})


class SystemJobsView(StaffView):
    perm = "view"

    def get(self, request):
        return Response({"jobs": ops_services.job_states(), "state_dir_found": os.path.isdir(settings.BENCH_STATE_DIR)})


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
        body.update({"last_24h": ops_services.email_counts(24, now), "days": days})
        return Response(body)


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
        "history": [{"at": iso(c.created_at), "who": c.actor_email, "text": c.summary} for c in changes],
    }


class FlagsView(StaffView):
    perm = "view"
    write_roles = roles_for("flags")

    def get(self, request):
        rows = {f.key: f for f in FeatureFlag.objects.prefetch_related("changes")}
        keys = list(flags.KNOWN) + [k for k in rows if k not in flags.KNOWN]
        out = [flag_json(k, rows.get(k), list(rows[k].changes.all()[:8]) if k in rows else []) for k in keys]
        recent = FeatureFlagChange.objects.select_related("flag").order_by("-created_at")[:20]
        return Response({"flags": out, "history": [{"at": iso(c.created_at), "who": c.actor_email, "text": f"{c.flag_id}: {c.summary}"} for c in recent]})


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
        FeatureFlagChange.objects.create(flag=row, actor_email=request.user.email, summary=summary)
        flags.clear_cache()
        services.log(request, "flag.changed", "flag", key, key, {"summary": summary})
        return Response(flag_json(key, row, list(row.changes.all()[:8])))


# ---------------------------------------------------------------- billing placeholder
class BillingView(StaffView):
    """Read-only plan list and the free periods granted by hand. Payments are parked: nothing here charges anyone."""

    perm = "view"

    def get(self, request):
        counts = {r["plan_id"]: r["n"] for r in Subscription.objects.values("plan_id").annotate(n=Count("id")).order_by()}
        plans = [
            {"code": p.code, "name": p.name, "kind": p.kind, "interval": p.interval, "price_minor": p.price_minor, "currency": p.currency, "per_seat": p.per_seat,
             "max_cards": p.max_cards, "min_seats": p.min_seats, "active": p.active, "companies": counts.get(p.code, 0)}
            for p in Plan.objects.order_by("kind", "sort_order")
        ]
        grants = Payment.objects.filter(source="manual").select_related("workspace", "plan").order_by("-paid_at")[:20]
        return Response({
            "payments_parked": True, "plans": plans, "invoices": [],
            "grants": [{"company_id": str(g.workspace_id), "company": g.workspace.name, "plan": g.plan.name, "seats": g.seats, "until": iso(g.period_end), "at": iso(g.paid_at)} for g in grants],
        })


class BillingGrantView(StaffView):
    perm = "view"
    write_roles = roles_for("plans")

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        ws = get_company(data.get("company_id"))
        plan = None
        if data.get("plan_code"):
            plan = Plan.objects.filter(code=data["plan_code"], kind="company", active=True).first()
            if plan is None:
                raise validation_error({"plan_code": ["Choose a plan from the list."]})
        seats = data.get("seats")
        if seats is not None and (not isinstance(seats, int) or isinstance(seats, bool) or not 1 <= seats <= 10000):
            raise validation_error({"seats": ["Enter a whole number of seats."]})
        reason = str(data.get("reason") or "").strip()
        if len(reason) < 5:
            raise validation_error({"reason": ["Write a reason of at least 5 characters."]})
        try:
            payment = grant_period(ws, plan, seats)
        except ValueError as exc:
            raise validation_error({"plan_code": [str(exc)]}) from exc
        services.log(request, "plan.granted", "company", ws.id, ws.name, {"plan": payment.plan.code, "seats": payment.seats, "reason": reason[:300]})
        return Response({"company": ws.name, "plan": payment.plan.name, "seats": payment.seats, "until": iso(payment.period_end)}, status=201)
