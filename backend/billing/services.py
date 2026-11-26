"""Subscription rules: when a workspace is "live", and how a payment grants or extends a period."""
import calendar
from datetime import datetime, timedelta, timezone as dt_timezone

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

from ilaf.errors import ApiError
from ilaf.utils import iso

from .models import InvoiceSequence, Payment, Plan, Subscription


def grace_delta():
    return timedelta(days=settings.CARDS_GRACE_DAYS)


def add_period(start, interval):
    """Add one billing interval (a calendar month or year) to a datetime."""
    months = 12 if interval == "year" else 1
    month_index = start.month - 1 + months
    year = start.year + month_index // 12
    month = month_index % 12 + 1
    day = min(start.day, calendar.monthrange(year, month)[1])
    return start.replace(year=year, month=month, day=day)


def get_subscription(workspace):
    return Subscription.objects.select_related("plan").filter(workspace=workspace).first()


FREE_PLAN_CODE = "free"
TRIAL_DAYS = 7
ENTERPRISE_PLAN_CODE = "enterprise"
# Companies that already paid for the Company plan before the Enterprise plan existed keep the Enterprise-only features
# until the period they paid for ends. A renewal after this day does not keep them.
ENTERPRISE_GRANDFATHER_BEFORE = datetime(2026, 11, 25, tzinfo=dt_timezone.utc)
# The features only Enterprise has (the keys of subscription.features).
ENTERPRISE_FEATURES = (
    "departments", "directory", "field_rules", "activity_log", "integrations", "custom_domain", "sign_in_rules",
)


def plan_is_paid(plan):
    """True for a plan that costs money. Enterprise has no list price (price_minor 0 means "by quote") but is a paid plan;
    only the free trial is not. Every "is this paid?" question goes through here, never through price_minor."""
    return plan is not None and (plan.price_minor > 0 or plan.code == ENTERPRISE_PLAN_CODE)


def grace_for(sub):
    """The free trial ends on its date; a paid period gets the grace days after its end."""
    return grace_delta() if plan_is_paid(sub.plan) else timedelta(0)


def is_free_plan(workspace):
    """A personal workspace on the free plan: before its first publish (no plan yet) or inside its 7-day trial."""
    if workspace.kind != "personal":
        return False
    sub = get_subscription(workspace)
    return sub is None or not plan_is_paid(sub.plan)


def ensure_trial(workspace):
    """A personal workspace that publishes for the first time without a plan gets 7 free days, without a card.
    Returns True when the trial was started now."""
    if workspace.kind != "personal" or get_subscription(workspace) is not None:
        return False
    now = timezone.now()
    plan, _ = Plan.objects.get_or_create(
        code=FREE_PLAN_CODE,
        defaults={
            "name": "Free", "kind": "personal", "interval": "month", "price_minor": 0, "currency": "QAR",
            "max_cards": 1, "per_seat": False, "min_seats": 1, "active": True, "sort_order": 0,
            "features": ["1 digital card for 7 days", "QR code and NFC link", "50 faces, 50 below-card layouts, 50 animations"],
        },
    )
    Subscription.objects.create(
        workspace=workspace, plan=plan, status="active", seats_total=1, starts_at=now, ends_at=now + timedelta(days=TRIAL_DAYS),
    )
    return True


def is_live(workspace, now=None):
    """Live means a paid period exists and today is no later than its end plus the grace days."""
    sub = get_subscription(workspace)
    return _sub_live(sub, now)


def _sub_live(sub, now=None):
    if sub is None or sub.status != "active":
        return False
    now = now or timezone.now()
    return now <= sub.ends_at + grace_for(sub)


def seats_used(workspace):
    return workspace.members.count()


def enterprise_grandfathered(workspace, sub=None, now=None):
    """A live Company period that began before ENTERPRISE_GRANDFATHER_BEFORE and was not paid for again since:
    it keeps the Enterprise-only features until it ends."""
    sub = sub or get_subscription(workspace)
    if sub is None or sub.plan_id != "company" or not _sub_live(sub, now):
        return False
    if sub.starts_at >= ENTERPRISE_GRANDFATHER_BEFORE:
        return False
    # A payment after the cut-off (a renewal, or more seats) starts a new period, even when it is dated from the old end.
    later = Payment.objects.filter(workspace=workspace, paid_at__gte=ENTERPRISE_GRANDFATHER_BEFORE).exclude(source="manual")
    return not later.exists()


def enterprise_allowed(workspace, now=None):
    """The one server-side switch for the Enterprise-only features: a live Enterprise subscription, or a grandfathered
    Company period (see enterprise_grandfathered)."""
    if workspace.kind != "company":
        return False
    sub = get_subscription(workspace)
    if sub is None or not _sub_live(sub, now):
        return False
    return sub.plan_id == ENTERPRISE_PLAN_CODE or enterprise_grandfathered(workspace, sub, now)


def require_enterprise(workspace):
    """Refuse (403 plan_limit) unless the company may use the Enterprise-only features."""
    if not enterprise_allowed(workspace):
        raise ApiError("plan_limit", "This is part of the Enterprise plan. Ask us for a quote.", 403)


def enterprise_features(workspace, allowed=None):
    allowed = enterprise_allowed(workspace) if allowed is None else allowed
    return {key: allowed for key in ENTERPRISE_FEATURES}


def subscription_json(workspace, now=None):
    """The Subscription object of the API contract."""
    now = now or timezone.now()
    sub = get_subscription(workspace)
    used = seats_used(workspace)
    if sub is None:
        return {
            "status": "none", "plan_code": None, "seats_total": 0, "seats_used": used,
            "starts_at": None, "ends_at": None, "grace_ends_at": None, "live": False,
            "auto_renew": False, "cancel_at_period_end": False, "renews_at": None, "payment_failed": False,
            "can_manage_billing": False, "enterprise": False, "grandfathered": False,
            "features": enterprise_features(workspace, False),
        }
    grace_ends = sub.ends_at + grace_for(sub)
    live = _sub_live(sub, now)
    # A period past its grace end is expired even before the expire command has run.
    status = "active" if (sub.status == "active" and now <= grace_ends) else "expired"
    allowed = enterprise_allowed(workspace, now)
    return {
        "status": status,
        "plan_code": sub.plan_id,
        "seats_total": sub.seats_total,
        "seats_used": used,
        "starts_at": iso(sub.starts_at),
        "ends_at": iso(sub.ends_at),
        "grace_ends_at": iso(grace_ends),
        "live": live,
        # Automatic renewal: Stripe charges again at ends_at while auto_renew is true and cancel_at_period_end is false.
        "auto_renew": bool(sub.auto_renew),
        "cancel_at_period_end": bool(sub.cancel_at_period_end),
        "renews_at": iso(sub.ends_at) if sub.auto_renew and not sub.cancel_at_period_end else None,
        "payment_failed": sub.payment_failed_at is not None,
        "can_manage_billing": bool(sub.stripe_customer_id),
        # The Enterprise-only features (departments, directory, field rules, activity log, integrations, custom domain,
        # sign-in rules): on for a live Enterprise plan and for a grandfathered Company period.
        "enterprise": allowed,
        "grandfathered": allowed and sub.plan_id != ENTERPRISE_PLAN_CODE,
        "features": enterprise_features(workspace, allowed),
    }


def seats_for(plan, requested):
    """Seats a purchase covers: per-seat plans honour the request (at least min_seats), others are 1."""
    if not plan.per_seat:
        return 1
    return max(int(requested or plan.min_seats), plan.min_seats)


def price_for(plan, seats):
    return plan.price_minor * (seats if plan.per_seat else 1)


def _next_invoice_number(now):
    seq, _ = InvoiceSequence.objects.get_or_create(name="invoice")
    InvoiceSequence.objects.filter(pk=seq.pk).update(value=F("value") + 1)
    seq.refresh_from_db()
    return f"INV-{now:%Y}-{seq.value:06d}"


def _existing_payment(session_id, invoice_id):
    if session_id:
        found = Payment.objects.filter(stripe_session_id=session_id).first()
        if found:
            return found
    if invoice_id:
        return Payment.objects.filter(stripe_invoice_id=invoice_id).first()
    return None


def activate(
    workspace, plan, seats, *, session_id=None, invoice_id=None, amount_minor=None, currency=None, source="stripe", period=None,
):
    """Record a payment and grant or extend the workspace's period. Returns (payment, created).

    Idempotent on session_id and on invoice_id: delivering the same Stripe session or invoice twice returns the first payment.
    A new period starts from the old end while it is still inside the grace window, else from now. `period` (start, end) is
    the period Stripe invoiced; it is used as it is, except that it is moved after the old end when it would overlap a
    period that is still running.
    """
    existing = _existing_payment(session_id, invoice_id)
    if existing:
        return existing, False
    now = timezone.now()
    seats = seats_for(plan, seats)
    try:
        with transaction.atomic():
            sub = Subscription.objects.select_for_update().filter(workspace=workspace).first()
            running = bool(sub and plan_is_paid(sub.plan) and now <= sub.ends_at + grace_delta() and sub.status == "active")
            if period:
                period_start, period_end = period
                if running and sub.ends_at - period_start > timedelta(minutes=1):
                    period_start = sub.ends_at  # never overlap a period that is still running
                    period_end = add_period(period_start, plan.interval)
            else:
                period_start = sub.ends_at if running else now  # extend from the old end, even when already in the grace days
                period_end = add_period(period_start, plan.interval)
            if sub is None:
                sub = Subscription.objects.create(
                    workspace=workspace, plan=plan, status="active", seats_total=seats,
                    starts_at=period_start, ends_at=period_end,
                )
            else:
                sub.plan = plan
                sub.status = "active"
                sub.seats_total = seats
                sub.starts_at = period_start
                sub.ends_at = period_end
                sub.payment_failed_at = None
                sub.failed_invoice_id = ""
                sub.save()
            payment = Payment.objects.create(
                number=_next_invoice_number(now),
                workspace=workspace,
                plan=plan,
                seats=seats,
                amount_minor=price_for(plan, seats) if amount_minor is None else amount_minor,
                currency=currency or plan.currency,
                stripe_session_id=session_id,
                stripe_invoice_id=invoice_id,
                source=source,
                period_start=period_start,
                period_end=period_end,
                paid_at=now,
            )
    except IntegrityError:
        # A concurrent delivery of the same session or invoice won the race.
        existing = _existing_payment(session_id, invoice_id)
        if existing:
            return existing, False
        raise
    return payment, True


def grant_period(workspace, plan=None, seats=None):
    """Staff action: give a free period of the given (or default) plan, recorded as a manual payment."""
    if plan is None:
        plan = Plan.objects.filter(kind=workspace.kind, active=True).exclude(code=ENTERPRISE_PLAN_CODE).order_by("sort_order").first()
    if plan is None:
        raise ValueError("No plan exists for this workspace type.")
    return activate(workspace, plan, seats or plan.min_seats, amount_minor=0, source="manual")[0]
