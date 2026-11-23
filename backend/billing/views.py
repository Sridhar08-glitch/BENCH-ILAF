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
from workspaces.access import MANAGER_ROLES, get_workspace_and_member
from workspaces.models import Workspace

from .models import Payment, Plan
from .services import activate, price_for, seats_for, seats_used, subscription_json

log = logging.getLogger(__name__)


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
    }


class PlansView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]

    def get(self, request):
        return Response([plan_json(p) for p in Plan.objects.filter(active=True)])


class CheckoutSerializer(serializers.Serializer):
    plan_code = serializers.CharField()
    seats = serializers.IntegerField(required=False, min_value=1, max_value=10000)


def dev_activation_enabled():
    """Skip Stripe when explicitly allowed, or when no Stripe key is set while DEBUG is on."""
    return settings.CARDS_DEV_ACTIVATE or (not settings.STRIPE_SECRET_KEY and settings.DEBUG)


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
        seats = seats_for(plan, ser.validated_data.get("seats"))
        if plan.per_seat and seats < seats_used(workspace):
            raise validation_error(
                {"seats": [f"You already use {seats_used(workspace)} seats. Choose at least that many."]}
            )
        amount = price_for(plan, seats)

        if dev_activation_enabled():
            activate(workspace, plan, seats, source="dev")
            return Response({"checkout_url": f"{settings.WEB_BASE_URL}/app/billing?paid=1"})

        if not settings.STRIPE_SECRET_KEY:
            raise ApiError("payments_unavailable", "Payments are not configured yet.", 503)
        stripe.api_key = settings.STRIPE_SECRET_KEY
        label = f"{settings.PRODUCT_NAME} - {plan.name}"
        if plan.per_seat:
            label += f" ({seats} seats)"
        metadata = {"workspace_id": str(workspace.id), "plan_code": plan.code, "seats": str(seats)}
        try:
            session = stripe.checkout.Session.create(
                mode="payment",
                customer_email=request.user.email,
                client_reference_id=str(workspace.id),
                line_items=[{
                    "quantity": 1,
                    "price_data": {
                        "currency": plan.currency.lower(),
                        "unit_amount": amount,
                        "product_data": {"name": label},
                    },
                }],
                payment_intent_data={
                    "statement_descriptor_suffix": settings.STATEMENT_DESCRIPTOR_SUFFIX[:22],
                    "metadata": metadata,
                },
                metadata=metadata,
                success_url=f"{settings.WEB_BASE_URL}/app/billing?paid=1&session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{settings.WEB_BASE_URL}/app/billing?canceled=1",
            )
        except stripe.error.StripeError:
            log.exception("Stripe checkout creation failed")
            raise ApiError("payments_unavailable", "We could not start the payment. Please try again.", 502)
        return Response({"checkout_url": session.url})


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


PAID_EVENTS = ("checkout.session.completed", "checkout.session.async_payment_succeeded")


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

        if event["type"] not in PAID_EVENTS:
            return Response({"received": True})
        # Read the already-verified payload as plain JSON so field access is simple and predictable.
        session = json.loads(payload)["data"]["object"]
        if session.get("payment_status") != "paid":
            return Response({"received": True})
        metadata = dict(session.get("metadata") or {})
        workspace = Workspace.objects.filter(pk=metadata.get("workspace_id") or None).first() \
            if _is_uuid(metadata.get("workspace_id")) else None
        plan = Plan.objects.filter(code=metadata.get("plan_code")).first()
        if workspace is None or plan is None:
            log.warning("Stripe session %s has no usable metadata", session.get("id"))
            return Response({"received": True})
        try:
            seats = int(metadata.get("seats") or 1)
        except ValueError:
            seats = 1
        activate(
            workspace, plan, seats,
            session_id=session.get("id"),
            amount_minor=session.get("amount_total"),
            currency=(session.get("currency") or plan.currency).upper(),
            source="stripe",
        )
        return Response({"received": True})


def _is_uuid(value):
    import uuid

    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False
