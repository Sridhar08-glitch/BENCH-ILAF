"""Languages: the language fields, the translator, Arabic e-mails and Arabic vCards."""
import re
import string
from datetime import date

from django.core import mail
from django.test import SimpleTestCase
from rest_framework.test import APIClient

from accounts.models import User
from cards.vcard import _split_name
from ilaf import i18n, locale_ar
from workspaces.models import Member

from .base import API, ApiTestCase

ARABIC = re.compile(r"[؀-ۿ]")


def placeholders(text):
    return sorted(name for _, name, _, _ in string.Formatter().parse(text) if name)


class TranslatorTests(SimpleTestCase):
    def test_normalise_and_direction(self):
        self.assertEqual(i18n.normalise_language("AR"), "ar")
        self.assertEqual(i18n.normalise_language("ar-QA"), "ar")
        self.assertEqual(i18n.normalise_language("en_GB"), "en")
        self.assertIsNone(i18n.normalise_language("fr"))
        self.assertIsNone(i18n.normalise_language(None))
        self.assertEqual(i18n.direction("ar"), "rtl")
        self.assertEqual(i18n.direction("en"), "ltr")
        self.assertEqual(i18n.direction("zz"), "ltr")

    def test_accept_language_header(self):
        self.assertEqual(i18n.from_accept_language("ar-QA,ar;q=0.9,en;q=0.8"), "ar")
        self.assertEqual(i18n.from_accept_language("fr-FR,en;q=0.5"), "en")
        self.assertEqual(i18n.from_accept_language("en;q=0.2,ar;q=0.9"), "ar")
        self.assertIsNone(i18n.from_accept_language("fr,de"))
        self.assertIsNone(i18n.from_accept_language(""))

    def test_arabic_plural_categories(self):
        expected = {0: "zero", 1: "one", 2: "two", 3: "few", 10: "few", 11: "many", 99: "many", 100: "other", 102: "other", 103: "few", 111: "many"}
        for n, category in expected.items():
            self.assertEqual(i18n.plural_category("ar", n), category, n)
        self.assertEqual(i18n.plural_category("en", 1), "one")
        self.assertEqual(i18n.plural_category("en", 0), "other")

    def test_trn_picks_the_right_arabic_form(self):
        one, other = "{n} click", "{n} clicks"
        self.assertEqual(i18n.trn("en", 1, one, other), "1 click")
        self.assertEqual(i18n.trn("en", 5, one, other), "5 clicks")
        self.assertEqual(i18n.trn("ar", 1, one, other), "نقرة واحدة")
        self.assertEqual(i18n.trn("ar", 2, one, other), "نقرتان")
        self.assertEqual(i18n.trn("ar", 5, one, other), "5 نقرات")
        self.assertEqual(i18n.trn("ar", 15, one, other), "15 نقرة")

    def test_missing_text_falls_back_to_english(self):
        self.assertEqual(i18n.tr("ar", "A text nobody translated {x}", x=1), "A text nobody translated 1")
        self.assertEqual(i18n.tr("en", "Accept invite"), "Accept invite")
        self.assertEqual(i18n.tr("ar", "Accept invite"), "قبول الدعوة")

    def test_latin_values_are_isolated_in_arabic_sentences(self):
        text = i18n.tr("ar", "Join {workspace}", workspace="Acme Ltd")
        self.assertIn(i18n.FSI + "Acme Ltd" + i18n.PDI, text)
        plain = i18n.tr("en", "Join {workspace}", workspace="Acme Ltd")
        self.assertEqual(plain, "Join Acme Ltd")
        # A plain number needs no isolate.
        self.assertNotIn(i18n.FSI, i18n.tr("ar", "up {pct}%", pct=12))

    def test_dates_use_arabic_month_names(self):
        self.assertEqual(i18n.format_date("ar", date(2026, 11, 22)), "22 نوفمبر 2026")
        self.assertEqual(i18n.format_date("en", date(2026, 11, 22)), "22 November 2026")

    def test_catalogue_placeholders_match_the_english_text(self):
        for english, arabic in locale_ar.TEXTS.items():
            self.assertEqual(placeholders(english), placeholders(arabic), english)
            self.assertTrue(ARABIC.search(arabic) or english in ("or",), english)

    def test_plural_forms_use_the_same_placeholders(self):
        for english, forms in locale_ar.PLURALS.items():
            self.assertIn("other", forms)
            for category, text in forms.items():
                self.assertIn(category, ("zero", "one", "two", "few", "many", "other"))
                self.assertLessEqual(set(placeholders(text)), set(placeholders(english)) | {"n"}, english)
        self.assertEqual(len(locale_ar.MONTHS), 12)

    def test_api_message_patterns(self):
        self.assertEqual(
            i18n.translate_message("ar", "A card can have at most 40 items."), "يمكن أن تحتوي البطاقة على 40 عنصرًا كحد أقصى."
        )
        self.assertEqual(i18n.translate_message("ar", "Unknown text."), "Unknown text.")
        self.assertEqual(i18n.translate_message("en", "Not found."), "Not found.")


class VcardNameTests(SimpleTestCase):
    def test_arabic_family_split(self):
        self.assertEqual(_split_name("محمد بن سالم الكواري"), ("الكواري", "محمد بن سالم"))
        self.assertEqual(_split_name("عبدالله آل ثاني"), ("آل ثاني", "عبدالله"))
        self.assertEqual(_split_name("Khalid Al Thani"), ("Al Thani", "Khalid"))
        self.assertEqual(_split_name("Al Gore"), ("Gore", "Al"))
        self.assertEqual(_split_name("فاطمة"), ("", "فاطمة"))
        self.assertEqual(_split_name("Alice Anderson"), ("Anderson", "Alice"))


class LanguageFieldTests(ApiTestCase):
    def test_user_language_is_saved_validated_and_clearable(self):
        person = self.signup()
        self.assertIsNone(person.user["language"])
        res = person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["language"], "ar")
        self.assertEqual(person.client.get(API + "auth/me").data["language"], "ar")
        res = person.client.patch(API + "auth/me", {"language": "xx"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["code"], "validation_error")
        self.assertIn("language", res.data["error"]["fields"])
        res = person.client.patch(API + "auth/me", {"language": 5}, format="json")
        self.assertEqual(res.status_code, 400)
        res = person.client.patch(API + "auth/me", {"language": ""}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(res.data["language"])

    def test_register_with_a_language(self):
        res = APIClient().post(
            API + "auth/register",
            {"email": "layla@example.com", "password": self.password, "full_name": "ليلى", "language": "ar"},
            format="json",
        )
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["user"]["language"], "ar")
        bad = APIClient().post(
            API + "auth/register",
            {"email": "bad@example.com", "password": self.password, "full_name": "Bad", "language": "klingon"},
            format="json",
        )
        self.assertEqual(bad.status_code, 400)

    def test_card_language_defaults_to_auto_and_is_validated(self):
        person = self.signup()
        self.buy(person)
        card = self.make_card(person)
        self.assertEqual(card["language"], "auto")
        res = person.client.patch(f"{API}cards/{card['id']}", {"language": "ar"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["language"], "ar")
        res = person.client.patch(f"{API}cards/{card['id']}", {"language": "fr"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertIn("language", res.data["error"]["fields"])
        public = APIClient().get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(public.status_code, 404)  # still a draft
        person.client.post(f"{API}cards/{card['id']}/publish")
        public = APIClient().get(f"{API}public/cards/{card['public_code']}")
        self.assertEqual(public.data["card"]["language"], "ar")

    def test_api_errors_follow_the_requested_language(self):
        res = APIClient().post(API + "auth/login", {"email": "no@example.com", "password": "x"}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "invalid_credentials")
        self.assertEqual(res.data["error"]["message"], "البريد الإلكتروني أو كلمة المرور غير صحيحة.")
        res = APIClient().post(API + "auth/login", {"email": "no@example.com", "password": "x"}, format="json", HTTP_ACCEPT_LANGUAGE="ar-QA,en;q=0.5")
        self.assertEqual(res.data["error"]["message"], "البريد الإلكتروني أو كلمة المرور غير صحيحة.")
        res = APIClient().post(API + "auth/login", {"email": "no@example.com", "password": "x"}, format="json")
        self.assertEqual(res.data["error"]["message"], "Email or password is not correct.")

    def test_signed_in_user_language_beats_the_browser_header(self):
        person = self.signup()
        person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        res = person.client.patch(API + "auth/me", {"language": "xx"}, format="json", HTTP_ACCEPT_LANGUAGE="en")
        self.assertEqual(res.data["error"]["message"], "اختر إحدى اللغات المتاحة.")


class ArabicEmailTests(ApiTestCase):
    def test_reset_email_in_arabic_for_an_arabic_account(self):
        person = self.signup("noura@example.com", "نورة الكواري")
        person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        mail.outbox.clear()
        APIClient().post(API + "auth/forgot", {"email": "noura@example.com"}, format="json")
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertTrue(ARABIC.search(message.subject))
        self.assertIn("كلمة مرور", message.subject)
        html = message.alternatives[0][0]
        self.assertIn('lang="ar" dir="rtl"', html)
        self.assertIn("direction:rtl", html)
        self.assertIn("text-align:right", html)
        self.assertIn("IBM Plex Sans Arabic", html)
        self.assertIn("اختيار كلمة مرور جديدة", html)
        self.assertIn("/reset/", message.body)

    def test_reset_email_follows_the_browser_language_without_a_saved_one(self):
        self.signup("omar@example.com", "Omar")
        mail.outbox.clear()
        APIClient().post(API + "auth/forgot", {"email": "omar@example.com"}, format="json", HTTP_ACCEPT_LANGUAGE="ar")
        self.assertTrue(ARABIC.search(mail.outbox[0].subject))

    def test_english_email_is_unchanged_and_left_to_right(self):
        self.signup("sam@example.com", "Sam")
        mail.outbox.clear()
        APIClient().post(API + "auth/forgot", {"email": "sam@example.com"}, format="json")
        message = mail.outbox[0]
        self.assertFalse(ARABIC.search(message.subject))
        html = message.alternatives[0][0]
        self.assertIn('lang="en" dir="ltr"', html)
        self.assertIn("Poppins", html)
        self.assertNotIn("IBM Plex Sans Arabic", html)

    def test_invite_language_picks_the_invite_email_and_becomes_the_account_language(self):
        owner = self.signup("owner@example.com", "Owner")
        ws = self.company(owner)
        mail.outbox.clear()
        invited = self.invite(owner, ws, "reem@example.com", language="ar", full_name="ريم")
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(ARABIC.search(mail.outbox[0].subject))
        self.assertIn('dir="rtl"', mail.outbox[0].alternatives[0][0])
        self.assertEqual(Member.objects.get(pk=invited["id"]).language, "ar")
        lookup = APIClient().get(f"{API}invites/{Member.objects.get(pk=invited['id']).invite_token}")
        self.assertEqual(lookup.data["language"], "ar")
        self.join(invited, full_name="ريم")
        self.assertEqual(User.objects.get(email="reem@example.com").language, "ar")

    def test_invite_language_is_validated(self):
        owner = self.signup("owner2@example.com", "Owner")
        ws = self.company(owner)
        res = owner.client.post(
            f"{API}workspaces/{ws}/invites", {"invites": [{"email": "x@example.com", "language": "de"}]}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_lead_notification_goes_out_in_the_holders_language(self):
        person = self.signup("holder@example.com", "Holder")
        person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        self.buy(person)
        card = self.published_card(person, name="خالد الكواري")
        mail.outbox.clear()
        res = APIClient().post(
            f"{API}public/cards/{card['public_code']}/leads",
            {"name": "Visitor Vic", "email": "vic@example.com", "consent": True},
            format="json",
        )
        self.assertIn(res.status_code, (200, 201, 204), res.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(ARABIC.search(mail.outbox[0].subject))
        self.assertIn("Visitor Vic", mail.outbox[0].subject)
        self.assertIn(i18n.FSI + "Visitor Vic" + i18n.PDI, mail.outbox[0].subject)

    def test_weekly_report_renders_right_to_left_in_arabic(self):
        from analytics import weekly

        owner = self.signup("rep@example.com", "Reporter")
        owner.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        member = Member.objects.filter(user__email="rep@example.com").first()
        week = weekly.last_full_week()
        data = weekly.personal_data(member, week)
        subject, text, html = weekly.render_personal(member, week, data, "https://x.test/unsub")
        self.assertTrue(ARABIC.search(subject))
        self.assertIn('dir="rtl"', html)
        self.assertIn("أسبوعك", html)
        self.assertIn("المشاهدات", html)
        self.assertIn("إلغاء الاشتراك بنقرة واحدة", html)
        self.assertIn("https://x.test/unsub", text)

    def test_data_export_and_deletion_emails_in_arabic(self):
        from privacy.services import _send_deletion_scheduled

        person = self.signup("del@example.com", "Del")
        person.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        user = User.objects.get(email="del@example.com")
        mail.outbox.clear()
        _send_deletion_scheduled(user, __import__("datetime").datetime(2026, 12, 5), "https://x.test/restore")
        message = mail.outbox[0]
        self.assertIn("5 ديسمبر 2026", message.body)
        self.assertIn('dir="rtl"', message.alternatives[0][0])
        mail.outbox.clear()
        _send_deletion_scheduled(user, __import__("datetime").datetime(2026, 12, 5), "https://x.test/restore", "Acme Ltd")
        self.assertIn("Acme Ltd", mail.outbox[0].body)

    def test_webhook_and_approval_emails_use_the_admin_language(self):
        from leads.models import WebhookEndpoint
        from leads.webhooks import notify_disabled

        owner = self.signup("hook@example.com", "Hook")
        owner.client.patch(API + "auth/me", {"language": "ar"}, format="json")
        ws = self.company(owner)
        endpoint = WebhookEndpoint(workspace_id=ws, url="https://hooks.example.com/x")
        mail.outbox.clear()
        notify_disabled(endpoint)
        self.assertEqual(len(mail.outbox), 1)
        self.assertTrue(ARABIC.search(mail.outbox[0].subject))


class ArabicVcardTests(ApiTestCase):
    def fetch(self, name, **fields):
        person = self.signup(f"v{abs(hash(name)) % 10000}@example.com")
        self.buy(person, "business")
        card = self.published_card(
            person, name=name, items=[{"kind": "Mobile", "value": "+974 5555 1111"}], **fields
        )
        res = APIClient().get(f"{API}public/cards/{card['public_code']}/vcard")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "text/vcard; charset=utf-8")
        return res.content.decode("utf-8").replace("\r\n ", "")

    def test_arabic_name_title_company_and_address_are_saved_as_typed(self):
        text = self.fetch(
            "محمد بن سالم الكواري", title="المدير التنفيذي", company="شركة الكواري للتجارة",
            address="الدوحة، شارع الكورنيش، برج 5",
        )
        self.assertIn("FN;CHARSET=UTF-8:محمد بن سالم الكواري\r\n", text)
        self.assertIn("N;CHARSET=UTF-8:الكواري;محمد بن سالم;;;\r\n", text)
        self.assertIn("TITLE;CHARSET=UTF-8:المدير التنفيذي\r\n", text)
        self.assertIn("ORG;CHARSET=UTF-8:شركة الكواري للتجارة\r\n", text)
        self.assertIn("ADR;CHARSET=UTF-8;TYPE=WORK:;;الدوحة، شارع الكورنيش، برج 5;;;;\r\n", text)
        self.assertNotIn("Muhammad", text)  # never transliterated

    def test_long_arabic_lines_fold_on_character_boundaries(self):
        text = self.fetch("فاطمة " * 15)
        for line in text.split("\r\n"):
            line.encode("utf-8").decode("utf-8")
        self.assertIn("BEGIN:VCARD", text)

    def test_mixed_arabic_and_english(self):
        text = self.fetch("Khalid خالد Al Thani", company="Qatar قطر")
        self.assertIn("FN;CHARSET=UTF-8:Khalid خالد Al Thani", text)
        self.assertIn("ORG;CHARSET=UTF-8:Qatar قطر", text)
