"""The only place that talks to Google for Wallet passes.

Two fixed https hosts are allowed (the token service and the Wallet API); nothing else can be reached. The
transport is the same checked one the CRM connectors use (public addresses only, no redirects, short wait, capped
answer). `send` is the single injectable function: tests replace it with a fake, so no test ever reaches Google.
The access token is kept in memory only and is never written to a log or a file.
"""
import time

from django.conf import settings

from crm import http as transport
from ilaf import rsa

TOKEN_URL = "https://oauth2.googleapis.com/token"
API_BASE = "https://walletobjects.googleapis.com/walletobjects/v1/"
SCOPE = "https://www.googleapis.com/auth/wallet_object.issuer"
ALLOWED_HOSTS = frozenset({"oauth2.googleapis.com", "walletobjects.googleapis.com"})
TOKEN_LIFETIME = 3600
REFRESH_MARGIN = 300


class WalletApiError(Exception):
    """A call to Google failed. `status` is 0 when Google could not be reached. The text never holds a secret."""

    def __init__(self, status, message):
        super().__init__(message)
        self.status = status
        self.message = message

    @property
    def retryable(self):
        return self.status == 0 or self.status == 429 or self.status >= 500


def host_ok(host):
    return host in ALLOWED_HOSTS


def _default_send(method, url, headers=None, json_body=None, form=None):
    """Return (status, data). Raises WalletApiError(0, ...) when Google cannot be reached."""
    try:
        result = transport.call(
            method, url, host_ok, headers=headers, json_body=json_body, form=form,
            timeout=settings.GOOGLE_WALLET_REST_TIMEOUT,
        )
    except transport.BlockedHost:
        raise WalletApiError(0, "The address is not one of Google's.")
    except transport.NetworkError as exc:
        raise WalletApiError(0, f"Google could not be reached ({exc}).")
    return result.status, result.data


# Replaced by tests: send(method, url, headers=None, json_body=None, form=None) -> (status, data).
send = _default_send

_token = {"value": "", "expires": 0.0, "who": ""}


def clear_token():
    _token.update(value="", expires=0.0, who="")


def error_text(status, data):
    """A short readable reason from a Google error answer (its message only, never a header or a token)."""
    message = ""
    if isinstance(data, dict):
        err = data.get("error")
        if isinstance(err, dict):
            message = str(err.get("message") or err.get("status") or "")
        elif isinstance(err, str):
            message = err + (": " + str(data.get("error_description")) if data.get("error_description") else "")
    return f"Google answered {status}" + (f": {message}" if message else "")[:260]


def access_token(email, key, now=None):
    """A Wallet API access token for the service account; reused until shortly before it expires."""
    now = time.time() if now is None else now
    if _token["value"] and _token["who"] == email and now < _token["expires"] - REFRESH_MARGIN:
        return _token["value"]
    claims = {"iss": email, "scope": SCOPE, "aud": TOKEN_URL, "iat": int(now), "exp": int(now) + TOKEN_LIFETIME}
    assertion = rsa.jwt_encode_rs256(claims, key)
    status, data = send("POST", TOKEN_URL, form={
        "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": assertion,
    })
    token = data.get("access_token") if isinstance(data, dict) else None
    if status != 200 or not token:
        raise WalletApiError(status, "The Google sign-in failed. " + error_text(status, data))
    lifetime = data.get("expires_in") if isinstance(data.get("expires_in"), int) else TOKEN_LIFETIME
    _token.update(value=str(token), expires=now + lifetime, who=email)
    return _token["value"]


def api(method, path, email, key, body=None, now=None):
    """One Wallet API call. Returns (status, data); the caller decides what 404 or 409 mean."""
    token = access_token(email, key, now)
    status, data = send(method, API_BASE + path, headers={"Authorization": f"Bearer {token}"}, json_body=body)
    if status == 401:
        # The token may have been revoked early: get a new one and try once more.
        clear_token()
        token = access_token(email, key, now)
        status, data = send(method, API_BASE + path, headers={"Authorization": f"Bearer {token}"}, json_body=body)
    return status, data
