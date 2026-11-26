"""Authentication, rate limits and scope checks of the public API.

The public API accepts only `Authorization: Bearer <api key>`. It never accepts a sign-in token, and the signed-in
API never accepts an API key (the keys are not JWTs), so the two cannot be mixed.
"""
import time

from django.conf import settings
from django.core.cache import cache
from django.db.models import F
from django.utils import timezone
from rest_framework.authentication import BaseAuthentication
from rest_framework.permissions import BasePermission
from rest_framework.throttling import BaseThrottle

from billing.services import is_live, require_enterprise
from ilaf.errors import ApiError
from ilaf.utils import client_ip, throttle_ident

from . import keys
from .models import ApiKey

# Wrong keys from one address, per minute, before that address is told to slow down.
BAD_KEY_LIMIT_PER_MINUTE = 30


class ApiKeyPrincipal:
    """Stands in for `request.user` on public routes: the key, acting for its company."""

    is_authenticated = True
    is_anonymous = False
    is_api_key = True
    language = ""
    email = ""

    def __init__(self, key):
        self.key = key
        self.workspace = key.workspace
        self.pk = key.pk
        self.id = key.pk
        self.full_name = f"API key: {key.name}"[:120]

    def __str__(self):
        return self.full_name


def _bad_key_counter(request):
    return f"pubapi:bad:{throttle_ident(request)}:{int(time.time() // 60)}"


def _deny(code, message, status=401):
    err = ApiError(code, message, status)
    if status == 401:
        err.auth_header = "Bearer"
    return err


class ApiKeyAuthentication(BaseAuthentication):
    def authenticate_header(self, request):
        return "Bearer"

    def authenticate(self, request):
        header = request.META.get("HTTP_AUTHORIZATION", "")
        parts = header.split(None, 1)
        if len(parts) != 2 or parts[0].lower() != "bearer":
            raise _deny("missing_api_key", "Send your API key as: Authorization: Bearer <key>.")
        raw = parts[1].strip()
        counter = _bad_key_counter(request)
        if cache.get(counter, 0) >= BAD_KEY_LIMIT_PER_MINUTE:
            err = ApiError("throttled", "Too many wrong keys from this address. Wait a minute and try again.", 429)
            err.retry_after = 60
            raise err
        key = None
        if keys.looks_like_key(raw):
            key = ApiKey.objects.select_related("workspace").filter(key_hash=keys.hash_key(raw)).first()
        if key is None:
            cache.add(counter, 0, 120)
            try:
                cache.incr(counter)
            except ValueError:
                pass
            raise _deny("invalid_api_key", "This API key is not valid.")
        if key.revoked_at is not None:
            raise _deny("key_revoked", "This API key was revoked.")
        if key.expires_at is not None and key.expires_at <= timezone.now():
            raise _deny("key_expired", "This API key has expired.")
        from staff.flags import flag_enabled

        if not flag_enabled("api_keys", key.workspace):
            raise ApiError("feature_unavailable", "This feature is not available for your company right now.", 403)
        if key.workspace.deleted_at is not None or key.workspace.deletion_due_at is not None or key.workspace.suspended_at is not None:
            raise ApiError("workspace_pending_deletion", "This company is closed or scheduled for deletion.", 403)
        if not keys.ip_allowed(key, client_ip(request)):
            raise ApiError("ip_not_allowed", "This API key cannot be used from this IP address.", 403)
        if not is_live(key.workspace):
            raise ApiError("subscription_required", "The company needs an active plan to use the API.", 402)
        require_enterprise(key.workspace)  # the public API is an Enterprise feature
        return ApiKeyPrincipal(key), key


class KeyRateThrottle(BaseThrottle):
    """Per-key limits: requests per minute and per day, counted in windows (fixed minute and UTC day).

    Every answer carries X-RateLimit-Limit, X-RateLimit-Remaining and X-RateLimit-Reset (seconds until the minute
    window ends) plus the daily numbers; a refused request also carries Retry-After."""

    def allow_request(self, request, view):
        principal = request.user
        key = principal.key
        now = time.time()
        minute, day = int(now // 60), int(now // 86400)
        mk, dk = f"pubapi:m:{key.pk}:{minute}", f"pubapi:d:{key.pk}:{day}"
        cache.add(mk, 0, 120)
        cache.add(dk, 0, 172800)
        used_m, used_d = cache.get(mk, 0), cache.get(dk, 0)
        reset_m = int((minute + 1) * 60 - now) + 1
        reset_d = int((day + 1) * 86400 - now) + 1
        info = {
            "limit": key.rate_per_minute, "daily_limit": key.rate_per_day, "reset": reset_m,
        }
        request._rate_info = info
        if used_m >= key.rate_per_minute or used_d >= key.rate_per_day:
            info.update(remaining=max(key.rate_per_minute - used_m, 0), daily_remaining=max(key.rate_per_day - used_d, 0))
            self._wait = reset_m if used_m >= key.rate_per_minute else reset_d
            info["retry_after"] = self._wait
            return False
        used_m, used_d = cache.incr(mk), cache.incr(dk)
        info.update(remaining=max(key.rate_per_minute - used_m, 0), daily_remaining=max(key.rate_per_day - used_d, 0))
        info["requests_today"] = used_d
        ApiKey.objects.filter(pk=key.pk).update(last_used_at=timezone.now(), use_count=F("use_count") + 1)
        return True

    def wait(self):
        return getattr(self, "_wait", None)


class ScopePermission(BasePermission):
    """The route's `required_scopes` maps a method to the scope it needs. A method with no entry is refused."""

    def has_permission(self, request, view):
        principal = request.user
        if not getattr(principal, "is_api_key", False):
            return False
        method = "GET" if request.method == "HEAD" else request.method
        scopes = getattr(view, "required_scopes", {})
        if method not in scopes:
            # An unsupported method is answered 405 by the framework, not 403 here.
            return not hasattr(view, request.method.lower())
        needed = scopes[method]
        if needed is None:
            return True
        if needed not in (principal.key.scopes or []):
            raise ApiError("insufficient_scope", f"This API key does not have the '{needed}' permission.", 403)
        return True
