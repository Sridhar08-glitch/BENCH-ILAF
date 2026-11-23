"""Checking a Google ID token ("Sign in with Google").

The browser gets a signed token from Google Identity Services and sends it here. It is checked
against Google's public keys (RS256), the client id of this product and the usual time limits.
No client secret is involved: the ID-token flow needs only the public client id.

`fetch_jwks` is the only function that talks to the network, so tests replace it.
"""
import json
import re
import time
import urllib.request

from django.conf import settings
from django.core.cache import cache

from ilaf import rsa
from ilaf.errors import ApiError

ISSUERS = ("accounts.google.com", "https://accounts.google.com")
CACHE_KEY = "google_jwks_v1"
LEEWAY_SECONDS = 60


def is_configured():
    return bool(settings.GOOGLE_CLIENT_ID)


def invalid(message="We could not verify your Google sign-in. Please try again."):
    return ApiError("google_token_invalid", message, 401)


def fetch_jwks():
    """Download Google's signing keys. Returns (keys list, seconds the answer may be cached)."""
    request = urllib.request.Request(settings.GOOGLE_JWKS_URL, headers={"Accept": "application/json"})
    with urllib.request.urlopen(request, timeout=5) as response:  # noqa: S310 - fixed https URL from settings
        body = json.loads(response.read().decode("utf-8"))
        match = re.search(r"max-age=(\d+)", response.headers.get("Cache-Control", ""))
    max_age = int(match.group(1)) if match else 3600
    return list(body.get("keys", [])), max_age


def get_keys(force=False):
    keys = None if force else cache.get(CACHE_KEY)
    if keys is None:
        try:
            keys, max_age = fetch_jwks()
        except Exception:  # network down, bad JSON, DNS: the sign-in cannot be checked right now
            raise ApiError("google_unavailable", "Google sign-in is not reachable right now. Please try again.", 503)
        cache.set(CACHE_KEY, keys, max(60, min(max_age, 24 * 3600)))
    return keys


def _key_for(kid):
    for force in (False, True):  # a key that is not cached yet may be a freshly rotated one
        for jwk in get_keys(force):
            if jwk.get("kid") == kid:
                return rsa.PublicKey.from_jwk(jwk)
    return None


def verify_id_token(token, max_age=None, now=None):
    """Return the verified claims of a Google ID token or raise an ApiError.

    `max_age` (seconds) additionally demands a recently issued token, used to confirm a sensitive action.
    """
    if not is_configured():
        raise ApiError("google_not_configured", "Sign in with Google is not set up on this server.", 503)
    if not isinstance(token, str) or not token or len(token) > 6000:
        raise invalid()
    try:
        header, claims, signing_input, signature = rsa.jwt_split(token)
    except rsa.RsaError:
        raise invalid()
    if header.get("alg") != "RS256" or not header.get("kid"):
        raise invalid()
    try:
        key = _key_for(header["kid"])
    except rsa.RsaError:
        key = None
    if key is None or not rsa.verify(signing_input, signature, key):
        raise invalid()

    now = int(now if now is not None else time.time())
    if claims.get("iss") not in ISSUERS:
        raise invalid()
    audience = claims.get("aud")
    audiences = audience if isinstance(audience, list) else [audience]
    if settings.GOOGLE_CLIENT_ID not in audiences:
        raise invalid("This Google sign-in was not made for this app.")
    try:
        exp = int(claims.get("exp", 0))
        iat = int(claims.get("iat", 0))
    except (TypeError, ValueError):
        raise invalid()
    if exp + LEEWAY_SECONDS < now:
        raise invalid("This Google sign-in has expired. Please try again.")
    if iat - LEEWAY_SECONDS > now:
        raise invalid()
    if max_age is not None and now - iat > max_age:
        raise invalid("Please sign in with Google again to confirm this.")
    sub = str(claims.get("sub") or "")
    email = str(claims.get("email") or "").strip().lower()
    if not sub or not email:
        raise invalid()
    if claims.get("email_verified") not in (True, "true"):
        raise ApiError(
            "google_email_unverified", "Your Google account has no verified email address, so it cannot be used here.", 403
        )
    return {
        "sub": sub, "email": email, "name": str(claims.get("name") or "").strip()[:120],
        "picture": claims.get("picture"), "iat": iat,
    }
