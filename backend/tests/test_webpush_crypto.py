"""The hand-written crypto behind Web Push, checked against published test vectors."""
import json

from django.test import SimpleTestCase

from notify import webpush


class PrimitiveTests(SimpleTestCase):
    def test_aes_128_block_matches_fips_197(self):
        key = bytes(range(16))
        block = bytes.fromhex("00112233445566778899aabbccddeeff")
        self.assertEqual(webpush.aes_encrypt_block(webpush._expand_key(key), block).hex(), "69c4e0d86a7b0430d8cdb78070b4c55a")

    def test_aes_gcm_matches_the_gcm_specification_cases(self):
        # Test case 2: zero key, zero nonce, one zero block.
        sealed = webpush.aes_gcm_encrypt(bytes(16), bytes(12), bytes(16))
        self.assertEqual(sealed[:16].hex(), "0388dace60b6a392f328c2b971b2fe78")
        self.assertEqual(sealed[16:].hex(), "ab6e47d42cec13bdf53a67b21257bddf")
        # Test case 1: empty plaintext gives only the tag.
        self.assertEqual(webpush.aes_gcm_encrypt(bytes(16), bytes(12), b"").hex(), "58e2fccefa7e3061367f1d57a4e7455a")

    def test_p256_order_and_public_key_of_one(self):
        self.assertIsNone(webpush.point_mul(webpush.N, webpush.G))
        self.assertTrue(webpush.on_curve(webpush.G))
        self.assertEqual(webpush.decode_point(webpush.public_key(1)), webpush.G)

    def test_a_point_off_the_curve_is_refused(self):
        bad = b"\x04" + (1).to_bytes(32, "big") + (1).to_bytes(32, "big")
        with self.assertRaises(ValueError):
            webpush.decode_point(bad)

    def test_ecdsa_round_trip_and_tamper(self):
        d = webpush.new_private_key()
        public = webpush.public_key(d)
        signature = webpush.ecdsa_sign(d, b"hello")
        self.assertTrue(webpush.ecdsa_verify(public, b"hello", signature))
        self.assertFalse(webpush.ecdsa_verify(public, b"hullo", signature))

    def test_ecdh_agrees_from_both_sides(self):
        a, b = webpush.new_private_key(), webpush.new_private_key()
        self.assertEqual(webpush.ecdh(a, webpush.public_key(b)), webpush.ecdh(b, webpush.public_key(a)))


class Rfc8291Tests(SimpleTestCase):
    """RFC 8291, appendix A."""

    AS_PRIVATE = "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw"
    AS_PUBLIC = "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8"
    UA_PUBLIC = "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4"
    AUTH = "BTBZMqHH6r4Tts7J_aSIgg"
    SALT = "DGv6ra1nlYgDCS1FRnbzlw"
    BODY = (
        "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN"
    )

    def test_the_sender_key_belongs_to_the_sender_private_key(self):
        d = int.from_bytes(webpush.b64d(self.AS_PRIVATE), "big")
        self.assertEqual(webpush.b64e(webpush.public_key(d)), self.AS_PUBLIC)

    def test_encrypt_matches_the_rfc_message(self):
        body = webpush.encrypt_message(
            b"When I grow up, I want to be a watermelon", webpush.b64d(self.UA_PUBLIC), webpush.b64d(self.AUTH),
            as_private=int.from_bytes(webpush.b64d(self.AS_PRIVATE), "big"), salt=webpush.b64d(self.SALT),
        )
        self.assertEqual(webpush.b64e(body), self.BODY)

    def test_a_message_that_is_too_long_is_refused(self):
        with self.assertRaises(ValueError):
            webpush.encrypt_message(b"x" * 5000, webpush.b64d(self.UA_PUBLIC), webpush.b64d(self.AUTH))


class VapidTests(SimpleTestCase):
    def test_header_carries_a_valid_es256_token(self):
        private, public = webpush.generate_vapid_keys()
        self.assertTrue(webpush.keys_match(private, public))
        header = webpush.vapid_headers("https://fcm.googleapis.com/fcm/send/abc", private, "mailto:a@example.com", now=1000)
        token = header.split("t=")[1].split(",")[0]
        head, claims, signature = token.split(".")
        self.assertEqual(json.loads(webpush.b64d(head)), {"typ": "JWT", "alg": "ES256"})
        payload = json.loads(webpush.b64d(claims))
        self.assertEqual(payload["aud"], "https://fcm.googleapis.com")
        self.assertEqual(payload["sub"], "mailto:a@example.com")
        self.assertEqual(payload["exp"], 1000 + 12 * 3600)
        self.assertTrue(webpush.ecdsa_verify(webpush.b64d(public), f"{head}.{claims}".encode(), webpush.b64d(signature)))
        self.assertTrue(header.endswith("k=" + public))
