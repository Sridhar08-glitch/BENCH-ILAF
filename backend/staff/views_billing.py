"""The staff Billing screens: plans, the summary tiles, upcoming renewals, failed payments, free weeks, payments (with a CSV)
and the billing facts of one company. Reading needs the same role as every staff screen ("view"); granting a plan period needs
"plans"; the payments CSV needs "export". Amounts are minor units of the payment's own currency (QAR).

Nothing here shows what a contact, an order or a booking says: the contact-sharing block of a company holds counts only."""
from datetime import timedelta

from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone
from rest_framework.response import Response

from billing import enterprise
from billing.models import Payment, Plan, Subscription
from billing.services import (
    ENTERPRISE_PLAN_CODE, FREE_PLAN_CODE, enterprise_allowed, enterprise_grandfathered, get_subscription, grace_for, grant_period, subscription_json,
)
from billing.views import plan_json
from cards.models import Card
from ilaf.errors import validation_error
from ilaf.utils import iso
from leads.models import Lead
from workspaces import domains
from workspaces.models import CustomDomain, Member

from . import billing_data as data, services
from .common import csv_response, paged
from .ops_services import customer_event
from .perms_map import roles_for
from .permissions import StaffView
from .views_customers import get_company

PAYMENT_SORTS = {"newest": ("-paid_at", "id"), "oldest": ("paid_at", "id"), "amount": ("-amount_minor", "-paid_at", "id"), "company": ("workspace__name", "-paid_at", "id")}
RENEWAL_SORTS = {"soonest": ("ends_at", "id"), "company": ("workspace__name", "ends_at", "id"), "plan": ("plan__sort_order", "ends_at", "id")}
FAILED_SORTS = {"oldest": ("payment_failed_at", "id"), "newest": ("-payment_failed_at", "id"), "company": ("workspace__name", "id")}
FREE_SORTS = {"ends": ("ends_at", "id"), "started": ("-starts_at", "id"), "owner": ("owner_email", "id")}


def _order(params, table, default):
    return table.get(params.get("sort"), table[default])


# ---------------------------------------------------------------- the page: plans, grants, tiles
class BillingView(StaffView):
    """The plan list, the summary tiles and the periods granted by hand."""

    perm = "view"

    def get(self, request):
        counts = {r["plan_id"]: r["n"] for r in Subscription.objects.values("plan_id").annotate(n=Count("id")).order_by()}
        plans = [{**plan_json(p), "active": p.active, "companies": counts.get(p.code, 0)} for p in Plan.objects.order_by("kind", "sort_order")]
        grants = Payment.objects.filter(source="manual").select_related("workspace", "plan").order_by("-paid_at")[:20]
        return Response({
            "summary": data.summary(), "plans": plans,
            "grants": [
                {"company_id": str(g.workspace_id), "company": g.workspace.name, "kind": g.workspace.kind, "plan": g.plan.name, "seats": g.seats, "until": iso(g.period_end), "at": iso(g.paid_at)}
                for g in grants
            ],
        })


class BillingGrantView(StaffView):
    perm = "view"
    write_roles = roles_for("plans")

    def post(self, request):
        body = request.data if isinstance(request.data, dict) else {}
        ws = get_company(body.get("company_id"))
        plan = None
        if body.get("plan_code"):
            plan = Plan.objects.filter(code=body["plan_code"], kind="company", active=True).first()
            if plan is None:
                raise validation_error({"plan_code": ["Choose a plan from the list."]})
        seats = body.get("seats")
        if seats is not None and (not isinstance(seats, int) or isinstance(seats, bool) or not 1 <= seats <= 10000):
            raise validation_error({"seats": ["Enter a whole number of seats."]})
        if plan is not None and plan.code == ENTERPRISE_PLAN_CODE and seats is None:
            raise validation_error({"seats": ["Enter the number of seats for the Enterprise period."]})
        reason = str(body.get("reason") or "").strip()
        if len(reason) < 5:
            raise validation_error({"reason": ["Write a reason of at least 5 characters."]})
        try:
            payment = grant_period(ws, plan, seats)
        except ValueError as exc:
            raise validation_error({"plan_code": [str(exc)]}) from exc
        services.log(request, "plan.granted", "company", ws.id, ws.name, {"plan": payment.plan.code, "seats": payment.seats, "reason": reason[:300]})
        customer_event(request, ws, "plan.granted", "workspace", ws.id, ws.name, {"plan": payment.plan.code, "seats": payment.seats})
        return Response({"company": ws.name, "plan": payment.plan.name, "seats": payment.seats, "until": iso(payment.period_end)}, status=201)


# ---------------------------------------------------------------- tables
def _who(sub):
    ws = sub.workspace
    return {"workspace_id": str(sub.workspace_id), "company": ws.name, "kind": ws.kind}


class BillingRenewalsView(StaffView):
    """Paid plans whose period ends soon. Filters: window (7, 30, 90 days; default 30), renew (auto or manual), sort."""

    perm = "view"

    def get(self, request):
        params = request.query_params
        now = timezone.now()
        days = {"7": 7, "30": 30, "90": 90}.get(params.get("window"), 30)
        qs = data.live_paid(now).filter(ends_at__lt=now + timedelta(days=days)).select_related("workspace", "plan").annotate(owner_email=data.owner_email_of())
        if params.get("renew") == "auto":
            qs = qs.filter(auto_renew=True, cancel_at_period_end=False)
        elif params.get("renew") == "manual":
            qs = qs.filter(Q(auto_renew=False) | Q(cancel_at_period_end=True))
        qs = qs.order_by(*_order(params, RENEWAL_SORTS, "soonest"))

        def row(sub):
            return {
                **_who(sub), "plan_code": sub.plan_id, "plan": sub.plan.name, "seats": sub.seats_total, "ends_at": iso(sub.ends_at),
                "days_left": (sub.ends_at - now).days if sub.ends_at >= now else -((now - sub.ends_at).days + 1),
                "renewal": data.renewal_mode(sub), "payment_failed": sub.payment_failed_at is not None, "owner_email": sub.owner_email or "",
            }

        return Response(paged(request, qs, row))


class BillingFailedView(StaffView):
    """Subscriptions whose last renewal payment failed (the grace days still apply)."""

    perm = "view"

    def get(self, request):
        qs = (
            Subscription.objects.filter(payment_failed_at__isnull=False, workspace__deleted_at__isnull=True).select_related("workspace", "plan")
            .annotate(owner_email=data.owner_email_of()).order_by(*_order(request.query_params, FAILED_SORTS, "oldest"))
        )
        now = timezone.now()

        def row(sub):
            return {
                **_who(sub), "plan_code": sub.plan_id, "plan": sub.plan.name, "seats": sub.seats_total, "owner_email": sub.owner_email or "",
                "failed_at": iso(sub.payment_failed_at), "invoice_id": sub.failed_invoice_id, "ends_at": iso(sub.ends_at),
                "grace_ends_at": iso(sub.ends_at + grace_for(sub)), "live": sub.ends_at + grace_for(sub) >= now,
            }

        return Response(paged(request, qs, row))


class BillingFreeWeeksView(StaffView):
    """The 7-day free weeks of personal workspaces. Filter: state (running, ending_soon, ended, all)."""

    perm = "view"

    def get(self, request):
        params = request.query_params
        now = timezone.now()
        qs = Subscription.objects.filter(workspace__kind="personal", workspace__deleted_at__isnull=True, plan_id=FREE_PLAN_CODE).select_related("workspace")
        state = params.get("state", "all")
        if state == "running":
            qs = qs.filter(ends_at__gt=now)
        elif state == "ending_soon":
            qs = qs.filter(ends_at__gt=now, ends_at__lte=now + timedelta(days=data.FREE_ENDING_DAYS))
        elif state == "ended":
            qs = qs.filter(ends_at__lte=now)
        qs = qs.annotate(
            owner_email=data.owner_email_of(), published=Exists(Card.objects.filter(workspace=OuterRef("workspace_id"), status="published")),
        ).order_by(*_order(params, FREE_SORTS, "ends"))
        return Response(paged(request, qs, lambda s: {
            "workspace_id": str(s.workspace_id), "owner_email": s.owner_email or "", "started_at": iso(s.starts_at), "ends_at": iso(s.ends_at),
            "state": "ended" if s.ends_at <= now else "ending_soon" if s.ends_at <= now + timedelta(days=data.FREE_ENDING_DAYS) else "running",
            "published": bool(s.published),
        }))


def filtered_payments(params):
    qs = Payment.objects.select_related("workspace", "plan")
    term = (params.get("q") or "").strip()[:100]
    if term:
        qs = qs.filter(Q(number__icontains=term) | Q(workspace__name__icontains=term) | Q(stripe_invoice_id__icontains=term))
    if params.get("source") in ("stripe", "dev", "manual"):
        qs = qs.filter(source=params["source"])
    if params.get("plan"):
        qs = qs.filter(plan_id=params["plan"])
    return qs.order_by(*_order(params, PAYMENT_SORTS, "newest"))


def payment_json(p):
    return {
        "id": str(p.id), "number": p.number, "company_id": str(p.workspace_id), "company": p.workspace.name, "kind": p.workspace.kind,
        "plan_code": p.plan_id, "plan": p.plan.name, "seats": p.seats, "amount_minor": p.amount_minor, "currency": p.currency, "source": p.source,
        "paid_at": iso(p.paid_at), "period_end": iso(p.period_end), "stripe_invoice_id": p.stripe_invoice_id or "",
    }


class BillingPaymentsView(StaffView):
    """Recent payments, newest first. Filters: q (invoice number, company, Stripe invoice), source, plan, sort."""

    perm = "view"

    def get(self, request):
        return Response(paged(request, filtered_payments(request.query_params), payment_json, 20))


class BillingPaymentsExportView(StaffView):
    """The payments the filters match as a CSV (at most 5000 rows). Admin and support only; written to the audit log."""

    perm = "export"

    def get(self, request):
        rows = list(filtered_payments(request.query_params)[:5000])
        services.log(request, "billing.exported", "export", "", f"{len(rows)} payments", {"rows": len(rows)})
        return csv_response(
            "payments.csv",
            ["Invoice", "Company", "Plan", "Seats", "Amount", "Currency", "Source", "Paid (UTC)", "Period ends (UTC)", "Stripe invoice"],
            [[p.number, p.workspace.name, p.plan.name, p.seats, f"{p.amount_minor / 100:.2f}", p.currency, p.source, iso(p.paid_at), iso(p.period_end), p.stripe_invoice_id or ""] for p in rows],
        )


# ---------------------------------------------------------------- one company
def domain_json(ws):
    """The custom web address claim of a company as staff read it: status and dates, never the DNS token."""
    row = domains.get_row(ws)
    if row is None:
        return None
    info = domains.info_json(ws)
    info.pop("records", None)
    info.update({
        "requested_at": iso(row.requested_at), "failing_since": iso(row.failing_since), "broken_at": iso(row.broken_at),
        "holding": row.status in CustomDomain.HOLDING,
    })
    return info


def sharing_json(ws):
    """How many employees switched on "share my new contacts with the company": counts only, never a contact."""
    employees = Member.objects.filter(workspace=ws, role="employee", status="active")
    row = employees.aggregate(total=Count("id"), sharing=Count("id", filter=Q(share_contacts=True)))
    return {
        "employees": row["total"], "sharing": row["sharing"],
        "last_changed_at": iso(employees.exclude(share_contacts_changed_at=None).order_by("-share_contacts_changed_at").values_list("share_contacts_changed_at", flat=True).first()),
        "contacts_shared": Lead.objects.filter(workspace=ws, shared_with_company=True).count(),
    }


def subscription_panel(ws, now):
    """The Subscription panel: the public subscription object plus the plan name, the failed invoice and the Stripe ids."""
    sub = get_subscription(ws)
    body = subscription_json(ws, now)
    if sub is None:
        return {**body, "plan": None, "payment_failed_at": None, "failed_invoice_id": "", "stripe_customer_id": "", "stripe_subscription_id": ""}
    return {
        **body, "plan": sub.plan.name, "interval": sub.plan.interval, "payment_failed_at": iso(sub.payment_failed_at), "failed_invoice_id": sub.failed_invoice_id,
        "stripe_customer_id": sub.stripe_customer_id, "stripe_subscription_id": sub.stripe_subscription_id,
    }


class CompanyBillingView(StaffView):
    """Billing facts of one company: subscription, Enterprise, contact sharing (counts), custom domain, latest payments."""

    perm = "view"

    def get(self, request, company_id):
        ws = get_company(company_id)
        now = timezone.now()
        sub = get_subscription(ws)
        latest = enterprise.latest_request(ws)
        grandfathered = enterprise_grandfathered(ws, sub, now)
        return Response({
            "subscription": subscription_panel(ws, now),
            "enterprise": {
                "features_on": enterprise_allowed(ws, now), "grandfathered": grandfathered,
                "grandfathered_until": iso(sub.ends_at) if grandfathered and sub else None,
                "latest_request": enterprise.request_json(latest, staff=True) if latest else None,
            },
            "sharing": sharing_json(ws),
            "domain": domain_json(ws),
            "payments": [payment_json(p) for p in Payment.objects.filter(workspace=ws).select_related("workspace", "plan").order_by("-paid_at")[:10]],
        })
