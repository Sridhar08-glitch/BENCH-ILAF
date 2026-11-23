"""Integrations > CRM: connect, disconnect, mapping, settings, test lead, backfill, recent sends (owner and admin)."""
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.core.cache import cache
from django.http import Http404, HttpResponseRedirect
from django.utils import timezone
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services import is_live
from ilaf.errors import ApiError, validation_error
from staff.flags import require_flag
from ilaf.throttles import PublicReadThrottle
from ilaf.utils import absolute_url, iso
from operations import audit
from workspaces.access import MANAGER_ROLES, active_membership, get_workspace_and_member
from workspaces.models import Workspace

from . import crypto, http, sync
from .errors import CrmError, OAuthFailed
from .models import VENDORS, CrmConnection, CrmSyncJob
from .vendors import LEAD_FIELDS, LEAD_STATUSES, get_vendor

STATE_SALT = "crm-oauth"
STATE_MINUTES = 15


def _vendor(key):
    vendor = get_vendor(key)
    if vendor is None:
        raise Http404
    return vendor


def _company(request, workspace_id):
    ws, member = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
    if ws.kind != "company":
        raise validation_error({"workspace": ["CRM connectors are for company workspaces."]})
    return ws, member


def redirect_uri(request, vendor_key):
    return absolute_url(request, f"/api/v1/crm/callback/{vendor_key}")


def health_of(conn):
    if conn.status == "disabled":
        return "needs_reconnect"
    if conn.consecutive_failures >= sync.FAILING_AFTER:
        return "failing"
    if conn.consecutive_failures:
        return "retrying"
    return "ok"


def connection_json(conn):
    vendor = get_vendor(conn.vendor)
    return {
        "id": str(conn.id), "status": conn.status, "health": health_of(conn), "region": conn.region,
        "account": conn.account_label, "connected_at": iso(conn.connected_at),
        "last_sync_at": iso(conn.last_sync_at), "last_success_at": iso(conn.last_success_at),
        "last_error": conn.last_error, "last_error_code": conn.last_error_code, "last_error_at": iso(conn.last_error_at),
        "disabled_reason": conn.disabled_reason, "consecutive_failures": conn.consecutive_failures,
        "pending": conn.jobs.filter(status="pending").count(),
        "mapping": sync.mapping_of(conn, vendor), "settings": sync.conn_settings(conn),
        "status_map": sync.status_map_of(conn, vendor),
    }


def vendor_json(request, workspace, vendor):
    conn = CrmConnection.objects.filter(workspace=workspace, vendor=vendor.key).first()
    return {
        "vendor": vendor.key, "label": vendor.label, "available": vendor.configured(),
        "redirect_uri": redirect_uri(request, vendor.key), "regions": vendor.regions(),
        "defaults": {"mapping": vendor.default_mapping, "status_map": vendor.default_status_map},
        "connection": connection_json(conn) if conn else None,
    }


class CrmOverviewView(APIView):
    def get(self, request, workspace_id):
        ws, _ = _company(request, workspace_id)
        return Response({
            "lead_fields": list(LEAD_FIELDS), "statuses": list(LEAD_STATUSES),
            "vendors": [vendor_json(request, ws, get_vendor(key)) for key in VENDORS],
        })


class CrmConnectView(APIView):
    """Start the OAuth flow: answers with the vendor's sign-in address for the owner's browser to open."""

    def post(self, request, workspace_id, vendor_key):
        ws, _ = _company(request, workspace_id)
        require_flag("crm_connectors", ws)
        vendor = _vendor(vendor_key)
        if not vendor.configured():
            raise ApiError("crm_not_configured", "This CRM is not set up on this server yet.", 400)
        if not is_live(ws):
            raise ApiError("subscription_required", "CRM connectors need an active company plan.", 402)
        existing = CrmConnection.objects.filter(workspace=ws, vendor=vendor.key).first()
        if existing is not None and existing.status == "connected":
            raise ApiError("crm_already_connected", "This CRM is already connected. Disconnect it first.", 409)
        data = request.data if isinstance(request.data, dict) else {}
        region = ""
        if vendor.regions():
            region = str(data.get("region") or "")
            if not vendor.valid_region(region):
                raise validation_error({"region": ["Choose the region of your account."]})
        nonce = vendor.new_state_nonce()
        cache.set(f"crm-state:{nonce}", True, STATE_MINUTES * 60)
        state = signing.dumps({"ws": str(ws.id), "v": vendor.key, "u": str(request.user.pk), "r": region, "n": nonce}, salt=STATE_SALT)
        return Response({"authorize_url": vendor.authorize_url(redirect_uri(request, vendor.key), state, region)})


class CrmCallbackView(APIView):
    """Where the vendor sends the owner's browser back to. No sign-in token travels here: the signed `state` made by
    the connect step names the company, the person and a one-time code, and the person must still be an owner or admin."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicReadThrottle]

    def _back(self, vendor_key, ok, code=""):
        query = f"crm={vendor_key}&crm_status={'connected' if ok else 'error'}" + (f"&crm_code={code}" if code else "")
        return HttpResponseRedirect(f"{settings.WEB_BASE_URL}/app/settings/integrations?{query}")

    def get(self, request, vendor_key):
        vendor = _vendor(vendor_key)
        params = request.query_params
        try:
            state = signing.loads(params.get("state", ""), salt=STATE_SALT, max_age=STATE_MINUTES * 60)
        except signing.BadSignature:
            return self._back(vendor_key, False, "crm_invalid_state")
        nonce_key = f"crm-state:{state.get('n')}"
        if state.get("v") != vendor.key or not cache.get(nonce_key):
            return self._back(vendor_key, False, "crm_invalid_state")
        cache.delete(nonce_key)  # a link can be used once
        workspace = Workspace.objects.filter(pk=state.get("ws"), kind="company", deleted_at__isnull=True).first()
        member = active_membership(state.get("u"), workspace.pk) if workspace is not None else None
        if member is None or member.role not in MANAGER_ROLES:
            return self._back(vendor_key, False, "crm_invalid_state")
        code = params.get("code")
        if params.get("error") or not code:
            return self._back(vendor_key, False, "crm_oauth_denied")
        try:
            tokens = vendor.exchange(code, redirect_uri(request, vendor.key), state.get("r", ""))
        except (CrmError, http.NetworkError, http.BlockedHost):
            return self._back(vendor_key, False, "crm_oauth_failed")
        now = timezone.now()
        conn, created = CrmConnection.objects.get_or_create(workspace=workspace, vendor=vendor.key)
        conn.region = state.get("r", "")
        conn.instance_url = tokens["instance_url"]
        conn.account_label = tokens["label"][:200]
        conn.access_token = crypto.encrypt(tokens["access_token"])
        conn.refresh_token = crypto.encrypt(tokens["refresh_token"])
        conn.token_expires_at = now + timedelta(seconds=tokens["expires_in"])
        conn.status, conn.disabled_reason = "connected", ""
        conn.consecutive_failures, conn.last_error, conn.last_error_code, conn.last_error_at = 0, "", "", None
        conn.connected_by = member.user
        conn.save()
        CrmSyncJob.objects.filter(connection=conn, status="pending", next_attempt_at__isnull=True).update(next_attempt_at=now)
        audit.log(None, workspace, "crm.connected", "crm", conn.id, vendor.label, {"vendor": vendor.key, "account": conn.account_label}, actor=member.user)
        return self._back(vendor.key, True)


def _connection(ws, vendor_key):
    _vendor(vendor_key)
    conn = CrmConnection.objects.filter(workspace=ws, vendor=vendor_key).first()
    if conn is None:
        raise ApiError("crm_not_connected", "This CRM is not connected.", 404)
    return conn


class CrmConnectionView(APIView):
    def patch(self, request, workspace_id, vendor_key):
        """Change the field mapping and the sync rules. Only the parts that are sent change."""
        ws, _ = _company(request, workspace_id)
        conn = _connection(ws, vendor_key)
        data = request.data if isinstance(request.data, dict) else {}
        changed = []
        try:
            if "mapping" in data:
                conn.field_mapping = {**(conn.field_mapping or {}), **sync.clean_mapping(data["mapping"])}
                changed.append("mapping")
            if "settings" in data:
                conn.options = sync.clean_settings(data["settings"], sync.conn_settings(conn))
                changed.append("settings")
        except ValueError as exc:
            field = str(exc)
            message = (
                "Use the CRM's field names: letters, digits and underscores, starting with a letter."
                if field == "mapping" else "These sync settings are not valid."
            )
            raise validation_error({field: [message]})
        if not changed:
            raise validation_error({"mapping": ["Send a mapping or settings to change."]})
        conn.save(update_fields=["field_mapping", "options"])
        audit.log(request, ws, "crm.settings_changed", "crm", conn.id, get_vendor(conn.vendor).label, {"vendor": conn.vendor, "changed": changed})
        return Response(connection_json(conn))


class CrmDisconnectView(APIView):
    def post(self, request, workspace_id, vendor_key):
        ws, _ = _company(request, workspace_id)
        conn = _connection(ws, vendor_key)
        vendor = get_vendor(conn.vendor)
        try:  # the vendor is told to forget the grant; whatever happens, our copy is deleted
            vendor.revoke(conn, crypto.decrypt(conn.refresh_token), crypto.decrypt(conn.access_token))
        except Exception:
            pass
        audit.log(request, ws, "crm.disconnected", "crm", conn.id, vendor.label, {"vendor": conn.vendor, "account": conn.account_label})
        conn.delete()
        return Response(status=204)


class CrmTestView(APIView):
    """Send a made-up lead now and report what the CRM said. The sample contact stays in the CRM (delete it there)."""

    def post(self, request, workspace_id, vendor_key):
        ws, _ = _company(request, workspace_id)
        conn = _connection(ws, vendor_key)
        if conn.status != "connected":
            raise ApiError("crm_disabled", "Connect this CRM again first.", 409)
        job = CrmSyncJob.objects.create(
            connection=conn, kind="test", payload={"lead": sync.sample_lead(), "owner_email": ""}, next_attempt_at=timezone.now(),
        )
        job = sync.attempt(job)
        conn.refresh_from_db()
        return Response({
            "ok": job.status == "success", "code": job.error_code, "detail": job.error, "remote_id": job.remote_id,
            "action": job.action, "connection": connection_json(conn),
        })


class CrmBackfillView(APIView):
    def post(self, request, workspace_id, vendor_key):
        ws, _ = _company(request, workspace_id)
        conn = _connection(ws, vendor_key)
        if conn.status != "connected":
            raise ApiError("crm_disabled", "Connect this CRM again first.", 409)
        queued = sync.queue_backfill(conn)
        audit.log(request, ws, "crm.settings_changed", "crm", conn.id, get_vendor(conn.vendor).label, {"vendor": conn.vendor, "backfill": queued})
        return Response({"queued": queued, "days": sync.BACKFILL_DAYS})


class CrmJobsView(APIView):
    def get(self, request, workspace_id, vendor_key):
        ws, _ = _company(request, workspace_id)
        conn = _connection(ws, vendor_key)
        rows = conn.jobs.all()[:20]
        return Response({"results": [{
            "id": str(j.id), "kind": j.kind, "status": j.status, "attempts": j.attempts,
            "name": (j.payload.get("lead") or {}).get("name", ""), "error_code": j.error_code, "error": j.error,
            "action": j.action, "remote_id": j.remote_id, "created_at": iso(j.created_at), "finished_at": iso(j.finished_at),
            "next_attempt_at": iso(j.next_attempt_at),
        } for j in rows]})
