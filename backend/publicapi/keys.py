"""Making, hashing and checking API keys. The secret is shown once; only its SHA-256 hash is stored.

A key looks like `<prefix><43 random characters>`. The prefix (setting API_KEY_PREFIX) tells people and secret
scanners what the string is; the first 8 random characters are kept in the clear as `ApiKey.prefix` so a key can be
recognised in a list without being usable.
"""
import hashlib
import ipaddress
import secrets
from datetime import timedelta

from django.conf import settings
from django.utils import timezone

from ilaf.errors import validation_error

from .models import SCOPES, ApiKey

VISIBLE_CHARS = 8
MAX_KEYS_PER_COMPANY = 20
MAX_ALLOWED_IPS = 20
MAX_LIFETIME_DAYS = 3650
MAX_RATE_PER_MINUTE = 600
MAX_RATE_PER_DAY = 100000


def key_prefix():
    return getattr(settings, "API_KEY_PREFIX", "bnch_live_")


def hash_key(raw):
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


def generate():
    """(full secret, visible prefix, hash). Only the hash and the prefix are ever stored."""
    secret = secrets.token_urlsafe(32)
    raw = key_prefix() + secret
    return raw, key_prefix() + secret[:VISIBLE_CHARS], hash_key(raw)


def looks_like_key(raw):
    return isinstance(raw, str) and raw.startswith(key_prefix()) and 20 < len(raw) <= 200


def parse_networks(values):
    """The allow-list as network objects (single addresses become /32 or /128)."""
    nets = []
    for value in values or []:
        try:
            nets.append(ipaddress.ip_network(str(value).strip(), strict=False))
        except ValueError:
            continue
    return nets


def ip_allowed(key, ip_text):
    if not key.allowed_ips:
        return True
    try:
        ip = ipaddress.ip_address(ip_text)
    except ValueError:
        return False
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
        ip = ip.ipv4_mapped
    return any(ip.version == net.version and ip in net for net in parse_networks(key.allowed_ips))


def clean_ip_list(values):
    """Validated allow-list as normal text; raises a validation error naming the bad entry."""
    if values in (None, ""):
        return []
    if not isinstance(values, list):
        raise validation_error({"allowed_ips": ["Send a list of addresses."]})
    if len(values) > MAX_ALLOWED_IPS:
        raise validation_error({"allowed_ips": [f"Use at most {MAX_ALLOWED_IPS} addresses."]})
    out = []
    for value in values:
        try:
            net = ipaddress.ip_network(str(value).strip(), strict=False)
        except ValueError:
            raise validation_error({"allowed_ips": [f"{str(value)[:60]} is not an IP address or network."]})
        text = str(net.network_address) if net.num_addresses == 1 else str(net)
        if text not in out:
            out.append(text)
    return out


def clean_scopes(values):
    if not isinstance(values, list) or not values:
        raise validation_error({"scopes": ["Choose at least one permission."]})
    bad = [v for v in values if v not in SCOPES]
    if bad:
        raise validation_error({"scopes": ["Unknown permission: " + ", ".join(str(b)[:40] for b in bad) + "."]})
    return [s for s in SCOPES if s in values]


def clean_expiry(raw):
    """An optional future time as a datetime, or None."""
    from django.utils.dateparse import parse_datetime

    if raw in (None, ""):
        return None
    when = parse_datetime(raw) if isinstance(raw, str) else None
    if when is None:
        raise validation_error({"expires_at": ["Use a date and time such as 2027-01-31T00:00:00Z."]})
    if timezone.is_naive(when):
        when = timezone.make_aware(when, timezone.utc)
    now = timezone.now()
    if when <= now:
        raise validation_error({"expires_at": ["The expiry must be in the future."]})
    if when > now + timedelta(days=MAX_LIFETIME_DAYS):
        raise validation_error({"expires_at": ["The expiry is too far away."]})
    return when


def create_key(workspace, user, name, scopes, expires_at=None, allowed_ips=None, rotated_from=None, per_minute=None, per_day=None):
    """Make a key. Returns (ApiKey, full secret). The secret is not recoverable afterwards."""
    raw, prefix, digest = generate()
    key = ApiKey.objects.create(
        workspace=workspace, name=name, prefix=prefix, key_hash=digest, scopes=scopes, expires_at=expires_at,
        allowed_ips=allowed_ips or [], created_by=user, rotated_from=rotated_from,
        rate_per_minute=per_minute or 120, rate_per_day=per_day or 5000,
    )
    return key, raw


def is_active(key, now=None):
    now = now or timezone.now()
    return key.revoked_at is None and (key.expires_at is None or key.expires_at > now)
