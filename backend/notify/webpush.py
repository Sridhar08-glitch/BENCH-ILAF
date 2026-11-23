"""Web Push without third-party packages: VAPID (RFC 8292, ES256 JWT) and message encryption (RFC 8291, aes128gcm).

The server holds no `cryptography` package, so the three primitives it needs are written out here in plain Python:
P-256 (ECDH and ECDSA), HKDF-SHA256 and AES-128-GCM. They only ever handle a few hundred bytes per notification, so
speed does not matter. The tests check them against the published test vectors (FIPS-197, the GCM specification and
RFC 8291 appendix A). If the `cryptography` package is installed later, nothing changes: this module keeps working.

`send_push` is the one function the rest of the app calls; the HTTP part is a replaceable `transport`."""
import base64
import hashlib
import hmac
import json
import secrets
import struct
import time
from urllib.parse import urlsplit

# ---------------------------------------------------------------- base64url
def b64e(data):
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64d(text):
    text = str(text).strip()
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


# ---------------------------------------------------------------- P-256
P = 0xFFFFFFFF00000001000000000000000000000000FFFFFFFFFFFFFFFFFFFFFFFF
A = P - 3
B = 0x5AC635D8AA3A93E7B3EBBD55769886BC651D06B0CC53B0F63BCE3C3E27D2604B
N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551
G = (
    0x6B17D1F2E12C4247F8BCE6E563A440F277037D812DEB33A0F4A13945D898C296,
    0x4FE342E2FE1A7F9B8EE7EB4A7C0F9E162BCE33576B315ECECBB6406837BF51F5,
)


def _add(p1, p2):
    if p1 is None:
        return p2
    if p2 is None:
        return p1
    x1, y1 = p1
    x2, y2 = p2
    if x1 == x2:
        if (y1 + y2) % P == 0:
            return None
        slope = (3 * x1 * x1 + A) * pow(2 * y1, -1, P) % P
    else:
        slope = (y2 - y1) * pow(x2 - x1, -1, P) % P
    x3 = (slope * slope - x1 - x2) % P
    return x3, (slope * (x1 - x3) - y1) % P


def point_mul(k, point):
    result = None
    addend = point
    while k:
        if k & 1:
            result = _add(result, addend)
        addend = _add(addend, addend)
        k >>= 1
    return result


def on_curve(point):
    if point is None:
        return False
    x, y = point
    return 0 <= x < P and 0 <= y < P and (y * y - (x * x * x + A * x + B)) % P == 0


def encode_point(point):
    return b"\x04" + point[0].to_bytes(32, "big") + point[1].to_bytes(32, "big")


def decode_point(data):
    """A public key from its 65-byte uncompressed form. Refuses anything that is not a point on the curve."""
    if len(data) != 65 or data[0] != 4:
        raise ValueError("not an uncompressed P-256 point")
    point = (int.from_bytes(data[1:33], "big"), int.from_bytes(data[33:], "big"))
    if not on_curve(point):
        raise ValueError("point is not on the curve")
    return point


def new_private_key():
    while True:
        d = secrets.randbelow(N)
        if d:
            return d


def public_key(d):
    return encode_point(point_mul(d, G))


def ecdh(d, peer_public):
    shared = point_mul(d, decode_point(peer_public))
    if shared is None:
        raise ValueError("invalid shared point")
    return shared[0].to_bytes(32, "big")


def ecdsa_sign(d, message):
    """ES256: the 64-byte r||s signature of SHA-256(message)."""
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    while True:
        k = new_private_key()
        r = point_mul(k, G)[0] % N
        if r == 0:
            continue
        s = pow(k, -1, N) * (z + r * d) % N
        if s:
            return r.to_bytes(32, "big") + s.to_bytes(32, "big")


def ecdsa_verify(public, message, signature):
    if len(signature) != 64:
        return False
    r, s = int.from_bytes(signature[:32], "big"), int.from_bytes(signature[32:], "big")
    if not (0 < r < N and 0 < s < N):
        return False
    z = int.from_bytes(hashlib.sha256(message).digest(), "big")
    w = pow(s, -1, N)
    point = _add(point_mul(z * w % N, G), point_mul(r * w % N, decode_point(public)))
    return point is not None and point[0] % N == r


# ---------------------------------------------------------------- HKDF
def hkdf(salt, ikm, info, length):
    prk = hmac.new(salt, ikm, hashlib.sha256).digest()
    out, block, counter = b"", b"", 1
    while len(out) < length:
        block = hmac.new(prk, block + info + bytes([counter]), hashlib.sha256).digest()
        out += block
        counter += 1
    return out[:length]


# ---------------------------------------------------------------- AES-128-GCM
def _make_sbox():
    sbox = [0] * 256
    p = q = 1
    while True:
        p = (p ^ (p << 1) ^ (0x11B if p & 0x80 else 0)) & 0xFF
        q = (q ^ (q << 1)) & 0xFF
        q = (q ^ (q << 2)) & 0xFF
        q = (q ^ (q << 4)) & 0xFF
        if q & 0x80:
            q ^= 0x09

        def rotl(value, shift):
            return ((value << shift) | (value >> (8 - shift))) & 0xFF

        sbox[p] = q ^ rotl(q, 1) ^ rotl(q, 2) ^ rotl(q, 3) ^ rotl(q, 4) ^ 0x63
        if p == 1:
            break
    sbox[0] = 0x63
    return sbox


_SBOX = _make_sbox()
_RCON = (1, 2, 4, 8, 16, 32, 64, 128, 27, 54)


def _xtime(value):
    value <<= 1
    return (value ^ 0x11B) & 0xFF if value & 0x100 else value


def _expand_key(key):
    if len(key) != 16:
        raise ValueError("AES-128 needs a 16-byte key")
    words = [list(key[i:i + 4]) for i in range(0, 16, 4)]
    for i in range(4, 44):
        word = list(words[i - 1])
        if i % 4 == 0:
            word = word[1:] + word[:1]
            word = [_SBOX[b] for b in word]
            word[0] ^= _RCON[i // 4 - 1]
        words.append([a ^ b for a, b in zip(words[i - 4], word)])
    return [sum(words[r * 4:r * 4 + 4], []) for r in range(11)]


def aes_encrypt_block(round_keys, block):
    state = [b ^ k for b, k in zip(block, round_keys[0])]
    for rnd in range(1, 11):
        state = [_SBOX[b] for b in state]
        state = [state[4 * ((c + r) % 4) + r] for c in range(4) for r in range(4)]  # shift rows
        if rnd != 10:
            mixed = []
            for c in range(4):
                a0, a1, a2, a3 = state[4 * c:4 * c + 4]
                mixed += [
                    _xtime(a0) ^ _xtime(a1) ^ a1 ^ a2 ^ a3,
                    a0 ^ _xtime(a1) ^ _xtime(a2) ^ a2 ^ a3,
                    a0 ^ a1 ^ _xtime(a2) ^ _xtime(a3) ^ a3,
                    _xtime(a0) ^ a0 ^ a1 ^ a2 ^ _xtime(a3),
                ]
            state = mixed
        state = [b ^ k for b, k in zip(state, round_keys[rnd])]
    return bytes(state)


_GCM_R = 0xE1 << 120


def _gf_mul(x, y):
    z, v = 0, y
    for i in range(127, -1, -1):
        if (x >> i) & 1:
            z ^= v
        v = (v >> 1) ^ _GCM_R if v & 1 else v >> 1
    return z


def _ghash(h, data):
    y = 0
    for i in range(0, len(data), 16):
        block = data[i:i + 16].ljust(16, b"\0")
        y = _gf_mul(y ^ int.from_bytes(block, "big"), h)
    return y


def aes_gcm_encrypt(key, nonce, plaintext, aad=b""):
    """ciphertext || 16-byte tag (96-bit nonce)."""
    if len(nonce) != 12:
        raise ValueError("the nonce must be 12 bytes")
    round_keys = _expand_key(key)
    h = int.from_bytes(aes_encrypt_block(round_keys, bytes(16)), "big")
    out = bytearray()
    for index in range(0, len(plaintext), 16):
        counter = nonce + struct.pack(">I", index // 16 + 2)
        stream = aes_encrypt_block(round_keys, counter)
        out += bytes(a ^ b for a, b in zip(plaintext[index:index + 16], stream))
    lengths = struct.pack(">QQ", len(aad) * 8, len(out) * 8)
    padded = lambda data: data + bytes(-len(data) % 16)  # noqa: E731
    tag_mask = int.from_bytes(aes_encrypt_block(round_keys, nonce + struct.pack(">I", 1)), "big")
    tag = _ghash(h, padded(aad) + padded(bytes(out)) + lengths) ^ tag_mask
    return bytes(out) + tag.to_bytes(16, "big")


# ---------------------------------------------------------------- RFC 8291 message encryption
RECORD_SIZE = 4096


def encrypt_message(plaintext, ua_public, auth_secret, as_private=None, salt=None):
    """The aes128gcm body for one push message (RFC 8291). `ua_public` is the browser's 65-byte key and `auth_secret`
    its 16-byte secret. `as_private` and `salt` are only given by the tests."""
    if len(plaintext) > RECORD_SIZE - 17 - 1:
        raise ValueError("a push message must fit in one record (about 4000 bytes)")
    if len(auth_secret) != 16:
        raise ValueError("the auth secret must be 16 bytes")
    as_private = as_private or new_private_key()
    salt = salt or secrets.token_bytes(16)
    as_public = public_key(as_private)
    secret = ecdh(as_private, ua_public)
    ikm = hkdf(auth_secret, secret, b"WebPush: info\0" + ua_public + as_public, 32)
    cek = hkdf(salt, ikm, b"Content-Encoding: aes128gcm\0", 16)
    nonce = hkdf(salt, ikm, b"Content-Encoding: nonce\0", 12)
    sealed = aes_gcm_encrypt(cek, nonce, plaintext + b"\x02")
    return salt + struct.pack(">IB", RECORD_SIZE, len(as_public)) + as_public + sealed


# ---------------------------------------------------------------- VAPID (RFC 8292)
def vapid_headers(endpoint, private_b64, subject, now=None):
    """The Authorization header value for a push to `endpoint`: a signed JWT plus the public key."""
    parts = urlsplit(endpoint)
    audience = f"{parts.scheme}://{parts.netloc}"
    d = int.from_bytes(b64d(private_b64), "big")
    header = b64e(json.dumps({"typ": "JWT", "alg": "ES256"}, separators=(",", ":")).encode())
    claims = b64e(json.dumps(
        {"aud": audience, "exp": int((now or time.time()) + 12 * 3600), "sub": subject}, separators=(",", ":")
    ).encode())
    signing_input = f"{header}.{claims}".encode("ascii")
    token = f"{header}.{claims}.{b64e(ecdsa_sign(d, signing_input))}"
    return f"vapid t={token}, k={b64e(public_key(d))}"


def generate_vapid_keys():
    """(private, public) as the unpadded base64url strings that go into the .env file."""
    d = new_private_key()
    return b64e(d.to_bytes(32, "big")), b64e(public_key(d))


def keys_match(private_b64, public_b64):
    try:
        return b64d(public_b64) == public_key(int.from_bytes(b64d(private_b64), "big"))
    except Exception:
        return False
