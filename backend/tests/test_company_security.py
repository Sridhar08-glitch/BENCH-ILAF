"""Verified company domains, company-branded e-mails (look, sender, reply-to, preview)."""
import re
from datetime import timedelta
from unittest import mock

from django.core import mail
from django.test import SimpleTestCase, override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from ilaf import company_mail
from security import company
from security.models import VerifiedDomain
from workspaces.models import Member, Workspace

from .base import API, ApiTestCase


class DomainRuleTests(SimpleTestCase):
    def test_free_mail_and_disposable_domains_are_refused(self):
        for domain in ("gmail.com", "outlook.com", "yahoo.com", "hotmail.com", "icloud.com", "proton.me", "protonmail.com", "mailinator.com", "mail.gmail.com"):
            self.assertEqual(company.domain_problem(domain), "free_mail", domain)

    def test_shapes(self):
        self.assertIsNone(company.domain_problem("northgate.com"))
        self.assertIsNone(company.domain_problem("north-gate.co.uk"))
        for bad in ("northgate", "http://", "a b.com", "-x.com", "x..com"):
            self.assertEqual(company.domain_problem(bad), "invalid", bad)

    def test_normalise(self):
        self.assertEqual(company.normalise_domain(" @WWW.Northgate.com "), "northgate.com")
        self.assertEqual(company.normalise_domain("https://northgate.com/about"), "northgate.com")


class VerifiedDomainTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@gmail.com", "Olive Owner")
        self.ws = self.company(self.owner, "Northgate")
        mail.outbox.clear()

    def url(self, tail=""):
        return f"{API}workspaces/{self.ws}/domains{tail}"

    def claim(self, domain="northgate.com", **extra):
        return self.owner.client.post(self.url(), {"domain": domain, **extra}, format="json")

    def test_mailbox_code_flow_verifies_and_shows_the_badge_everywhere(self):
        res = self.claim()
        self.assertEqual(res.status_code, 201)
        self.assertEqual((res.data["status"], res.data["sent_to"]), ("pending", "admin@northgate.com"))
        self.assertEqual(mail.outbox[-1].to, ["admin@northgate.com"])
        code = re.search(r"code is (\d{6})", mail.outbox[-1].body).group(1)
        link = re.search(r"/verify-domain/([\w-]+)", mail.outbox[-1].body).group(1)
        self.assertTrue(link)
        bad = self.owner.client.post(self.url(f"/{res.data['id']}/verify"), {"code": "000000"}, format="json")
        self.assertEqual(bad.data["error"]["code"], "domain_code_invalid")
        ok = self.owner.client.post(self.url(f"/{res.data['id']}/verify"), {"code": code}, format="json")
        self.assertEqual((ok.status_code, ok.data["status"]), (200, "verified"))
        detail = self.owner.client.get(f"{API}workspaces/{self.ws}").data
        self.assertEqual(detail["verified_domain"], "northgate.com")
        self.assertEqual(detail["security"]["verified_domains"], ["northgate.com"])
        self.assertEqual(detail["security"]["suggested_email_domains"], ["northgate.com"])
        card = self.published_card(self.owner, self.ws)
        public = APIClient().get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(public.data["card"]["brand"]["verified_domain"], "northgate.com")

    def test_link_flow_works_without_signing_in_and_only_once(self):
        self.claim(mailbox="postmaster")
        self.assertEqual(mail.outbox[-1].to, ["postmaster@northgate.com"])
        token = re.search(r"/verify-domain/([\w-]+)", mail.outbox[-1].body).group(1)
        ok = APIClient().post(API + "domains/confirm", {"token": token}, format="json")
        self.assertEqual((ok.status_code, ok.data["domain"], ok.data["company"]), (200, "northgate.com", "Northgate"))
        again = APIClient().post(API + "domains/confirm", {"token": token}, format="json")
        self.assertEqual((again.status_code, again.data["error"]["code"]), (410, "domain_link_invalid"))
        self.assertEqual(APIClient().post(API + "domains/confirm", {"token": "nonsense-token-value"}, format="json").status_code, 410)

    def test_any_address_at_the_domain_is_allowed_but_not_elsewhere(self):
        ok = self.claim(mailbox="boss@northgate.com")
        self.assertEqual(ok.data["sent_to"], "boss@northgate.com")
        for bad in ("boss@other.com", "boss@sub.northgate.com", "root", "a b@northgate.com"):
            res = self.claim("second.com", mailbox=bad)
            self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "domain_mailbox_invalid"), bad)

    def test_the_owner_with_a_verified_address_at_the_domain_is_verified_at_once(self):
        User.objects.filter(email="owner@gmail.com").update(email="owner@northgate.com", email_verified=True)
        res = self.claim()
        self.assertEqual((res.status_code, res.data["status"], res.data["mail_sent"]), (201, "verified", False))
        self.assertEqual(len(mail.outbox), 0)

    def test_an_unverified_account_address_does_not_count(self):
        User.objects.filter(email="owner@gmail.com").update(email="owner@northgate.com", email_verified=False)
        self.assertEqual(self.claim().data["status"], "pending")

    def test_free_mail_domains_are_refused(self):
        res = self.claim("gmail.com")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "domain_free_mail"))

    def test_only_the_owner_claims_and_admins_can_read(self):
        self.claim()
        admin = self.join(self.invite(self.owner, self.ws, "ada@northgate.com", role="admin"))
        self.assertEqual(admin.client.get(self.url()).status_code, 200)
        self.assertEqual(admin.client.post(self.url(), {"domain": "x-y.com"}, format="json").status_code, 403)
        employee = self.join(self.invite(self.owner, self.ws, "eve@northgate.com"), full_name="Eve")
        self.assertEqual(employee.client.get(self.url()).status_code, 403)

    def test_a_verified_domain_cannot_be_taken_by_another_company(self):
        self.claim()
        code = re.search(r"code is (\d{6})", mail.outbox[-1].body).group(1)
        row = VerifiedDomain.objects.get()
        self.owner.client.post(self.url(f"/{row.id}/verify"), {"code": code}, format="json")
        other = self.signup("rival@gmail.com")
        rival_ws = self.company(other, "Rival")
        res = other.client.post(f"{API}workspaces/{rival_ws}/domains", {"domain": "northgate.com"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "domain_taken"))

    def test_attempts_expiry_and_resend_limit(self):
        res = self.claim()
        for _ in range(5):
            self.owner.client.post(self.url(f"/{res.data['id']}/verify"), {"code": "000000"}, format="json")
        code = re.search(r"code is (\d{6})", mail.outbox[-1].body).group(1)
        locked = self.owner.client.post(self.url(f"/{res.data['id']}/verify"), {"code": code}, format="json")
        self.assertEqual(locked.data["error"]["code"], "domain_code_invalid")
        again = self.claim()
        self.assertEqual((again.status_code, again.data["error"]["code"]), (429, "domain_resend_wait"))
        VerifiedDomain.objects.update(expires_at=timezone.now() - timedelta(hours=47, minutes=58))
        fresh = self.claim()
        self.assertEqual(fresh.status_code, 201)
        VerifiedDomain.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        code = re.search(r"code is (\d{6})", mail.outbox[-1].body).group(1)
        expired = self.owner.client.post(self.url(f"/{res.data['id']}/verify"), {"code": code}, format="json")
        self.assertEqual((expired.status_code, expired.data["error"]["code"]), (410, "domain_expired"))
        self.assertEqual(self.owner.client.get(self.url()).data["domains"][0]["status"], "expired")

    def test_limit_of_five_and_removal_revokes_the_badge(self):
        for i in range(5):
            self.assertEqual(self.claim(f"firm{i}.com").status_code, 201)
        self.assertEqual(self.claim("firm9.com").data["error"]["code"], "domain_limit")
        row = VerifiedDomain.objects.first()
        VerifiedDomain.objects.filter(pk=row.pk).update(status="verified", verified_at=timezone.now())
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}").data["verified_domain"], row.domain)
        self.assertEqual(self.owner.client.delete(self.url(f"/{row.id}")).status_code, 204)
        self.assertIsNone(self.owner.client.get(f"{API}workspaces/{self.ws}").data["verified_domain"])
        from operations.models import AuditEvent

        self.assertIn("domain.removed", [e.action for e in AuditEvent.objects.all()])

    def test_mail_is_arabic_for_an_arabic_owner(self):
        self.owner.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        self.claim()
        self.assertIn("northgate.com", mail.outbox[-1].subject)
        self.assertIn("تأكيد", mail.outbox[-1].subject)

    def test_directory_shows_the_domain(self):
        self.owner.client.patch(f"{API}workspaces/{self.ws}", {"brand": {"directory_enabled": True, "directory_slug": "northgate"}}, format="json")
        VerifiedDomain.objects.create(workspace=Workspace.objects.get(pk=self.ws), domain="northgate.com", status="verified", verified_at=timezone.now())
        res = APIClient().get(API + "public/directory/northgate")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["company"]["verified_domain"], "northgate.com")


class BrandedMailTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@northgate.com", "Olive Owner")
        self.ws = self.company(self.owner, "Northgate")

    def palette(self, acc, on="#ffffff"):
        Workspace.objects.filter(pk=self.ws).update(brand={"company_name": "Northgate", "palette": {"bg": "#101114", "bg2": "#1b1c20", "fg": "#ffffff", "acc": acc, "on": on}})

    def test_invite_uses_company_name_colour_sender_and_reply_to(self):
        self.palette("#0B5FFF")
        self.owner.client.patch(f"{API}workspaces/{self.ws}/email-settings", {"reply_to_email": "People@Northgate.com"}, format="json")
        mail.outbox.clear()
        self.invite(self.owner, self.ws, "eve@northgate.com")
        message = mail.outbox[-1]
        self.assertTrue(message.from_email.startswith("Northgate via BENCH <"), message.from_email)
        self.assertEqual(message.reply_to, ["people@northgate.com"])
        html = message.alternatives[0][0]
        self.assertIn("background:#0B5FFF", html)
        self.assertIn("color:#FFFFFF", html)
        self.assertIn("prefers-color-scheme: dark", html)
        self.assertIn("Northgate", html)

    def test_unreadable_accent_falls_back_to_the_product_look(self):
        self.palette("#777777")  # neither white nor ink reaches 4.5 on mid grey
        self.invite(self.owner, self.ws, "eve@northgate.com")
        self.assertIn("background:#FF6B35", mail.outbox[-1].alternatives[0][0])

    def test_logo_needs_https_and_a_reachable_address(self):
        ws = Workspace.objects.get(pk=self.ws)
        ws.logo.name = "logos/x.png"
        with override_settings(API_BASE_URL="https://api.test", MEDIA_URL="/media/"):
            self.assertTrue(company_mail.logo_url(ws).startswith("https://api.test/"))
        with override_settings(API_BASE_URL="http://api.test", MEDIA_URL="/media/"):
            self.assertIsNone(company_mail.logo_url(ws))
        with override_settings(API_BASE_URL="https://api.test", MEDIA_URL="/media/", EMAIL_LOGO_CHECK=True):
            with mock.patch("urllib.request.urlopen", side_effect=OSError("down")):
                self.assertIsNone(company_mail.logo_url(ws))

    def test_a_personal_workspace_keeps_the_product_look(self):
        person = self.signup("p@example.com")
        self.assertIsNone(company_mail.company_style(Workspace.objects.get(pk=person.ws)))

    def test_sender_name_is_cleaned(self):
        ws = Workspace(name='Evil"\r\nBcc: x@y.com <b>', kind="company")
        name = company_mail.sender_name(ws)
        self.assertNotIn("\n", name)
        self.assertNotIn('"', name)
        self.assertNotIn("<", name)

    def test_reply_to_validation_blocks_injection(self):
        url = f"{API}workspaces/{self.ws}/email-settings"
        for bad in ("a@b.com\r\nBcc: z@z.com", "two@a.com,three@b.com", "no-at-sign", "a b@c.com"):
            self.assertEqual(self.owner.client.patch(url, {"reply_to_email": bad}, format="json").status_code, 400, bad)
        self.assertEqual(self.owner.client.patch(url, {"reply_to_email": ""}, format="json").data["reply_to_email"], "")
        self.assertEqual(self.owner.client.patch(url, {"reply_to_email": "hr@northgate.com"}, format="json").data["reply_to_email"], "hr@northgate.com")
        admin = self.join(self.invite(self.owner, self.ws, "ada@northgate.com", role="admin"))
        self.assertEqual(admin.client.patch(url, {"reply_to_email": "x@northgate.com"}, format="json").status_code, 403)
        self.assertEqual(admin.client.get(url).data["reply_to_email"], "hr@northgate.com")

    def test_preview_returns_the_branded_invite_in_both_languages(self):
        self.palette("#0B5FFF")
        en = self.owner.client.get(f"{API}workspaces/{self.ws}/email-preview")
        self.assertEqual(en.status_code, 200)
        self.assertIn("background:#0B5FFF", en.data["html"])
        self.assertIn("Northgate", en.data["subject"])
        self.assertTrue(en.data["from"].startswith("Northgate via"))
        ar = self.owner.client.get(f"{API}workspaces/{self.ws}/email-preview", {"lang": "ar"})
        self.assertIn('dir="rtl"', ar.data["html"])
        self.assertIn('lang="ar"', ar.data["html"])

    def test_preview_is_for_company_managers_only(self):
        employee = self.join(self.invite(self.owner, self.ws, "eve@northgate.com"), full_name="Eve")
        self.assertEqual(employee.client.get(f"{API}workspaces/{self.ws}/email-preview").status_code, 403)
        person = self.signup("p@example.com")
        self.assertEqual(person.client.get(f"{API}workspaces/{person.ws}/email-preview").status_code, 400)
