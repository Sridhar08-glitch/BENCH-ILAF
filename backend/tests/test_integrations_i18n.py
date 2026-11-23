"""Every message the API keys and CRM settings pages can show has an Arabic text, and e-mails go out in the reader's language."""
import ast
from pathlib import Path

from django.core import mail

from ilaf import locale_ar
from ilaf.i18n import translate_message
from operations import audit
from workspaces.models import Member

from .base import API
from .crm_base import CrmTestCase, ok

ROOT = Path(__file__).resolve().parent.parent
FILES = ["publicapi/manage_views.py", "publicapi/keys.py", "crm/views.py"]


def literal_messages(path):
    """The plain English sentences passed to ApiError(...) and validation_error({...}) in a file."""
    tree = ast.parse((ROOT / path).read_text(encoding="utf-8"))
    found = []
    inside_fstring = {id(c) for n in ast.walk(tree) if isinstance(n, (ast.JoinedStr, ast.BinOp)) for c in ast.walk(n)}
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        name = getattr(node.func, "id", getattr(node.func, "attr", ""))
        if name == "ApiError" and len(node.args) >= 2 and isinstance(node.args[1], ast.Constant):
            found.append(node.args[1].value)
        if name == "validation_error" and node.args:
            for sub in ast.walk(node.args[0]):
                if isinstance(sub, ast.Constant) and isinstance(sub.value, str) and " " in sub.value and id(sub) not in inside_fstring:
                    found.append(sub.value)
    return found


class ArabicCatalogueTests(CrmTestCase):
    def test_every_literal_message_in_the_new_code_has_an_arabic_text(self):
        for path in FILES:
            messages = literal_messages(path)
            self.assertTrue(messages, path)
            for message in messages:
                self.assertNotEqual(translate_message("ar", message), message, f"{path}: {message!r}")

    def test_messages_with_values_translate_through_patterns(self):
        for text in (
            "Unknown permission: cards:delete.", "Use at most 20 addresses.", "nope is not an IP address or network.",
            "A company can have up to 20 active API keys. Revoke one first.", "Use a whole number from 1 to 600.",
        ):
            translated = translate_message("ar", text)
            self.assertNotEqual(translated, text, text)
            self.assertNotIn("{", translated)

    def test_activity_log_wording_exists_in_arabic(self):
        for key in ("card.created", "card.updated", "apikey.created", "apikey.revoked", "apikey.rotated", "crm.connected",
                    "crm.disconnected", "crm.settings_changed", "crm.disabled"):
            self.assertIn(key, audit.ACTIONS)
            self.assertIn(audit.ACTIONS[key], locale_ar.TEXTS, key)

    def test_the_api_answers_in_arabic_when_asked(self):
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/api-keys", {"scopes": ["cards:read"]}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertEqual(res.data["error"]["fields"]["name"], ["أعطِ المفتاح اسمًا، مثل اسم النظام الذي سيستخدمه."])
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/crm/zoho/connect", {"region": "cn"}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.data["error"]["fields"]["region"], ["اختر منطقة حسابك."])
        res = self.owner.client.post(f"{API}workspaces/{self.ws}/crm/hubspot/disconnect", format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual((res.data["error"]["code"], res.data["error"]["message"]), ("crm_not_connected", "هذا النظام (CRM) غير متصل."))

    def test_the_error_codes_the_pages_show_are_stable(self):
        from crm import errors

        codes = {c.code for c in vars(errors).values() if isinstance(c, type) and issubclass(c, errors.CrmError)}
        self.assertEqual(codes, {
            "crm_error", "crm_auth_revoked", "crm_rate_limited", "crm_unavailable", "crm_forbidden", "crm_rejected",
            "crm_bad_mapping", "crm_token_unreadable", "crm_oauth_failed",
        })


class DisabledMailLanguageTests(CrmTestCase):
    def test_the_admin_mail_follows_the_admins_language(self):
        from accounts.models import User
        from crm import sync

        User.objects.filter(email="owner@example.com").update(language="ar")
        ada = self.add("ada@acme.test", "Ada Admin", role="admin")
        conn = self.connect_direct("hubspot")
        self.server.add("POST", "/crm/v3/objects/contacts/search", ok({}, 401))
        self.server.add("POST", "/oauth/v1/token", ok({"error": "invalid_grant"}, 400))
        mail.outbox.clear()
        self.make_lead()
        sync.process_queue()
        by_recipient = {m.to[0]: m for m in mail.outbox}
        self.assertIn("توقفت مزامنة جهات الاتصال مع", by_recipient["owner@example.com"].subject)
        self.assertEqual(by_recipient["ada@acme.test"].subject, "HubSpot stopped syncing your contacts")
        self.assertIn("فتح التكاملات", by_recipient["owner@example.com"].alternatives[0][0])
