"""The public API: keys, authentication, scopes, company isolation, rate limits, idempotency, ETag, pagination, audit."""
import logging
from datetime import timedelta

from django.core import mail
from django.db import connection
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from analytics.models import Event
from cards.models import Card
from leads.models import Lead
from operations.models import AuditEvent
from publicapi import keys
from publicapi.models import ApiKey, IdempotencyRecord
from workspaces.models import Member, Workspace

from .base import API
from .ops_base import OpsTestCase

PUB = "/api/public/v1/"


def api_client(secret, ip=None):
    client = APIClient()
    extra = {"HTTP_AUTHORIZATION": f"Bearer {secret}"}
    if ip:
        extra["HTTP_X_FORWARDED_FOR"] = ip
    client.credentials(**extra)
    return client


class PublicApiBase(OpsTestCase):
    def make_key(self, scopes=None, workspace=None, **kw):
        from publicapi.models import SCOPES

        ws = Workspace.objects.get(pk=workspace or self.ws)
        kw = {{"rate_per_minute": "per_minute", "rate_per_day": "per_day"}.get(k, k): v for k, v in kw.items()}
        key, secret = keys.create_key(ws, None, kw.pop("name", "Test key"), scopes or list(SCOPES), **kw)
        return key, api_client(secret), secret

    def setUp(self):
        super().setUp()
        self.key, self.api, self.secret = self.make_key()

    def lead(self, ws=None, card=None, **kw):
        ws = ws or Workspace.objects.get(pk=self.ws)
        values = {"name": "Lena Lead", "email": "lena@example.com", "note": "Hello"}
        values.update(kw)
        return Lead.objects.create(workspace=ws, card=card, card_name=card.name if card else "", **values)

    def other_company(self):
        other_owner = self.signup("other@example.com", "Otto Other")
        other_ws = self.company(other_owner, "Other Ltd", seats=5)
        member = self.invite(other_owner, other_ws, "ola@other.test", full_name="Ola Other")
        card = Card.objects.get(pk=member["card_id"])
        lead = self.lead(Workspace.objects.get(pk=other_ws), card, name="Other Lead")
        return other_owner, other_ws, member, card, lead


class KeyManagementTests(PublicApiBase):
    def url_keys(self, suffix=""):
        return f"{API}workspaces/{self.ws}/api-keys{suffix}"

    def test_owner_creates_a_key_and_sees_the_secret_once(self):
        res = self.owner.client.post(self.url_keys(), {"name": "ERP", "scopes": ["cards:read", "leads:read"]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        secret = res.data["secret"]
        self.assertTrue(secret.startswith("bnch_live_"))
        self.assertTrue(secret.startswith(res.data["prefix"]))
        self.assertEqual(len(res.data["prefix"]), len("bnch_live_") + 8)
        listing = self.owner.client.get(self.url_keys())
        self.assertNotIn("secret", str(listing.data["results"]))
        self.assertNotIn(secret, str(listing.data))
        # The secret works on the public API.
        self.assertEqual(api_client(secret).get(PUB + "me").status_code, 200)

    def test_only_the_hash_is_stored(self):
        res = self.owner.client.post(self.url_keys(), {"name": "ERP", "scopes": ["cards:read"]}, format="json")
        secret = res.data["secret"]
        key = ApiKey.objects.get(pk=res.data["id"])
        self.assertEqual(key.key_hash, keys.hash_key(secret))
        self.assertNotIn(secret, key.key_hash)
        # Nothing in the database holds the plain key: search every text column of every table.
        with connection.cursor() as cursor:
            tables = connection.introspection.table_names(cursor)
            for table in tables:
                cols = [c.name for c in connection.introspection.get_table_description(cursor, table)]
                for col in cols:
                    cursor.execute(f'SELECT COUNT(*) FROM "{table}" WHERE CAST("{col}" AS TEXT) LIKE %s', [f"%{secret[10:30]}%"])
                    self.assertEqual(cursor.fetchone()[0], 0, f"{table}.{col}")

    def test_employee_cannot_manage_keys_but_admin_can(self):
        eve = self.add("eve@acme.test", "Eve Employee")
        self.assertEqual(eve.client.get(self.url_keys()).status_code, 403)
        self.assertEqual(eve.client.post(self.url_keys(), {"name": "x", "scopes": ["cards:read"]}, format="json").status_code, 403)
        ada = self.add("ada@acme.test", "Ada Admin", role="admin")
        self.assertEqual(ada.client.post(self.url_keys(), {"name": "x", "scopes": ["cards:read"]}, format="json").status_code, 201)

    def test_validation(self):
        post = lambda body: self.owner.client.post(self.url_keys(), body, format="json")
        self.assertEqual(post({"scopes": ["cards:read"]}).status_code, 400)
        self.assertEqual(post({"name": "x", "scopes": []}).status_code, 400)
        self.assertEqual(post({"name": "x", "scopes": ["cards:delete"]}).status_code, 400)
        self.assertEqual(post({"name": "x", "scopes": ["cards:read"], "expires_at": "2001-01-01T00:00:00Z"}).status_code, 400)
        self.assertEqual(post({"name": "x", "scopes": ["cards:read"], "expires_at": "tomorrow"}).status_code, 400)
        self.assertEqual(post({"name": "x", "scopes": ["cards:read"], "allowed_ips": ["not-an-ip"]}).status_code, 400)
        self.assertEqual(post({"name": "x", "scopes": ["cards:read"], "rate_per_minute": 0}).status_code, 400)
        ok = post({"name": "x", "scopes": ["cards:read"], "allowed_ips": ["203.0.113.0/24", "198.51.100.7"]})
        self.assertEqual(ok.status_code, 201)
        self.assertEqual(ok.data["allowed_ips"], ["203.0.113.0/24", "198.51.100.7"])

    def test_personal_workspace_cannot_have_keys(self):
        person = self.signup("solo@example.com", "Solo")
        res = person.client.post(f"{API}workspaces/{person.ws}/api-keys", {"name": "x", "scopes": ["cards:read"]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_limit_of_active_keys(self):
        for i in range(keys.MAX_KEYS_PER_COMPANY - 1):  # the setUp key is one
            self.make_key(name=f"k{i}")
        res = self.owner.client.post(self.url_keys(), {"name": "one too many", "scopes": ["cards:read"]}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "plan_limit")

    def test_revoke_and_audit(self):
        res = self.owner.client.post(self.url_keys(f"/{self.key.id}/revoke"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["status"], "revoked")
        self.assertEqual(self.api.get(PUB + "me").data["error"]["code"], "key_revoked")
        event = AuditEvent.objects.filter(action="apikey.revoked").first()
        self.assertEqual(event.details["prefix"], self.key.prefix)
        self.assertEqual(event.actor.email, "owner@example.com")

    def test_rotate_with_grace_then_old_key_expires(self):
        res = self.owner.client.post(self.url_keys(f"/{self.key.id}/rotate"), {"grace_hours": 2}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        new_secret = res.data["new"]["secret"]
        self.assertEqual(api_client(new_secret).get(PUB + "me").status_code, 200)
        self.assertEqual(self.api.get(PUB + "me").status_code, 200)  # still inside the grace period
        self.key.refresh_from_db()
        self.assertLess(self.key.expires_at, timezone.now() + timedelta(hours=2, minutes=1))
        ApiKey.objects.filter(pk=self.key.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(self.api.get(PUB + "me").data["error"]["code"], "key_expired")
        self.assertTrue(AuditEvent.objects.filter(action="apikey.rotated").exists())

    def test_rotate_without_grace_stops_the_old_key_at_once(self):
        res = self.owner.client.post(self.url_keys(f"/{self.key.id}/rotate"), {"grace_hours": 0}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.api.get(PUB + "me").status_code, 401)

    def test_other_company_cannot_touch_my_keys(self):
        other_owner, other_ws, *_ = self.other_company()
        res = other_owner.client.post(f"{API}workspaces/{other_ws}/api-keys/{self.key.id}/revoke")
        self.assertEqual(res.status_code, 404)
        res = other_owner.client.get(f"{API}workspaces/{self.ws}/api-keys")
        self.assertEqual(res.status_code, 404)

    def test_create_is_audited_without_the_secret(self):
        res = self.owner.client.post(self.url_keys(), {"name": "ERP", "scopes": ["cards:read"]}, format="json")
        event = AuditEvent.objects.get(action="apikey.created")
        self.assertNotIn(res.data["secret"], str(event.details))
        self.assertEqual(event.details["prefix"], res.data["prefix"])


class AuthenticationTests(PublicApiBase):
    def test_missing_and_wrong_keys(self):
        self.assertEqual(APIClient().get(PUB + "me").data["error"]["code"], "missing_api_key")
        self.assertEqual(api_client("bnch_live_" + "x" * 43).get(PUB + "me").data["error"]["code"], "invalid_api_key")
        self.assertEqual(api_client("whatever").get(PUB + "me").status_code, 401)
        res = APIClient().get(PUB + "me", HTTP_AUTHORIZATION="Basic abc")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res["WWW-Authenticate"], "Bearer")

    def test_a_sign_in_token_is_not_an_api_key(self):
        self.assertEqual(api_client(self.owner.access).get(PUB + "me").status_code, 401)
        self.assertEqual(api_client(self.owner.access).get(PUB + "cards").status_code, 401)

    def test_an_api_key_is_not_a_sign_in_token(self):
        self.assertEqual(api_client(self.secret).get(f"{API}me/workspaces").status_code, 401)
        self.assertEqual(api_client(self.secret).get(f"{API}workspaces/{self.ws}/cards").status_code, 401)
        self.assertEqual(api_client(self.secret).get(f"{API}workspaces/{self.ws}/api-keys").status_code, 401)

    def test_expired_key(self):
        _, client, _ = self.make_key(expires_at=timezone.now() + timedelta(days=1))
        self.assertEqual(client.get(PUB + "me").status_code, 200)
        ApiKey.objects.filter(pk=ApiKey.objects.exclude(pk=self.key.pk).first().pk).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(client.get(PUB + "me").data["error"]["code"], "key_expired")

    def test_ip_allow_list(self):
        key, _, raw = self.make_key(allowed_ips=["203.0.113.0/24", "2001:db8::1"])
        self.assertEqual(api_client(raw, "203.0.113.9").get(PUB + "me").status_code, 200)
        denied = api_client(raw, "198.51.100.9").get(PUB + "me")
        self.assertEqual((denied.status_code, denied.data["error"]["code"]), (403, "ip_not_allowed"))
        self.assertEqual(api_client(raw, "2001:db8::1").get(PUB + "me").status_code, 200)
        self.assertEqual(api_client(raw, "2001:db8::2").get(PUB + "me").status_code, 403)

    def test_last_used_and_count(self):
        self.api.get(PUB + "me")
        self.api.get(PUB + "cards")
        self.key.refresh_from_db()
        self.assertEqual(self.key.use_count, 2)
        self.assertIsNotNone(self.key.last_used_at)

    def test_error_format_has_a_request_id(self):
        res = self.api.get(PUB + "cards/00000000-0000-0000-0000-000000000001")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(set(res.data["error"]), {"code", "message", "request_id"})
        self.assertEqual(res["X-Request-Id"], res.data["error"]["request_id"])
        self.assertEqual(res["X-Api-Version"], "v1")

    def test_a_workspace_waiting_for_deletion_closes_the_api(self):
        Workspace.objects.filter(pk=self.ws).update(deletion_due_at=timezone.now() + timedelta(days=3))
        self.assertEqual(self.api.get(PUB + "me").data["error"]["code"], "workspace_pending_deletion")

    def test_a_company_without_a_plan_gets_402(self):
        from unittest import mock

        with mock.patch("publicapi.auth.is_live", return_value=False):
            res = self.api.get(PUB + "me")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (402, "subscription_required"))

    def test_many_wrong_keys_from_one_address_are_slowed_down(self):
        bad = api_client("bnch_live_" + "y" * 43)
        for _ in range(30):
            self.assertEqual(bad.get(PUB + "me").status_code, 401)
        self.assertEqual(bad.get(PUB + "me").status_code, 429)


class ScopeTests(PublicApiBase):
    def test_every_route_needs_its_scope(self):
        member = Member.objects.filter(workspace_id=self.ws).first()
        card = Card.objects.filter(workspace_id=self.ws).first()
        lead = self.lead(card=card)
        cid, mid, lid = card.id if card else "00000000-0000-0000-0000-000000000001", member.id, lead.id
        routes = [
            ("get", "cards", "cards:read"), ("post", "cards", "cards:write"), ("get", f"cards/{cid}", "cards:read"),
            ("patch", f"cards/{cid}", "cards:write"), ("post", f"cards/{cid}/publish", "cards:write"),
            ("post", f"cards/{cid}/unpublish", "cards:write"), ("get", "members", "team:read"),
            ("get", f"members/{mid}", "team:read"), ("post", "invites", "team:write"),
            ("post", f"members/{mid}/suspend", "team:write"), ("post", f"members/{mid}/restore", "team:write"),
            ("delete", f"members/{mid}", "team:write"), ("get", "leads", "leads:read"), ("get", f"leads/{lid}", "leads:read"),
            ("patch", f"leads/{lid}", "leads:write"), ("get", "analytics/summary", "analytics:read"),
            ("get", "analytics/cards", "analytics:read"), ("get", f"analytics/cards/{cid}", "analytics:read"),
        ]
        from publicapi.models import SCOPES

        for method, path, scope in routes:
            others = [s for s in SCOPES if s != scope]
            _, client, _ = self.make_key(others, name=f"no-{scope}")
            res = getattr(client, method)(PUB + path, {}, format="json")
            self.assertEqual(res.status_code, 403, f"{method} {path}: {res.content}")
            self.assertEqual(res.data["error"]["code"], "insufficient_scope")
            self.assertIn(scope, res.data["error"]["message"])
            ApiKey.objects.filter(name=f"no-{scope}").delete()

    def test_a_write_scope_does_not_allow_reading(self):
        _, client, _ = self.make_key(["cards:write"])
        self.assertEqual(client.get(PUB + "cards").status_code, 403)
        _, client, _ = self.make_key(["cards:read"])
        self.assertEqual(client.get(PUB + "cards").status_code, 200)
        self.assertEqual(client.post(PUB + "cards", {}, format="json").status_code, 403)

    def test_unsupported_method_is_405_not_403(self):
        self.assertEqual(self.api.put(PUB + "cards", {}, format="json").status_code, 405)


class IsolationTests(PublicApiBase):
    def setUp(self):
        super().setUp()
        self.anna = self.add("anna@acme.test", "Anna Acme")
        self.mine_lead = self.lead(name="Mine")  # a contact of the company itself
        self.other_owner, self.other_ws, self.other_member, self.other_card, self.other_lead = self.other_company()
        Event.objects.create(card=self.other_card, type="view")

    def test_lists_never_show_another_company(self):
        ids = {c["id"] for c in self.api.get(PUB + "cards?limit=100").data["data"]}
        self.assertIn(self.anna.card_id, ids)
        self.assertNotIn(str(self.other_card.id), ids)
        self.assertNotIn(str(self.other_member["id"]), {m["id"] for m in self.api.get(PUB + "members").data["data"]})
        leads = self.api.get(PUB + "leads").data["data"]
        self.assertEqual([l["name"] for l in leads], ["Mine"])
        by_card = self.api.get(PUB + f"leads?card_id={self.other_card.id}").data["data"]
        self.assertEqual(by_card, [])

    def test_direct_access_to_another_companys_rows_is_404(self):
        card, member, lead = self.other_card.id, self.other_member["id"], self.other_lead.id
        for method, path, body in [
            ("get", f"cards/{card}", None), ("patch", f"cards/{card}", {"title": "Hacked"}),
            ("post", f"cards/{card}/publish", None), ("post", f"cards/{card}/unpublish", None),
            ("get", f"members/{member}", None), ("post", f"members/{member}/suspend", None),
            ("post", f"members/{member}/restore", None), ("delete", f"members/{member}", None),
            ("get", f"leads/{lead}", None), ("patch", f"leads/{lead}", {"status": "won"}),
            ("get", f"analytics/cards/{card}", None),
        ]:
            res = getattr(self.api, method)(PUB + path, body, format="json")
            self.assertEqual(res.status_code, 404, f"{method} {path}")
        self.other_card.refresh_from_db()
        self.assertEqual(self.other_card.title, "")
        self.other_lead.refresh_from_db()
        self.assertEqual(self.other_lead.status, "new")
        self.assertTrue(Member.objects.filter(pk=member).exclude(status="suspended").exists())

    def test_cannot_create_a_card_for_another_companys_member(self):
        res = self.api.post(PUB + "cards", {"member_email": "ola@other.test", "name": "X"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(Card.objects.filter(member_id=self.other_member["id"]).count(), 1)

    def test_cannot_assign_a_lead_to_another_companys_member(self):
        res = self.api.patch(PUB + f"leads/{self.mine_lead.id}", {"assignee_email": "ola@other.test"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.api.patch(PUB + f"leads/{self.mine_lead.id}", {"assignee_id": str(self.other_member["id"])}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_analytics_only_count_my_cards(self):
        res = self.api.get(PUB + "analytics/summary?days=7")
        self.assertEqual(res.data["totals"]["views"], 0)
        rows = self.api.get(PUB + "analytics/cards").data["data"]
        self.assertNotIn(str(self.other_card.id), {r["card_id"] for r in rows})

    def test_a_key_of_company_b_sees_only_b(self):
        other_key, client, _ = self.make_key(workspace=self.other_ws)
        ids = {c["id"] for c in client.get(PUB + "cards").data["data"]}
        self.assertEqual(ids, {str(self.other_card.id)})
        self.assertEqual(client.get(PUB + f"cards/{self.anna.card_id}").status_code, 404)
        self.assertEqual(client.get(PUB + f"leads/{self.mine_lead.id}").status_code, 404)
        self.assertEqual(client.get(PUB + "me").data["workspace"]["id"], str(self.other_ws))

    def test_workspace_id_in_the_request_is_ignored(self):
        res = self.api.get(PUB + f"cards?workspace_id={self.other_ws}&limit=100")
        self.assertNotIn(str(self.other_card.id), {c["id"] for c in res.data["data"]})
        res = self.api.post(PUB + "cards", {"member_email": "anna@acme.test", "workspace_id": str(self.other_ws), "name": "x"}, format="json")
        self.assertEqual(res.status_code, 409)  # Anna already has a card: and nothing was created elsewhere
        self.assertEqual(Card.objects.filter(workspace_id=self.other_ws).count(), 1)


class RateLimitTests(PublicApiBase):
    def test_per_minute_limit_with_headers(self):
        key, client, _ = self.make_key(rate_per_minute=3)
        first = client.get(PUB + "me")
        self.assertEqual(first["X-RateLimit-Limit"], "3")
        self.assertEqual(first["X-RateLimit-Remaining"], "2")
        self.assertIn("X-RateLimit-Reset", first)
        client.get(PUB + "me")
        client.get(PUB + "me")
        blocked = client.get(PUB + "me")
        self.assertEqual(blocked.status_code, 429)
        self.assertEqual(blocked.data["error"]["code"], "throttled")
        self.assertGreaterEqual(int(blocked["Retry-After"]), 1)
        self.assertEqual(blocked["X-RateLimit-Remaining"], "0")

    def test_per_day_limit(self):
        key, client, _ = self.make_key(rate_per_day=2)
        client.get(PUB + "me")
        client.get(PUB + "me")
        blocked = client.get(PUB + "me")
        self.assertEqual(blocked.status_code, 429)
        self.assertGreater(int(blocked["Retry-After"]), 60)
        self.assertEqual(blocked["X-RateLimit-Daily-Remaining"], "0")

    def test_limits_are_per_key(self):
        _, a, _ = self.make_key(rate_per_minute=1)
        _, b, _ = self.make_key(rate_per_minute=1)
        self.assertEqual(a.get(PUB + "me").status_code, 200)
        self.assertEqual(a.get(PUB + "me").status_code, 429)
        self.assertEqual(b.get(PUB + "me").status_code, 200)

    def test_default_limits(self):
        key = ApiKey.objects.get(pk=self.key.pk)
        self.assertEqual((key.rate_per_minute, key.rate_per_day), (120, 5000))


class IdempotencyTests(PublicApiBase):
    def invite(self, email="new@acme.test", key="abc-1", **body):
        payload = {"invites": [{"email": email, "full_name": "New Person"}]}
        payload.update(body)
        return self.api.post(PUB + "invites", payload, format="json", HTTP_IDEMPOTENCY_KEY=key)

    def test_a_retry_returns_the_first_answer_and_does_nothing_twice(self):
        first = self.invite()
        self.assertEqual(first.status_code, 201, first.content)
        second = self.invite()
        self.assertEqual(second.status_code, 201)
        self.assertEqual(second["Idempotent-Replayed"], "true")
        self.assertEqual(second.data, first.data)
        self.assertEqual(Member.objects.filter(email="new@acme.test").count(), 1)
        self.assertEqual(sum(1 for m in mail.outbox if "new@acme.test" in m.to), 1)

    def test_same_key_with_another_body_is_422(self):
        self.invite()
        res = self.invite(email="different@acme.test")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (422, "idempotency_key_reused"))

    def test_without_a_key_nothing_is_remembered(self):
        res = self.api.post(PUB + "invites", {"invites": [{"email": "one@acme.test"}]}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)

    def test_failures_are_not_remembered(self):
        bad = self.api.post(PUB + "invites", {"invites": [{"email": "nope"}]}, format="json", HTTP_IDEMPOTENCY_KEY="k1")
        self.assertEqual(bad.status_code, 400)
        good = self.api.post(PUB + "invites", {"invites": [{"email": "nope"}]}, format="json", HTTP_IDEMPOTENCY_KEY="k1")
        self.assertEqual(good.status_code, 400)
        self.assertEqual(IdempotencyRecord.objects.count(), 0)

    def test_keys_are_per_api_key(self):
        _, other, _ = self.make_key(name="other")
        self.invite()
        res = other.post(PUB + "invites", {"invites": [{"email": "new@acme.test", "full_name": "New Person"}]}, format="json", HTTP_IDEMPOTENCY_KEY="abc-1")
        self.assertEqual(res.status_code, 400)  # not a replay: it ran, and the person is already in the team

    def test_records_expire_after_24_hours(self):
        self.invite()
        IdempotencyRecord.objects.update(created_at=timezone.now() - timedelta(hours=25))
        res = self.invite()
        self.assertEqual(res.status_code, 400)  # executed again: the person is already in the team

    def test_a_request_still_running_gives_409(self):
        IdempotencyRecord.objects.create(api_key=self.key, idem_key="busy", request_hash=__import__("hashlib").sha256(
            b"POST\n" + (PUB + "invites").encode() + b"\n" + b'{"invites": [{"email": "w@acme.test"}]}').hexdigest())
        res = self.api.post(PUB + "invites", data='{"invites": [{"email": "w@acme.test"}]}', content_type="application/json", HTTP_IDEMPOTENCY_KEY="busy")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "idempotency_in_progress"))


class EtagTests(PublicApiBase):
    def test_if_none_match(self):
        first = self.api.get(PUB + "cards")
        tag = first["ETag"]
        self.assertTrue(tag.startswith('"'))
        again = self.api.get(PUB + "cards", HTTP_IF_NONE_MATCH=tag)
        self.assertEqual(again.status_code, 304)
        self.assertEqual(again.content, b"")
        self.assertEqual(again["ETag"], tag)
        self.assertEqual(self.api.get(PUB + "cards", HTTP_IF_NONE_MATCH='W/' + tag).status_code, 304)
        self.assertEqual(self.api.get(PUB + "cards", HTTP_IF_NONE_MATCH='"other"').status_code, 200)

    def test_tag_changes_when_data_changes(self):
        tag = self.api.get(PUB + "leads")["ETag"]
        self.lead()
        res = self.api.get(PUB + "leads", HTTP_IF_NONE_MATCH=tag)
        self.assertEqual(res.status_code, 200)
        self.assertNotEqual(res["ETag"], tag)

    def test_a_not_modified_answer_still_counts_for_the_rate_limit(self):
        _, client, _ = self.make_key(rate_per_minute=2)
        tag = client.get(PUB + "cards")["ETag"]
        self.assertEqual(client.get(PUB + "cards", HTTP_IF_NONE_MATCH=tag).status_code, 304)
        self.assertEqual(client.get(PUB + "cards", HTTP_IF_NONE_MATCH=tag).status_code, 429)


class PaginationTests(PublicApiBase):
    def test_cursor_walks_every_lead_once(self):
        for i in range(7):
            self.lead(name=f"Lead {i}", email=f"l{i}@example.com")
        seen, cursor, pages = [], None, 0
        while True:
            url = PUB + "leads?limit=3" + (f"&cursor={cursor}" if cursor else "")
            page = self.api.get(url).data
            seen += [l["name"] for l in page["data"]]
            pages += 1
            if not page["has_more"]:
                self.assertIsNone(page["next_cursor"])
                break
            cursor = page["next_cursor"]
        self.assertEqual(pages, 3)
        self.assertEqual(sorted(seen), sorted(f"Lead {i}" for i in range(7)))
        self.assertEqual(len(set(seen)), 7)

    def test_rows_with_the_same_time_are_not_skipped(self):
        stamp = timezone.now()
        for i in range(5):
            self.lead(name=f"Same {i}", email=f"s{i}@example.com")
        Lead.objects.update(created_at=stamp)
        seen, cursor = [], None
        for _ in range(6):
            page = self.api.get(PUB + "leads?limit=2" + (f"&cursor={cursor}" if cursor else "")).data
            seen += [l["id"] for l in page["data"]]
            cursor = page["next_cursor"]
            if not page["has_more"]:
                break
        self.assertEqual(len(seen), 5)
        self.assertEqual(len(set(seen)), 5)

    def test_bad_limit_and_cursor(self):
        self.assertEqual(self.api.get(PUB + "leads?limit=0").status_code, 400)
        self.assertEqual(self.api.get(PUB + "leads?limit=101").status_code, 400)
        self.assertEqual(self.api.get(PUB + "leads?limit=abc").status_code, 400)
        self.assertEqual(self.api.get(PUB + "leads?cursor=garbage").status_code, 400)

    def test_members_and_cards_paginate(self):
        for i in range(3):
            self.add(f"p{i}@acme.test", f"Person {i}")
        page = self.api.get(PUB + "members?limit=2").data
        self.assertEqual((len(page["data"]), page["has_more"]), (2, True))
        rest = self.api.get(PUB + f"members?limit=2&cursor={page['next_cursor']}").data
        self.assertEqual(len(rest["data"]), 2)
        self.assertEqual(len(self.api.get(PUB + "cards?limit=2").data["data"]), 2)


class CardTests(PublicApiBase):
    def test_create_update_publish_unpublish(self):
        member = self.invite(self.owner, self.ws, "carl@acme.test", full_name="Carl Card")
        Card.objects.filter(pk=member["card_id"]).delete()  # the invite's draft is gone: make one through the API
        res = self.api.post(PUB + "cards", {
            "member_email": "carl@acme.test", "title": "Sales lead",
            "items": [{"kind": "Mobile", "value": "+97455550000"}, {"kind": "Website", "value": "carl.example.com"}],
        }, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        card = res.data
        self.assertEqual((card["name"], card["title"], card["status"]), ("Carl Card", "Sales lead", "draft"))
        self.assertEqual(card["member"]["email"], "carl@acme.test")
        self.assertNotIn("owner", card)
        kinds = [i["kind"] for i in card["items"]]
        self.assertIn("Mobile", kinds)
        patched = self.api.patch(PUB + f"cards/{card['id']}", {"title": "Head of sales", "address": "Doha"}, format="json")
        self.assertEqual((patched.status_code, patched.data["title"], patched.data["address"]), (200, "Head of sales", "Doha"))
        pub = self.api.post(PUB + f"cards/{card['id']}/publish")
        self.assertEqual(pub.data["status"], "published")
        self.assertEqual(self.api.post(PUB + f"cards/{card['id']}/publish").data["status"], "published")  # repeat is fine
        self.assertEqual(self.api.post(PUB + f"cards/{card['id']}/unpublish").data["status"], "draft")
        actions = list(AuditEvent.objects.filter(target_id=card["id"]).values_list("action", flat=True))
        for wanted in ("card.created", "card.updated", "card.published", "card.unpublished"):
            self.assertIn(wanted, actions)

    def test_every_write_is_audited_with_the_key_as_actor(self):
        self.add("dave@acme.test", "Dave Doe")
        card_id = Card.objects.get(member__email="dave@acme.test").id
        self.api.patch(PUB + f"cards/{card_id}", {"title": "Chief"}, format="json")
        event = AuditEvent.objects.filter(action="card.updated").latest("created_at")
        self.assertIsNone(event.actor)
        self.assertEqual(event.actor_name, self.key.name)
        self.assertEqual(event.actor_email, f"api:{self.key.prefix}")
        self.assertEqual(event.details["via"], "api_key")
        self.assertEqual(event.details["key_id"], str(self.key.id))
        self.assertEqual(event.details["fields"], ["title"])
        self.assertNotIn(self.secret, str(event.details))

    def test_a_member_with_a_card_gets_409_and_unknown_member_400(self):
        self.add("erin@acme.test", "Erin Doe")
        res = self.api.post(PUB + "cards", {"member_email": "erin@acme.test"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "card_exists"))
        self.assertEqual(self.api.post(PUB + "cards", {"member_email": "ghost@acme.test", "name": "G"}, format="json").status_code, 400)
        self.assertEqual(self.api.post(PUB + "cards", {"name": "G"}, format="json").status_code, 400)

    def test_validation_errors_use_the_stable_format(self):
        self.add("fay@acme.test", "Fay Doe")
        card_id = Card.objects.get(member__email="fay@acme.test").id
        res = self.api.patch(PUB + f"cards/{card_id}", {"items": [{"kind": "Website", "value": "javascript:alert(1)"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertTrue(res.data["error"]["fields"])
        self.assertEqual(self.api.patch(PUB + f"cards/{card_id}", {}, format="json").status_code, 400)
        self.assertEqual(self.api.patch(PUB + f"cards/{card_id}", [1], format="json").status_code, 400)

    def test_employee_field_rules_bind_the_api(self):
        gina = self.add("gina@acme.test", "Gina Doe")
        self.owner.client.patch(self.url("field-rules"), {"title": "locked", "company": "approval"}, format="json")
        res = self.api.patch(PUB + f"cards/{gina.card_id}", {"title": "Boss"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "field_locked"))
        res = self.api.patch(PUB + f"cards/{gina.card_id}", {"company": "Other Co"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "approval_required"))
        card = Card.objects.get(pk=gina.card_id)
        self.assertNotEqual(card.company, "Other Co")
        self.assertEqual(card.title, "")
        ok = self.api.patch(PUB + f"cards/{gina.card_id}", {"address": "Doha"}, format="json")
        self.assertEqual(ok.status_code, 200)

    def test_banned_links_are_refused_for_employee_cards(self):
        hal = self.add("hal@acme.test", "Hal Doe")
        self.owner.client.patch(self.url("field-rules"), {"banned_domains": ["bad.example"], "button_add": "free"}, format="json")
        res = self.api.patch(PUB + f"cards/{hal.card_id}", {"items": [{"kind": "Website", "value": "https://bad.example/x"}]}, format="json")
        self.assertEqual(res.status_code, 400, res.content)

    def test_locked_company_design_wins(self):
        ivy = self.add("ivy@acme.test", "Ivy Doe")
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"lock_design": True}}, format="json")
        before = self.api.get(PUB + f"cards/{ivy.card_id}").data["design"]
        res = self.api.patch(PUB + f"cards/{ivy.card_id}", {"design": {"colour": 3}}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["design"]["colour"], before["colour"])

    def test_a_key_cannot_publish_the_owners_card(self):
        owner_card = Card.objects.get(pk=self.make_card(self.owner, self.ws)["id"])
        res = self.api.post(PUB + f"cards/{owner_card.id}/publish")
        self.assertEqual(res.status_code, 403)

    def test_suspended_cards_cannot_be_changed(self):
        jo = self.add("jo@acme.test", "Jo Doe")
        self.owner.client.post(f"{API}cards/{jo.card_id}/suspend")
        res = self.api.patch(PUB + f"cards/{jo.card_id}", {"title": "x"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "card_suspended"))

    def test_filters(self):
        kim = self.add("kim@acme.test", "Kim Doe")
        res = self.api.get(PUB + "cards?member_email=KIM@acme.test").data["data"]
        self.assertEqual([c["id"] for c in res], [kim.card_id])
        self.assertEqual(self.api.get(PUB + "cards?status=published").data["data"], [])
        self.assertEqual(self.api.get(PUB + "cards?status=bogus").status_code, 400)


class TeamTests(PublicApiBase):
    def test_invite_uses_the_invite_flow(self):
        res = self.api.post(PUB + "invites", {"invites": [
            {"email": "Nia@acme.test", "full_name": "Nia Doe", "title": "Designer", "language": "ar"},
        ]}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        row = res.data["data"][0]
        self.assertEqual((row["email"], row["status"], row["role"]), ("nia@acme.test", "invited", "employee"))
        self.assertIsNotNone(row["card_id"])
        self.assertTrue(any("nia@acme.test" in m.to for m in mail.outbox))
        event = AuditEvent.objects.get(action="invite.sent")
        self.assertEqual(event.actor_name, self.key.name)

    def test_cannot_invite_admins(self):
        res = self.api.post(PUB + "invites", {"invites": [{"email": "x@acme.test", "role": "admin"}]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_seats_are_respected(self):
        # ten seats in the company, one used by the owner
        many = [{"email": f"s{i}@acme.test"} for i in range(10)]
        res = self.api.post(PUB + "invites", {"invites": many}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        self.assertEqual(Member.objects.filter(workspace_id=self.ws).count(), 1)

    def test_domain_rules_duplicates_and_departments(self):
        Workspace.objects.filter(pk=self.ws).update(allowed_email_domains=["acme.test"])
        res = self.api.post(PUB + "invites", {"invites": [{"email": "a@elsewhere.test"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.api.post(PUB + "invites", {"invites": [{"email": "owner@example.com"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.api.post(PUB + "invites", {"invites": [{"email": "d@acme.test", "department_id": "00000000-0000-0000-0000-000000000009"}]}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.api.post(PUB + "invites", {"invites": [{"email": "x@acme.test"}, {"email": "x@acme.test"}]}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_suspend_restore_remove(self):
        olga = self.add("olga@acme.test", "Olga Doe")
        res = self.api.post(PUB + f"members/{olga.member_id}/suspend")
        self.assertEqual((res.status_code, res.data["status"]), (200, "suspended"))
        self.assertEqual(Card.objects.get(pk=olga.card_id).status, "suspended")
        self.assertEqual(self.api.post(PUB + f"members/{olga.member_id}/suspend").status_code, 400)
        res = self.api.post(PUB + f"members/{olga.member_id}/restore")
        self.assertEqual(res.data["status"], "active")
        res = self.api.delete(PUB + f"members/{olga.member_id}")
        self.assertEqual(res.status_code, 204)
        self.assertFalse(Member.objects.filter(pk=olga.member_id).exists())
        actions = set(AuditEvent.objects.values_list("action", flat=True))
        self.assertTrue({"member.suspended", "member.restored", "member.removed"} <= actions)
        self.assertEqual(AuditEvent.objects.filter(action="member.removed").first().actor_name, self.key.name)

    def test_cannot_touch_the_owner_or_an_admin(self):
        owner_member = Member.objects.get(workspace_id=self.ws, role="owner")
        ada = self.add("ada@acme.test", "Ada Admin", role="admin")
        for target in (owner_member.id, ada.member_id):
            self.assertEqual(self.api.post(PUB + f"members/{target}/suspend").status_code, 403)
            self.assertEqual(self.api.delete(PUB + f"members/{target}").status_code, 403)
        self.assertTrue(Member.objects.filter(pk=ada.member_id, status="active").exists())

    def test_list_and_filters(self):
        self.add("pia@acme.test", "Pia Doe")
        rows = self.api.get(PUB + "members?status=active").data["data"]
        self.assertEqual({r["email"] for r in rows}, {"owner@example.com", "pia@acme.test"})
        self.assertEqual(len(self.api.get(PUB + "members?email=pia@acme.test").data["data"]), 1)
        self.assertNotIn("user", rows[0])


class LeadTests(PublicApiBase):
    def test_get_and_list_shape(self):
        lead = self.lead(name="Ravi", phone="+974555")
        row = self.api.get(PUB + f"leads/{lead.id}").data
        self.assertEqual((row["name"], row["message"], row["status"]), ("Ravi", "Hello", "new"))
        self.assertNotIn("notes", row)
        self.assertEqual(len(self.api.get(PUB + "leads?status=new").data["data"]), 1)
        self.assertEqual(self.api.get(PUB + "leads?status=won").data["data"], [])
        self.assertEqual(self.api.get(PUB + "leads?status=nonsense").status_code, 400)
        self.assertEqual(len(self.api.get(PUB + "leads?email=RAVI@nowhere.test").data["data"]), 0)

    def test_patch_status_and_assignee_and_audit(self):
        sam = self.add("sam@acme.test", "Sam Doe")
        lead = self.lead()  # a contact of the company itself; an employee's contact is the employee's, and is not reachable through the company's API key
        employees = self.lead(card=Card.objects.get(pk=sam.card_id), name="Sam's own")
        self.assertEqual(self.api.get(PUB + f"leads/{employees.id}").status_code, 404)
        res = self.api.patch(PUB + f"leads/{lead.id}", {"status": "qualified", "assignee_email": "sam@acme.test"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["status"], res.data["assignee"]["email"]), ("qualified", "sam@acme.test"))
        lead.refresh_from_db()
        self.assertEqual(lead.status, "qualified")
        actions = AuditEvent.objects.filter(target_id=str(lead.id))
        self.assertEqual({a.action for a in actions}, {"lead.assigned", "lead.status_changed"})
        self.assertTrue(all(a.actor_name == self.key.name and a.actor is None for a in actions))
        timeline = lead.activity.filter(kind="status_changed").first()
        self.assertIsNone(timeline.actor)
        self.assertIn(self.key.name, timeline.actor_name)
        cleared = self.api.patch(PUB + f"leads/{lead.id}", {"assignee_id": None}, format="json")
        self.assertIsNone(cleared.data["assignee"])

    def test_bad_patches(self):
        lead = self.lead()
        self.assertEqual(self.api.patch(PUB + f"leads/{lead.id}", {"status": "great"}, format="json").status_code, 400)
        self.assertEqual(self.api.patch(PUB + f"leads/{lead.id}", {}, format="json").status_code, 400)
        self.assertEqual(self.api.patch(PUB + f"leads/{lead.id}", {"name": "Hacked"}, format="json").status_code, 400)
        lead.refresh_from_db()
        self.assertEqual(lead.name, "Lena Lead")


class AnalyticsTests(PublicApiBase):
    def test_summary_and_per_card(self):
        tess = self.add("tess@acme.test", "Tess Doe")
        card = Card.objects.get(pk=tess.card_id)
        for _ in range(3):
            Event.objects.create(card=card, type="view", source="qr")
        Event.objects.create(card=card, type="save")
        self.lead(card=card)
        summary = self.api.get(PUB + "analytics/summary?days=7").data
        self.assertEqual((summary["totals"]["views"], summary["totals"]["scans"], summary["totals"]["saves"], summary["totals"]["leads"]), (3, 3, 1, 1))
        self.assertEqual(summary["period"]["days"], 7)
        rows = self.api.get(PUB + "analytics/cards").data["data"]
        mine = next(r for r in rows if r["card_id"] == tess.card_id)
        self.assertEqual((mine["views"], mine["saves"], mine["leads"]), (3, 1, 1))
        one = self.api.get(PUB + f"analytics/cards/{tess.card_id}?days=7").data
        self.assertEqual(one["totals"]["views"], 3)
        self.assertEqual(self.api.get(PUB + "analytics/summary?tz=Nowhere/City").status_code, 400)


class LogMaskTests(PublicApiBase):
    def test_api_keys_and_tokens_are_masked_in_logs(self):
        from ilaf.logfilters import mask

        secret = self.secret
        self.assertNotIn(secret, mask(f"GET /api/public/v1/me key {secret} failed"))
        self.assertNotIn(secret, mask(f"Authorization: Bearer {secret}"))
        self.assertEqual(mask("Bearer abcdefghijklmnopqrstuvwxyz"), "Bearer <hidden>")
        self.assertNotIn("abcdef123456", mask("GET /cb?code=abcdef123456&state=zzz"))
        self.assertNotIn("abcdef123456", mask("GET /x?client_secret=abcdef123456"))
        self.assertEqual(mask("plain text"), "plain text")

    def test_no_log_line_holds_the_key_when_a_request_fails(self):
        with self.assertLogs("django.request", level="WARNING") as captured:
            self.api.get(PUB + "cards/00000000-0000-0000-0000-000000000001")
        from ilaf.logfilters import MaskSecrets

        for record in captured.records:
            MaskSecrets().filter(record)
            self.assertNotIn(self.secret, record.getMessage())
