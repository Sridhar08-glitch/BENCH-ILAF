"""What the staff billing screens, the companies list, the overview and the analytics read about money and plans.

Everything is counted in the database (one aggregate or one paged query per block), never row by row in Python. The rules
of "paid", "live", "grandfathered" and "Enterprise features on" are the ones of billing.services; `billing_cell` repeats them
on rows that are already loaded so a list of companies does not ask the database again for every row, and the tests compare
the two so they cannot drift.

Staff see plans, seats, dates, amounts and counts here. Never the content of a contact, an order or a booking.
"""
from datetime import timedelta

from django.db.models import Case, Count, Exists, F, IntegerField, OuterRef, Q, Subquery, Sum, Value, When
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from accounts.models import User
from billing.models import EnterpriseRequest, Payment, Subscription
from billing.services import ENTERPRISE_GRANDFATHER_BEFORE, ENTERPRISE_PLAN_CODE, FREE_PLAN_CODE, _sub_live, grace_delta, plan_is_paid
from cards.models import Card
from ilaf.utils import iso
from workspaces.models import CustomDomain, Member

CURRENCY = "QAR"
FREE_ENDING_DAYS = 2

# A subscription row whose plan costs money (Enterprise has price_minor 0 but is paid), as a filter on Subscription.
PAID = Q(plan__price_minor__gt=0) | Q(plan_id=ENTERPRISE_PLAN_CODE)


def live_paid(now=None):
    """Paid subscriptions that are live now: status active and not past the end plus the grace days."""
    now = now or timezone.now()
    return Subscription.objects.filter(PAID, status="active", ends_at__gte=now - grace_delta(), workspace__deleted_at__isnull=True)


def owner_email_of(workspace_ref="workspace_id"):
    """A subquery: the e-mail of the owner of the workspace a row points to."""
    return Subquery(Member.objects.filter(workspace=OuterRef(workspace_ref), role="owner").order_by("joined_at", "invited_at").values("email")[:1])


def renewal_mode(sub):
    """How a paid plan continues: auto (Stripe charges again), cancels (switched off, runs to its end), manual (nothing is
    scheduled), or none for a plan that costs nothing."""
    if not plan_is_paid(sub.plan):
        return "none"
    if sub.cancel_at_period_end:
        return "cancels"
    return "auto" if sub.auto_renew else "manual"


# ---------------------------------------------------------------- companies list
def with_company_billing(qs):
    """Add what the companies list needs about plans: whether a payment after the Enterprise cut-off exists (that ends the
    grandfathering) and the status of the custom domain."""
    later = Payment.objects.filter(workspace=OuterRef("pk"), paid_at__gte=ENTERPRISE_GRANDFATHER_BEFORE).exclude(source="manual")
    domain = CustomDomain.objects.filter(workspace=OuterRef("pk")).values("status")[:1]
    return qs.annotate(later_pay=Exists(later), domain_status=Subquery(domain))


def _live_q(prefix="subscription__"):
    return Q(**{f"{prefix}status": "active", f"{prefix}ends_at__gte": timezone.now() - grace_delta()})


def _paid_q(prefix="subscription__"):
    return Q(**{f"{prefix}plan__price_minor__gt": 0}) | Q(**{f"{prefix}plan_id": ENTERPRISE_PLAN_CODE})


def _grandfathered_q():
    return Q(subscription__plan_id="company", subscription__starts_at__lt=ENTERPRISE_GRANDFATHER_BEFORE, later_pay=False) & _live_q()


def filter_company_billing(qs, params):
    """The billing filters of the companies list (the queryset must come from with_company_billing):
    auto_renew=off, payment_failed=1, grandfathered=1, enterprise=1."""
    if params.get("auto_renew") == "off":
        qs = qs.filter(_paid_q() & _live_q() & (Q(subscription__auto_renew=False) | Q(subscription__cancel_at_period_end=True)))
    if params.get("payment_failed") in ("1", "true"):
        qs = qs.filter(subscription__payment_failed_at__isnull=False)
    if params.get("grandfathered") in ("1", "true"):
        qs = qs.filter(_grandfathered_q())
    if params.get("enterprise") in ("1", "true"):
        qs = qs.filter((Q(subscription__plan_id=ENTERPRISE_PLAN_CODE) & _live_q()) | _grandfathered_q())
    return qs


def billing_cell(sub, later_pay, domain_status, now):
    """The plan facts of one company row, from a subscription that is already loaded."""
    domain = domain_status or None
    if sub is None:
        return {
            "plan_code": None, "auto_renew": "none", "payment_failed": False, "enterprise": False, "grandfathered": False,
            "grandfathered_until": None, "plan_ends_at": None, "domain_status": domain,
        }
    live = _sub_live(sub, now)
    grandfathered = sub.plan_id == "company" and live and sub.starts_at < ENTERPRISE_GRANDFATHER_BEFORE and not later_pay
    return {
        "plan_code": sub.plan_id, "auto_renew": renewal_mode(sub), "payment_failed": sub.payment_failed_at is not None,
        "enterprise": bool(live and (sub.plan_id == ENTERPRISE_PLAN_CODE or grandfathered)), "grandfathered": bool(grandfathered),
        "grandfathered_until": iso(sub.ends_at) if grandfathered else None, "plan_ends_at": iso(sub.ends_at), "domain_status": domain,
    }


# ---------------------------------------------------------------- the summary tiles
def _arr_rows(now):
    """Estimated yearly revenue of the live paid subscriptions, per plan: price x seats for a plan with a price, the last real
    payment for Enterprise (its price is set per customer). Only plans in QAR; a plan billed monthly counts twelve times."""
    last_paid = Payment.objects.filter(workspace=OuterRef("workspace_id")).exclude(source="manual").order_by("-paid_at").values("amount_minor")[:1]
    seats = Case(When(plan__per_seat=True, then=F("seats_total")), default=Value(1), output_field=IntegerField())
    per_year = Case(When(plan__interval="month", then=Value(12)), default=Value(1), output_field=IntegerField())
    value = Case(
        When(plan_id=ENTERPRISE_PLAN_CODE, then=Coalesce(Subquery(last_paid), Value(0))),
        default=F("plan__price_minor") * seats * per_year, output_field=IntegerField(),
    )
    return (
        live_paid(now).filter(plan__currency=CURRENCY).annotate(yearly=value).values("plan_id", "plan__name")
        .annotate(n=Count("id"), seats=Sum("seats_total"), arr=Sum("yearly")).order_by("plan__sort_order", "plan_id")
    )


def summary(now=None):
    """Every tile of the Billing page."""
    now = now or timezone.now()
    by_plan = [
        {"plan_code": r["plan_id"], "plan": r["plan__name"], "subscriptions": r["n"], "seats": r["seats"] or 0, "arr_minor": r["arr"] or 0}
        for r in _arr_rows(now)
    ]
    renewals = live_paid(now).aggregate(
        in_grace=Count("id", filter=Q(ends_at__lt=now)),
        auto_7=Count("id", filter=Q(ends_at__gte=now, ends_at__lt=now + timedelta(days=7), auto_renew=True, cancel_at_period_end=False)),
        manual_7=Count("id", filter=Q(ends_at__gte=now, ends_at__lt=now + timedelta(days=7)) & (Q(auto_renew=False) | Q(cancel_at_period_end=True))),
        auto_30=Count("id", filter=Q(ends_at__gte=now, ends_at__lt=now + timedelta(days=30), auto_renew=True, cancel_at_period_end=False)),
        manual_30=Count("id", filter=Q(ends_at__gte=now, ends_at__lt=now + timedelta(days=30)) & (Q(auto_renew=False) | Q(cancel_at_period_end=True))),
    )
    free = Subscription.objects.filter(workspace__kind="personal", workspace__deleted_at__isnull=True, plan_id=FREE_PLAN_CODE).aggregate(
        running=Count("id", filter=Q(ends_at__gt=now)),
        ending_soon=Count("id", filter=Q(ends_at__gt=now, ends_at__lte=now + timedelta(days=FREE_ENDING_DAYS))),
        ended_unpaid=Count("id", filter=Q(ends_at__lte=now)),
    )
    converted = Subscription.objects.filter(PAID, workspace__kind="personal", workspace__deleted_at__isnull=True).count()
    return {
        "currency": CURRENCY,
        "active_by_plan": by_plan,
        "active_total": sum(r["subscriptions"] for r in by_plan),
        "arr_minor": sum(r["arr_minor"] for r in by_plan),
        "arr_is_estimate": True,
        "free_weeks": {**free, "converted": converted},
        "renewals": {
            "in_7_days": {"auto": renewals["auto_7"], "manual": renewals["manual_7"]},
            "in_30_days": {"auto": renewals["auto_30"], "manual": renewals["manual_30"]},
            "in_grace": renewals["in_grace"],
        },
        "failed_payments": Subscription.objects.filter(payment_failed_at__isnull=False, workspace__deleted_at__isnull=True).count(),
        "enterprise_requests": {
            "requested": EnterpriseRequest.objects.filter(status="requested").count(),
            "quoted": EnterpriseRequest.objects.filter(status="quoted").count(),
        },
    }


def counts(now=None):
    """The few numbers the overview and the analytics show beside the funnel."""
    now = now or timezone.now()
    r = live_paid(now).aggregate(
        due_7=Count("id", filter=Q(ends_at__gte=now, ends_at__lt=now + timedelta(days=7))),
        due_30=Count("id", filter=Q(ends_at__gte=now, ends_at__lt=now + timedelta(days=30))),
    )
    return {
        "renewals_due_7": r["due_7"], "renewals_due_30": r["due_30"],
        "failed_payments": Subscription.objects.filter(payment_failed_at__isnull=False, workspace__deleted_at__isnull=True).count(),
        "enterprise_requests_waiting": EnterpriseRequest.objects.filter(status="requested").count(),
    }


# ---------------------------------------------------------------- conversion funnel and revenue
def funnel(days, now=None):
    """What became of the people who signed up in the last `days` days (customers only, not staff):
    signed up, made a card, published (their free week started: a plan row of the personal space exists), still live now,
    free week ended unpaid, and now on a paid plan. A person who bought straight away counts as converted."""
    now = now or timezone.now()
    since = now - timedelta(days=days)
    users = User.objects.filter(deleted_at__isnull=True, staff_role="none", created_at__gte=since)
    subs = Subscription.objects.filter(
        workspace__kind="personal", workspace__deleted_at__isnull=True, workspace__members__role="owner",
        workspace__members__user__deleted_at__isnull=True, workspace__members__user__staff_role="none", workspace__members__user__created_at__gte=since,
    )
    free = ~PAID
    live = Q(status="active") & ((PAID & Q(ends_at__gte=now - grace_delta())) | (free & Q(ends_at__gte=now)))
    row = subs.aggregate(
        published=Count("id", distinct=True),
        live=Count("id", distinct=True, filter=live),
        ended_unpaid=Count("id", distinct=True, filter=free & Q(ends_at__lt=now)),
        converted=Count("id", distinct=True, filter=PAID),
    )
    return {
        "days": days,
        "signed_up": users.count(),
        "created_card": users.filter(Exists(Card.objects.filter(owner=OuterRef("pk")))).count(),
        "published": row["published"], "still_live": row["live"], "ended_unpaid": row["ended_unpaid"], "converted": row["converted"],
    }


def revenue_by_month(months=12, now=None):
    """Money received per month in QAR (Stripe and test payments; grants by hand are free and not counted), oldest first,
    months without a payment shown as zero."""
    now = now or timezone.now()
    first = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    index = first.year * 12 + first.month - 1 - (months - 1)
    start = first.replace(year=index // 12, month=index % 12 + 1)
    rows = {
        (r["m"].year, r["m"].month): r
        for r in Payment.objects.filter(paid_at__gte=start, currency=CURRENCY).exclude(source="manual")
        .annotate(m=TruncMonth("paid_at")).values("m").annotate(total=Sum("amount_minor"), n=Count("id")).order_by()
    }
    out = []
    for i in range(months):
        k = start.year * 12 + start.month - 1 + i
        year, month = k // 12, k % 12 + 1
        r = rows.get((year, month))
        out.append({"month": f"{year:04d}-{month:02d}", "amount_minor": r["total"] if r else 0, "payments": r["n"] if r else 0})
    return out


def money_block(now=None):
    """The block the overview and the analytics add: funnel for 7 and 30 days, revenue per month, renewals and failed payments."""
    now = now or timezone.now()
    return {"funnel": {"7": funnel(7, now), "30": funnel(30, now)}, "revenue_monthly": revenue_by_month(12, now), "currency": CURRENCY, **counts(now)}
