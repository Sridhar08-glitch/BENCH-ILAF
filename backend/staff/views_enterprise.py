"""Enterprise requests in the back office: staff read what a company asked for, then quote the seats and the price for that
customer (the owner is e-mailed and accepts in Billing) or decline."""
from django.db.models import Q
from django.http import Http404
from rest_framework.response import Response

from billing import enterprise
from billing.models import EnterpriseRequest

from . import services
from .common import paged
from .perms_map import roles_for
from .permissions import StaffView


def _request_or_404(request_id):
    try:
        return EnterpriseRequest.objects.select_related("workspace", "requested_by").get(pk=request_id)
    except (EnterpriseRequest.DoesNotExist, ValueError):
        raise Http404


class EnterpriseRequestsView(StaffView):
    perm = "view"

    def get(self, request):
        params = request.query_params
        qs = EnterpriseRequest.objects.select_related("workspace", "requested_by")
        status = params.get("status", "open")
        if status == "open":
            qs = qs.filter(status__in=EnterpriseRequest.OPEN)
        elif status != "all":
            qs = qs.filter(status=status)
        term = (params.get("q") or "").strip()[:100]
        if term:
            qs = qs.filter(Q(workspace__name__icontains=term) | Q(requested_by__email__icontains=term) | Q(message__icontains=term))
        qs = qs.order_by("created_at" if status == "open" else "-created_at", "id")
        body = paged(request, qs, lambda r: enterprise.request_json(r, staff=True))
        body["counts"] = {s: EnterpriseRequest.objects.filter(status=s).count() for s in ("requested", "quoted", "accepted", "declined", "cancelled")}
        return Response(body)


class EnterpriseQuoteView(StaffView):
    perm = "view"
    write_roles = roles_for("plans")

    def post(self, request, request_id):
        req = _request_or_404(request_id)
        data = request.data if isinstance(request.data, dict) else {}
        enterprise.quote_request(req, request.user, data)
        services.log(request, "enterprise.quoted", "company", req.workspace_id, req.workspace.name, {
            "seats": req.quoted_seats, "price_per_seat_minor": req.quoted_price_per_seat_minor, "currency": req.currency,
        })
        return Response(enterprise.request_json(req, staff=True))


class EnterpriseDeclineView(StaffView):
    perm = "view"
    write_roles = roles_for("plans")

    def post(self, request, request_id):
        req = _request_or_404(request_id)
        data = request.data if isinstance(request.data, dict) else {}
        enterprise.decline_request(req, request.user, data)
        services.log(request, "enterprise.declined", "company", req.workspace_id, req.workspace.name, {})
        return Response(enterprise.request_json(req, staff=True))
