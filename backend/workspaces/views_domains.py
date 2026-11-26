"""Custom domain routes: the owner's side (workspaces/{id}/domain) and the two public lookups the web server and the TLS proxy use
(domains/resolve, domains/allowed)."""
import hmac

from django.conf import settings
from django.http import Http404, HttpResponse
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services import require_enterprise
from cards.models import Card
from ilaf.errors import ApiError
from ilaf.throttles import DomainCheckThrottle, DomainResolveThrottle

from . import domains
from .access import MANAGER_ROLES, get_workspace_and_member


class DomainSerializer(serializers.Serializer):
    domain = serializers.CharField(max_length=300)


def _body(ws):
    return {"domain": domains.info_json(ws)}


class DomainView(APIView):
    """GET the claim, PUT a new one (Enterprise), DELETE it. Owner and admin."""

    def get(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        return Response(_body(ws))

    def put(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        ser = DomainSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        _, created = domains.set_domain(request, ws, ser.validated_data["domain"])
        return Response(_body(ws), status=201 if created else 200)

    def delete(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        domains.remove_domain(request, ws)
        return Response(status=204)


class DomainCheckView(APIView):
    """Ask DNS now. The answer is the updated claim plus what the check found."""

    throttle_classes = [DomainCheckThrottle]

    def post(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        row = domains.get_row(ws)
        if row is None:
            raise ApiError("domain_not_found", "This company has no custom domain yet. Add one first.", 404)
        require_enterprise(ws)
        result = domains.check_domain(row, request, restart=True)
        return Response({**_body(ws), "result": {**result, "message": domains.REASONS.get(result["reason"])}})


# ---------------------------------------------------------------- public lookups
def _clean_host(value):
    return (value or "").strip().lower().rstrip(".")[:253]


class DomainResolveView(APIView):
    """The web server asks which company a host belongs to. Public and read-only; reveals only what a visitor of that host sees."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DomainResolveThrottle]

    def get(self, request):
        host = _clean_host(request.query_params.get("host"))
        row, state = domains.host_state(host)
        if state != "active":
            body = {"verified": False, "state": state}
        else:
            ws = row.workspace
            from staff.flags import flag_enabled

            directory_on = bool(ws.directory_enabled and ws.directory_slug and flag_enabled("directory", ws))
            company_card = Card.objects.filter(workspace=ws, is_company=True).values_list("public_code", flat=True).first()
            body = {
                "verified": True, "state": "active", "workspace": domains.public_workspace_id(ws.id),
                "kind": "directory" if directory_on else ("card" if company_card else "none"),
                "directory_enabled": directory_on, "directory_slug": ws.directory_slug if directory_on else None,
                "company_card": company_card,
            }
        response = Response(body)
        response["Cache-Control"] = "public, max-age=5"
        return response


def _ask_allowed(request):
    """The caller may use the "ask" endpoint: it knows DOMAIN_ASK_TOKEN, or (with no token set) it is this machine itself
    and no proxy sits in between (a proxied request always carries a forwarding header)."""
    token = settings.DOMAIN_ASK_TOKEN
    meta = request.META
    if token:
        given = request.headers.get("X-Domain-Ask-Token") or request.query_params.get("token") or ""
        return hmac.compare_digest(given.encode(), token.encode())
    if any(meta.get(h) for h in ("HTTP_X_FORWARDED_FOR", "HTTP_X_REAL_IP", "HTTP_FORWARDED", "HTTP_CF_CONNECTING_IP")):
        return False
    return meta.get("REMOTE_ADDR") in ("127.0.0.1", "::1")


class DomainAllowedView(APIView):
    """Caddy's on-demand TLS "ask": 200 only for a verified domain of an Enterprise-live company, else 404 (also when the caller
    is not allowed to ask, so the endpoint tells strangers nothing)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DomainResolveThrottle]

    def get(self, request):
        if not _ask_allowed(request):
            raise Http404
        _, state = domains.host_state(_clean_host(request.query_params.get("domain")))
        if state != "active":
            raise Http404
        return HttpResponse("ok", content_type="text/plain")
