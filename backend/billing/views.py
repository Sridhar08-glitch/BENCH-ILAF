import json
import logging

import stripe
from django.conf import settings
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError, validation_error
from ilaf.utils import iso
from operations import audit
from workspaces.access import MANAGER_ROLES, get_workspace_and_member

from . import checkout, enterprise, webhooks
from .checkout import dev_activation_enabled
from .models import Payment, Plan
from .services import (
    ENTERPRISE_PLAN_CODE, activate, get_subscription, is_live, plan_is_paid, price_for, seats_for, seats_used,
    subscription_json,
)

log = logging.getLogger(__name__)

LEGACY_PLAN_CODES = ("business",)  # merged into Company; kept for customers who already have it


def plan_json(plan):
    return {
        "code": plan.code,
        "name": plan.name,
        "kind": plan.kind,
        "interval": plan.interval,
        "price_minor": plan.price_minor,
        "currency": plan.currency,
        "max_cards": plan.max_cards,
        "per_seat": plan.per_seat,
        "min_seats": plan.min_seats,
        "features": plan.features or [],
        # The free trial plan and the retired Business plan are never sold to new customers; Enterprise has no price
        # (by_quote): the company asks and staff set the seats and the price for that customer.
        "purchasable": plan.price_minor > 0 and plan.code not in LEGACY_PLAN_CODES and plan.code != ENTERPRISE_PLAN_CODE,
        "by_quote": plan.code == ENTERPRISE_PLAN_CODE,
    }


class PlansView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response([plan_json(p) for p in Plan.objects.filter(active=True)])


class CheckoutSerializer(serializers.Serializer):
    plan_code = serializers.CharField()
    seats = serializers.IntegerField(required=False, min_value=1, max_value=10000)


def refuse_if_renewing(workspace):
    """A plan that renews by itself is changed through Manage billing (or by us for Enterprise), never by paying a second time:
    a second Stripe subscription would charge twice."""
    sub = get_subscription(workspace)
    if (
        sub is not None and sub.auto_renew and not sub.cancel_at_period_end and sub.stripe_subscription_id
        and plan_is_paid(sub.plan) and is_live(workspace)
    ):
        raise ApiError("already_subscribed", "Your plan renews automatically. Use Manage billing to change or cancel it.", 409)


class CheckoutView(APIView):
    def post(self, request, workspace_id):
        workspace, member = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        ser = CheckoutSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        plan = Plan.objects.filter(code=ser.validated_data["plan_code"], active=True).first()
        if plan is None:
            raise validation_error({"plan_code": ["Unknown plan."]})
        if plan.kind != workspace.kind:
            raise validation_error({"plan_code": [f"This plan is for {plan.kind} workspaces."]})
        if plan.code == ENTERPRISE_PLAN_CODE:
            raise validation_error({"plan_code": ["Enterprise is by quote. Ask us for a quote from the billing page."]})
        seats = seats_for(plan, ser.validated_data.get("seats"))
        if plan.per_seat and seats < seats_used(workspace):
            raise validation_error(
                {"seats": [f"You already use {seats_used(workspace)} seats. Choose at least that many."]}
            )
        refuse_if_renewing(workspace)

        if dev_activation_enabled():
            activate(workspace, plan, seats, source="dev")
            return Response({"checkout_url": f"{settings.WEB_BASE_URL}/app/billing?paid=1"})

        url = checkout.create_checkout(request.user, workspace, plan, seats, plan.price_minor)
        return Response({"checkout_url": url})


class SubscriptionView(APIView):
    def get(self, request, workspace_id):
        workspace, _ = get_workspace_and_member(request.user, workspace_id)
        return Response(subscription_json(workspace))


class InvoicesView(APIView):
    def get(self, request, workspace_id):
        workspace, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        payments = Payment.objects.filter(workspace=workspace).order_by("-paid_at")
        return Response([
            {
                "id": str(p.id),
                "number": p.number,
                "amount_minor": p.amount_minor,
                "currency": p.currency,
                "plan_code": p.plan_id,
                "paid_at": iso(p.paid_at),
            }
            for p in payments
        ])


class BillingPortalView(APIView):
    """A Stripe Billing Portal link for the owner: change the card, cancel the renewal or turn it back on."""

    def post(self, request, workspace_id):
        workspace, _ = get_workspace_and_member(request.user, workspace_id, ("owner",))
        if dev_activation_enabled() or not settings.STRIPE_SECRET_KEY:
            raise ApiError("payments_unavailable", "Payments are not configured yet.", 503)
        sub = get_subscription(workspace)
        if sub is None or not sub.stripe_customer_id:
            raise ApiError("no_billing_account", "There is no card payment to manage yet.", 409)
        return Response({"url": checkout.create_portal(sub.stripe_customer_id, f"{settings.WEB_BASE_URL}/app/billing")})


# ---------------------------------------------------------------- Enterprise by request
def _owner_company(request, workspace_id):
    workspace, member = get_workspace_and_member(request.user, workspace_id, ("owner",))
    if workspace.kind != "company":
        raise validation_error({"workspace": ["Enterprise is only available to companies."]})
    return workspace


def _request_answer(workspace, status=200):
    req = enterprise.latest_request(workspace)
    return Response({"request": enterprise.request_json(req) if req else None}, status=status)


class EnterpriseRequestView(APIView):
    """The owner asks for an Enterprise quote (POST), reads the request and its quote (GET) or withdraws it (DELETE)."""

    def get(self, request, workspace_id):
        return _request_answer(_owner_company(request, workspace_id))

    def post(self, request, workspace_id):
        workspace = _owner_company(request, workspace_id)
        data = request.data if isinstance(request.data, dict) else {}
        req = enterprise.create_request(workspace, request.user, data)
        audit.log(request, workspace, "enterprise.requested", "workspace", workspace.id, workspace.name, {"seats": req.seats_wanted})
        return _request_answer(workspace, 201)

    def delete(self, request, workspace_id):
        workspace = _owner_company(request, workspace_id)
        req = enterprise.open_request(workspace)
        if req is None:
            raise ApiError("enterprise_request_closed", "This Enterprise request is already closed.", 409)
        enterprise.cancel_request(req)
        audit.log(request, workspace, "enterprise.cancelled", "workspace", workspace.id, workspace.name)
        return _request_answer(workspace)


class EnterpriseAcceptView(APIView):
    """The owner accepts the quote: pay the quoted amount (Stripe Checkout; in development the plan starts at once)."""

    def post(self, request, workspace_id):
        workspace = _owner_company(request, workspace_id)
        req = enterprise.open_request(workspace)
        if req is None:
            raise ApiError("enterprise_not_quoted", "There is no quote to accept yet.", 409)
        enterprise.checkable_quote(req)
        plan = enterprise.enterprise_plan()
        if plan is None:
            raise ApiError("payments_unavailable", "Payments are not configured yet.", 503)
        seats = req.quoted_seats
        if dev_activation_enabled():
            activate(
                workspace, plan, seats, amount_minor=req.quoted_total_minor, currency=req.currency, source="dev",
            )
            enterprise.mark_accepted(req.id, workspace)
            audit.log(request, workspace, "enterprise.accepted", "workspace", workspace.id, workspace.name, {"seats": seats})
            return Response({"checkout_url": f"{settings.WEB_BASE_URL}/app/billing?paid=1"})
        url = checkout.create_checkout(
            request.user, workspace, plan, seats, req.quoted_price_per_seat_minor,
            {"enterprise_request_id": str(req.id)},
        )
        audit.log(request, workspace, "enterprise.accepted", "workspace", workspace.id, workspace.name, {"seats": seats})
        return Response({"checkout_url": url})


class StripeWebhookView(APIView):
    """Receives Stripe events. The signature is always verified; unknown events are acknowledged and ignored."""

    authentication_classes = []
    permission_classes = [AllowAny]

    def post(self, request):
        secret = settings.STRIPE_WEBHOOK_SECRET
        if not secret:
            return Response({"error": {"code": "validation_error", "message": "Webhook is not configured."}}, status=400)
        payload = request.body
        signature = request.META.get("HTTP_STRIPE_SIGNATURE", "")
        try:
            event = stripe.Webhook.construct_event(payload, signature, secret)
        except (ValueError, stripe.error.SignatureVerificationError):
            return Response({"error": {"code": "validation_error", "message": "Invalid signature."}}, status=400)

        if event["type"] not in webhooks.EVENTS:
            return Response({"received": True})
        # Read the already-verified payload as plain JSON so field access is simple and predictable.
        webhooks.handle(event["type"], json.loads(payload)["data"]["object"])
        return Response({"received": True})
