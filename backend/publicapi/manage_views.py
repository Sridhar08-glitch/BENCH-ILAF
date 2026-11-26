"""Managing a company's API keys from the web app (owner and admin, signed in with the normal login)."""
import time

from django.core.cache import cache
from django.http import Http404
from django.utils import timezone
from datetime import timedelta
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services import is_live, require_enterprise
from ilaf.errors import ApiError, validation_error
from staff.flags import require_flag
from ilaf.utils import clean_line, iso
from operations import audit
from workspaces.access import MANAGER_ROLES, get_workspace_and_member

from . import keys
from .models import SCOPES, SCOPE_HELP, ApiKey

MAX_GRACE_HOURS = 24 * 14


def key_json(key, secret=None):
    now = timezone.now()
    status = "revoked" if key.revoked_at else "expired" if key.expires_at and key.expires_at <= now else "active"
    today = cache.get(f"pubapi:d:{key.pk}:{int(time.time() // 86400)}", 0)
    data = {
        "id": str(key.id), "name": key.name, "prefix": key.prefix, "scopes": key.scopes, "status": status,
        "expires_at": iso(key.expires_at), "allowed_ips": key.allowed_ips or [],
        "rate_limit": {"per_minute": key.rate_per_minute, "per_day": key.rate_per_day},
        "created_at": iso(key.created_at),
        "created_by": (key.created_by.full_name or key.created_by.email) if key.created_by_id else None,
        "last_used_at": iso(key.last_used_at), "use_count": key.use_count, "requests_today": today,
        "revoked_at": iso(key.revoked_at),
    }
    if secret:
        data["secret"] = secret
    return data


def _workspace(request, workspace_id):
    ws, member = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
    if ws.kind != "company":
        raise validation_error({"workspace": ["API keys are for company workspaces."]})
    return ws, member


def _key(ws, key_id):
    try:
        return ApiKey.objects.select_related("created_by").get(pk=key_id, workspace=ws)
    except (ApiKey.DoesNotExist, ValueError):
        raise Http404


class ApiKeysView(APIView):
    def get(self, request, workspace_id):
        ws, _ = _workspace(request, workspace_id)
        rows = ApiKey.objects.filter(workspace=ws).select_related("created_by")[:100]
        return Response({
            "scopes": [{"key": s, "label": SCOPE_HELP[s]} for s in SCOPES],
            "max_keys": keys.MAX_KEYS_PER_COMPANY,
            "results": [key_json(k) for k in rows],
        })

    def post(self, request, workspace_id):
        ws, member = _workspace(request, workspace_id)
        require_flag("api_keys", ws)
        if not is_live(ws):
            raise ApiError("subscription_required", "API keys need an active company plan.", 402)
        require_enterprise(ws)  # API keys are an Enterprise feature; listing and revoking stay possible
        data = request.data if isinstance(request.data, dict) else {}
        name = data.get("name")
        if not isinstance(name, str) or not name.strip():
            raise validation_error({"name": ["Give the key a name, for example the system that will use it."]})
        name = clean_line(name, 80)
        scopes = keys.clean_scopes(data.get("scopes"))
        expires_at = keys.clean_expiry(data.get("expires_at"))
        allowed_ips = keys.clean_ip_list(data.get("allowed_ips"))
        active = ApiKey.objects.filter(workspace=ws, revoked_at__isnull=True).count()
        if active >= keys.MAX_KEYS_PER_COMPANY:
            raise ApiError("plan_limit", f"A company can have up to {keys.MAX_KEYS_PER_COMPANY} active API keys. Revoke one first.", 403)
        per_minute = _rate(data, "rate_per_minute", 120, keys.MAX_RATE_PER_MINUTE)
        per_day = _rate(data, "rate_per_day", 5000, keys.MAX_RATE_PER_DAY)
        key, secret = keys.create_key(ws, request.user, name, scopes, expires_at, allowed_ips, per_minute=per_minute, per_day=per_day)
        audit.log(request, ws, "apikey.created", "api_key", key.id, key.name, {
            "prefix": key.prefix, "scopes": scopes, "expires_at": iso(expires_at), "ip_restricted": bool(allowed_ips),
        })
        return Response(key_json(key, secret), status=201)


def _rate(data, field, default, ceiling):
    if field not in data or data[field] in (None, ""):
        return default
    value = data[field]
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= ceiling:
        raise validation_error({field: [f"Use a whole number from 1 to {ceiling}."]})
    return value


class ApiKeyRevokeView(APIView):
    def post(self, request, workspace_id, key_id):
        ws, _ = _workspace(request, workspace_id)
        key = _key(ws, key_id)
        if key.revoked_at is None:
            key.revoked_at = timezone.now()
            key.revoked_by = request.user
            key.save(update_fields=["revoked_at", "revoked_by"])
            audit.log(request, ws, "apikey.revoked", "api_key", key.id, key.name, {"prefix": key.prefix})
        return Response(key_json(key))


class ApiKeyRotateView(APIView):
    """Make a new key with the same name, permissions, expiry and address list. The old key stops now or after a
    grace period (`grace_hours`, default 24) so the integration can switch over without a gap."""

    def post(self, request, workspace_id, key_id):
        ws, _ = _workspace(request, workspace_id)
        require_enterprise(ws)
        old = _key(ws, key_id)
        if old.revoked_at is not None or (old.expires_at and old.expires_at <= timezone.now()):
            raise validation_error({"key": ["This key is no longer active."]})
        data = request.data if isinstance(request.data, dict) else {}
        grace = data.get("grace_hours", 24)
        if isinstance(grace, bool) or not isinstance(grace, int) or not 0 <= grace <= MAX_GRACE_HOURS:
            raise validation_error({"grace_hours": [f"Use a whole number from 0 to {MAX_GRACE_HOURS}."]})
        new, secret = keys.create_key(
            ws, request.user, old.name, old.scopes, old.expires_at, old.allowed_ips, rotated_from=old,
            per_minute=old.rate_per_minute, per_day=old.rate_per_day,
        )
        now = timezone.now()
        if grace == 0:
            old.revoked_at, old.revoked_by = now, request.user
        else:
            end = now + timedelta(hours=grace)
            old.expires_at = min(old.expires_at, end) if old.expires_at else end
        old.save(update_fields=["revoked_at", "revoked_by", "expires_at"])
        audit.log(request, ws, "apikey.rotated", "api_key", new.id, new.name, {
            "old_prefix": old.prefix, "new_prefix": new.prefix, "grace_hours": grace,
        })
        return Response({"old": key_json(old), "new": key_json(new, secret)}, status=201)
