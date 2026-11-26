"""Custom domains (Enterprise): names that are refused, claims that start pending, DNS checks with a fake resolver, the first
company to verify wins, cron, resolve/allowed, the card address on the company domain, and isolation between companies."""
from datetime import timedelta
from io import StringIO

from django.core import mail
from django.core.management import call_command
from django.db import connection
from django.db.migrations.executor import MigrationExecutor
from django.test import TransactionTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from ilaf.errors import ApiError
from workspaces import domains
from workspaces.models import CustomDomain, Workspace

from .base import API, ApiTestCase

CNAME = "cards.bench.test"


class FakeResolver(domains.DnsResolver):
    """Answers from dictionaries. Names in `down` raise DnsLookupError (a DNS outage)."""

    def __init__(self, txt=None, cname=None, addresses=None, down=()):
        self.txt_records = txt or {}
        self.cname_records = cname or {}
        self.address_records = addresses or {}
        self.down = set(down)
        self.asked = []

    def _ask(self, kind, name):
        self.asked.append((kind, name))
        if name in self.down:
            raise domains.DnsLookupError("timeout")

    def txt(self, name):
        self._ask("TXT", name)
        return list(self.txt_records.get(name, []))

    def cname(self, name):
        self._ask("CNAME", name)
        return list(self.cname_records.get(name, []))

    def addresses(self, name):
        self._ask("A", name)
        return list(self.address_records.get(name, []))

    @classmethod
    def good(cls, row):
        return cls(txt={domains.txt_name(row.domain): [domains.txt_value(row)]}, cname={row.domain: [CNAME]})


@override_settings(CARD_DOMAIN_CNAME_TARGET=CNAME, CARD_DOMAIN_A_RECORDS=[], DOMAIN_ASK_TOKEN="")
class DomainBase(ApiTestCase):
    def setUp(self):
        super().setUp()
        domains.set_resolver(None)
        self.owner = self.signup("owner@acme.test", "Olivia Owner")
        self.ws = self.company(self.owner, "Acme Ltd")
        self.url = f"{API}workspaces/{self.ws}/domain"

    def tearDown(self):
        domains.set_resolver(None)
        super().tearDown()

    def other_company(self, email="boss@other.test", name="Other Co"):
        boss = self.signup(email, "Bob Boss")
        return boss, self.company(boss, name)

    def claim(self, person, ws, domain="cards.acme.test"):
        res = person.client.put(f"{API}workspaces/{ws}/domain", {"domain": domain}, format="json")
        self.assertIn(res.status_code, (200, 201), res.content)
        return CustomDomain.objects.get(workspace_id=ws)

    def verify(self, person, ws, domain="cards.acme.test"):
        row = self.claim(person, ws, domain)
        domains.set_resolver(FakeResolver.good(row))
        res = person.client.post(f"{API}workspaces/{ws}/domain/check")
        self.assertEqual(res.status_code, 200, res.content)
        row.refresh_from_db()
        self.assertEqual(row.status, "verified")
        domains.set_resolver(None)
        return row

    def lapse(self, ws):
        """The company's Enterprise period is over (and its grace days)."""
        from billing.models import Subscription

        Subscription.objects.filter(workspace_id=ws).update(status="expired")


class NormaliseTests(DomainBase):
    def test_accepted_forms(self):
        self.assertEqual(domains.normalise_domain("  Cards.Northgate.COM. "), "cards.northgate.com")
        self.assertEqual(domains.normalise_domain("münchen.de"), "xn--mnchen-3ya.de")
        self.assertEqual(domains.normalise_domain("northgate.co.uk"), "northgate.co.uk")
        self.assertEqual(domains.normalise_domain("a-b.c-d.example.org"), "a-b.c-d.example.org")

    def test_refused_values(self):
        bad = [
            "", "   ", "*.northgate.com", "*", "https://cards.northgate.com", "cards.northgate.com/x", "cards.northgate.com?x=1",
            "me@northgate.com", "cards.northgate.com:8443", "10.0.0.1", "8.8.8.8", "2130706433", "[::1]", "::1", "2001:db8::1",
            "localhost", "localhost.", "printer.local", "x.localhost", "x.internal", "x.invalid", "x.onion", "intranet", "com",
            "co.uk", "github.io", "herokuapp.com", "northgate", "-bad.example.com", "bad-.example.com", "a_b.example.com",
            "a..example.com", "x" * 64 + ".example.com", ("a" * 60 + ".") * 5 + "com", "exa mple.com", "example.c",
            "example.123",
        ]
        for value in bad:
            with self.assertRaises(ApiError, msg=repr(value)) as cm:
                domains.normalise_domain(value)
            self.assertEqual((cm.exception.code, cm.exception.status_code), ("invalid_domain", 400), repr(value))

    def test_our_own_hosts_and_their_parents_are_refused(self):
        # WEB_BASE_URL is https://web.test and API_BASE_URL https://api.test in the tests; the CNAME target is cards.bench.test.
        for value in ("web.test", "api.test", "cards.bench.test", "app.web.test", "x.cards.bench.test", "bench.test"):
            with self.assertRaises(ApiError, msg=value):
                domains.normalise_domain(value)
        with override_settings(CARD_DOMAIN_RESERVED_HOSTS=["staff.example.org"]):
            with self.assertRaises(ApiError):
                domains.normalise_domain("staff.example.org")
            with self.assertRaises(ApiError):
                domains.normalise_domain("example.org")  # the parent of a reserved host

    def test_apex_detection(self):
        self.assertTrue(domains.is_apex("northgate.com"))
        self.assertTrue(domains.is_apex("northgate.co.uk"))
        self.assertTrue(domains.is_apex("northgate.com.qa"))
        self.assertFalse(domains.is_apex("cards.northgate.com"))
        self.assertFalse(domains.is_apex("cards.northgate.co.uk"))


class ClaimTests(DomainBase):
    def test_claim_is_pending_with_records_and_not_live(self):
        res = self.owner.client.put(self.url, {"domain": "Cards.Acme.Test."}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        info = res.data["domain"]
        self.assertEqual((info["domain"], info["status"], info["serving"]), ("cards.acme.test", "pending", False))
        row = CustomDomain.objects.get(workspace_id=self.ws)
        self.assertGreaterEqual(len(row.token), 24)
        self.assertEqual(info["records"]["txt"], {"type": "TXT", "name": "_bench-verify.cards.acme.test", "value": f"bench-verify={row.token}"})
        self.assertEqual(info["records"]["cname"], {"type": "CNAME", "name": "cards.acme.test", "value": CNAME})
        self.assertFalse(info["records"]["apex"])
        self.assertIsNotNone(info["expires_at"])
        # Backwards compatible: the old field shows only a VERIFIED domain; the richer field shows the claim.
        ws = self.owner.client.get(f"{API}workspaces/{self.ws}").data
        self.assertIsNone(ws["custom_domain"])
        self.assertEqual(ws["custom_domain_info"]["status"], "pending")
        self.assertEqual(self.owner.client.get(self.url).data["domain"]["domain"], "cards.acme.test")
        self.assertEqual(self.owner.client.put(self.url, {"domain": "cards.acme.test"}, format="json").status_code, 200)  # same value: no new token
        self.assertEqual(CustomDomain.objects.get(workspace_id=self.ws).token, row.token)
        self.assertEqual(AuditActions(self.ws).count("custom_domain.added"), 1)

    def test_invalid_values_are_400(self):
        for bad in ("localhost", "https://x.com", "1.2.3.4", "web.test"):
            res = self.owner.client.put(self.url, {"domain": bad}, format="json")
            self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "invalid_domain"), bad)
        self.assertEqual(self.owner.client.put(self.url, {}, format="json").status_code, 400)
        self.assertFalse(CustomDomain.objects.exists())

    def test_enterprise_only_writes_but_clearing_stays_possible(self):
        plain = self.signup("plain@acme.test", "Pat Plain")
        plain_ws = self.company(plain, "Plain Co", plan="company")
        res = plain.client.put(f"{API}workspaces/{plain_ws}/domain", {"domain": "cards.plain.test"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        res = plain.client.patch(f"{API}workspaces/{plain_ws}", {"custom_domain": "cards.plain.test"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        # A claim that exists (an old value migrated) can be read and removed, but not checked.
        CustomDomain.objects.create(workspace_id=plain_ws, domain="old.plain.test", token="t" * 24)
        self.assertEqual(plain.client.get(f"{API}workspaces/{plain_ws}/domain").data["domain"]["domain"], "old.plain.test")
        res = plain.client.post(f"{API}workspaces/{plain_ws}/domain/check")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "plan_limit"))
        self.assertEqual(plain.client.delete(f"{API}workspaces/{plain_ws}/domain").status_code, 204)
        self.assertFalse(CustomDomain.objects.filter(workspace_id=plain_ws).exists())

    def test_only_owner_and_admin(self):
        emp = self.join(self.invite(self.owner, self.ws, "emp@acme.test"))
        for method, path in (("get", ""), ("put", ""), ("delete", ""), ("post", "/check")):
            kwargs = {"data": {"domain": "cards.acme.test"}, "format": "json"} if method == "put" else {}
            res = getattr(emp.client, method)(self.url + path, **kwargs)
            self.assertEqual(res.status_code, 403, (method, path))
        stranger = self.signup("stranger@x.test", "Sam Stranger")
        self.assertEqual(stranger.client.get(self.url).status_code, 404)
        self.assertEqual(APIClient().get(self.url).status_code, 401)
        # An admin may.
        admin = self.join(self.invite(self.owner, self.ws, "admin@acme.test", role="admin"))
        self.assertEqual(admin.client.put(self.url, {"domain": "cards.acme.test"}, format="json").status_code, 201)

    def test_patch_custom_domain_delegates(self):
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"custom_domain": "Cards.Acme.Test"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIsNone(res.data["custom_domain"])
        self.assertEqual(res.data["custom_domain_info"]["status"], "pending")
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"custom_domain": "not a domain"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = self.owner.client.patch(f"{API}workspaces/{self.ws}", {"custom_domain": ""}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["custom_domain_info"])
        self.assertFalse(CustomDomain.objects.exists())

    def test_replacing_a_domain_makes_a_new_token(self):
        first = self.claim(self.owner, self.ws, "one.acme.test")
        second = self.claim(self.owner, self.ws, "two.acme.test")
        self.assertEqual(CustomDomain.objects.filter(workspace_id=self.ws).count(), 1)
        self.assertNotEqual(first.token, second.token)
        self.assertEqual(second.status, "pending")

    def test_remove_and_audit(self):
        self.verify(self.owner, self.ws)
        self.assertEqual(self.owner.client.delete(self.url).status_code, 204)
        self.assertFalse(CustomDomain.objects.exists())
        self.assertEqual(self.owner.client.delete(self.url).status_code, 204)  # again: nothing to do
        self.assertEqual(AuditActions(self.ws).count("custom_domain.verified"), 1)
        self.assertEqual(AuditActions(self.ws).count("custom_domain.removed"), 1)
        self.assertIsNone(self.owner.client.get(f"{API}workspaces/{self.ws}").data["custom_domain"])


def AuditActions(ws):
    from operations.models import AuditEvent

    return list(AuditEvent.objects.filter(workspace_id=ws).values_list("action", flat=True))


class CheckTests(DomainBase):
    def check(self, resolver, person=None):
        domains.set_resolver(resolver)
        res = (person or self.owner).client.post(f"{self.url}/check")
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def setUp(self):
        super().setUp()
        self.row = self.claim(self.owner, self.ws)
        self.txt = domains.txt_name("cards.acme.test")

    def test_every_failure_reason(self):
        value = domains.txt_value(self.row)
        cases = [
            (FakeResolver(), "txt_missing"),
            (FakeResolver(txt={self.txt: ["bench-verify=wrong"]}, cname={"cards.acme.test": [CNAME]}), "txt_mismatch"),
            (FakeResolver(txt={self.txt: ["v=spf1 -all"]}), "txt_mismatch"),
            (FakeResolver(txt={self.txt: [value]}), "cname_missing"),
            (FakeResolver(txt={self.txt: [value]}, cname={"cards.acme.test": ["elsewhere.example.net"]}), "cname_wrong"),
            (FakeResolver(txt={self.txt: [value]}, down={"cards.acme.test"}), "dns_error"),
            (FakeResolver(down={self.txt}), "dns_error"),
        ]
        for resolver, reason in cases:
            data = self.check(resolver)
            self.assertFalse(data["result"]["ok"], reason)
            self.assertEqual(data["result"]["reason"], reason)
            self.assertEqual((data["domain"]["status"], data["domain"]["last_error"]), ("failed", reason))
            self.assertTrue(data["result"]["message"])
            self.assertFalse(data["domain"]["serving"])
        self.assertTrue(self.check(FakeResolver(txt={self.txt: [value]}, cname={"cards.acme.test": ["elsewhere.example.net"]}))["result"]["txt_ok"])

    def test_success_verifies_and_serves(self):
        data = self.check(FakeResolver.good(self.row))
        self.assertEqual((data["result"]["ok"], data["domain"]["status"], data["domain"]["serving"]), (True, "verified", True))
        self.assertIsNone(data["domain"]["last_error"])
        ws = self.owner.client.get(f"{API}workspaces/{self.ws}").data
        self.assertEqual(ws["custom_domain"], "cards.acme.test")  # the old field now shows the verified domain
        self.assertIn("custom_domain.verified", AuditActions(self.ws))

    def test_txt_quoted_and_with_other_records_is_found(self):
        value = domains.txt_value(self.row)
        data = self.check(FakeResolver(txt={self.txt: ["google-site=xyz", f'"{value}"'], }, cname={"cards.acme.test": [CNAME]}))
        self.assertTrue(data["result"]["ok"])

    def test_cname_through_a_chain_and_with_the_right_target_only(self):
        value = domains.txt_value(self.row)
        chain = FakeResolver(txt={self.txt: [value]}, cname={"cards.acme.test": ["edge.example.net"], "edge.example.net": [CNAME]})
        self.assertTrue(self.check(chain)["result"]["ok"])

    def test_apex_with_fixed_addresses(self):
        with override_settings(CARD_DOMAIN_A_RECORDS=["203.0.113.10"]):
            row = self.claim(self.owner, self.ws, "northgate.com")
            info = self.owner.client.get(self.url).data["domain"]
            self.assertTrue(info["records"]["apex"])
            self.assertEqual(info["records"]["a"], [{"type": "A", "name": "northgate.com", "value": "203.0.113.10"}])
            txt = {domains.txt_name("northgate.com"): [domains.txt_value(row)]}
            self.assertFalse(self.check(FakeResolver(txt=txt, addresses={"northgate.com": ["198.51.100.7"]}))["result"]["ok"])
            self.assertTrue(self.check(FakeResolver(txt=txt, addresses={"northgate.com": ["198.51.100.7", "203.0.113.10"]}))["result"]["ok"])

    def test_cname_is_the_only_way_without_a_configured_address(self):
        value = domains.txt_value(self.row)
        res = FakeResolver(txt={self.txt: [value]}, addresses={"cards.acme.test": ["203.0.113.10"]})
        self.assertEqual(self.check(res)["result"]["reason"], "cname_missing")

    def test_check_without_a_claim_is_404(self):
        self.owner.client.delete(self.url)
        res = self.owner.client.post(f"{self.url}/check")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (404, "domain_not_found"))

    def test_check_is_throttled(self):
        domains.set_resolver(FakeResolver())
        with override_settings(ILAF_THROTTLE_RATES={"domain_check": "2/min"}):
            codes = [self.owner.client.post(f"{self.url}/check").status_code for _ in range(4)]
        self.assertEqual(codes, [200, 200, 429, 429])

    def test_expired_claim_restarts_on_check(self):
        CustomDomain.objects.filter(pk=self.row.pk).update(status="expired", requested_at=timezone.now() - timedelta(days=30))
        data = self.check(FakeResolver.good(self.row))
        self.assertEqual(data["domain"]["status"], "verified")
        CustomDomain.objects.filter(pk=self.row.pk).update(status="expired")
        data = self.check(FakeResolver())
        self.assertEqual(data["domain"]["status"], "failed")  # a new 7-day window opened and the check failed
        self.assertIsNotNone(data["domain"]["expires_at"])


class SquattingTests(DomainBase):
    def test_pending_claims_coexist_and_the_first_to_verify_wins(self):
        boss, other_ws = self.other_company()
        mine = self.claim(self.owner, self.ws, "cards.shared.test")
        theirs = self.claim(boss, other_ws, "cards.shared.test")  # nothing blocks a pending claim
        self.assertNotEqual(mine.token, theirs.token)
        # Their TXT is right, mine is not: they verify.
        domains.set_resolver(FakeResolver.good(theirs))
        self.assertEqual(boss.client.post(f"{API}workspaces/{other_ws}/domain/check").data["domain"]["status"], "verified")
        # I cannot verify any more, even with DNS that matches my token.
        domains.set_resolver(FakeResolver.good(mine))
        data = self.owner.client.post(f"{self.url}/check").data
        self.assertEqual((data["domain"]["status"], data["result"]["reason"]), ("failed", "domain_taken"))
        # And I cannot claim it afresh.
        res = self.owner.client.put(self.url, {"domain": "cards.shared.test"}, format="json")
        self.assertEqual(res.status_code, 200)  # the same pending row stays (a failed one restarts as pending) ...
        self.owner.client.delete(self.url)
        res = self.owner.client.put(self.url, {"domain": "cards.shared.test"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "domain_taken"))  # ... but a new claim is refused

    def test_database_refuses_two_verified_rows(self):
        from django.db import IntegrityError, transaction

        boss, other_ws = self.other_company()
        CustomDomain.objects.create(workspace_id=self.ws, domain="x.shared.test", token="a", status="verified")
        with self.assertRaises(IntegrityError), transaction.atomic():
            CustomDomain.objects.create(workspace_id=other_ws, domain="x.shared.test", token="b", status="dns_broken")
        CustomDomain.objects.create(workspace_id=other_ws, domain="x.shared.test", token="b", status="pending")  # pending is fine

    def test_removing_releases_the_name(self):
        boss, other_ws = self.other_company()
        self.verify(self.owner, self.ws, "cards.shared.test")
        self.owner.client.delete(self.url)
        row = self.verify(boss, other_ws, "cards.shared.test")
        self.assertEqual(row.workspace_id.hex, other_ws.replace("-", ""))


class CronTests(DomainBase):
    def run_cron(self, resolver, now=None, force=False):
        return domains.run_checks(now=now, resolver=resolver, force=force)

    def test_pending_claims_are_rechecked_then_expire_after_seven_days(self):
        row = self.claim(self.owner, self.ws)
        now = timezone.now()
        s = self.run_cron(FakeResolver(), now)
        row.refresh_from_db()
        self.assertEqual((s["checked"], row.status, row.last_error), (1, "failed", "txt_missing"))
        s = self.run_cron(FakeResolver(), now + timedelta(days=6, hours=23))
        row.refresh_from_db()
        self.assertEqual(row.status, "failed")
        s = self.run_cron(FakeResolver(), now + timedelta(days=7, hours=1))
        row.refresh_from_db()
        self.assertEqual((s["expired"], row.status, s["checked"]), (1, "expired", 0))
        # An expired claim is not checked any more, but the owner can press "Check now".
        self.assertEqual(self.owner.client.get(self.url).data["domain"]["status"], "expired")

    def test_cron_verifies_a_claim_when_dns_appears(self):
        row = self.claim(self.owner, self.ws)
        s = self.run_cron(FakeResolver.good(row))
        row.refresh_from_db()
        self.assertEqual((s["verified"], row.status), (1, "verified"))

    def test_claims_of_companies_that_are_not_enterprise_do_not_take_a_name(self):
        row = self.claim(self.owner, self.ws)
        self.lapse(self.ws)
        s = self.run_cron(FakeResolver.good(row))
        row.refresh_from_db()
        self.assertEqual((s["checked"], row.status), (0, "pending"))

    def test_verified_domains_are_rechecked_about_once_a_day(self):
        row = self.verify(self.owner, self.ws)
        resolver = FakeResolver.good(row)
        self.assertEqual(self.run_cron(resolver)["checked"], 0)  # just checked
        self.assertEqual(self.run_cron(resolver, timezone.now() + timedelta(hours=21))["checked"], 1)
        self.assertEqual(self.run_cron(resolver, force=True)["checked"], 1)

    def test_missing_records_mark_dns_broken_email_the_owner_keep_serving_then_release(self):
        row = self.verify(self.owner, self.ws)
        t0 = timezone.now() + timedelta(hours=25)
        mail.outbox.clear()
        self.run_cron(FakeResolver(), t0)  # day 1: first miss, nothing yet
        row.refresh_from_db()
        self.assertEqual((row.status, row.last_error), ("verified", "txt_missing"))
        self.assertIsNotNone(row.failing_since)
        self.assertEqual(len(mail.outbox), 0)
        self.run_cron(FakeResolver(), t0 + timedelta(days=2, hours=2))  # still inside the 3 days
        row.refresh_from_db()
        self.assertEqual(row.status, "verified")
        t_broken = t0 + timedelta(days=3, hours=1)
        s = self.run_cron(FakeResolver(), t_broken)
        row.refresh_from_db()
        self.assertEqual((s["broken"], row.status), (1, "dns_broken"))
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("cards.acme.test", mail.outbox[0].subject)
        self.assertEqual(mail.outbox[0].to, ["owner@acme.test"])
        self.assertIn("custom_domain.broken", AuditActions(self.ws))
        # Still served during the grace period, and it still owns the name.
        self.assertEqual(domains.host_state("cards.acme.test")[1], "active")
        boss, other_ws = self.other_company()
        other_row = CustomDomain.objects.create(workspace_id=other_ws, domain="cards.acme.test", token="o" * 24)  # claimed earlier, still pending
        domains.set_resolver(FakeResolver.good(other_row))
        self.assertEqual(boss.client.post(f"{API}workspaces/{other_ws}/domain/check").data["result"]["reason"], "domain_taken")
        domains.set_resolver(None)
        self.run_cron(FakeResolver(), t_broken + timedelta(days=2))
        self.assertEqual(len(mail.outbox), 1)  # one mail only
        # After the grace days the name is released.
        s = self.run_cron(FakeResolver(), t_broken + timedelta(days=14, hours=2))
        row.refresh_from_db()
        self.assertEqual((s["released"], row.status, row.last_error), (1, "failed", "dns_released"))
        self.assertEqual(domains.host_state("cards.acme.test")[1], "unknown")

    def test_a_dns_outage_is_not_counted_as_missing_records(self):
        row = self.verify(self.owner, self.ws)
        t0 = timezone.now() + timedelta(hours=25)
        for n in range(6):
            self.run_cron(FakeResolver(down={domains.txt_name(row.domain)}), t0 + timedelta(days=n), force=True)
        row.refresh_from_db()
        self.assertEqual((row.status, row.failing_since), ("verified", None))

    def test_records_coming_back_heal_a_broken_domain(self):
        row = self.verify(self.owner, self.ws)
        CustomDomain.objects.filter(pk=row.pk).update(status="dns_broken", broken_at=timezone.now() - timedelta(days=2), failing_since=timezone.now() - timedelta(days=5))
        self.run_cron(FakeResolver.good(row), force=True)
        row.refresh_from_db()
        self.assertEqual((row.status, row.failing_since, row.broken_at, row.last_error), ("verified", None, None, ""))

    def test_command_and_arabic_mail(self):
        row = self.verify(self.owner, self.ws)
        from accounts.models import User

        User.objects.filter(email="owner@acme.test").update(language="ar")
        CustomDomain.objects.filter(pk=row.pk).update(failing_since=timezone.now() - timedelta(days=4), last_checked_at=None)
        domains.set_resolver(FakeResolver())
        mail.outbox.clear()
        out = StringIO()
        call_command("check_custom_domains", stdout=out)
        self.assertIn("dns_broken 1", out.getvalue())
        self.assertEqual(len(mail.outbox), 1)
        self.assertNotIn("The DNS records", mail.outbox[0].subject)  # Arabic subject


class ResolveTests(DomainBase):
    def resolve(self, host, **extra):
        return APIClient().get(f"{API}domains/resolve", {"host": host}, **extra)

    def test_unknown_pending_and_garbage_hosts(self):
        self.claim(self.owner, self.ws)
        for host in ("cards.acme.test", "nobody.example.com", "", "   ", "x" * 400, "web.test"):
            res = self.resolve(host)
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data, {"verified": False, "state": "unknown"}, host)

    def test_verified_enterprise_company_with_directory(self):
        self.verify(self.owner, self.ws)
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"directory_slug": "acme-people", "directory_enabled": True}}, format="json")
        res = self.resolve("Cards.Acme.Test.")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(set(res.data), {"verified", "state", "workspace", "kind", "directory_enabled", "directory_slug", "company_card"})
        self.assertEqual((res.data["verified"], res.data["state"], res.data["kind"], res.data["directory_slug"]), (True, "active", "directory", "acme-people"))
        self.assertTrue(res.data["workspace"].startswith("ws_"))
        self.assertNotIn(self.ws, str(res.data))
        self.assertIn("max-age", res["Cache-Control"])

    def test_root_is_the_company_card_without_a_directory_else_none(self):
        self.verify(self.owner, self.ws)
        self.assertEqual(self.resolve("cards.acme.test").data["kind"], "none")
        from cards.models import Card

        company_card = self.make_card(self.owner, self.ws)
        Card.objects.filter(pk=company_card["id"]).update(is_company=True)
        res = self.resolve("cards.acme.test")
        self.assertEqual((res.data["kind"], res.data["company_card"]), ("card", company_card["public_code"]))

    def test_plan_lapsed_means_inactive(self):
        self.verify(self.owner, self.ws)
        self.lapse(self.ws)
        res = self.resolve("cards.acme.test")
        self.assertEqual(res.data, {"verified": False, "state": "inactive"})

    def test_deleted_company_is_inactive(self):
        self.verify(self.owner, self.ws)
        Workspace.objects.filter(pk=self.ws).update(deleted_at=timezone.now())
        self.assertEqual(self.resolve("cards.acme.test").data["state"], "inactive")

    def test_throttle_scope(self):
        with override_settings(ILAF_THROTTLE_RATES={"domain_resolve": "2/min"}):
            codes = [self.resolve("a.example.com").status_code for _ in range(4)]
        self.assertEqual(codes, [200, 200, 429, 429])

    def test_custom_hosts_are_not_django_hosts(self):
        # The web server calls the API with the API's own host; a request that arrives with a customer's Host header is refused.
        res = APIClient().get(f"{API}domains/resolve", {"host": "cards.acme.test"}, HTTP_HOST="cards.acme.test")
        self.assertEqual(res.status_code, 400)


class AllowedTests(DomainBase):
    def ask(self, domain, **extra):
        return APIClient().get(f"{API}domains/allowed", {"domain": domain}, **extra)

    def test_only_verified_enterprise_live_domains_get_a_certificate(self):
        self.claim(self.owner, self.ws)
        self.assertEqual(self.ask("cards.acme.test").status_code, 404)  # pending
        row = CustomDomain.objects.get(workspace_id=self.ws)
        domains.set_resolver(FakeResolver.good(row))
        self.owner.client.post(f"{self.url}/check")
        domains.set_resolver(None)
        res = self.ask("cards.acme.test", REMOTE_ADDR="127.0.0.1")
        self.assertEqual((res.status_code, res.content), (200, b"ok"))
        self.assertEqual(self.ask("CARDS.acme.test.", REMOTE_ADDR="127.0.0.1").status_code, 200)
        self.assertEqual(self.ask("other.acme.test").status_code, 404)
        self.assertEqual(self.ask("").status_code, 404)
        self.lapse(self.ws)
        self.assertEqual(self.ask("cards.acme.test").status_code, 404)

    def test_without_a_token_only_this_machine_without_a_proxy(self):
        self.verify(self.owner, self.ws)
        self.assertEqual(self.ask("cards.acme.test", REMOTE_ADDR="203.0.113.5").status_code, 404)
        self.assertEqual(self.ask("cards.acme.test", REMOTE_ADDR="127.0.0.1", HTTP_X_FORWARDED_FOR="198.51.100.1").status_code, 404)
        self.assertEqual(self.ask("cards.acme.test", REMOTE_ADDR="127.0.0.1", HTTP_X_REAL_IP="198.51.100.1").status_code, 404)
        self.assertEqual(self.ask("cards.acme.test", REMOTE_ADDR="127.0.0.1").status_code, 200)

    @override_settings(DOMAIN_ASK_TOKEN="s3cret-token")
    def test_with_a_token_the_token_decides(self):
        self.verify(self.owner, self.ws)
        self.assertEqual(self.ask("cards.acme.test").status_code, 404)
        self.assertEqual(self.ask("cards.acme.test", HTTP_X_DOMAIN_ASK_TOKEN="nope").status_code, 404)
        self.assertEqual(self.ask("cards.acme.test", HTTP_X_DOMAIN_ASK_TOKEN="s3cret-token").status_code, 200)
        res = APIClient().get(f"{API}domains/allowed", {"domain": "cards.acme.test", "token": "s3cret-token"})
        self.assertEqual(res.status_code, 200)
        # A proxy header does not matter when a token is set.
        self.assertEqual(self.ask("cards.acme.test", HTTP_X_DOMAIN_ASK_TOKEN="s3cret-token", HTTP_X_FORWARDED_FOR="1.2.3.4").status_code, 200)
        self.assertEqual(self.ask("unknown.example.com", HTTP_X_DOMAIN_ASK_TOKEN="s3cret-token").status_code, 404)


class AddressTests(DomainBase):
    def public(self, key, host=None):
        params = {"host": host} if host else {}
        return APIClient().get(f"{API}public/cards/{key}", params)

    def test_card_addresses_use_the_domain_once_verified(self):
        card = self.published_card(self.owner, self.ws)
        code = card["public_code"]
        self.assertEqual(card["public_url"], f"https://web.test/c/{code}")
        self.claim(self.owner, self.ws)
        self.assertEqual(self.owner.client.get(f"{API}cards/{card['id']}").data["public_url"], f"https://web.test/c/{code}")  # pending: not yet
        row = self.verify(self.owner, self.ws)
        self.assertEqual(self.owner.client.get(f"{API}cards/{card['id']}").data["public_url"], f"https://cards.acme.test/{code}")
        res = self.public(code)
        self.assertEqual(res.data["card"]["public_url"], f"https://cards.acme.test/{code}")
        self.assertEqual(res.data["canonical"], code)
        # Still found at the normal Bench address too (no host given).
        self.assertEqual(self.public(code).status_code, 200)
        # A slug is used instead of the code.
        self.owner.client.patch(f"{API}cards/{card['id']}", {"slug": "olivia"}, format="json")
        self.assertEqual(self.public("olivia").data["card"]["public_url"], "https://cards.acme.test/olivia")
        # QR and wallet use the same address.
        qr = APIClient().get(f"{API}public/cards/olivia/qr.svg")
        self.assertEqual(qr.status_code, 200)
        import segno

        self.assertIn(b"svg", qr.content[:300])
        from cards.models import Card
        from cards.services import public_url

        self.assertEqual(public_url(Card.objects.get(pk=card["id"])), "https://cards.acme.test/olivia")
        # The plan lapses: the addresses go back to the Bench host at once (the memo only lives for one request).
        self.lapse(self.ws)
        self.assertEqual(public_url(Card.objects.get(pk=card["id"])), "https://web.test/c/olivia")
        self.assertEqual(row.domain, "cards.acme.test")

    def test_qr_encodes_the_domain_address(self):
        import segno

        card = self.published_card(self.owner, self.ws)
        self.verify(self.owner, self.ws)
        seen = []
        real = segno.make
        import public.views as pv

        pv.segno = type("S", (), {"make": staticmethod(lambda text, **kw: (seen.append(text), real(text, **kw))[1])})
        try:
            APIClient().get(f"{API}public/cards/{card['public_code']}/qr.svg")
            APIClient().get(f"{API}public/cards/{card['public_code']}/qr.png")
        finally:
            pv.segno = segno
        self.assertEqual(seen, [f"https://cards.acme.test/{card['public_code']}?s=qr"] * 2)

    def test_personal_cards_never_get_a_domain(self):
        card = self.published_card(self.owner, self.owner.ws)
        self.assertEqual(card["public_url"], f"https://web.test/c/{card['public_code']}")

    def test_directory_url(self):
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"directory_slug": "acme-people", "directory_enabled": True}}, format="json")
        res = APIClient().get(f"{API}public/directory/acme-people")
        self.assertEqual(res.data["company"]["url"], "https://web.test/d/acme-people")
        self.verify(self.owner, self.ws)
        res = APIClient().get(f"{API}public/directory/acme-people")
        self.assertEqual(res.data["company"]["url"], "https://cards.acme.test/")


class IsolationTests(DomainBase):
    def test_a_card_of_another_company_is_never_served_on_this_domain(self):
        mine = self.published_card(self.owner, self.ws)
        boss, other_ws = self.other_company()
        theirs = self.published_card(boss, other_ws)
        personal = self.published_card(boss, boss.ws)
        self.verify(self.owner, self.ws)
        ok = APIClient().get(f"{API}public/cards/{mine['public_code']}", {"host": "cards.acme.test"})
        self.assertEqual(ok.status_code, 200)
        for key in (theirs["public_code"], personal["public_code"]):
            for path in ("", "/vcard", "/qr.svg", "/qr.png"):
                res = APIClient().get(f"{API}public/cards/{key}{path}", {"host": "cards.acme.test"})
                self.assertEqual(res.status_code, 404, (key, path))
            # without a host it is public as always
            self.assertEqual(APIClient().get(f"{API}public/cards/{key}").status_code, 200)
        # Slugs and old slugs resolve only inside the workspace too.
        boss.client.patch(f"{API}cards/{theirs['id']}", {"slug": "bobby"}, format="json")
        self.assertEqual(APIClient().get(f"{API}public/cards/bobby", {"host": "cards.acme.test"}).status_code, 404)
        self.assertEqual(APIClient().get(f"{API}public/cards/bobby", {"host": "cards.other.test"}).status_code, 404)  # unknown host

    def test_host_must_be_active(self):
        mine = self.published_card(self.owner, self.ws)
        self.verify(self.owner, self.ws)
        self.lapse(self.ws)
        self.assertEqual(APIClient().get(f"{API}public/cards/{mine['public_code']}", {"host": "cards.acme.test"}).status_code, 404)
        self.assertEqual(APIClient().get(f"{API}public/cards/{mine['public_code']}", {"host": "nobody.example.com"}).status_code, 404)

    def test_directory_of_another_company_is_not_served_on_this_domain(self):
        boss, other_ws = self.other_company()
        boss.client.patch(f"{API}workspaces/{other_ws}", {"brand": {"directory_slug": "other-people", "directory_enabled": True}}, format="json")
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"directory_slug": "acme-people", "directory_enabled": True}}, format="json")
        self.verify(self.owner, self.ws)
        self.assertEqual(APIClient().get(f"{API}public/directory/acme-people", {"host": "cards.acme.test"}).status_code, 200)
        self.assertEqual(APIClient().get(f"{API}public/directory/other-people", {"host": "cards.acme.test"}).status_code, 404)
        self.assertEqual(APIClient().get(f"{API}public/directory/other-people").status_code, 200)

    def test_a_lapsed_company_never_shows_its_domain_in_card_json_of_others(self):
        boss, other_ws = self.other_company()
        theirs = self.published_card(boss, other_ws)
        self.verify(self.owner, self.ws)
        self.assertEqual(APIClient().get(f"{API}public/cards/{theirs['public_code']}").data["card"]["public_url"], f"https://web.test/c/{theirs['public_code']}")


class PrivacyAndStaffTests(DomainBase):
    def test_company_export_and_erasure(self):
        import json
        import zipfile

        from privacy import exporter
        from privacy.services import purge_workspace

        self.verify(self.owner, self.ws)
        ws = Workspace.objects.get(pk=self.ws)
        with zipfile.ZipFile(exporter.build_workspace_export(ws)) as z:
            data = json.loads(z.read("company.json"))
        self.assertEqual((data["custom_domain"], data["custom_domain_status"]), ("cards.acme.test", "verified"))
        self.assertNotIn(CustomDomain.objects.get(workspace=ws).token, json.dumps(data))
        purge_workspace(ws)
        self.assertFalse(CustomDomain.objects.filter(workspace=ws).exists())
        self.assertEqual(domains.host_state("cards.acme.test")[1], "unknown")


class MigrationTests(TransactionTestCase):
    """The old free-text custom_domain values become PENDING claims with a token; nothing is verified automatically."""

    def test_old_values_become_pending_claims(self):
        executor = MigrationExecutor(connection)
        executor.migrate([("workspaces", "0012_customdomain")])
        apps = MigrationExecutor(connection).loader.project_state([("workspaces", "0012_customdomain")]).apps
        Workspace_ = apps.get_model("workspaces", "Workspace")
        a = Workspace_.objects.create(kind="company", name="A", custom_domain="Cards.A.Test.")
        b = Workspace_.objects.create(kind="company", name="B", custom_domain="")
        c = Workspace_.objects.create(kind="company", name="C", custom_domain=None)
        d = Workspace_.objects.create(kind="company", name="D", custom_domain="google.com")
        try:
            executor = MigrationExecutor(connection)
            executor.migrate([("workspaces", "0014_remove_workspace_custom_domain")])
            apps = MigrationExecutor(connection).loader.project_state([("workspaces", "0014_remove_workspace_custom_domain")]).apps
            rows = {r.workspace_id: r for r in apps.get_model("workspaces", "CustomDomain").objects.all()}
            self.assertEqual(set(rows), {a.pk, d.pk})
            self.assertEqual((rows[a.pk].domain, rows[a.pk].status), ("cards.a.test", "pending"))
            self.assertEqual(rows[d.pk].status, "pending")  # google.com is NOT verified because somebody typed it
            self.assertGreaterEqual(len(rows[a.pk].token), 24)
            self.assertNotEqual(rows[a.pk].token, rows[d.pk].token)
            # And back again: the values return to the old column.
            MigrationExecutor(connection).migrate([("workspaces", "0012_customdomain")])
            apps = MigrationExecutor(connection).loader.project_state([("workspaces", "0012_customdomain")]).apps
            self.assertEqual(apps.get_model("workspaces", "Workspace").objects.get(pk=a.pk).custom_domain, "cards.a.test")
        finally:
            executor = MigrationExecutor(connection)  # leave the database fully migrated for later tests
            executor.migrate(executor.loader.graph.leaf_nodes())
            Workspace.objects.filter(pk__in=[a.pk, b.pk, c.pk, d.pk]).delete()
