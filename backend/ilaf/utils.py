"""Small helpers shared by several apps."""
import hashlib
import hmac
import ipaddress
import logging
import re
import threading
from datetime import timezone as dt_timezone

from django.conf import settings
from django.utils import timezone

from rest_framework.exceptions import ValidationError

CONTROL_RE = re.compile(r"[\x00-\x08\x0b-\x1f\x7f  ]")  # everything except \t and \n
ANY_CONTROL_RE = re.compile(r"[\x00-\x1f\x7f  ]")


def iso(value):
    """ISO 8601 in UTC with a trailing Z, or None."""
    if value is None:
        return None
    return value.astimezone(dt_timezone.utc).isoformat().replace("+00:00", "Z")


def sane_date(value):
    """A date from a filter. Years outside 1970..2100 are refused (ValueError) so date arithmetic can never overflow."""
    if not 1970 <= value.year <= 2100:
        raise ValueError("date out of range")
    return value


def clean_line(value, max_len, field="value"):
    """A single-line text value: trimmed, no control characters, length capped."""
    value = (value or "").strip()
    if ANY_CONTROL_RE.search(value):
        raise ValidationError("Control characters are not allowed.")
    if len(value) > max_len:
        raise ValidationError(f"Keep this under {max_len} characters.")
    return value


def clean_multiline(value, max_len):
    """Free text where line breaks are allowed but other control characters are not."""
    value = (value or "").replace("\r\n", "\n").replace("\r", "\n").strip()
    if CONTROL_RE.search(value):
        raise ValidationError("Control characters are not allowed.")
    if len(value) > max_len:
        raise ValidationError(f"Keep this under {max_len} characters.")
    return value


def run_after_response(func, *args, **kwargs):
    """Run slow side work (sending an e-mail) without making the request wait for it, so the time a request takes
    does not depend on whether the work was needed. Failures are logged and never reach the caller. With
    EMAIL_AFTER_RESPONSE off (tests) the work runs at once."""
    def job():
        try:
            func(*args, **kwargs)
        except Exception:  # pragma: no cover - logged only
            logging.getLogger(__name__).exception("Background job failed: %s", getattr(func, "__name__", func))

    if getattr(settings, "EMAIL_AFTER_RESPONSE", True):
        threading.Thread(target=job, daemon=True).start()
    else:
        job()


def parse_ip(value):
    """A clean ip_address object from header text (handles 'ip:port', '[v6]:port' and IPv4-mapped IPv6), or None."""
    value = (value or "").strip()
    if not value or len(value) > 64:
        return None
    candidates = [value]
    if value.startswith("[") and "]" in value:
        candidates.append(value[1 : value.index("]")])
    elif value.count(":") == 1:
        candidates.append(value.split(":", 1)[0])
    for text in candidates:
        try:
            ip = ipaddress.ip_address(text)
        except ValueError:
            continue
        if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped:
            return ip.ipv4_mapped
        return ip
    return None


def _trusted_networks():
    nets = []
    for item in getattr(settings, "TRUSTED_PROXY_IPS", None) or []:
        try:
            nets.append(ipaddress.ip_network(str(item).strip(), strict=False))
        except ValueError:
            continue
    return nets


def _is_trusted(ip, nets):
    return ip is not None and any(ip.version == net.version and ip in net for net in nets)


def sign_client_ip(ip, secret):
    """Signature the web server attaches to X-BENCH-Client-IP: HMAC-SHA256 of the address, hex."""
    return hmac.new(secret.encode("utf-8"), str(ip).encode("utf-8"), hashlib.sha256).hexdigest()


def client_ip(request):
    """The visitor address used for throttles, visitor hashes and audit.

    REMOTE_ADDR is the only value a visitor cannot forge. Forwarded headers are read only when the
    connection comes from a trusted proxy (TRUSTED_PROXY_IPS, loopback by default) and TRUST_PROXY_HEADERS is on:
      1. X-BENCH-Client-IP: sent by the web server for calls it makes on behalf of a visitor. When
         CLIENT_IP_HEADER_SECRET is set it must carry a valid X-BENCH-Client-IP-Signature.
      2. CF-Connecting-IP, only when TRUST_CLOUDFLARE_HEADER is on (Cloudflare really is in front).
      3. X-Forwarded-For, read from the right: trusted proxies are skipped, up to NUM_PROXIES extra hops
         are skipped, and the first remaining address is the client. Entries to the left of it are ignored.
    Anything that does not parse as an IP address is ignored. The result is always a valid address string.
    """
    meta = request.META
    peer = parse_ip(meta.get("REMOTE_ADDR", ""))
    fallback = str(peer) if peer else "0.0.0.0"
    if not settings.TRUST_PROXY_HEADERS:
        return fallback
    nets = _trusted_networks()
    if not _is_trusted(peer, nets):
        return fallback

    own = meta.get("HTTP_X_BENCH_CLIENT_IP")
    if own:
        ip = parse_ip(own)
        secret = getattr(settings, "CLIENT_IP_HEADER_SECRET", "")
        if ip is not None:
            if not secret:
                return str(ip)
            given = (meta.get("HTTP_X_BENCH_CLIENT_IP_SIGNATURE") or "").strip().lower()
            if given and hmac.compare_digest(given, sign_client_ip(ip, secret)):
                return str(ip)

    if getattr(settings, "TRUST_CLOUDFLARE_HEADER", False):
        ip = parse_ip(meta.get("HTTP_CF_CONNECTING_IP"))
        if ip is not None:
            return str(ip)

    xff = meta.get("HTTP_X_FORWARDED_FOR")
    if xff:
        hops = [parse_ip(part) for part in xff.split(",")]
        extra = max(int(getattr(settings, "NUM_PROXIES", 0) or 0), 0)
        for ip in reversed(hops):
            if ip is None:
                return fallback  # a garbled entry on the trusted side of the chain: do not guess
            if _is_trusted(ip, nets):
                continue
            if extra > 0:
                extra -= 1
                continue
            return str(ip)
    return fallback


def throttle_ident(request):
    """Counter key for IP throttles. IPv6 visitors share one counter per /64 so rotating addresses inside a
    network does not dodge the limit."""
    ip = parse_ip(client_ip(request))
    if ip is not None and ip.version == 6:
        return str(ipaddress.ip_network(f"{ip}/64", strict=False).network_address) + "/64"
    return str(ip) if ip is not None else "0.0.0.0"


def client_country(request):
    """Two-letter country from Cloudflare's header, or 'unknown'."""
    value = (request.META.get("HTTP_CF_IPCOUNTRY") or "").strip().upper()
    if re.fullmatch(r"[A-Z]{2}", value) and value not in ("XX", "T1"):
        return value
    return "unknown"


def device_from_ua(user_agent):
    ua = (user_agent or "").lower()
    if "iphone" in ua or "ipad" in ua or "ipod" in ua:
        return "ios"
    if "android" in ua:
        return "android"
    if any(token in ua for token in ("windows", "macintosh", "linux", "x11", "cros")):
        return "desktop"
    return "other"


def visitor_hash(request):
    """Daily anonymous visitor id. The IP and user agent are mixed with the date and the
    server secret, hashed, and thrown away, so the raw address is never stored."""
    day = timezone.now().strftime("%Y-%m-%d")
    raw = f"{client_ip(request)}|{request.META.get('HTTP_USER_AGENT', '')}|{day}|{settings.SECRET_KEY}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def absolute_url(request, path):
    """Absolute URL for a path on this API. Uses API_BASE_URL when set, else the request host."""
    if path.startswith("http://") or path.startswith("https://"):
        return path
    if settings.API_BASE_URL:
        return settings.API_BASE_URL + (path if path.startswith("/") else "/" + path)
    if request is not None:
        return request.build_absolute_uri(path)
    return path


def file_url(request, field_file):
    """Public URL of an uploaded file, or None when there is no file."""
    if not field_file:
        return None
    try:
        url = field_file.url
    except Exception:  # storage misconfigured or file name empty
        return None
    return absolute_url(request, url)
