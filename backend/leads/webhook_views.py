"""Company webhook endpoints (owner and admin): list, create, change, delete, test, new secret, delivery log."""
from django.core.cache import cache
from django.http import Http404
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services import is_live, require_enterprise
from ilaf.errors import ApiError, validation_error
from ilaf.utils import iso
from operations import audit
from workspaces.access import MANAGER_ROLES, get_workspace_and_member

from . import webhooks
from .models import WebhookDelivery, WebhookEndpoint


def endpoint_json(e, secret=None):
    data = {
        "id": str(e.id), "name": e.name, "url": e.url, "events": e.events, "enabled": e.enabled,
        "secret_hint": "..." + e.secret[-4:], "consecutive_failures": e.consecutive_failures,
        "disabled_reason": e.disabled_reason, "last_success_at": iso(e.last_success_at),
        "last_failure_at": iso(e.last_failure_at), "created_at": iso(e.created_at),
    }
    if secret:
        data["secret"] = secret
    return data


def delivery_json(d, full=False):
    data = {
        "id": str(d.id), "event_id": str(d.event_id), "event_type": d.event_type, "status": d.status,
        "attempts": d.attempts, "response_status": d.response_status, "error": d.error, "duration_ms": d.duration_ms,
        "is_test": d.is_test, "next_attempt_at": iso(d.next_attempt_at), "created_at": iso(d.created_at),
        "delivered_at": iso(d.delivered_at),
    }
    if full:
        data["response_body"] = d.response_body
        data["payload"] = d.payload
    return data


def _clean(data, base=None):
    """Validate the writable fields. Returns the cleaned values for the keys that were sent."""
    errors, out = {}, {}
    if "url" in data or base is None:
        url = data.get("url")
        if not isinstance(url, str) or not url.strip():
            errors["url"] = ["Enter the web address that should receive the events."]
        else:
            try:
                webhooks.check_target(url.strip())
                out["url"] = url.strip()
            except webhooks.UnsafeTarget as exc:
                errors["url"] = [str(exc)]
            if len(url) > 500:
                errors["url"] = ["That address is too long."]
    if "name" in data:
        name = data.get("name")
        if not isinstance(name, str) or len(name.strip()) > 80:
            errors["name"] = ["Use up to 80 characters."]
        else:
            out["name"] = name.strip()
    if "events" in data or base is None:
        events = data.get("events", list(webhooks.EVENT_TYPES))
        if (
            not isinstance(events, list) or not events
            or any(e not in webhooks.EVENT_TYPES for e in events)
        ):
            errors["events"] = ["Choose at least one of: " + ", ".join(webhooks.EVENT_TYPES) + "."]
        else:
            out["events"] = [e for e in webhooks.EVENT_TYPES if e in events]
    if "enabled" in data:
        if not isinstance(data["enabled"], bool):
            errors["enabled"] = ["Must be true or false."]
        else:
            out["enabled"] = data["enabled"]
    if errors:
        raise validation_error(errors)
    return out


def _endpoint(request, workspace_id, endpoint_id):
    workspace, member = get_workspace_and_member(request.user, workspace_id, roles=MANAGER_ROLES)
    try:
        return workspace, WebhookEndpoint.objects.get(pk=endpoint_id, workspace=workspace)
    except (WebhookEndpoint.DoesNotExist, ValueError):
        raise Http404


def _require_plan(workspace):
    """Webhooks are part of a live Enterprise plan."""
    if not is_live(workspace):
        raise ApiError("subscription_required", "Webhooks need an active company plan.", 402)
    require_enterprise(workspace)


def _delivery_log_access(request, workspace_id, endpoint_id):
    """The delivery log holds copies of contact data, so it is closed while the company waits to be deleted."""
    workspace, endpoint = _endpoint(request, workspace_id, endpoint_id)
    if workspace.deletion_due_at is not None:
        raise ApiError("workspace_pending_deletion", "This company is scheduled for deletion and its contacts are closed for now.", 403)
    return workspace, endpoint


class WebhookListView(APIView):
    def get(self, request, workspace_id):
        workspace, _ = get_workspace_and_member(request.user, workspace_id, roles=MANAGER_ROLES)
        return Response({
            "events": list(webhooks.EVENT_TYPES),
            "results": [endpoint_json(e) for e in WebhookEndpoint.objects.filter(workspace=workspace)],
        })

    def post(self, request, workspace_id):
        workspace, _ = get_workspace_and_member(request.user, workspace_id, roles=MANAGER_ROLES)
        if workspace.kind != "company":
            raise validation_error({"url": ["Webhooks are for company workspaces."]})
        _require_plan(workspace)
        if WebhookEndpoint.objects.filter(workspace=workspace).count() >= webhooks.MAX_ENDPOINTS:
            raise validation_error({"url": [f"A company can have up to {webhooks.MAX_ENDPOINTS} webhooks."]})
        data = _clean(request.data if isinstance(request.data, dict) else {})
        secret = webhooks.new_secret()
        endpoint = WebhookEndpoint.objects.create(workspace=workspace, secret=secret, created_by=request.user, **data)
        audit.log(request, workspace, "webhook.created", "webhook", endpoint.id, endpoint.url, {"events": endpoint.events})
        return Response(endpoint_json(endpoint, secret=secret), status=201)


class WebhookDetailView(APIView):
    def get(self, request, workspace_id, endpoint_id):
        _, endpoint = _endpoint(request, workspace_id, endpoint_id)
        return Response(endpoint_json(endpoint))

    def patch(self, request, workspace_id, endpoint_id):
        workspace, endpoint = _endpoint(request, workspace_id, endpoint_id)
        data = _clean(request.data if isinstance(request.data, dict) else {}, base=endpoint)
        for key, value in data.items():
            setattr(endpoint, key, value)
        if data.get("enabled") is True:
            _require_plan(workspace)
            endpoint.consecutive_failures = 0
            endpoint.disabled_reason = ""
        endpoint.save()
        audit.log(request, workspace, "webhook.updated", "webhook", endpoint.id, endpoint.url, {"changed": sorted(data)})
        return Response(endpoint_json(endpoint))

    def delete(self, request, workspace_id, endpoint_id):
        workspace, endpoint = _endpoint(request, workspace_id, endpoint_id)
        audit.log(request, workspace, "webhook.deleted", "webhook", endpoint.id, endpoint.url)
        endpoint.delete()
        return Response(status=204)


def _limit_test_sends(endpoint):
    """The test button sends inside the web request, so it is limited per endpoint (not per address)."""
    key = f"webhook-test:{endpoint.id}"
    cache.add(key, 0, timeout=60)
    try:
        count = cache.incr(key)
    except ValueError:
        cache.set(key, 1, timeout=60)
        count = 1
    if count > webhooks.TEST_SENDS_PER_MINUTE:
        error = ApiError("throttled", "Too many requests. Please wait a moment and try again.", 429)
        error.retry_after = 60
        raise error


class WebhookTestView(APIView):
    """Send a sample event right now and answer with how it went."""

    def post(self, request, workspace_id, endpoint_id):
        workspace, endpoint = _endpoint(request, workspace_id, endpoint_id)
        _require_plan(workspace)
        _limit_test_sends(endpoint)
        delivery = webhooks.queue_test(endpoint)
        webhooks.attempt(delivery)
        return Response(delivery_json(delivery, full=True))


class WebhookSecretView(APIView):
    """Make a new secret. It is shown in this answer only; the old one stops working at once."""

    def post(self, request, workspace_id, endpoint_id):
        workspace, endpoint = _endpoint(request, workspace_id, endpoint_id)
        endpoint.secret = webhooks.new_secret()
        endpoint.save(update_fields=["secret"])
        audit.log(request, workspace, "webhook.secret_rotated", "webhook", endpoint.id, endpoint.url)
        return Response(endpoint_json(endpoint, secret=endpoint.secret))


class WebhookDeliveriesView(APIView):
    def get(self, request, workspace_id, endpoint_id):
        _, endpoint = _delivery_log_access(request, workspace_id, endpoint_id)
        qs = endpoint.deliveries.all()
        status = request.query_params.get("status")
        if status in ("pending", "success", "failed"):
            qs = qs.filter(status=status)
        try:
            limit = max(1, min(int(request.query_params.get("limit", 30)), 100))
        except ValueError:
            raise validation_error({"limit": ["Must be a number."]})
        return Response({"count": qs.count(), "results": [delivery_json(d) for d in qs[:limit]]})


class WebhookDeliveryView(APIView):
    def get(self, request, workspace_id, endpoint_id, delivery_id):
        _, endpoint = _delivery_log_access(request, workspace_id, endpoint_id)
        try:
            delivery = endpoint.deliveries.get(pk=delivery_id)
        except (WebhookDelivery.DoesNotExist, ValueError):
            raise Http404
        return Response(delivery_json(delivery, full=True))
