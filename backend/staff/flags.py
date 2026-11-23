"""Feature switches. `flag_enabled(key, workspace)` is the one question the rest of the code asks.

A switch that was never edited has no row and answers with its default (on for every feature that already exists), so
nothing disappears by accident. Answers are cached for 60 seconds; a change clears the cache at once."""
import hashlib

from django.core.cache import cache

from ilaf.errors import ApiError

# key -> what it switches. All of these exist today, so they default to on.
KNOWN = {
    "directory": "The company directory page",
    "api_keys": "API keys and the public API",
    "crm_connectors": "CRM connections (HubSpot, Salesforce, Zoho CRM)",
    "wallet_google": "Add to Google Wallet",
    "custom_designs": "Custom card design requests and company faces",
    "support_chat": "Live chat with the support team",
}
CACHE_KEY = "staff:flags:v1"
CACHE_SECONDS = 60


def _rows():
    rows = cache.get(CACHE_KEY)
    if rows is None:
        from .models import FeatureFlag

        rows = {f.key: {"state": f.state, "percent": f.rollout_percent, "companies": [str(c) for c in f.company_ids or []]} for f in FeatureFlag.objects.all()}
        cache.set(CACHE_KEY, rows, CACHE_SECONDS)
    return rows


def clear_cache():
    cache.delete(CACHE_KEY)


def in_rollout(key, workspace_id, percent):
    """True when this company falls inside `percent` of all companies for this switch (the same companies every time)."""
    if percent >= 100:
        return True
    if percent <= 0 or workspace_id is None:
        return False
    digest = hashlib.sha256(f"{key}|{workspace_id}".encode()).hexdigest()
    return int(digest[:8], 16) % 100 < percent


def flag_enabled(key, workspace=None, default=True):
    row = _rows().get(key)
    if row is None:
        return default
    if row["state"] == "off":
        return False
    workspace_id = getattr(workspace, "id", workspace)
    if row["state"] == "selected":
        return workspace_id is not None and str(workspace_id) in row["companies"]
    return in_rollout(key, workspace_id, row["percent"])


def switched_off(key):
    """True when the switch is off for everybody (a caller without a company, such as a visitor, is only refused then)."""
    row = _rows().get(key)
    return bool(row and row["state"] == "off")


def flags_for(workspace=None):
    """Every known switch for one company: what the customer app asks for."""
    return {key: flag_enabled(key, workspace) for key in KNOWN}


def require_flag(key, workspace=None):
    if not flag_enabled(key, workspace):
        raise ApiError("feature_unavailable", "This feature is not available for your company right now.", 403)
