"""Explicit throttle classes. Rates come from settings.ILAF_THROTTLE_RATES so tests can change them.

DRF throttles keep their counters in Django's cache. With several server processes the cache
must be shared (set REDIS_URL), otherwise each process counts on its own.
"""
import re

from django.conf import settings
from rest_framework.throttling import SimpleRateThrottle

from .utils import throttle_ident


class IpThrottle(SimpleRateThrottle):
    scope = None

    def get_rate(self):
        return settings.ILAF_THROTTLE_RATES.get(self.scope)

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": throttle_ident(request)}


class LoginThrottle(IpThrottle):
    scope = "auth_login"


class RegisterThrottle(IpThrottle):
    scope = "auth_register"


class ForgotThrottle(IpThrottle):
    scope = "auth_forgot"


class ResetThrottle(IpThrottle):
    scope = "auth_reset"


class InviteAcceptThrottle(IpThrottle):
    scope = "invite_accept"


class PublicReadThrottle(IpThrottle):
    scope = "public_read"


class PublicEventThrottle(IpThrottle):
    scope = "public_event"


class PublicLeadThrottle(IpThrottle):
    scope = "public_lead"


class SlugCheckThrottle(IpThrottle):
    scope = "slug_check"


class DirectoryThrottle(IpThrottle):
    scope = "public_directory"


class SupportPublicThrottle(IpThrottle):
    scope = "support_public"


class SupportChatStartThrottle(IpThrottle):
    scope = "support_chat_start"


class SupportChatThrottle(IpThrottle):
    scope = "support_chat"


class SupportInboundThrottle(IpThrottle):
    scope = "support_inbound"


class GoogleAuthThrottle(IpThrottle):
    scope = "auth_google"


class DataDownloadThrottle(IpThrottle):
    scope = "data_download"


# ---------------------------------------------------------------- signed-in API
# One counter per person (not per address) for every signed-in request. The scope is chosen from the method and
# the path: ordinary reads, ordinary writes, and three stricter groups. A request is counted once, in one scope.
#   user_heavy      exports, spreadsheets, bulk actions, imports (expensive to serve)
#   user_sensitive  password and sign-in changes, account and company deletion (guessing or abuse targets)
#   user_create     creating companies, invites, webhooks (cost money or send e-mail)
# Rates live in settings.ILAF_THROTTLE_RATES (override with THROTTLE_RATES_JSON); a scope with no rate is not limited.
_ROUTE_SCOPES = [
    ("GET", r"workspaces/[^/]+/(leads|audit)\.csv$", "user_heavy"),
    ("POST", r"workspaces/[^/]+/(members/import|bulk/members|bulk/cards|leads/bulk|change-requests/bulk)$", "user_heavy"),
    ("POST", r"privacy/export$", "user_heavy"),
    ("POST", r"workspaces/[^/]+/reports/weekly/preview$", "user_heavy"),
    ("POST", r"auth/(change-password|set-password|logout-all|google/link|google/unlink)$", "user_sensitive"),
    ("POST", r"staff/(verify|totp/confirm|totp/enrol|recovery-codes)$", "user_sensitive"),
    ("POST", r"cards/[^/]+/file$", "user_heavy"),
    ("POST", r"auth/(2fa/(setup|confirm|recovery-codes|disable)|devices/sign-out-others)$", "user_sensitive"),
    ("POST", r"workspaces/[^/]+/domains(/[^/]+/verify)?$", "user_sensitive"),
    ("POST", r"workspaces/[^/]+/design-requests(/[^/]+/(files|messages))?$", "user_create"),
    ("POST", r"privacy/(delete-account|workspaces/[^/]+/(delete|restore))$", "user_sensitive"),
    ("POST", r"workspaces/[^/]+/webhooks/[^/]+/secret$", "user_sensitive"),
    ("POST", r"support/tickets$", "user_create"),
    ("POST", r"workspaces$", "user_create"),
    ("POST", r"workspaces/[^/]+/(invites|webhooks|api-keys)$", "user_create"),
    ("POST", r"workspaces/[^/]+/api-keys/[^/]+/(revoke|rotate)$", "user_sensitive"),
    ("POST", r"workspaces/[^/]+/crm/[^/]+/(connect|disconnect|test|backfill)$", "user_sensitive"),
    ("POST", r"workspaces/[^/]+/members/[^/]+/resend-invite$", "user_create"),
]
_ROUTE_SCOPES = [(m, re.compile(p), s) for m, p, s in _ROUTE_SCOPES]


def api_scope(method, path):
    """The throttle scope of a signed-in request."""
    path = path.split("?", 1)[0].rstrip("/")
    for verb, pattern, scope in _ROUTE_SCOPES:
        if verb == method and pattern.search(path.removeprefix("/api/v1/")):
            return scope
    return "user_read" if method in ("GET", "HEAD", "OPTIONS") else "user_write"


class UserApiThrottle(SimpleRateThrottle):
    """Per-person limit for the signed-in API. Anonymous requests are left to the per-address throttles of their views."""

    scope = "user_read"

    def get_rate(self):
        return settings.ILAF_THROTTLE_RATES.get(self.scope)

    def allow_request(self, request, view):
        user = getattr(request, "user", None)
        if user is None or not getattr(user, "is_authenticated", False):
            return True
        self.scope = api_scope(request.method, request.path)
        self.rate = self.get_rate()
        self.num_requests, self.duration = self.parse_rate(self.rate)
        return super().allow_request(request, view)

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


class PublicReportThrottle(IpThrottle):
    scope = "public_report"


class PublicCompanyLeadThrottle(IpThrottle):
    scope = "public_company_lead"
