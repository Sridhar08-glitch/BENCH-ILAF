"""Subscription rules: when a workspace is "live", and how a payment grants or extends a period."""
import calendar
from datetime import timedelta

from django.conf import settings
from django.db import IntegrityError, transaction
from django.db.models import F
from django.utils import timezone

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


def is_live(workspace, now=None):
    """Live means a paid period exists and today is no later than its end plus the grace days."""
    sub = get_subscription(workspace)
    return _sub_live(sub, now)


def _sub_live(sub, now=None):
    if sub is None or sub.status != "active":
        return False
    now = now or timezone.now()
    return now <= sub.ends_at + grace_delta()


def seats_used(workspace):
    return workspace.members.count()


def subscription_json(workspace, now=None):
    """The Subscription object of the API contract."""
    now = now or timezone.now()
    sub = get_subscription(workspace)
    used = seats_used(workspace)
    if sub is None:
        return {
            "status": "none", "plan_code": None, "seats_total": 0, "seats_used": used,
            "starts_at": None, "ends_at": None, "grace_ends_at": None, "live": False,
        }
    grace_ends = sub.ends_at + grace_delta()
    live = _sub_live(sub, now)
    # A period past its grace end is expired even before the expire command has run.
    status = "active" if (sub.status == "active" and now <= grace_ends) else "expired"
    return {
        "status": status,
        "plan_code": sub.plan_id,
        "seats_total": sub.seats_total,
        "seats_used": used,
        "starts_at": iso(sub.starts_at),
        "ends_at": iso(sub.ends_at),
        "grace_ends_at": iso(grace_ends),
        "live": live,
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


def activate(workspace, plan, seats, *, session_id=None, amount_minor=None, currency=None, source="stripe"):
    """Record a payment and grant or extend the workspace's period. Returns (payment, created).

    Idempotent on session_id: delivering the same Stripe session twice returns the first payment.
    A new period starts from the old end while it is still inside the grace window, else from now.
    """
    if session_id:
        existing = Payment.objects.filter(stripe_session_id=session_id).first()
        if existing:
            return existing, False
    now = timezone.now()
    seats = seats_for(plan, seats)
    try:
        with transaction.atomic():
            sub = Subscription.objects.select_for_update().filter(workspace=workspace).first()
            if sub and now <= sub.ends_at + grace_delta() and sub.status == "active":
                period_start = sub.ends_at  # extend from the old end, even when already in the grace days
            else:
                period_start = now
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
                sub.save()
            payment = Payment.objects.create(
                number=_next_invoice_number(now),
                workspace=workspace,
                plan=plan,
                seats=seats,
                amount_minor=price_for(plan, seats) if amount_minor is None else amount_minor,
                currency=currency or plan.currency,
                stripe_session_id=session_id,
                source=source,
                period_start=period_start,
                period_end=period_end,
                paid_at=now,
            )
    except IntegrityError:
        # A concurrent delivery of the same session won the race.
        existing = Payment.objects.filter(stripe_session_id=session_id).first() if session_id else None
        if existing:
            return existing, False
        raise
    return payment, True


def grant_period(workspace, plan=None, seats=None):
    """Staff action: give a free period of the given (or default) plan, recorded as a manual payment."""
    if plan is None:
        plan = Plan.objects.filter(kind=workspace.kind, active=True).order_by("sort_order").first()
    if plan is None:
        raise ValueError("No plan exists for this workspace type.")
    return activate(workspace, plan, seats or plan.min_seats, amount_minor=0, source="manual")[0]
