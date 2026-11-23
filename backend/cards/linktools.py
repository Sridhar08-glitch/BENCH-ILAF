"""Link helper: read a page title and favicon for a link a user pastes into a card.

This is an outbound fetch of a user-supplied address, so it is built to be safe against
server-side request forgery (SSRF):
  * only http and https, only a few ports, no credentials in the address;
  * the host name is resolved here, every resolved address must be public (no private,
    loopback, link-local, carrier-grade NAT, multicast or metadata addresses), and the
    connection is made to that exact address so the name cannot change between check and use;
  * the same checks run again on every redirect (at most 3);
  * 3 second socket timeout, 1 MB size cap, no cookies, nothing is ever sent from the user's session.
Every failure becomes None, never an exception for the caller.
"""
import hashlib
import http.client
import ipaddress
import logging
import re
import socket
import ssl
import threading
import time
from html import unescape
from urllib.parse import urljoin, urlsplit

from django.core.files.storage import default_storage

from ilaf.images import icon_from_bytes
from ilaf.netsafety import is_public_ip
from ilaf.items import ALLOWED_SCHEMES, has_unsafe_scheme, scheme_of

log = logging.getLogger(__name__)

TIMEOUT = 3
OVERALL_BUDGET = 8
MAX_BYTES = 1024 * 1024
MAX_REDIRECTS = 3
ALLOWED_PORTS = (80, 443, 8080, 8443)
USER_AGENT = "BENCHLinkPreview/1.0"

# Brands the web app already shows a logo for; their favicon is not fetched.
KNOWN_BRAND_DOMAINS = {
    "facebook.com", "instagram.com", "linkedin.com", "x.com", "twitter.com", "youtube.com", "tiktok.com",
    "snapchat.com", "t.me", "telegram.org", "pinterest.com", "threads.net", "github.com", "behance.net",
    "dribbble.com", "discord.com", "discord.gg", "spotify.com", "soundcloud.com", "twitch.tv", "reddit.com",
    "medium.com", "calendly.com", "apple.com", "google.com", "paypal.com", "paypal.me", "wa.me",
    "whatsapp.com", "amazon.com", "notion.so", "figma.com", "behance.net",
}


def is_public_address(address):
    """True only for globally routable addresses."""
    try:
        ip = ipaddress.ip_address(address)
    except ValueError:
        return False
    return is_public_ip(ip)


DNS_TIMEOUT = 3


def _lookup(host, port):
    """getaddrinfo with a time limit (the resolver has none of its own). None on failure or when the answer is late."""
    box = []

    def work():
        try:
            box.append(socket.getaddrinfo(host, port, type=socket.SOCK_STREAM))
        except (socket.gaierror, UnicodeError, OSError, ValueError):
            box.append(None)

    thread = threading.Thread(target=work, daemon=True)
    thread.start()
    thread.join(DNS_TIMEOUT)
    return box[0] if box else None


def resolve_public(host, port):
    """Resolve a host name and return one safe address, or None if any resolved address is not public."""
    infos = _lookup(host, port)
    if infos is None:
        return None
    addresses = [info[4][0] for info in infos]
    if not addresses or not all(is_public_address(a.split("%")[0]) for a in addresses):
        return None
    return addresses[0].split("%")[0]


class _PinnedHTTP(http.client.HTTPConnection):
    """Connects to a fixed, already-validated address while keeping the original Host header."""

    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout)
        self._ip = ip

    def connect(self):
        self.sock = self.raw_sock = socket.create_connection((self._ip, self.port), self.timeout)


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host, ip, port, timeout):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self):
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self.raw_sock = self._context.wrap_socket(sock, server_hostname=self.host)


_clock = threading.local()


def _request_once(scheme, host, ip, port, path, accept):
    """One GET to a validated address. Returns (status, headers, body_bytes_up_to_cap).

    The whole request (connect, headers, body) must fit in what is left of safe_get's overall budget. A watchdog shuts
    the socket when it runs out, so a server that sends one byte at a time cannot hold the worker, and the body is
    read in chunks against the same clock."""
    budget = max(min(OVERALL_BUDGET, getattr(_clock, "deadline", time.monotonic() + OVERALL_BUDGET) - time.monotonic()), 0.1)
    conn_class = _PinnedHTTPS if scheme == "https" else _PinnedHTTP
    conn = conn_class(host, ip, port, min(TIMEOUT, max(budget, 0.1)))
    deadline = time.monotonic() + budget
    expired = threading.Event()

    def cut():
        expired.set()
        sock = getattr(conn, "raw_sock", None)  # conn.sock is dropped once the answer says Connection: close
        if sock is not None:
            try:
                sock.shutdown(socket.SHUT_RDWR)
            except OSError:
                pass
            try:
                sock.close()
            except OSError:
                pass

    watchdog = threading.Timer(max(budget, 0.1), cut)
    watchdog.daemon = True
    watchdog.start()
    try:
        conn.request("GET", path, headers={
            "User-Agent": USER_AGENT, "Accept": accept, "Accept-Encoding": "identity", "Connection": "close",
        })
        resp = conn.getresponse()
        chunks, size = [], 0
        while size < MAX_BYTES + 1:
            if time.monotonic() > deadline:
                raise socket.timeout("deadline")
            chunk = resp.read(min(8192, MAX_BYTES + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        return resp.status, {k.lower(): v for k, v in resp.getheaders()}, b"".join(chunks)
    except (OSError, http.client.HTTPException, ValueError):
        if expired.is_set():
            raise socket.timeout("deadline")
        raise
    finally:
        watchdog.cancel()
        conn.close()


def safe_get(url, accept="*/*"):
    """Fetch a URL safely. Returns (final_url, headers, body) or None on any refusal or failure."""
    deadline = time.monotonic() + OVERALL_BUDGET
    current = url
    for _hop in range(MAX_REDIRECTS + 1):
        if time.monotonic() > deadline:
            return None
        parts = urlsplit(current)
        if parts.scheme not in ("http", "https") or not parts.hostname or parts.username or parts.password:
            return None
        try:
            port = parts.port or (443 if parts.scheme == "https" else 80)
        except ValueError:
            return None
        if port not in ALLOWED_PORTS:
            return None
        ip = resolve_public(parts.hostname, port)
        if ip is None:
            return None
        path = (parts.path or "/") + (f"?{parts.query}" if parts.query else "")
        if deadline - time.monotonic() <= 0.2:
            return None
        _clock.deadline = deadline
        try:
            status, headers, body = _request_once(parts.scheme, parts.hostname, ip, port, path, accept)
        except (OSError, http.client.HTTPException, ssl.SSLError, UnicodeError):
            return None
        if status in (301, 302, 303, 307, 308):
            location = headers.get("location")
            if not location:
                return None
            current = urljoin(current, location)
            continue
        if status != 200:
            return None
        return current, headers, body
    return None  # too many redirects


# ---------------------------------------------------------------- normalising and parsing
def normalise_link(raw):
    """Turn what a person typed into a link. Returns None if it is not a safe link."""
    raw = (raw or "").strip()
    if not raw or len(raw) > 500 or re.search(r"[\x00-\x1f\x7f\s]", raw):
        return None
    if has_unsafe_scheme(raw):
        return None
    scheme = scheme_of(raw)
    if scheme in ALLOWED_SCHEMES:
        return raw
    if "." not in raw and not raw.startswith("localhost"):
        return None
    return "https://" + raw.lstrip("/")


_TITLE_RE = re.compile(r"<title[^>]*>(.*?)</title>", re.I | re.S)
_OG_TITLE_RE = re.compile(
    r"<meta[^>]+property=[\"']og:title[\"'][^>]*content=[\"']([^\"']*)[\"']", re.I
)
_LINK_TAG_RE = re.compile(r"<link\b[^>]*>", re.I)


def _decode(body, headers):
    charset = "utf-8"
    match = re.search(r"charset=([\w-]+)", headers.get("content-type", ""), re.I)
    if match:
        charset = match.group(1)
    try:
        return body.decode(charset, errors="replace")
    except LookupError:
        return body.decode("utf-8", errors="replace")


def extract_title(html):
    match = _OG_TITLE_RE.search(html) or _TITLE_RE.search(html)
    if not match:
        return None
    title = re.sub(r"[\x00-\x1f\x7f]+", " ", unescape(match.group(1)))
    title = re.sub(r"\s+", " ", title).strip()
    return title[:120] or None


def extract_icon_href(html):
    for tag in _LINK_TAG_RE.findall(html):
        rel = re.search(r"rel=[\"']([^\"']*)[\"']", tag, re.I)
        href = re.search(r"href=[\"']([^\"']*)[\"']", tag, re.I)
        if rel and href and "icon" in rel.group(1).lower() and not href.group(1).lower().endswith(".svg"):
            return unescape(href.group(1))
    return None


def _favicon_name(host):
    return f"icons/fav-{hashlib.sha1(host.encode()).hexdigest()[:16]}.png"


def _store_favicon(host, data):
    name = _favicon_name(host)
    if default_storage.exists(name):
        return name
    content = icon_from_bytes(data)
    if content is None:
        return None
    return default_storage.save(name, content)


def resolve_link(raw):
    """Return {'url', 'title', 'favicon_name'} for a pasted link. Title and favicon are None on any failure."""
    url = normalise_link(raw)
    result = {"url": url, "title": None, "favicon_name": None}
    if not url or scheme_of(url) not in ("http", "https"):
        return result
    try:
        page = safe_get(url, accept="text/html,application/xhtml+xml")
        if page is None:
            return result
        final_url, headers, body = page
        html = _decode(body[:MAX_BYTES], headers)
        result["title"] = extract_title(html)
        host = (urlsplit(final_url).hostname or "").lower()
        base = host[4:] if host.startswith("www.") else host
        if base in KNOWN_BRAND_DOMAINS or any(base.endswith("." + d) for d in KNOWN_BRAND_DOMAINS):
            return result
        if default_storage.exists(_favicon_name(host)):
            result["favicon_name"] = _favicon_name(host)  # fetched once before; never fetched again
            return result
        href = extract_icon_href(html) or "/favicon.ico"
        icon_url = urljoin(final_url, href)
        icon = safe_get(icon_url, accept="image/*")
        if icon is not None and len(icon[2]) <= MAX_BYTES:
            result["favicon_name"] = _store_favicon(host, icon[2])
    except Exception:  # never let a helper fetch break the caller
        log.exception("resolve_link failed")
    return result
