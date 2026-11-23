"""Time-based one-time passwords (RFC 6238, HMAC-SHA1, 6 digits, 30 second steps) with the standard library only."""
import base64
import hmac
import secrets
import struct
import time
from urllib.parse import quote

STEP_SECONDS = 30
DIGITS = 6
# A code is also accepted one step before or after the current one, for clocks that are a little off.
WINDOW = 1


def new_secret():
    """A random 160-bit secret as unpadded base32 (what authenticator apps expect)."""
    return base64.b32encode(secrets.token_bytes(20)).decode("ascii").rstrip("=")


def _key(secret):
    text = secret.strip().replace(" ", "").upper()
    return base64.b32decode(text + "=" * (-len(text) % 8))


def hotp(secret, counter):
    digest = hmac.new(_key(secret), struct.pack(">Q", counter), "sha1").digest()
    offset = digest[-1] & 0x0F
    number = (struct.unpack(">I", digest[offset:offset + 4])[0] & 0x7FFFFFFF) % (10 ** DIGITS)
    return str(number).zfill(DIGITS)


def counter_at(now=None):
    return int((time.time() if now is None else now) // STEP_SECONDS)


def code_at(secret, now=None):
    return hotp(secret, counter_at(now))


def verify(secret, code, now=None, last_counter=0):
    """The matching time step (a whole number) when `code` is right and was not used before, else None.

    `last_counter` is the newest step already accepted: a code from that step or an older one is refused, so a
    code that was seen once (shoulder surfing, a replayed request) cannot be used twice."""
    code = "".join(str(code or "").split())
    if len(code) != DIGITS or not code.isdigit():
        return None
    now_counter = counter_at(now)
    found = None
    for drift in range(-WINDOW, WINDOW + 1):
        step = now_counter + drift
        if hmac.compare_digest(hotp(secret, step), code) and step > last_counter:
            found = step if found is None else max(found, step)
    return found


def otpauth_uri(secret, account, issuer):
    label = f"{quote(issuer, safe='')}:{quote(account, safe='')}"
    return (
        f"otpauth://totp/{label}?secret={secret}&issuer={quote(issuer, safe='')}"
        f"&algorithm=SHA1&digits={DIGITS}&period={STEP_SECONDS}"
    )


RECOVERY_CODE_COUNT = 10


def new_recovery_codes(count=RECOVERY_CODE_COUNT):
    """Single-use recovery codes such as "a1b2c-3d4e5" (10 hex characters in two groups). Only hashes are ever stored."""
    codes = []
    for _ in range(count):
        raw = secrets.token_hex(5)
        codes.append(f"{raw[:5]}-{raw[5:]}")
    return codes


def normalise_recovery_code(code):
    """The form a recovery code is hashed in: no spaces or dashes, upper case."""
    return "".join(str(code or "").upper().split()).replace("-", "")
