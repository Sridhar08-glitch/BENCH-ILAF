"""Encryption of CRM tokens at rest.

Tokens are stored as text that starts with a version tag:
  f1:  Fernet (the `cryptography` package), used when that package is installed;
  h1:  a standard-library construction: a keystream made with HMAC-SHA256 in counter mode, a random 16-byte
       nonce, and an HMAC-SHA256 tag over version, nonce and ciphertext (encrypt-then-MAC). A wrong key or a
       changed value fails the tag check and raises `CannotDecrypt`.
Both read either tag, so a server that later gains (or loses) the package still opens old values written with h1.
The keys are derived from the CRM_ENCRYPTION_KEY setting (the SECRET_KEY when that is empty, which is only for
development): changing it makes every stored token unreadable and the connections ask to be connected again.
Tokens are never logged.
"""
import base64
import hashlib
import hmac
import secrets

from django.conf import settings

try:  # pragma: no cover - depends on the installed packages
    from cryptography.fernet import Fernet, InvalidToken
except ImportError:  # pragma: no cover
    Fernet = None
    InvalidToken = Exception


class CannotDecrypt(Exception):
    pass


def _master():
    value = getattr(settings, "CRM_ENCRYPTION_KEY", "") or settings.SECRET_KEY
    return value.encode("utf-8")


def _derive(label):
    return hmac.new(_master(), b"crm-token-v1:" + label, hashlib.sha256).digest()


def _keystream(key, nonce, length):
    out = b""
    counter = 0
    while len(out) < length:
        out += hmac.new(key, nonce + counter.to_bytes(8, "big"), hashlib.sha256).digest()
        counter += 1
    return out[:length]


def _encrypt_h1(plain):
    nonce = secrets.token_bytes(16)
    data = plain.encode("utf-8")
    cipher = bytes(a ^ b for a, b in zip(data, _keystream(_derive(b"enc"), nonce, len(data))))
    tag = hmac.new(_derive(b"mac"), b"h1" + nonce + cipher, hashlib.sha256).digest()
    return "h1:" + base64.urlsafe_b64encode(nonce + cipher + tag).decode("ascii")


def _decrypt_h1(body):
    try:
        raw = base64.urlsafe_b64decode(body.encode("ascii"))
    except Exception:
        raise CannotDecrypt("The stored value is damaged.")
    if len(raw) < 16 + 32:
        raise CannotDecrypt("The stored value is damaged.")
    nonce, cipher, tag = raw[:16], raw[16:-32], raw[-32:]
    expected = hmac.new(_derive(b"mac"), b"h1" + nonce + cipher, hashlib.sha256).digest()
    if not hmac.compare_digest(tag, expected):
        raise CannotDecrypt("The encryption key changed or the value was altered.")
    data = bytes(a ^ b for a, b in zip(cipher, _keystream(_derive(b"enc"), nonce, len(cipher))))
    return data.decode("utf-8")


def _fernet():
    return Fernet(base64.urlsafe_b64encode(_derive(b"fernet")))


def encrypt(plain):
    if not plain:
        return ""
    if Fernet is not None:  # pragma: no cover
        return "f1:" + _fernet().encrypt(plain.encode("utf-8")).decode("ascii")
    return _encrypt_h1(plain)


def decrypt(value):
    if not value:
        return ""
    if value.startswith("h1:"):
        return _decrypt_h1(value[3:])
    if value.startswith("f1:"):
        if Fernet is None:  # pragma: no cover
            raise CannotDecrypt("This value needs the cryptography package.")
        try:  # pragma: no cover
            return _fernet().decrypt(value[3:].encode("ascii")).decode("utf-8")
        except InvalidToken:  # pragma: no cover
            raise CannotDecrypt("The encryption key changed or the value was altered.")
    raise CannotDecrypt("Unknown format.")
