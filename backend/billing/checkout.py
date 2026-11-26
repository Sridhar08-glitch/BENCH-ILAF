"""Stripe Checkout and the Billing Portal.

A plan is bought as a Stripe subscription (mode="subscription", one yearly recurring price made inline with price_data), so
Stripe charges again every year until the owner cancels. With STRIPE_RECURRING off the old one-off payment is used instead
(the owner pays again each period); that is the fallback for a Stripe account or region that cannot take recurring payments.
"""
import logging

import stripe
from django.conf import settings

from ilaf.errors import ApiError

log = logging.getLogger(__name__)


def dev_activation_enabled():
    """Skip Stripe when explicitly allowed, or when no Stripe key is set while DEBUG is on."""
    return settings.CARDS_DEV_ACTIVATE or (not settings.STRIPE_SECRET_KEY and settings.DEBUG)


def require_stripe():
    if not settings.STRIPE_SECRET_KEY:
        raise ApiError("payments_unavailable", "Payments are not configured yet.", 503)
    stripe.api_key = settings.STRIPE_SECRET_KEY


def create_checkout(user, workspace, plan, seats, unit_amount, extra_metadata=None):
    """Start a Stripe Checkout for `seats` seats at `unit_amount` (minor units per seat, or per plan when it is not per seat).
    Returns the checkout URL. Nothing is granted until the webhook arrives."""
    require_stripe()
    label = f"{settings.PRODUCT_NAME} - {plan.name}"
    if plan.per_seat:
        label += f" ({seats} seats)"
    metadata = {"workspace_id": str(workspace.id), "plan_code": plan.code, "seats": str(seats), **(extra_metadata or {})}
    quantity = seats if plan.per_seat else 1
    price_data = {
        "currency": plan.currency.lower(),
        "unit_amount": unit_amount,
        "product_data": {"name": label},
    }
    from .models import Subscription

    sub = Subscription.objects.filter(workspace=workspace).first()
    customer = {"customer": sub.stripe_customer_id} if sub and sub.stripe_customer_id else {"customer_email": user.email}
    common = dict(
        client_reference_id=str(workspace.id),
        metadata=metadata,
        success_url=f"{settings.WEB_BASE_URL}/app/billing?paid=1&session_id={{CHECKOUT_SESSION_ID}}",
        cancel_url=f"{settings.WEB_BASE_URL}/app/billing?canceled=1",
        **customer,
    )
    try:
        if getattr(settings, "STRIPE_RECURRING", True):
            session = stripe.checkout.Session.create(
                mode="subscription",
                line_items=[{"quantity": quantity, "price_data": {**price_data, "recurring": {"interval": plan.interval}}}],
                subscription_data={"metadata": metadata},
                **common,
            )
        else:
            price_data["unit_amount"] = unit_amount * quantity
            session = stripe.checkout.Session.create(
                mode="payment",
                line_items=[{"quantity": 1, "price_data": price_data}],
                payment_intent_data={
                    "statement_descriptor_suffix": settings.STATEMENT_DESCRIPTOR_SUFFIX[:22],
                    "metadata": metadata,
                },
                **common,
            )
    except stripe.error.StripeError:
        log.exception("Stripe checkout creation failed")
        raise ApiError("payments_unavailable", "We could not start the payment. Please try again.", 502)
    return session.url


def create_portal(customer_id, return_url):
    """A Stripe Billing Portal link where the owner changes the card, cancels or resumes the renewal."""
    require_stripe()
    try:
        session = stripe.billing_portal.Session.create(customer=customer_id, return_url=return_url)
    except stripe.error.StripeError:
        log.exception("Stripe billing portal creation failed")
        raise ApiError("payments_unavailable", "We could not open the billing page. Please try again.", 502)
    return session.url
