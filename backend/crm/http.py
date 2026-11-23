"""Outbound calls to the CRM vendors, and nothing else.

Every call goes to an https address whose host is on the vendor's own list (`vendors.allowed_host`). The name is
looked up, every address it points to must be public, and the connection goes to the checked address, so the name
cannot change between the check and the call. Redirects are never followed, the wait is short and the answer is
capped. Tests replace `call` with a fake: no test ever reaches a vendor.
"""
import http.client
import json
import socket
from dataclasses import dataclass, field
from urllib.parse import urlencode, urlsplit

from leads import webhooks

TIMEOUT_SECONDS = 10
MAX_BODY = 1024 * 1024


class BlockedHost(Exception):
    """The address is not one of the vendor's."""


class NetworkError(Exception):
    """The vendor could not be reached (or answered too slowly)."""


@dataclass
class Result:
    status: int
    data: object = None
    headers: dict = field(default_factory=dict)


def call(method, url, host_ok, headers=None, json_body=None, form=None, params=None, timeout=None):
    """Send one request and return a Result. `host_ok(hostname)` is the vendor's allow-list."""
    parts = urlsplit(url)
    if parts.scheme != "https" or not parts.hostname or parts.username or parts.password:
        raise BlockedHost("The address must be an https address.")
    host = parts.hostname.lower()
    if not host_ok(host):
        raise BlockedHost("The address is not one of the CRM's own addresses.")
    path = parts.path or "/"
    query = parts.query
    if params:
        query = (query + "&" if query else "") + urlencode(params)
    if query:
        path += "?" + query
    try:
        _, port, ip = webhooks.check_target(f"https://{host}{':' + str(parts.port) if parts.port else ''}/")
    except webhooks.UnsafeTarget as exc:
        raise BlockedHost(str(exc))
    body, send_headers = None, {"Accept": "application/json", **(headers or {})}
    if json_body is not None:
        body = json.dumps(json_body).encode("utf-8")
        send_headers["Content-Type"] = "application/json"
    elif form is not None:
        body = urlencode(form).encode("utf-8")
        send_headers["Content-Type"] = "application/x-www-form-urlencoded"
    conn = webhooks._PinnedHTTPS(host, ip, port, timeout or TIMEOUT_SECONDS)
    try:
        conn.request(method, path, body=body, headers=send_headers)
        response = conn.getresponse()
        raw = response.read(MAX_BODY)
        data = None
        if raw:
            try:
                data = json.loads(raw.decode("utf-8", "replace"))
            except ValueError:
                data = {"raw": raw[:300].decode("utf-8", "replace")}
        return Result(response.status, data, {k.lower(): v for k, v in response.getheaders()})
    except (OSError, http.client.HTTPException, socket.timeout) as exc:
        raise NetworkError(type(exc).__name__)
    finally:
        conn.close()
