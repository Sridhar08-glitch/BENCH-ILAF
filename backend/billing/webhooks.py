"""What each Stripe event does. Every handler is idempotent: Stripe may deliver an event twice or out of order.

checkout.session.completed / async_payment_succeeded   first payment (subscription or one-off): grants the period
invoice.paid                                           every payment of a subscription: creates or extends the period
invoice.payment_failed                                 marks the plan, e-mails the owner (the grace days still apply)
customer.subscription.updated / deleted                keeps cancel_at_period_end, auto_renew and the seats in step
"""
import logging
import uuid
from datetime import datetime, timezone as dt_timezone

from django.utils import timezone

from operations import audit
from workspaces.models import Workspace

from . import enterprise, notices
from .models import Payment, Plan, Subscription
from .services import activate, seats_used

log = logging.getLogger(__name__)

SESSION_EVENTS = ("checkout.session.completed", "checkout.session.async_payment_succeeded")
EVENTS = SESSION_EVENTS + (
    "invoice.paid", "invoice.payment_failed", "customer.subscription.updated", "customer.subscription.deleted",
)
LIVE_STATUSES = ("active", "trialing", "past_due")
DEAD_STATUSES = ("canceled", "unpaid", "incomplete_expired")


def _is_uuid(value):
    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _workspace_plan_seats(metadata):
    workspace = Workspace.objects.filter(pk=metadata.get("workspace_id")).first() if _is_uuid(metadata.get("workspace_id")) else None
    plan = Plan.objects.filter(code=metadata.get("plan_code")).first()
    try:
        seats = int(metadata.get("seats") or 1)
    except ValueError:
        seats = 1
    return workspace, plan, seats


def _link_stripe(workspace, customer, subscription):
    """Remember the Stripe customer and subscription of a company that pays by subscription; renewal is on again."""
    fields = {}
    if customer:
        fields["stripe_customer_id"] = customer
    previous = ""
    if subscription:
        previous = Subscription.objects.filter(workspace=workspace).values_list("stripe_subscription_id", flat=True).first() or ""
        fields.update(stripe_subscription_id=subscription, auto_renew=True, cancel_at_period_end=False)
    if fields:
        Subscription.objects.filter(workspace=workspace).update(**fields)
    if previous and previous != subscription:
        _cancel_remote(previous)


def _cancel_remote(subscription_id):
    """A company that moves to a new Stripe subscription (Company to Enterprise, or paying again after cancelling) must not
    be charged by the old one as well."""
    import stripe
    from django.conf import settings

    if not settings.STRIPE_SECRET_KEY:
        return
    stripe.api_key = settings.STRIPE_SECRET_KEY
    try:
        stripe.Subscription.cancel(subscription_id)
    except stripe.error.StripeError:
        log.exception("Could not cancel the replaced Stripe subscription %s", subscription_id)


def _finish_request(metadata, workspace):
    if metadata.get("enterprise_request_id") and _is_uuid(metadata["enterprise_request_id"]):
        enterprise.mark_accepted(metadata["enterprise_request_id"], workspace)


def on_session(session):
    """The first payment. In subscription mode the invoice of the same payment may also arrive as invoice.paid: whichever
    comes first records the payment, the other finds it by the invoice id."""
    if session.get("payment_status") != "paid":
        return
    metadata = dict(session.get("metadata") or {})
    workspace, plan, seats = _workspace_plan_seats(metadata)
    if workspace is None or plan is None:
        log.warning("Stripe session %s has no usable metadata", session.get("id"))
        return
    recurring = session.get("mode") == "subscription"
    activate(
        workspace, plan, seats,
        session_id=session.get("id"),
        invoice_id=session.get("invoice") if recurring else None,
        amount_minor=session.get("amount_total"),
        currency=(session.get("currency") or plan.currency).upper(),
        source="stripe",
    )
    if recurring:
        _link_stripe(workspace, session.get("customer"), session.get("subscription"))
    _finish_request(metadata, workspace)


def _invoice_metadata(invoice):
    details = invoice.get("subscription_details") or {}
    meta = dict(details.get("metadata") or {})
    if not meta.get("workspace_id"):
        for line in (invoice.get("lines") or {}).get("data") or []:
            meta = dict(line.get("metadata") or {})
            if meta.get("workspace_id"):
                break
    return meta


def _invoice_period(invoice):
    lines = (invoice.get("lines") or {}).get("data") or []
    for line in lines:
        period = line.get("period") or {}
        if period.get("start") and period.get("end"):
            return datetime.fromtimestamp(period["start"], dt_timezone.utc), datetime.fromtimestamp(period["end"], dt_timezone.utc)
    return None


def on_invoice_paid(invoice):
    """Every paid invoice of a subscription: the first one (billing_reason subscription_create) and each renewal."""
    sub_id = invoice.get("subscription")
    if not sub_id:
        return  # a one-off invoice, not ours
    sub = Subscription.objects.select_related("workspace", "plan").filter(stripe_subscription_id=sub_id).first()
    metadata = _invoice_metadata(invoice)
    if sub is not None:
        workspace, plan, seats = sub.workspace, sub.plan, sub.seats_total
    else:
        workspace, plan, seats = _workspace_plan_seats(metadata)
    if workspace is None or plan is None:
        log.warning("Stripe invoice %s has no workspace", invoice.get("id"))
        return
    paid_before = Payment.objects.filter(workspace=workspace).exists()
    payment, created = activate(
        workspace, plan, seats,
        invoice_id=invoice.get("id"),
        amount_minor=invoice.get("amount_paid"),
        currency=(invoice.get("currency") or plan.currency).upper(),
        source="stripe",
        period=_invoice_period(invoice),
    )
    if created and paid_before:
        audit.log(None, workspace, "subscription.renewed", "workspace", workspace.id, workspace.name, {"plan": plan.code, "seats": payment.seats, "invoice": payment.number})
    _link_stripe(workspace, invoice.get("customer"), sub_id)
    _finish_request(metadata, workspace)


def on_payment_failed(invoice):
    sub = Subscription.objects.select_related("workspace", "plan").filter(
        stripe_subscription_id=invoice.get("subscription") or "-"
    ).first()
    if sub is None:
        return
    invoice_id = invoice.get("id") or ""
    first_for_invoice = sub.failed_invoice_id != invoice_id
    sub.payment_failed_at = sub.payment_failed_at or timezone.now()
    sub.failed_invoice_id = invoice_id
    sub.save(update_fields=["payment_failed_at", "failed_invoice_id", "updated_at"])
    if first_for_invoice:  # Stripe retries the same invoice several times: one e-mail per invoice
        audit.log(None, sub.workspace, "subscription.payment_failed", "workspace", sub.workspace_id, sub.workspace.name, {"plan": sub.plan_id, "invoice": invoice_id})
        notices.send_payment_failed(sub)


def on_subscription_updated(obj):
    sub = Subscription.objects.select_related("workspace", "plan").filter(stripe_subscription_id=obj.get("id") or "-").first()
    if sub is None:
        return
    status = obj.get("status")
    was_cancelling = sub.cancel_at_period_end
    sub.cancel_at_period_end = bool(obj.get("cancel_at_period_end") or obj.get("cancel_at"))
    if status in DEAD_STATUSES:
        sub.auto_renew = False
    elif status in LIVE_STATUSES:
        sub.auto_renew = True
    if obj.get("customer") and not sub.stripe_customer_id:
        sub.stripe_customer_id = obj["customer"]
    items = (obj.get("items") or {}).get("data") or []
    quantity = items[0].get("quantity") if items else None
    if sub.plan.per_seat and isinstance(quantity, int) and quantity > 0 and quantity != sub.seats_total:
        # Seats never drop below the people already on the team.
        sub.seats_total = max(quantity, seats_used(sub.workspace))
    sub.save()
    if sub.cancel_at_period_end != was_cancelling:
        action = "subscription.auto_renew_off" if sub.cancel_at_period_end else "subscription.auto_renew_on"
        audit.log(None, sub.workspace, action, "workspace", sub.workspace_id, sub.workspace.name, {"plan": sub.plan_id})


def on_subscription_deleted(obj):
    sub = Subscription.objects.select_related("workspace").filter(stripe_subscription_id=obj.get("id") or "-").first()
    if sub is None:
        return
    # What was paid for still runs to ends_at; Stripe just will not charge again.
    if sub.auto_renew:
        audit.log(None, sub.workspace, "subscription.auto_renew_off", "workspace", sub.workspace_id, sub.workspace.name, {"plan": sub.plan_id})
    sub.auto_renew = False
    sub.cancel_at_period_end = False
    sub.stripe_subscription_id = ""
    sub.save()


def handle(event_type, obj):
    if event_type in SESSION_EVENTS:
        on_session(obj)
    elif event_type == "invoice.paid":
        on_invoice_paid(obj)
    elif event_type == "invoice.payment_failed":
        on_payment_failed(obj)
    elif event_type == "customer.subscription.updated":
        on_subscription_updated(obj)
    elif event_type == "customer.subscription.deleted":
        on_subscription_deleted(obj)
