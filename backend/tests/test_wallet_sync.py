"""Google Wallet pass storage and updates through the REST API, with a fake Google (no test reaches the network)."""
import io
import json
from datetime import timedelta
from unittest import mock
from urllib.parse import unquote

from django.core.management import call_command
from django.test import SimpleTestCase, override_settings
from django.utils import timezone

from ilaf import rsa
from wallet import client, passes, sync
from wallet.models import WalletPass

from .base import API, ApiTestCase, png_upload
from .keys import KEY_ONE
from .test_wallet import ISSUER, PUBLIC, SA_EMAIL, WALLET, decode

TOKEN = "ya29.secret-access-token-value"


class FakeGoogle:
    """Stands in for client.send. `script` maps "METHOD kind" to a list of answers used first, e.g. {"PATCH object": [500]}."""

    def __init__(self):
        self.calls = []
        self.classes = set()
        self.objects = {}
        self.script = {}

    def __call__(self, method, url, headers=None, json_body=None, form=None):
        kind = "token" if url == client.TOKEN_URL else ("class" if "genericClass" in url else "object")
        self.calls.append({"method": method, "url": url, "kind": kind, "headers": headers or {}, "json": json_body, "form": form})
        queued = self.script.get(f"{method} {kind}")
        if queued:
            answer = queued.pop(0)
            if isinstance(answer, Exception):
                raise answer
            return answer, {"error": {"message": f"scripted {answer}"}}
        if kind == "token":
            return 200, {"access_token": TOKEN, "expires_in": 3600, "token_type": "Bearer"}
        if kind == "class":
            if method == "GET":
                return (200, {}) if unquote(url.rsplit("/", 1)[1]) in self.classes else (404, {"error": {"message": "no class"}})
            self.classes.add(json_body["id"])
            return 200, json_body
        if method == "POST":
            if json_body["id"] in self.objects:
                return 409, {"error": {"message": "exists"}}
            self.objects[json_body["id"]] = json_body
            return 200, json_body
        object_id = unquote(url.rsplit("/", 1)[1])
        if object_id not in self.objects:
            return 404, {"error": {"message": "no object"}}
        self.objects[object_id].update(json_body)
        return 200, self.objects[object_id]

    def of(self, method, kind):
        return [c for c in self.calls if c["method"] == method and c["kind"] == kind]


@override_settings(**WALLET, GOOGLE_WALLET_REST_UPDATES=True)
class RestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        passes._key_cache.clear()
        client.clear_token()
        sync._class_ready.clear()
        self.google = FakeGoogle()
        patcher = mock.patch.object(client, "send", self.google)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.alice = self.signup("alice@example.com", "Alice Anderson")
        self.buy(self.alice)
        self.card = self.published_card(self.alice, name="Alice Anderson", title="Designer", company="Studio North")

    def link(self, card=None):
        card = card or self.card
        return self.alice.client.get(f"{API}cards/{card['id']}/wallet/google")

    def run_job(self, **options):
        out = io.StringIO()
        call_command("sync_wallet_passes", stdout=out, **options)
        return out.getvalue()

    def make_due(self):
        WalletPass.objects.update(next_try_at=timezone.now() - timedelta(minutes=1))

    def row(self):
        return WalletPass.objects.get(object_id=f"{ISSUER}.{self.card['public_code']}")


class TokenTests(RestCase):
    def test_token_request_shape_and_signature(self):
        email, key = passes.load_service_account()
        self.assertEqual(client.access_token(email, key, now=1_800_000_000), TOKEN)
        call = self.google.calls[0]
        self.assertEqual((call["method"], call["url"]), ("POST", "https://oauth2.googleapis.com/token"))
        self.assertEqual(call["form"]["grant_type"], "urn:ietf:params:oauth:grant-type:jwt-bearer")
        header, claims, signing_input, signature = rsa.jwt_split(call["form"]["assertion"])
        self.assertEqual(header["alg"], "RS256")
        self.assertEqual(claims["iss"], SA_EMAIL)
        self.assertEqual(claims["scope"], "https://www.googleapis.com/auth/wallet_object.issuer")
        self.assertEqual(claims["aud"], "https://oauth2.googleapis.com/token")
        self.assertEqual((claims["iat"], claims["exp"]), (1_800_000_000, 1_800_003_600))
        self.assertTrue(rsa.verify(signing_input, signature, PUBLIC))
        self.assertFalse(rsa.verify(signing_input, signature, rsa.PrivateKey.from_pem(KEY_ONE).public().__class__ and PUBLIC.__class__ and _other_key()))

    def test_token_is_cached_until_shortly_before_it_expires(self):
        email, key = passes.load_service_account()
        client.access_token(email, key, now=1000)
        client.access_token(email, key, now=1000 + 3000)
        self.assertEqual(len(self.google.of("POST", "token")), 1)
        client.access_token(email, key, now=1000 + 3400)
        self.assertEqual(len(self.google.of("POST", "token")), 2)

    def test_token_never_reaches_the_logs_or_the_pass_row(self):
        self.google.script["POST object"] = [500]
        with self.assertNoLogs():
            self.link()
        self.assertNotIn(TOKEN, WalletPass.objects.get().last_error)

    def test_only_googles_hosts_can_be_called(self):
        self.assertTrue(client.host_ok("walletobjects.googleapis.com"))
        self.assertTrue(client.host_ok("oauth2.googleapis.com"))
        self.assertFalse(client.host_ok("evil.example.com"))
        self.assertFalse(client.host_ok("walletobjects.googleapis.com.evil.com"))
        with self.assertRaises(client.WalletApiError):
            client._default_send("GET", "https://evil.example.com/x")
        with self.assertRaises(client.WalletApiError):
            client._default_send("GET", "http://walletobjects.googleapis.com/x")


def _other_key():
    from .keys import KEY_TWO
    return rsa.PrivateKey.from_pem(KEY_TWO).public()


class SaveLinkTests(RestCase):
    def test_link_stores_the_pass_and_only_names_it(self):
        res = self.link()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(set(res.data), {"save_url", "warnings"})
        _, claims, valid = decode(res.data["save_url"])
        self.assertTrue(valid)
        oid = f"{ISSUER}.{self.card['public_code']}"
        self.assertEqual(claims["payload"], {"genericObjects": [{"id": oid}]})
        self.assertLess(len(res.data["save_url"]), 900)
        self.assertEqual([c["kind"] for c in self.google.calls], ["token", "class", "class", "object"])
        self.assertEqual(self.google.calls[2]["json"], {"id": f"{ISSUER}.bench_card"})
        posted = self.google.of("POST", "object")[0]
        self.assertEqual(posted["headers"]["Authorization"], f"Bearer {TOKEN}")
        self.assertEqual(posted["json"]["id"], oid)
        self.assertEqual(posted["json"]["header"]["defaultValue"]["value"], "Alice Anderson")
        self.assertEqual(posted["json"]["state"], "ACTIVE")
        self.assertNotIn("_warnings", posted["json"])
        row = self.row()
        self.assertTrue(row.remote_exists)
        self.assertFalse(row.dirty)
        self.assertEqual(row.last_error, "")
        self.assertEqual(len(row.last_synced_hash), 64)

    def test_second_link_for_an_unchanged_card_calls_google_not_at_all(self):
        self.link()
        before = len(self.google.calls)
        res = self.link()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(self.google.calls), before)

    def test_changed_card_is_updated_by_the_next_link(self):
        self.link()
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"title": "Lead designer"}, format="json")
        self.link()
        patched = self.google.of("PATCH", "object")[0]["json"]
        self.assertEqual(patched["subheader"]["defaultValue"]["value"], "Lead designer")

    def test_existing_object_on_insert_is_updated_instead(self):
        self.google.objects[f"{ISSUER}.{self.card['public_code']}"] = {"id": "old"}
        res = self.link()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len(self.google.of("POST", "object")), 1)
        patch = self.google.of("PATCH", "object")[0]
        self.assertTrue(patch["url"].endswith("/genericObject/" + f"{ISSUER}.{self.card['public_code']}"))
        self.assertNotIn("id", patch["json"])
        self.assertNotIn("classId", patch["json"])
        self.assertTrue(self.row().remote_exists)

    def test_google_failure_falls_back_to_the_inline_pass_and_is_recorded(self):
        self.google.script["POST object"] = [403]
        res = self.link()
        self.assertEqual(res.status_code, 200)
        _, claims, valid = decode(res.data["save_url"])
        self.assertTrue(valid)
        obj = claims["payload"]["genericObjects"][0]
        self.assertEqual(obj["header"]["defaultValue"]["value"], "Alice Anderson")
        row = self.row()
        self.assertIn("403", row.last_error)
        self.assertTrue(row.dirty)
        self.assertFalse(row.remote_exists)

    def test_network_failure_and_token_failure_fall_back(self):
        self.google.script["POST token"] = [client.WalletApiError(0, "Google could not be reached (timeout).")]
        res = self.link()
        self.assertEqual(res.status_code, 200)
        self.assertIn("header", decode(res.data["save_url"])[1]["payload"]["genericObjects"][0])
        self.assertIn("could not be reached", self.row().last_error)
        self.google.script["POST token"] = [400]
        self.assertEqual(self.link().status_code, 200)
        self.assertIn("sign-in failed", self.row().last_error)

    def test_unexpected_error_inside_wallet_code_falls_back(self):
        with mock.patch.object(sync, "ensure_class", side_effect=RuntimeError("boom")):
            res = self.link()
        self.assertEqual(res.status_code, 200)
        self.assertIn("header", decode(res.data["save_url"])[1]["payload"]["genericObjects"][0])

    @override_settings(GOOGLE_WALLET_REST_UPDATES=False)
    def test_rest_off_keeps_the_inline_pass_and_makes_no_call(self):
        res = self.link()
        self.assertIn("header", decode(res.data["save_url"])[1]["payload"]["genericObjects"][0])
        self.assertEqual(self.google.calls, [])
        self.assertEqual(WalletPass.objects.count(), 0)
        self.assertIn("off", self.run_job())

    @override_settings(GOOGLE_WALLET_OBJECT_SUFFIX="_v2")
    def test_object_id_keeps_the_suffix(self):
        res = self.link()
        self.assertEqual(decode(res.data["save_url"])[1]["payload"]["genericObjects"], [{"id": f"{ISSUER}.{self.card['public_code']}_v2"}])


class UpdateJobTests(RestCase):
    def setUp(self):
        super().setUp()
        self.link()
        self.google.calls.clear()

    def test_editing_a_card_marks_the_pass_and_the_job_sends_it_once(self):
        self.assertFalse(self.row().dirty)
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Alice Brown"}, format="json")
        self.assertTrue(self.row().dirty)
        out = self.run_job()
        self.assertIn("sent 1", out)
        patched = self.google.of("PATCH", "object")
        self.assertEqual(len(patched), 1)
        self.assertEqual(patched[0]["json"]["header"]["defaultValue"]["value"], "Alice Brown")
        row = self.row()
        self.assertFalse(row.dirty)
        self.assertEqual(row.last_error, "")
        # nothing is due now, and a forced comparison finds the pass unchanged
        self.google.calls.clear()
        self.assertIn("sent 0", self.run_job())
        self.make_due()
        out = self.run_job()
        self.assertIn("unchanged 1", out)
        self.assertEqual(self.google.calls, [])

    def test_job_output_when_nothing_is_set_up(self):
        with override_settings(GOOGLE_WALLET_ISSUER_ID=""):
            self.assertIn("nothing to do", self.run_job())

    def test_items_photo_and_company_logo_changes_mark_the_pass(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"items": [
            {"kind": "Email", "value": "a@studio.com", "label": "", "on": True}]}, format="json")
        self.assertTrue(self.row().dirty)
        self.run_job()
        self.assertFalse(self.row().dirty)
        self.alice.client.post(f"{API}cards/{self.card['id']}/photo", {"file": png_upload()}, format="multipart")
        self.assertTrue(self.row().dirty)

    def test_company_brand_change_marks_every_card_pass_of_the_company(self):
        owner = self.signup("owner@acme.com")
        ws = self.company(owner)
        card = self.published_card(owner, ws=ws)
        owner.client.get(f"{API}cards/{card['id']}/wallet/google")
        row = WalletPass.objects.get(object_id=f"{ISSUER}.{card['public_code']}")
        self.assertFalse(row.dirty)
        owner.client.post(f"{API}workspaces/{ws}/logo", {"file": png_upload()}, format="multipart")
        row.refresh_from_db()
        self.assertTrue(row.dirty)
        self.assertFalse(self.row().dirty)

    def test_hidden_items_and_notes_are_never_sent(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"label": "private note", "items": [
            {"kind": "Email", "value": "shown@studio.com", "label": "", "on": True},
            {"kind": "Mobile", "value": "+97150000000", "label": "", "on": False},
        ]}, format="json")
        self.run_job()
        text = json.dumps(self.google.of("PATCH", "object")[0]["json"])
        self.assertIn("shown@studio.com", text)
        self.assertNotIn("+97150000000", text)
        self.assertNotIn("private note", text)

    def test_removed_optional_parts_are_cleared_in_the_update(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"title": ""}, format="json")
        self.run_job()
        self.assertIsNone(self.google.of("PATCH", "object")[0]["json"]["subheader"])

    def test_unpublished_card_switches_the_pass_off(self):
        self.alice.client.post(f"{API}cards/{self.card['id']}/unpublish")
        self.run_job()
        self.assertEqual(self.google.of("PATCH", "object")[0]["json"]["state"], "INACTIVE")
        self.alice.client.post(f"{API}cards/{self.card['id']}/publish")
        self.run_job()
        self.assertEqual(self.google.of("PATCH", "object")[1]["json"]["state"], "ACTIVE")

    def test_deleted_card_expires_the_pass_and_keeps_it(self):
        self.alice.client.delete(f"{API}cards/{self.card['id']}")
        row = WalletPass.objects.get()
        self.assertIsNone(row.card)
        self.assertTrue(row.dirty)
        self.run_job()
        self.assertEqual(self.google.of("PATCH", "object")[0]["json"], {"state": "EXPIRED"})
        row.refresh_from_db()
        self.assertIsNone(row.next_try_at)
        self.google.calls.clear()
        self.run_job()
        self.assertEqual(self.google.calls, [])

    def test_unsaved_pass_404_is_marked_synced(self):
        self.google.objects.clear()
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "New Name"}, format="json")
        out = self.run_job()
        self.assertIn("not saved by anyone 1", out)
        row = self.row()
        self.assertFalse(row.dirty)
        self.assertFalse(row.remote_exists)
        self.assertEqual(row.last_error, "")
        # the next save link creates it again
        self.google.calls.clear()
        self.link()
        self.assertEqual(len(self.google.of("POST", "object")), 1)

    def test_server_error_backs_off_and_then_recovers(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Alice B"}, format="json")
        self.google.script["PATCH object"] = [500]
        self.assertIn("failed 1", self.run_job())
        row = self.row()
        self.assertEqual(row.attempts, 1)
        self.assertTrue(row.dirty)
        self.assertIn("500", row.last_error)
        self.assertGreater(row.next_try_at, timezone.now())
        self.google.calls.clear()
        self.assertIn("failed 0", self.run_job())  # not due yet
        self.assertEqual(self.google.calls, [])
        first_wait = row.next_try_at
        self.make_due()
        self.google.script["PATCH object"] = [500]
        self.run_job()
        self.assertGreater(self.row().next_try_at - timezone.now(), first_wait - timezone.now())
        self.make_due()
        self.assertIn("sent 1", self.run_job())
        self.assertEqual(self.row().last_error, "")
        self.assertEqual(self.row().attempts, 0)

    def test_rate_limit_backs_off_and_gives_up_after_the_maximum(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Alice C"}, format="json")
        self.google.script["PATCH object"] = [429, 429, 429]
        with override_settings(GOOGLE_WALLET_MAX_ATTEMPTS=2):
            self.run_job()
            self.assertEqual(self.row().attempts, 1)
            self.make_due()
            self.assertIn("gave up 1", self.run_job())
        row = self.row()
        self.assertTrue(row.last_error.startswith("Gave up"))
        self.assertFalse(row.dirty)
        self.assertEqual(row.attempts, 0)

    def test_client_error_is_not_retried(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Alice D"}, format="json")
        self.google.script["PATCH object"] = [400]
        self.assertIn("gave up 1", self.run_job())

    def test_the_job_stops_after_repeated_failures_and_respects_the_limit(self):
        WalletPass.objects.all().delete()
        for n in range(5):
            WalletPass.objects.create(object_id=f"{ISSUER}.gone{n}", card_deleted=True, dirty=True,
                                      next_try_at=timezone.now() - timedelta(minutes=1))
        self.google.script["PATCH object"] = [500] * 10
        self.assertIn("stopped early", self.run_job())
        self.assertEqual(len(self.google.of("PATCH", "object")), sync.STOP_AFTER_FAILURES)
        self.google.script["PATCH object"] = []
        self.make_due()
        self.assertIn("not saved by anyone 2", self.run_job(limit=2))

    @override_settings(GOOGLE_WALLET_NOTIFY_ON_UPDATE=True)
    def test_phone_message_only_when_switched_on(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Alice E"}, format="json")
        self.run_job()
        body = self.google.of("PATCH", "object")[0]["json"]
        self.assertEqual(body["notifyPreference"], "ENABLE_NOTIFICATIONS")
        self.assertEqual(body["messages"][0]["header"], "Card updated")

    def test_silent_by_default(self):
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Alice F"}, format="json")
        self.run_job()
        body = self.google.of("PATCH", "object")[0]["json"]
        self.assertNotIn("messages", body)
        self.assertNotIn("notifyPreference", body)

    def test_staff_summary(self):
        self.assertEqual(sync.summary()["passes"], 1)
        self.google.script["PATCH object"] = [500]
        self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Alice G"}, format="json")
        self.run_job()
        data = sync.summary()
        self.assertEqual((data["waiting"], data["failing"]), (1, 1))
        self.assertIn("500", data["last_error"])


class NeverBreaksACardEditTests(RestCase):
    def test_editing_a_card_survives_wallet_code_that_raises(self):
        self.link()
        broken = mock.MagicMock()
        broken.objects.filter.side_effect = RuntimeError("database trouble")
        with mock.patch.object(sync, "WalletPass", broken):
            res = self.alice.client.patch(f"{API}cards/{self.card['id']}", {"name": "Still saved"}, format="json")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(self.alice.client.post(f"{API}cards/{self.card['id']}/unpublish").status_code, 200)
            self.assertEqual(self.alice.client.delete(f"{API}cards/{self.card['id']}").status_code, 204)


class CronTests(SimpleTestCase):
    def test_cron_and_checks_list_the_job(self):
        from pathlib import Path

        deploy = Path(__file__).resolve().parent.parent.parent / "deploy"
        self.assertIn("$J sync_wallet_passes sync_wallet_passes", (deploy / "cron" / "bench-cron").read_text(encoding="utf-8"))
        self.assertIn("sync_wallet_passes:", (deploy / "check_bench.sh").read_text(encoding="utf-8"))
