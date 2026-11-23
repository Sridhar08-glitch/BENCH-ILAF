"""RSA signatures (RS256) with the standard library only.

Two jobs need RSA here: checking the signature of a Google ID token (public key from Google's key
set) and signing the Google Wallet "save" link (private key of a service account). Both use
RSASSA-PKCS1-v1_5 with SHA-256, so this small module covers them without a native crypto package.
If a deployment prefers the `cryptography` package, only `sign` and `verify` need swapping.
"""
import base64
import hashlib
import hmac
import json

# DER prefix of a SHA-256 DigestInfo (RFC 8017, section 9.2).
_SHA256_PREFIX = bytes.fromhex("3031300d060960864801650304020105000420")
MIN_VERIFY_BITS = 2048


class RsaError(Exception):
    """A key could not be read or a signature is not valid."""


def b64url_encode(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(text):
    text = text.strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---------------------------------------------------------------- DER reading

def _read_tlv(der, pos):
    """Return (tag, value_start, value_end) of the element at `pos`."""
    if pos + 2 > len(der):
        raise RsaError("The key is truncated.")
    tag = der[pos]
    length = der[pos + 1]
    pos += 2
    if length & 0x80:
        count = length & 0x7F
        if count == 0 or count > 4 or pos + count > len(der):
            raise RsaError("The key has an invalid length.")
        length = int.from_bytes(der[pos:pos + count], "big")
        pos += count
    end = pos + length
    if end > len(der):
        raise RsaError("The key is truncated.")
    return tag, pos, end


def _read_sequence_items(der, start, end):
    items = []
    pos = start
    while pos < end:
        tag, vs, ve = _read_tlv(der, pos)
        items.append((tag, vs, ve))
        pos = ve
    return items


def _int(der, item):
    tag, vs, ve = item
    if tag != 0x02:
        raise RsaError("The key is not a valid RSA key.")
    return int.from_bytes(der[vs:ve], "big")


class PublicKey:
    def __init__(self, n, e):
        self.n = n
        self.e = e

    @property
    def bits(self):
        return self.n.bit_length()

    @classmethod
    def from_jwk(cls, jwk):
        try:
            if jwk.get("kty") != "RSA":
                raise RsaError("Not an RSA key.")
            return cls(int.from_bytes(b64url_decode(jwk["n"]), "big"), int.from_bytes(b64url_decode(jwk["e"]), "big"))
        except (KeyError, ValueError, TypeError) as exc:
            raise RsaError("The key could not be read.") from exc


class PrivateKey(PublicKey):
    def __init__(self, n, e, d, p=None, q=None, dp=None, dq=None, qinv=None):
        super().__init__(n, e)
        self.d, self.p, self.q, self.dp, self.dq, self.qinv = d, p, q, dp, dq, qinv

    @classmethod
    def from_pem(cls, pem):
        """Read a PKCS#8 ("BEGIN PRIVATE KEY") or PKCS#1 ("BEGIN RSA PRIVATE KEY") PEM text."""
        if isinstance(pem, bytes):
            pem = pem.decode("utf-8", "replace")
        lines = [ln.strip() for ln in pem.strip().splitlines()]
        if not lines or not lines[0].startswith("-----BEGIN") or "ENCRYPTED" in lines[0]:
            raise RsaError("The private key must be an unencrypted PEM key.")
        body = "".join(ln for ln in lines if ln and not ln.startswith("-----"))
        try:
            der = base64.b64decode(body)
        except ValueError as exc:
            raise RsaError("The private key is not valid base64.") from exc
        pkcs8 = "RSA PRIVATE KEY" not in lines[0]
        tag, vs, ve = _read_tlv(der, 0)
        if tag != 0x30:
            raise RsaError("The private key is not valid.")
        items = _read_sequence_items(der, vs, ve)
        if pkcs8:
            # SEQUENCE { version, SEQUENCE { algorithm, params }, OCTET STRING { RSAPrivateKey } }
            if len(items) < 3 or items[2][0] != 0x04:
                raise RsaError("The private key is not valid.")
            _, os_start, os_end = items[2]
            tag, vs, ve = _read_tlv(der, os_start)
            items = _read_sequence_items(der, vs, ve)
        if len(items) < 9:
            raise RsaError("The private key is not an RSA key.")
        # version, n, e, d, p, q, dp, dq, qinv
        n, e, d, p, q, dp, dq, qinv = (_int(der, items[i]) for i in range(1, 9))
        if p * q != n:
            raise RsaError("The private key is damaged.")
        return cls(n, e, d, p, q, dp, dq, qinv)

    def public(self):
        return PublicKey(self.n, self.e)


def _encode_message(message, size):
    digest = hashlib.sha256(message).digest()
    info = _SHA256_PREFIX + digest
    if size < len(info) + 11:
        raise RsaError("The key is too short.")
    return b"\x00\x01" + b"\xff" * (size - len(info) - 3) + b"\x00" + info


def sign(message, key):
    """RSASSA-PKCS1-v1_5 / SHA-256 signature of `message` (bytes)."""
    size = (key.n.bit_length() + 7) // 8
    m = int.from_bytes(_encode_message(message, size), "big")
    if key.p and key.q and key.dp is not None:
        m1 = pow(m, key.dp, key.p)
        m2 = pow(m, key.dq, key.q)
        h = (key.qinv * (m1 - m2)) % key.p
        s = m2 + h * key.q
    else:
        s = pow(m, key.d, key.n)
    return s.to_bytes(size, "big")


def verify(message, signature, key):
    """True when `signature` is a valid RS256 signature of `message` under the public key."""
    if key.bits < MIN_VERIFY_BITS:
        return False
    size = (key.n.bit_length() + 7) // 8
    if len(signature) != size:
        return False
    s = int.from_bytes(signature, "big")
    if s >= key.n:
        return False
    recovered = pow(s, key.e, key.n).to_bytes(size, "big")
    return hmac.compare_digest(recovered, _encode_message(message, size))


# ---------------------------------------------------------------- compact JWS (RS256)

def _json_part(value):
    return b64url_encode(json.dumps(value, separators=(",", ":"), sort_keys=True).encode("utf-8"))


def jwt_encode_rs256(claims, key, headers=None):
    header = {"alg": "RS256", "typ": "JWT", **(headers or {})}
    signing_input = f"{_json_part(header)}.{_json_part(claims)}"
    return f"{signing_input}.{b64url_encode(sign(signing_input.encode('ascii'), key))}"


def jwt_split(token):
    """Return (header, claims, signing_input, signature) of a compact JWT without checking anything."""
    try:
        head, body, sig = token.split(".")
        header = json.loads(b64url_decode(head))
        claims = json.loads(b64url_decode(body))
        signature = b64url_decode(sig)
    except (ValueError, TypeError, json.JSONDecodeError) as exc:
        raise RsaError("The token is not a valid JWT.") from exc
    if not isinstance(header, dict) or not isinstance(claims, dict):
        raise RsaError("The token is not a valid JWT.")
    return header, claims, f"{head}.{body}".encode("ascii"), signature
