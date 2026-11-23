"""Inbound support e-mail: quote stripping on sample mails, auto-reply and loop detection, threading, the webhook and IMAP."""
import base64
from email.message import EmailMessage
from unittest import mock

from django.core import mail
from django.core.management import call_command
from rest_framework.test import APIClient

from support import mailparse, services
from support.models import SupportMessage, SupportTicket

from .base import API
from .support_base import PNG, SupportTestCase

SAMPLES = [
    # (name, raw text, what must remain, what must be gone)
    ("gmail", "Thanks, it works now!\n\nOn Mon, 23 Nov 2026 at 10:15, BENCH Support <support@ilaf.qa> wrote:\n> We fixed it.\n> Regards", "Thanks, it works now!", "We fixed it"),
    ("gmail_wrapped", "Yes please.\n\nOn Mon, 23 Nov 2026 at 10:15, BENCH Support\n<support@ilaf.qa> wrote:\n> Shall we call you?", "Yes please.", "Shall we call"),
    ("outlook", "It still fails.\n\nFrom: BENCH Support <support@ilaf.qa>\nSent: Monday, November 23, 2026 10:15 AM\nTo: Alice\nSubject: [BNC-00001] Card\n\nWe fixed it.", "It still fails.", "We fixed it"),
    ("original_message", "See below.\n\n-----Original Message-----\nFrom: x\nSent: y\nOld text", "See below.", "Old text"),
    ("reply_marker", "My answer.\n\n##- Please type your reply above this line -##\n\nWe replied to your request BNC-00001:\nOld", "My answer.", "Old"),
    ("arabic_marker", "ردي هنا\n\n##- يرجى كتابة ردك أعلى هذا السطر -##\nرددنا على طلبك", "ردي هنا", "رددنا"),
    ("arabic_gmail", "شكرًا لكم، المشكلة انحلت.\n\nفي الاثنين، 23 نوفمبر 2026 في 10:15 ص، فريق الدعم <support@ilaf.qa> كتب:\n> تم الحل", "شكرًا لكم، المشكلة انحلت.", "تم الحل"),
    ("arabic_headers", "لا يزال لا يعمل\n\nمن: فريق الدعم <support@ilaf.qa>\nأرسل: الاثنين\nإلى: أليس\nالموضوع: طلب\n\nنص قديم", "لا يزال لا يعمل", "نص قديم"),
    ("signature_delimiter", "Please call me.\n\n-- \nAlice Anderson\nCEO, Acme\n+974 5555 5555", "Please call me.", "CEO, Acme"),
    ("iphone", "Got it, thanks\n\nSent from my iPhone\n\n> On 23 Nov, Support wrote:\n> old", "Got it, thanks", "iPhone"),
    ("outlook_mobile", "Okay.\n\nGet Outlook for Android<https://aka.ms/ghei36>", "Okay.", "Outlook for"),
    ("arabic_iphone", "تمام شكرًا\n\nأرسل من جهاز iPhone الخاص بي", "تمام شكرًا", "iPhone"),
    ("inline_quotes", "> Did you try restarting?\nYes, twice.\n> And clearing cache?\nYes.", "Yes, twice.\nYes.", "restarting"),
    ("underscores", "Done.\n\n________________________________\nFrom: Support\nOld", "Done.", "Old"),
    ("french", "Merci.\n\nLe 23 nov. 2026 à 10:15, Support <support@ilaf.qa> a écrit :\n> vieux", "Merci.", "vieux"),
    ("plain_no_quote", "Just a normal message\nwith two lines.", "Just a normal message\nwith two lines.", "zzz"),
    ("mid_sentence_wrote", "I wrote: hello to them and it worked.", "I wrote: hello to them and it worked.", "zzz"),
]

AUTOMATIC = [
    ("auto_submitted", {"Auto-Submitted": "auto-replied"}, "alice@example.com", "Re: [BNC-00001] x"),
    ("precedence_bulk", {"Precedence": "bulk"}, "alice@example.com", "Hi"),
    ("precedence_auto", {"Precedence": "auto_reply"}, "alice@example.com", "Hi"),
    ("suppress", {"X-Auto-Response-Suppress": "All"}, "alice@example.com", "Hi"),
    ("list", {"List-Id": "<news.example.com>"}, "alice@example.com", "Hi"),
    ("mailer_daemon", {}, "MAILER-DAEMON@mail.example.com", "Undelivered"),
    ("no_reply", {}, "no-reply@shop.example.com", "Your order"),
    ("ooo_en", {}, "alice@example.com", "Out of office: back on Monday"),
    ("ooo_auto", {}, "alice@example.com", "Automatic reply: card"),
    ("ooo_ar", {}, "alice@example.com", "رد تلقائي: خارج المكتب"),
    ("our_own_address_loop", {}, "support@ilaf.test", "Re: [BNC-00001] x"),
    ("return_path_empty", {"Return-Path": "<>"}, "alice@example.com", "Hi"),
]


def mail_dict(sender="alice@example.com", subject="Re: [BNC-00001] My card will not save", text="More details.", **extra):
    base = {"from": f"Alice Anderson <{sender}>", "to": "support@ilaf.test", "subject": subject, "text": text,
            "message_id": f"<m-{abs(hash((sender, subject, text)))}@client>", "in_reply_to": "", "references": "", "headers": {}, "attachments": []}
    base.update(extra)
    return base


class QuoteStrippingTests(SupportTestCase):
    def test_sample_mails(self):
        self.assertGreaterEqual(len(SAMPLES), 15)
        for name, raw, keep, gone in SAMPLES:
            result = mailparse.strip_quoted(raw)
            self.assertEqual(result, keep, name)
            self.assertNotIn(gone, result, name)

    def test_html_only_mail_is_turned_into_text(self):
        text = mailparse.html_to_text("<div>Hello<br>there</div><blockquote>old stuff</blockquote><style>p{}</style>")
        self.assertIn("Hello", text)
        self.assertNotIn("old stuff", text)

    def test_subject_cleaning(self):
        self.assertEqual(mailparse.clean_subject_text("Re: RE: [BNC-00012] Login problem"), "Login problem")
        self.assertEqual(mailparse.clean_subject_text("رد: مشكلة الدخول"), "مشكلة الدخول")
        self.assertEqual(mailparse.clean_subject_text("Fwd: BNC-00005 Hello"), "Hello")

    def test_automatic_mail_is_recognised(self):
        self.assertGreaterEqual(len(AUTOMATIC), 12)
        for name, headers, sender, subject in AUTOMATIC:
            self.assertTrue(mailparse.is_automatic(headers, mailparse.sender_address(sender), subject), name)
        self.assertFalse(mailparse.is_automatic({}, "alice@example.com", "Hello there"))
        self.assertFalse(mailparse.is_automatic({"Auto-Submitted": "no"}, "alice@example.com", "Hello"))


class ThreadingTests(SupportTestCase):
    def setUp(self):
        super().setUp()
        self.ticket = SupportTicket.objects.get(pk=self.new_ticket()["id"])
        mail.outbox.clear()

    def test_reply_with_token_in_subject_joins_the_ticket(self):
        result = mailparse.process_inbound(mail_dict(text="More details.\n\nOn Mon, X wrote:\n> old"))
        self.assertEqual((result["status"], result["ticket"]), ("added", "BNC-00001"))
        last = self.ticket.messages.order_by("created_at").last()
        self.assertEqual((last.body, last.via, last.author_kind), ("More details.", "email", "customer"))
        self.assertEqual(SupportTicket.objects.count(), 1)
        self.assertTrue(any(m.to in (["agent@ilaf.test"], ["admin@ilaf.test"]) for m in mail.outbox))

    def test_reply_found_by_message_id_headers(self):
        SupportMessage.objects.filter(ticket=self.ticket).update(email_message_id="<orig@client>")
        result = mailparse.process_inbound(mail_dict(subject="Re: something totally different", in_reply_to="<orig@client>"))
        self.assertEqual(result["ticket"], "BNC-00001")
        result = mailparse.process_inbound(mail_dict(subject="Hello", text="again", references="<x@y> <support.1.abcdef@ilaf.test>"))
        self.assertEqual(result["ticket"], "BNC-00001")

    def test_staff_reply_mail_has_a_token_and_message_id_that_thread_back(self):
        self.agent.client.post(self.staff_url(str(self.ticket.id), "/reply"), {"body": "Try again"}, format="json")
        sent = next(m for m in mail.outbox if m.to == ["alice@example.com"])
        stored = SupportMessage.objects.filter(ticket=self.ticket, author_kind="staff").first().email_message_id
        self.assertEqual(stored, sent.extra_headers["Message-ID"])
        result = mailparse.process_inbound(mail_dict(subject="Re: nothing", in_reply_to=stored, text="Tried"))
        self.assertEqual(result["status"], "added")
        self.assertEqual(SupportTicket.objects.get(pk=self.ticket.pk).status, "open")

    def test_unknown_sender_opens_a_new_ticket(self):
        result = mailparse.process_inbound(mail_dict(sender="new@client.org", subject="Question about plans", text="How much is it?"))
        self.assertEqual(result["status"], "created")
        t = SupportTicket.objects.get(number=2)
        self.assertEqual((t.channel, t.requester_email, t.subject, t.status), ("email", "new@client.org", "Question about plans", "new"))
        self.assertEqual(t.requester_name, "Alice Anderson")
        self.assertTrue(any(m.to == ["new@client.org"] for m in mail.outbox))

    def test_arabic_mail_makes_an_arabic_ticket(self):
        mailparse.process_inbound(mail_dict(sender="ali@client.org", subject="استفسار عن الأسعار", text="كم سعر الباقة؟"))
        t = SupportTicket.objects.get(number=2)
        self.assertEqual((t.language, t.subject), ("ar", "استفسار عن الأسعار"))
        self.assertIn("استلمنا طلبك", next(m for m in mail.outbox if m.to == ["ali@client.org"]).body)

    def test_known_verified_account_is_linked(self):
        from accounts.models import User

        User.objects.filter(email="bob@example.com").update(email_verified=True)
        mailparse.process_inbound(mail_dict(sender="bob@example.com", subject="Help", text="Hi"))
        self.assertEqual(SupportTicket.objects.get(number=2).requester.email, "bob@example.com")
        mailparse.process_inbound(mail_dict(sender="alice@example.com", subject="Help", text="Hello again"))
        self.assertIsNone(SupportTicket.objects.get(number=3).requester)  # not verified: never linked

    def test_a_different_sender_cannot_write_into_someones_ticket(self):
        result = mailparse.process_inbound(mail_dict(sender="mallory@evil.org", text="Injected"))
        self.assertEqual(result["status"], "created")
        self.assertNotIn("Injected", [m.body for m in self.ticket.messages.all()])
        self.assertIn("different address", SupportTicket.objects.get(number=2).messages.first().body)

    def test_solved_ticket_is_reopened_and_closed_ticket_starts_a_new_one(self):
        self.agent.client.patch(self.staff_url(str(self.ticket.id)), {"status": "solved"}, format="json")
        self.assertEqual(mailparse.process_inbound(mail_dict(text="Not fixed"))["status"], "reopened")
        self.assertEqual(SupportTicket.objects.get(pk=self.ticket.pk).status, "open")
        self.agent.client.patch(self.staff_url(str(self.ticket.id)), {"status": "closed"}, format="json")
        result = mailparse.process_inbound(mail_dict(text="Another thing", message_id="<other@c>"))
        self.assertEqual(result["status"], "created")
        self.assertIn("Follow-up to BNC-00001", SupportTicket.objects.get(number=2).messages.first().body)

    def test_merged_ticket_threads_into_the_target(self):
        second = SupportTicket.objects.get(pk=self.new_ticket(subject="Second")["id"])
        self.agent.client.post(self.staff_url(str(second.id), "/merge"), {"into": str(self.ticket.id)}, format="json")
        result = mailparse.process_inbound(mail_dict(subject="Re: [BNC-00002] Second", text="Hello"))
        self.assertEqual(result["ticket"], "BNC-00001")

    def test_automatic_mail_changes_nothing(self):
        for name, headers, sender, subject in AUTOMATIC:
            result = mailparse.process_inbound(mail_dict(sender=sender, subject=subject, headers=headers, message_id=f"<{name}@x>"))
            self.assertEqual(result["status"], "ignored", name)
        self.assertEqual(SupportTicket.objects.count(), 1)
        self.assertEqual(self.ticket.messages.count(), 1)

    def test_duplicates_empty_mails_and_limits(self):
        data = mail_dict(message_id="<same@x>")
        self.assertEqual(mailparse.process_inbound(data)["status"], "added")
        self.assertEqual(mailparse.process_inbound(data)["reason"], "duplicate")
        self.assertEqual(mailparse.process_inbound(mail_dict(text="  \n> only quote", message_id="<q@x>"))["reason"], "empty")
        self.assertEqual(mailparse.process_inbound(mail_dict(sender="", message_id="<n@x>"))["reason"], "no_sender")
        long = mailparse.process_inbound(mail_dict(text="x" * 50000, message_id="<long@x>"))
        self.assertEqual(long["status"], "added")
        self.assertEqual(len(self.ticket.messages.order_by("created_at").last().body), mailparse.MAX_TEXT)

    def test_sender_rate_limit(self):
        for i in range(mailparse.SENDER_PER_HOUR):
            mailparse.process_inbound(mail_dict(text=f"m{i}", message_id=f"<r{i}@x>"))
        self.assertEqual(mailparse.process_inbound(mail_dict(text="one more", message_id="<rx@x>"))["reason"], "rate_limited")

    def test_attachments_are_validated(self):
        good = {"filename": "shot.png", "content_type": "image/png", "content_base64": base64.b64encode(PNG).decode()}
        bad = {"filename": "evil.png", "content_type": "image/png", "content_base64": base64.b64encode(b"MZ\x90").decode()}
        info_only = {"filename": "big.pdf", "content_type": "application/pdf", "size": 12345}
        result = mailparse.process_inbound(mail_dict(attachments=[good, bad, info_only]))
        self.assertEqual(result["status"], "added")
        last = self.ticket.messages.order_by("created_at").last()
        self.assertEqual([a.original_name for a in last.attachments.all()], ["shot.png"])
        self.assertIn("evil.png", last.body)
        self.assertIn("big.pdf", last.body)


class RawMailAndWebhookTests(SupportTestCase):
    def raw(self, **headers):
        msg = EmailMessage()
        msg["From"] = "Alice Anderson <alice@example.com>"
        msg["To"] = "support@ilaf.test"
        msg["Subject"] = "Re: [BNC-00001] My card will not save"
        msg["Message-ID"] = "<raw-1@client>"
        for k, v in headers.items():
            msg[k.replace("_", "-")] = v
        msg.set_content("Thanks!\n\nOn Mon, X wrote:\n> old")
        msg.add_alternative("<p>Thanks!</p><blockquote>old</blockquote>", subtype="html")
        msg.add_attachment(PNG, maintype="image", subtype="png", filename="s.png")
        return msg.as_bytes()

    def test_parse_raw_and_process(self):
        self.new_ticket()
        data = mailparse.parse_raw(self.raw())
        self.assertEqual(data["message_id"], "<raw-1@client>")
        self.assertEqual(data["attachments"][0]["filename"], "s.png")
        result = mailparse.process_inbound(data)
        self.assertEqual((result["status"], result["ticket"]), ("added", "BNC-00001"))
        self.assertEqual(SupportMessage.objects.filter(email_message_id="<raw-1@client>").first().attachments.count(), 1)

    def test_parse_raw_reads_automatic_headers(self):
        data = mailparse.parse_raw(self.raw(Auto_Submitted="auto-generated"))
        self.assertTrue(mailparse.is_automatic(data["headers"], "alice@example.com", data["subject"]))

    def test_webhook_secret(self):
        self.new_ticket()
        body = {"from": "alice@example.com", "to": "support@ilaf.test", "subject": "Re: [BNC-00001] x", "text": "Hello", "message-id": "<w1@x>", "in-reply-to": "", "attachments": []}
        anon = APIClient()
        url = API + "support/inbound-email/"
        self.assertEqual(anon.post(url, body, format="json").status_code, 403)
        self.assertEqual(anon.post(url, body, format="json", HTTP_X_SUPPORT_SECRET="wrong").status_code, 403)
        res = anon.post(url, body, format="json", HTTP_X_SUPPORT_SECRET="inbound-secret")
        self.assertEqual((res.status_code, res.data["status"], res.data["ticket"]), (200, "added", "BNC-00001"))
        self.assertEqual(anon.post(url, body, format="json", HTTP_X_SUPPORT_SECRET="inbound-secret").data["reason"], "duplicate")

    def test_webhook_is_off_without_a_secret(self):
        from django.test import override_settings

        with override_settings(SUPPORT_INBOUND_SECRET=""):
            self.assertEqual(APIClient().post(API + "support/inbound-email/", {"from": "a@b.co"}, format="json", HTTP_X_SUPPORT_SECRET="").status_code, 404)

    def test_fetch_command_reads_the_mailbox_and_marks_seen(self):
        from django.test import override_settings

        self.new_ticket()
        raw = self.raw()
        box = mock.MagicMock()
        box.search.return_value = ("OK", [b"1 2"])

        def fetch(num, what):
            if "SIZE" in what:
                return "OK", [b"1 (RFC822.SIZE 500)"]
            return "OK", [(b"1 (BODY[] {10}", raw), b")"]

        box.fetch.side_effect = fetch
        with override_settings(SUPPORT_IMAP_HOST="imap.test", SUPPORT_IMAP_USER="u", SUPPORT_IMAP_PASSWORD="p"), \
                mock.patch("imaplib.IMAP4_SSL", return_value=box) as ssl:
            call_command("fetch_support_mail")
        ssl.assert_called_once()
        box.login.assert_called_with("u", "p")
        self.assertEqual(box.store.call_count, 2)  # both mails marked seen, the second one is a duplicate
        self.assertEqual(SupportMessage.objects.filter(email_message_id="<raw-1@client>").count(), 1)

    def test_fetch_command_does_nothing_without_a_mailbox(self):
        with mock.patch("imaplib.IMAP4_SSL") as ssl:
            call_command("fetch_support_mail")
        ssl.assert_not_called()

    def test_oversized_mail_is_skipped_but_marked_seen(self):
        from django.test import override_settings

        box = mock.MagicMock()
        box.search.return_value = ("OK", [b"1"])
        box.fetch.return_value = ("OK", [b"1 (RFC822.SIZE 99999999)"])
        with override_settings(SUPPORT_IMAP_HOST="imap.test", SUPPORT_IMAP_USER="u", SUPPORT_MAIL_MAX_BYTES=1000), mock.patch("imaplib.IMAP4_SSL", return_value=box):
            call_command("fetch_support_mail")
        box.store.assert_called_once()
        self.assertEqual(box.fetch.call_count, 1)
