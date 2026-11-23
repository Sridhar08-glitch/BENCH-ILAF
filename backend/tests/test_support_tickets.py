"""Support tickets: the customer flow, isolation, the staff role matrix, audit, e-mails in two languages, files, the SLA clock."""
import os
from datetime import datetime, timedelta, timezone as dt_tz

from django.core import mail
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from staff.models import StaffAuditEvent
from support import hours, services
from support.models import SupportAttachment, SupportTicket

from .base import API, BIG_RATES
from .staff_base import PRIVATE_DIR
from .support_base import ALWAYS_OPEN, PDF, PNG, SupportTestCase, pow_solve


class CustomerFlowTests(SupportTestCase):
    def test_create_confirms_by_email_and_alerts_staff(self):
        data = self.new_ticket()
        self.assertEqual(data["label"], "BNC-00001")
        self.assertEqual(data["status"], "new")
        self.assertEqual(len(data["messages"]), 1)
        to_customer = [m for m in mail.outbox if m.to == ["alice@example.com"]]
        self.assertEqual(len(to_customer), 1)
        msg = to_customer[0]
        self.assertIn("[BNC-00001]", msg.subject)
        self.assertEqual(msg.extra_headers["Reply-To"], "support@ilaf.test")
        self.assertEqual(msg.extra_headers["Auto-Submitted"], "auto-generated")
        self.assertIn("BNC-00001", msg.body)
        staff = {a for m in mail.outbox for a in m.to if a.endswith("@ilaf.test")}
        self.assertEqual(staff, {"admin@ilaf.test", "agent@ilaf.test"})

    def test_numbers_count_up(self):
        self.assertEqual(self.new_ticket()["number"], 1)
        self.assertEqual(self.new_ticket(self.bob)["number"], 2)

    def test_context_is_kept_without_secrets(self):
        ctx = {
            "page_url": "https://app.example.com/app/cards?token=abc123&x=1#frag", "route": "/app/cards", "app_language": "ar",
            "build_id": "eyJhbGciOiJIUzI1NiJ9.payload.sig", "screen": {"w": 1280, "h": 720}, "password": "hunter2", "workspace_id": "nonsense",
            "role": "owner", "plan_label": "Hacked", "card_id": "c-1",
        }
        res = self.alice.client.post(API + "support/tickets", {
            "category": "bug", "subject": "s", "body": "b", "context": ctx,
        }, format="json", HTTP_USER_AGENT="Mozilla/5.0 (Windows NT 10.0) Chrome/120.0.0.0 Safari/537.36")
        got = res.data["context"]
        self.assertEqual(got["page_url"], "/app/cards")
        self.assertEqual(got["route"], "/app/cards")
        self.assertEqual(got["screen"], {"w": 1280, "h": 720})
        self.assertEqual(got["browser"], "Chrome 120")
        self.assertEqual(got["os"], "Windows")
        self.assertEqual(got["card_id"], "c-1")
        for key in ("password", "build_id", "role", "plan_label", "workspace_id"):
            self.assertNotIn(key, got)
        self.assertNotIn("hunter2", str(got))

    def test_role_and_plan_come_from_the_server(self):
        res = self.alice.client.post(API + "support/tickets", {
            "category": "billing", "subject": "s", "body": "b", "context": {"workspace_id": self.alice.ws, "role": "admin"},
        }, format="json")
        self.assertEqual(res.data["context"]["workspace_id"], self.alice.ws)
        self.assertEqual(res.data["context"]["role"], "owner")
        other = self.bob.client.post(API + "support/tickets", {
            "category": "billing", "subject": "s", "body": "b", "context": {"workspace_id": self.alice.ws},
        }, format="json")
        self.assertNotIn("workspace_id", other.data["context"])

    def test_context_can_be_switched_off(self):
        res = self.alice.client.post(API + "support/tickets", {"category": "bug", "subject": "s", "body": "b", "include_context": False, "context": {"route": "/app"}}, format="json")
        self.assertEqual(res.data["context"], {})

    def test_validation(self):
        bad = [({}, "subject"), ({"subject": "x", "body": " "}, "body"), ({"subject": "x", "body": "y", "category": "nope"}, "category"),
               ({"subject": "x" * 201, "body": "y"}, "subject"), ({"subject": "x", "body": "y" * 10001}, "body")]
        for body, field in bad:
            res = self.alice.client.post(API + "support/tickets", body, format="json")
            self.assertEqual(res.status_code, 400, body)
            self.assertIn(field, res.data["error"]["fields"])

    def test_isolation_between_customers(self):
        t = self.new_ticket()
        tid = t["id"]
        self.assertEqual(self.bob.client.get(f"{API}support/tickets/{tid}").status_code, 404)
        self.assertEqual(self.bob.client.post(f"{API}support/tickets/{tid}/messages", {"body": "hi"}, format="json").status_code, 404)
        self.assertEqual(self.bob.client.post(f"{API}support/tickets/{tid}/solve").status_code, 404)
        self.assertEqual(self.bob.client.post(f"{API}support/tickets/{tid}/rating", {"rating": 5}, format="json").status_code, 404)
        self.assertEqual(self.bob.client.get(API + "support/tickets").data, [])
        self.assertEqual(len(self.alice.client.get(API + "support/tickets").data), 1)
        self.assertEqual(APIClient().get(API + "support/tickets").status_code, 401)

    def test_staff_endpoints_are_hidden_from_customers(self):
        self.assertEqual(self.alice.client.get(API + "staff/support/tickets").status_code, 404)
        self.assertEqual(APIClient().get(API + "staff/support/tickets").status_code, 401)

    def test_reply_unread_seen_and_internal_notes(self):
        t = self.new_ticket()
        res = self.agent.client.post(self.staff_url(t["id"], "/reply"), {"body": "Please try the latest version."}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "waiting_customer")
        self.agent.client.post(self.staff_url(t["id"], "/reply"), {"body": "Internal: check logs", "internal": True}, format="json")
        listed = self.alice.client.get(API + "support/tickets").data[0]
        self.assertEqual(listed["unread"], 1)
        self.assertEqual(self.alice.client.get(API + "support/summary").data["unread"], 1)
        detail = self.alice.client.get(f"{API}support/tickets/{t['id']}").data
        self.assertEqual([m["body"] for m in detail["messages"] if m["kind"] == "message"], ["When I press save nothing happens.", "Please try the latest version."])
        self.assertNotIn("internal", detail["messages"][0])
        self.alice.client.post(f"{API}support/tickets/{t['id']}/seen")
        self.assertEqual(self.alice.client.get(API + "support/summary").data["unread"], 0)
        ticket = SupportTicket.objects.get(pk=t["id"])
        self.assertIsNotNone(ticket.first_response_at)
        self.assertEqual(ticket.assigned_staff.email, "agent@ilaf.test")

    def test_staff_reply_email_has_link_marker_and_reply_to(self):
        t = self.new_ticket()
        mail.outbox.clear()
        self.agent.client.post(self.staff_url(t["id"], "/reply"), {"body": "We fixed it."}, format="json")
        msg = next(m for m in mail.outbox if m.to == ["alice@example.com"] and "We fixed it." in m.body)
        self.assertIn("##- Please type your reply above this line -##", msg.body)
        self.assertIn("https://web.test/app/support/" + t["id"], msg.body)
        self.assertEqual(msg.extra_headers["Reply-To"], "support@ilaf.test")
        self.assertNotIn("Auto-Submitted", msg.extra_headers)
        self.assertTrue(msg.subject.startswith("[BNC-00001]"))

    def test_emails_in_arabic_for_arabic_customers(self):
        res = self.alice.client.post(API + "support/tickets", {"category": "bug", "subject": "مشكلة", "body": "لا يعمل الحفظ"}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.status_code, 201)
        msg = next(m for m in mail.outbox if m.to == ["alice@example.com"])
        self.assertIn("استلمنا طلبك", msg.body)
        self.assertIn('dir="rtl"', msg.alternatives[0][0])
        mail.outbox.clear()
        self.agent.client.post(self.staff_url(res.data["id"], "/reply"), {"body": "تم الحل"}, format="json")
        reply = next(m for m in mail.outbox if m.to == ["alice@example.com"])
        self.assertIn("رددنا على طلبك", reply.body)
        self.assertIn("يرجى كتابة ردك أعلى هذا السطر", reply.body)

    def test_api_errors_are_translated(self):
        res = self.alice.client.post(API + "support/tickets", {"category": "zzz", "subject": "s", "body": "b"}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertEqual(res.data["error"]["fields"]["category"], ["اختر فئة."])

    def test_every_customer_text_has_arabic(self):
        import re
        from pathlib import Path

        from ilaf import locale_ar

        src = Path(services.__file__).parent
        missing = []
        for name in ("services.py", "views.py", "chat.py", "mailparse.py"):
            text = (src / name).read_text(encoding="utf-8")
            found = re.findall(r'\btr\(\s*\w+(?:\([^)]*\))?\s*,\s*"([^"]+)"', text)
            found += re.findall(r'ApiError\(\s*"[a-z_]+",\s*"([^"]+)"', text)
            found += re.findall(r'validation_error\(\{"\w+": \["([^"]+)"\]', text)
            for message in found:
                if message not in locale_ar.TEXTS and not any(p.fullmatch(message) for p, _ in locale_ar.PATTERNS):
                    missing.append(message)
        self.assertEqual(sorted(set(missing)), [])


class SolveReopenRateTests(SupportTestCase):
    def test_solve_reopen_and_rate(self):
        t = self.new_ticket()
        tid = t["id"]
        self.assertEqual(self.alice.client.post(f"{API}support/tickets/{tid}/rating", {"rating": 5}, format="json").status_code, 409)
        res = self.alice.client.post(f"{API}support/tickets/{tid}/solve")
        self.assertEqual(res.data["status"], "solved")
        self.assertTrue(res.data["can_reopen"])
        self.assertEqual(self.alice.client.post(f"{API}support/tickets/{tid}/rating", {"rating": 9}, format="json").status_code, 400)
        res = self.alice.client.post(f"{API}support/tickets/{tid}/rating", {"rating": 4, "comment": "Quick"}, format="json")
        self.assertEqual((res.data["rating"], res.data["rating_comment"]), (4, "Quick"))
        res = self.alice.client.post(f"{API}support/tickets/{tid}/reopen")
        self.assertEqual(res.data["status"], "open")

    def test_reopen_expires_after_14_days(self):
        t = self.new_ticket()
        self.alice.client.post(f"{API}support/tickets/{t['id']}/solve")
        SupportTicket.objects.filter(pk=t["id"]).update(solved_at=timezone.now() - timedelta(days=15))
        res = self.alice.client.post(f"{API}support/tickets/{t['id']}/reopen")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "support_reopen_expired"))
        res = self.alice.client.post(f"{API}support/tickets/{t['id']}/messages", {"body": "still broken"}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_a_reply_reopens_a_solved_ticket_and_closing_sweeps_old_ones(self):
        t = self.new_ticket()
        self.alice.client.post(f"{API}support/tickets/{t['id']}/solve")
        res = self.alice.client.post(f"{API}support/tickets/{t['id']}/messages", {"body": "It came back"}, format="json")
        self.assertEqual(res.data["status"], "open")
        self.alice.client.post(f"{API}support/tickets/{t['id']}/solve")
        SupportTicket.objects.filter(pk=t["id"]).update(solved_at=timezone.now() - timedelta(days=15))
        self.assertEqual(services.close_old_solved(), 1)
        self.assertEqual(SupportTicket.objects.get(pk=t["id"]).status, "closed")

    def test_staff_solved_sends_email_and_customer_reply_alerts_staff(self):
        t = self.new_ticket()
        mail.outbox.clear()
        self.agent.client.patch(self.staff_url(t["id"]), {"status": "solved"}, format="json")
        self.assertTrue(any("solved" in m.body and m.to == ["alice@example.com"] for m in mail.outbox))
        mail.outbox.clear()
        self.alice.client.post(f"{API}support/tickets/{t['id']}/messages", {"body": "thanks but no"}, format="json")
        self.assertTrue(any(m.to == ["agent@ilaf.test"] or m.to == ["admin@ilaf.test"] for m in mail.outbox))


class StaffRoleTests(SupportTestCase):
    def test_role_matrix(self):
        t = self.new_ticket()
        tid = t["id"]
        # everybody on the team can look
        for person in (self.viewer, self.agent, self.admin):
            self.assertEqual(person.client.get(API + "staff/support/tickets").status_code, 200)
            self.assertEqual(person.client.get(self.staff_url(tid)).status_code, 200)
            self.assertEqual(person.client.get(API + "staff/support/settings").status_code, 200)
            self.assertEqual(person.client.get(API + "staff/support/metrics").status_code, 200)
        # read only cannot change anything
        self.assertEqual(self.viewer.client.post(self.staff_url(tid, "/reply"), {"body": "x"}, format="json").status_code, 403)
        self.assertEqual(self.viewer.client.patch(self.staff_url(tid), {"status": "open"}, format="json").status_code, 403)
        self.assertEqual(self.viewer.client.post(API + "staff/support/tickets/bulk", {"ids": [tid], "action": "status", "value": "open"}, format="json").status_code, 403)
        self.assertEqual(self.viewer.client.get(API + "staff/support/tickets.csv").status_code, 403)
        # support can work tickets but not edit settings, canned replies or bans
        self.assertEqual(self.agent.client.patch(self.staff_url(tid), {"priority": "high"}, format="json").status_code, 200)
        self.assertEqual(self.agent.client.put(API + "staff/support/settings", {"chat_enabled": False}, format="json").status_code, 403)
        self.assertEqual(self.agent.client.post(API + "staff/support/canned", {"title": "t", "body_en": "b"}, format="json").status_code, 403)
        self.assertEqual(self.agent.client.post(API + "staff/support/bans", {"ip_hash": "a" * 32}, format="json").status_code, 403)
        self.assertEqual(self.admin.client.put(API + "staff/support/settings", {"chat_enabled": False}, format="json").status_code, 200)

    def test_second_step_is_required(self):
        person = self.make_staff("nostep@ilaf.test", "support", verified=False)
        res = person.client.get(API + "staff/support/tickets")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (403, "staff_verification_required"))

    def test_filters_tabs_search_and_counts(self):
        a = self.new_ticket(category="billing", subject="Invoice question")
        b = self.new_ticket(self.bob, category="bug", subject="Broken button")
        self.agent.client.patch(self.staff_url(a["id"]), {"assigned_to": str(self.agent.user.id)}, format="json")
        listed = lambda q: [r["label"] for r in self.agent.client.get(API + "staff/support/tickets?" + q).data["results"]]  # noqa: E731
        self.assertEqual(listed("tab=mine"), ["BNC-00001"])
        self.assertEqual(listed("tab=unassigned"), ["BNC-00002"])
        self.assertEqual(sorted(listed("tab=open")), ["BNC-00001", "BNC-00002"])
        self.assertEqual(listed("category=bug"), ["BNC-00002"])
        self.assertEqual(listed("q=invoice"), ["BNC-00001"])
        self.assertEqual(listed("q=BNC-00002"), ["BNC-00002"])
        self.assertEqual(listed("q=bob@example"), ["BNC-00002"])
        self.assertEqual(listed("assignee=none"), ["BNC-00002"])
        self.assertEqual(listed("channel=chat"), [])
        self.agent.client.patch(self.staff_url(b["id"]), {"status": "solved"}, format="json")
        self.assertEqual(listed("tab=solved"), ["BNC-00002"])
        counts = self.agent.client.get(API + "staff/support/tickets").data["counts"]
        self.assertEqual(counts, {"mine": 1, "unassigned": 0, "open": 1})

    def test_workspace_filter_and_customer_panel(self):
        t = self.alice.client.post(API + "support/tickets", {"category": "billing", "subject": "s", "body": "b", "context": {"workspace_id": self.alice.ws}}, format="json").data
        found = self.agent.client.get(f"{API}staff/support/tickets?workspace={self.alice.ws}").data["results"]
        self.assertEqual([r["id"] for r in found], [t["id"]])
        detail = self.agent.client.get(self.staff_url(t["id"])).data
        self.assertEqual(detail["customer"]["email"], "alice@example.com")
        self.assertEqual(detail["customer"]["workspace"]["id"], self.alice.ws)
        self.assertEqual(detail["customer"]["support_view"], {"available": False})
        self.assertEqual(self.agent.client.get(f"{API}staff/support/tickets?workspace=not-a-uuid").data["count"], 0)

    def test_changes_are_audited(self):
        t = self.new_ticket()
        tid = t["id"]
        self.agent.client.patch(self.staff_url(tid), {"assigned_to": str(self.agent.user.id), "priority": "urgent", "status": "open"}, format="json")
        self.agent.client.post(self.staff_url(tid, "/reply"), {"body": "note", "internal": True}, format="json")
        self.agent.client.post(self.staff_url(tid, "/reply"), {"body": "hello"}, format="json")
        self.admin.client.put(API + "staff/support/settings", {"chat_enabled": True}, format="json")
        self.admin.client.get(API + "staff/support/tickets.csv")
        actions = set(StaffAuditEvent.objects.filter(action__startswith="support.").values_list("action", flat=True))
        self.assertTrue({"support.ticket.assigned_to", "support.ticket.priority", "support.ticket.status", "support.ticket.note",
                         "support.ticket.reply", "support.settings", "support.export"} <= actions, actions)
        event = StaffAuditEvent.objects.get(action="support.ticket.priority")
        self.assertEqual(event.details, {"from": "normal", "to": "urgent"})
        self.assertEqual(event.target_label, "BNC-00001")

    def test_internal_note_is_never_shown_to_the_customer(self):
        t = self.new_ticket()
        self.agent.client.post(self.staff_url(t["id"], "/reply"), {"body": "SECRET NOTE", "internal": True}, format="json")
        self.assertNotIn("SECRET NOTE", str(self.alice.client.get(f"{API}support/tickets/{t['id']}").data))
        self.assertTrue(any(m["body"] == "SECRET NOTE" for m in self.agent.client.get(self.staff_url(t["id"])).data["messages"]))
        self.assertFalse(any("SECRET NOTE" in m.body for m in mail.outbox))

    def test_canned_replies(self):
        c = self.admin.client.post(API + "staff/support/canned", {"title": "Hello", "body_en": "Hi {name}, this is {agent} about {ticket} at {product}.", "body_ar": "مرحبًا {name}، {ticket}"}, format="json")
        self.assertEqual(c.status_code, 201)
        t = self.new_ticket()
        res = self.agent.client.post(self.staff_url(t["id"], "/reply"), {"canned_id": c.data["id"]}, format="json")
        self.assertIn("Hi Alice Anderson, this is Agent about BNC-00001 at BENCH.", [m["body"] for m in res.data["messages"]])
        ar = self.alice.client.post(API + "support/tickets", {"category": "bug", "subject": "s", "body": "b"}, format="json", HTTP_X_LANGUAGE="ar").data
        res = self.agent.client.post(self.staff_url(ar["id"], "/reply"), {"canned_id": c.data["id"]}, format="json")
        self.assertIn("مرحبًا Alice Anderson، BNC-00002", [m["body"] for m in res.data["messages"]])
        self.assertEqual(self.admin.client.put(f"{API}staff/support/canned/{c.data['id']}", {"title": "Hello2", "body_en": "x"}, format="json").status_code, 200)
        self.assertEqual(self.admin.client.delete(f"{API}staff/support/canned/{c.data['id']}").status_code, 204)

    def test_merge_and_bulk(self):
        a = self.new_ticket(subject="First")
        b = self.new_ticket(subject="Duplicate")
        other = self.new_ticket(self.bob, subject="Bob")
        res = self.agent.client.post(self.staff_url(b["id"], "/merge"), {"into": a["id"]}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(len([m for m in res.data["messages"] if m["kind"] == "message"]), 2)
        self.assertEqual(SupportTicket.objects.get(pk=b["id"]).merged_into_id.hex, a["id"].replace("-", ""))
        self.assertEqual(len(self.alice.client.get(API + "support/tickets").data), 1)
        mismatch = self.agent.client.post(self.staff_url(other["id"], "/merge"), {"into": a["id"]}, format="json")
        self.assertEqual(mismatch.status_code, 409)
        bulk = lambda body: self.agent.client.post(API + "staff/support/tickets/bulk", body, format="json")  # noqa: E731
        self.assertEqual(bulk({"ids": [a["id"], other["id"]], "action": "assign", "value": str(self.agent.user.id)}).data["changed"], 2)
        self.assertEqual(bulk({"ids": [a["id"], other["id"]], "action": "priority", "value": "high"}).status_code, 200)
        self.assertEqual(bulk({"ids": [a["id"], other["id"]], "action": "status", "value": "solved"}).status_code, 200)
        self.assertEqual(SupportTicket.objects.filter(status="solved", priority="high").count(), 2)
        self.assertEqual(bulk({"ids": [a["id"]], "action": "bogus"}).status_code, 400)
        self.assertEqual(bulk({"ids": [], "action": "status", "value": "open"}).status_code, 400)

    def test_csv_export_neutralises_formulas(self):
        self.new_ticket(subject="=HYPERLINK(\"http://x\")")
        res = self.agent.client.get(API + "staff/support/tickets.csv")
        text = res.content.decode()
        self.assertIn("'=HYPERLINK", text)
        self.assertNotIn(",=HYPERLINK", text)

    def test_metrics(self):
        a = self.new_ticket()
        self.agent.client.post(self.staff_url(a["id"], "/reply"), {"body": "hi", "status": "solved"}, format="json")
        self.alice.client.post(f"{API}support/tickets/{a['id']}/rating", {"rating": 5}, format="json")
        m = self.agent.client.get(API + "staff/support/metrics?days=7").data
        self.assertEqual((m["created"], m["solved"]), (1, 1))
        self.assertIsNotNone(m["first_response_seconds"])
        self.assertEqual(m["satisfaction"]["distribution"]["5"], 1)
        self.assertEqual(m["by_category"], [{"category": "bug", "count": 1}])
        self.assertEqual(len(m["by_day"]), 7)
        self.assertEqual(m["by_day"][-1]["count"], 1)

    def test_settings_validation_and_round_trip(self):
        put = lambda body: self.admin.client.put(API + "staff/support/settings", body, format="json")  # noqa: E731
        for body, field in [({"timezone": "Mars/Base"}, "timezone"), ({"business_hours": {"mon": [["17:00", "09:00"]]}}, "business_hours"),
                            ({"holidays": ["soon"]}, "holidays"), ({"chat_accept_seconds": 5}, "chat_accept_seconds"),
                            ({"sla": {"low": {"first": 1}}}, "sla"), ({"blocked_words": [""]}, "blocked_words"), ({"inbound_address": "nope"}, "inbound_address")]:
            res = put(body)
            self.assertEqual(res.status_code, 400, body)
            self.assertIn(field, res.data["error"]["fields"])
        res = put({"timezone": "Asia/Dubai", "holidays": ["2026-12-18"], "blocked_words": ["Spam"], "chat_accept_seconds": 90,
                   "auto_reply_ar": "شكرًا", "business_hours": {"sun": [["08:00", "12:00"], ["13:00", "16:00"]]}})
        self.assertEqual(res.status_code, 200)
        got = self.admin.client.get(API + "staff/support/settings").data
        self.assertEqual((got["timezone"], got["holidays"], got["blocked_words"], got["auto_reply_ar"]), ("Asia/Dubai", ["2026-12-18"], ["spam"], "شكرًا"))
        self.assertEqual(got["mail"]["reply_to"], "support@ilaf.test")
        self.assertNotIn("inbound-secret", str(got))


class AttachmentTests(SupportTestCase):
    def post_with_files(self, files, person=None):
        person = person or self.alice
        return person.client.post(API + "support/tickets", {"category": "bug", "subject": "s", "body": "b", "files": files}, format="multipart")

    def test_valid_types_are_stored_privately_under_random_names(self):
        res = self.post_with_files([self.upload("shot.png", PNG), self.upload("doc.pdf", PDF), self.upload("run.log", b"line 1\nline 2\n"),
                                    self.upload("a.txt", "نص عربي".encode()), self.upload("w.webp", b"RIFF\x10\x00\x00\x00WEBPVP8 ")])
        self.assertEqual(res.status_code, 201, res.content)
        files = res.data["messages"][0]["files"]
        self.assertEqual(sorted(f["content_type"] for f in files), ["application/pdf", "image/png", "image/webp", "text/plain", "text/plain"])
        for row in SupportAttachment.objects.all():
            self.assertTrue(row.file.path.startswith(os.path.realpath(PRIVATE_DIR)) or row.file.path.startswith(PRIVATE_DIR))
            self.assertNotIn("shot", row.file.name)
            self.assertRegex(os.path.basename(row.file.name), r"^[0-9a-f]{32}")
        ticket_id = res.data["id"]
        fid = files[0]["id"]
        down = self.alice.client.get(f"{API}support/tickets/{ticket_id}/files/{fid}/download")
        self.assertEqual(down.status_code, 200)
        self.assertEqual(down["X-Content-Type-Options"], "nosniff")
        self.assertEqual(self.bob.client.get(f"{API}support/tickets/{ticket_id}/files/{fid}/download").status_code, 404)
        self.assertEqual(self.agent.client.get(f"{API}staff/support/tickets/{ticket_id}/files/{fid}/download").status_code, 200)
        self.assertEqual(APIClient().get(f"{API}support/tickets/{ticket_id}/files/{fid}/download").status_code, 401)

    def test_wrong_files_are_refused(self):
        for name, data in [("evil.png", b"MZ\x90\x00 not an image"), ("page.svg", b"<svg onload=alert(1)>"), ("x.txt", b"\x00\x01\x02binary"),
                           ("run.exe", b"MZ\x90\x00"), ("notes", b"plain text but no ending"), ("p.html", b"<html></html>")]:
            res = self.post_with_files([self.upload(name, data)])
            self.assertEqual(res.status_code, 400, name)
        self.assertEqual(SupportAttachment.objects.count(), 0)
        self.assertEqual(SupportTicket.objects.count(), 0)

    def test_limits_five_files_and_ten_megabytes(self):
        too_many = [self.upload(f"{i}.png", PNG) for i in range(6)]
        self.assertEqual(self.post_with_files(too_many).status_code, 400)
        big = self.upload("big.pdf", PDF + b"0" * (10 * 1024 * 1024))
        res = self.post_with_files([big])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(res.data["error"]["fields"]["file"], ["That file is larger than 10 MB."])

    def test_files_on_internal_notes_are_hidden_from_the_customer(self):
        t = self.new_ticket()
        res = self.agent.client.post(self.staff_url(t["id"], "/reply"), {"body": "log", "internal": True, "files": [self.upload("x.log", b"secret log")]}, format="multipart")
        fid = res.data["messages"][-1]["files"][0]["id"]
        self.assertEqual(self.alice.client.get(f"{API}support/tickets/{t['id']}/files/{fid}/download").status_code, 404)
        self.assertEqual(self.agent.client.get(f"{API}staff/support/tickets/{t['id']}/files/{fid}/download").status_code, 200)

    @override_settings(SUPPORT_VIRUS_SCAN="tests.test_support_tickets.fake_scanner")
    def test_virus_scan_hook(self):
        res = self.post_with_files([self.upload("x.txt", b"EICAR test")])
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self.post_with_files([self.upload("x.txt", b"fine")]).status_code, 201)


def fake_scanner(data, content_type):
    return "infected" if b"EICAR" in data else "clean"


class BusinessHoursTests(SupportTestCase):
    def cfg(self):
        c = services.cfg()
        c.timezone = "Asia/Qatar"
        c.business_hours = {d: [["09:00", "17:00"]] for d in ("sun", "mon", "tue", "wed", "thu")}
        c.holidays = []
        return c

    def test_is_open(self):
        c = self.cfg()
        # 2026-11-19 is a Thursday; Qatar is UTC+3
        self.assertTrue(hours.is_open(c, datetime(2026, 11, 19, 7, 0, tzinfo=dt_tz.utc)))      # 10:00 local
        self.assertFalse(hours.is_open(c, datetime(2026, 11, 19, 14, 30, tzinfo=dt_tz.utc)))   # 17:30 local
        self.assertFalse(hours.is_open(c, datetime(2026, 11, 20, 8, 0, tzinfo=dt_tz.utc)))     # Friday
        self.assertFalse(hours.is_open(c, datetime(2026, 11, 21, 8, 0, tzinfo=dt_tz.utc)))     # Saturday
        self.assertTrue(hours.is_open(c, datetime(2026, 11, 22, 8, 0, tzinfo=dt_tz.utc)))      # Sunday

    def test_deadline_skips_nights_weekend_and_holidays(self):
        c = self.cfg()
        thursday_1630 = datetime(2026, 11, 19, 13, 30, tzinfo=dt_tz.utc)
        due = hours.add_business_minutes(c, thursday_1630, 60)  # 30 min left on Thursday, 30 on Sunday
        self.assertEqual(due.astimezone(hours._zone(c)).strftime("%a %H:%M"), "Sun 09:30")
        c.holidays = ["2026-11-22"]
        due = hours.add_business_minutes(c, thursday_1630, 60)
        self.assertEqual(due.astimezone(hours._zone(c)).strftime("%a %H:%M"), "Mon 09:30")
        inside = hours.add_business_minutes(c, datetime(2026, 11, 23, 6, 0, tzinfo=dt_tz.utc), 120)  # Monday 09:00 local
        self.assertEqual(inside.astimezone(hours._zone(c)).strftime("%a %H:%M"), "Mon 11:00")

    def test_business_minutes_between(self):
        c = self.cfg()
        start = datetime(2026, 11, 19, 13, 30, tzinfo=dt_tz.utc)   # Thursday 16:30
        end = datetime(2026, 11, 22, 6, 30, tzinfo=dt_tz.utc)      # Sunday 09:30
        self.assertEqual(hours.business_minutes_between(c, start, end), 60)
        self.assertEqual(hours.business_minutes_between(c, end, start), 0)

    def test_no_hours_means_plain_time(self):
        c = self.cfg()
        c.business_hours = {}
        start = datetime(2026, 11, 20, 8, 0, tzinfo=dt_tz.utc)
        self.assertEqual(hours.add_business_minutes(c, start, 90), start + timedelta(minutes=90))

    def test_ticket_deadlines_follow_priority_and_hours(self):
        t = self.new_ticket()
        row = SupportTicket.objects.get(pk=t["id"])
        self.assertLess(row.first_due_at, row.resolve_due_at)
        self.agent.client.patch(self.staff_url(t["id"]), {"priority": "urgent"}, format="json")
        urgent = SupportTicket.objects.get(pk=t["id"])
        self.assertLess(urgent.first_due_at, row.first_due_at)

    def test_sla_states_and_breach_alert(self):
        t = self.new_ticket()
        row = SupportTicket.objects.get(pk=t["id"])
        self.assertEqual(services.sla_state(row), "ok")
        SupportTicket.objects.filter(pk=row.pk).update(first_due_at=timezone.now() + timedelta(minutes=30))
        self.assertEqual(services.sla_state(SupportTicket.objects.get(pk=row.pk)), "at_risk")
        self.assertEqual(self.agent.client.get(API + "staff/support/tickets?sla=at_risk").data["count"], 1)
        SupportTicket.objects.filter(pk=row.pk).update(first_due_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(services.sla_state(SupportTicket.objects.get(pk=row.pk)), "breached")
        self.assertEqual(self.agent.client.get(API + "staff/support/tickets?sla=breached").data["count"], 1)
        mail.outbox.clear()
        self.assertEqual(services.sweep_sla(), 1)
        self.assertEqual(services.sweep_sla(), 0)
        alert = mail.outbox[0]
        self.assertEqual(alert.to, ["admin@ilaf.test"])
        self.assertIn("missed", alert.body)
        self.agent.client.patch(self.staff_url(t["id"]), {"status": "waiting_customer"}, format="json")
        self.assertEqual(services.sla_state(SupportTicket.objects.get(pk=row.pk)), "paused")


class ContactFormTests(SupportTestCase):
    def challenge(self):
        return APIClient().get(API + "support/challenge").data

    def contact(self, **extra):
        ch = self.challenge()
        body = {"name": "Visitor Vera", "email": "vera@example.org", "category": "other", "subject": "Hello", "body": "Can you help?",
                "challenge": ch["challenge"], "counter": pow_solve(ch["challenge"], ch["difficulty"]), "website": ""}
        body.update(extra)
        return APIClient().post(API + "support/contact", body, format="json")

    def test_signed_out_visitor_can_write(self):
        res = self.contact()
        self.assertEqual(res.status_code, 201, res.content)
        t = SupportTicket.objects.get()
        self.assertIsNone(t.requester)
        self.assertEqual(t.requester_email, "vera@example.org")
        self.assertEqual(t.channel, "form")
        msg = next(m for m in mail.outbox if m.to == ["vera@example.org"])
        self.assertIn("Reply to this e-mail", msg.body)

    def test_honeypot_wrong_proof_and_replay_are_refused(self):
        self.assertEqual(self.contact(website="http://spam").status_code, 400)
        self.assertEqual(self.contact(counter=1).status_code, 400)
        ch = self.challenge()
        body = {"name": "V", "email": "v@example.org", "subject": "s", "body": "b", "challenge": ch["challenge"], "counter": pow_solve(ch["challenge"], ch["difficulty"])}
        self.assertEqual(APIClient().post(API + "support/contact", body, format="json").status_code, 201)
        self.assertEqual(APIClient().post(API + "support/contact", body, format="json").status_code, 400)
        self.assertEqual(SupportTicket.objects.count(), 1)

    @override_settings(SUPPORT_MIN_FILL_SECONDS=60)
    def test_too_fast_is_refused(self):
        self.assertEqual(self.contact().status_code, 400)

    def test_forged_challenge_is_refused(self):
        ch = self.challenge()["challenge"]
        forged = ch[:-4] + "0000"
        body = {"name": "V", "email": "v@example.org", "subject": "s", "body": "b", "challenge": forged, "counter": pow_solve(forged)}
        self.assertEqual(APIClient().post(API + "support/contact", body, format="json").status_code, 400)

    def test_validation_and_blocked_words(self):
        self.assertEqual(self.contact(email="not-an-email").status_code, 400)
        self.assertEqual(self.contact(name="").status_code, 400)
        self.assertEqual(self.contact(category="nope").status_code, 400)
        c = services.cfg()
        c.blocked_words = ["casino"]
        c.save()
        res = self.contact(body="Visit my CASINO site")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "support_blocked_content"))

    def test_rate_limit_per_address(self):
        rates = {**BIG_RATES, "support_public": "2/hour"}
        with override_settings(ILAF_THROTTLE_RATES=rates):
            codes = [self.contact().status_code for _ in range(4)]
        self.assertEqual(codes[:2], [201, 201])
        self.assertEqual(codes[3], 429)

    def test_banned_address(self):
        self.assertEqual(self.contact().status_code, 201)
        digest = SupportTicket.objects.get().ip_hash
        res = self.admin.client.post(API + "staff/support/bans", {"ip_hash": digest, "days": 3, "reason": "spam"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.contact(email="w@example.org").status_code, 403)
        self.assertEqual(len(self.admin.client.get(API + "staff/support/bans").data), 1)
        self.assertEqual(self.admin.client.delete(f"{API}staff/support/bans/{res.data['id']}").status_code, 204)
        self.assertEqual(self.contact(email="w@example.org").status_code, 201)

    def test_signed_in_person_uses_their_account(self):
        ch = self.challenge()
        res = self.alice.client.post(API + "support/contact", {"category": "other", "subject": "Hi", "body": "Hello"}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(SupportTicket.objects.get().requester.email, "alice@example.com")
