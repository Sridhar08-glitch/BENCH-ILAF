"""The request flow: briefs, the thread, uploads, approval, e-mails, audit entries and tenant isolation."""
import os
from datetime import timedelta

from django.core import mail
from django.core.files.uploadedfile import SimpleUploadedFile
from django.utils import timezone

from designs.models import DesignRequest, DesignRequestFile
from operations.models import AuditEvent
from staff.models import StaffAuditEvent

from .base import API, png_upload
from .staff_base import PRIVATE_DIR, StaffTestCase

PDF = b"%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF"


def upload(name, data, content_type="application/octet-stream"):
    return SimpleUploadedFile(name, data, content_type=content_type)


class RequestCreationTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.company_with_owner()
        self.url = f"{API}workspaces/{self.owner.company}/design-requests"

    def test_create_and_read_back(self):
        res = self.owner.client.post(self.url, {
            "goals": "Show our craft.", "brand_assets_notes": "Logo is on the brand page.", "style_examples": ["https://example.com/a", "http://b.example.com/c"],
            "languages": "ar", "deadline": (timezone.now().date() + timedelta(days=30)).isoformat(), "employees_count": 42, "notes": "Thanks",
            "allow_team_names": True,
        }, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "new")
        self.assertEqual(res.data["languages"], "ar")
        self.assertEqual(res.data["employees_count"], 42)
        self.assertTrue(res.data["allow_team_names"])
        self.assertEqual(res.data["style_examples"], ["https://example.com/a", "http://b.example.com/c"])
        one = self.owner.client.get(f"{self.url}/{res.data['id']}")
        self.assertEqual(one.data["goals"], "Show our craft.")
        listed = self.owner.client.get(self.url)
        self.assertEqual([r["id"] for r in listed.data], [res.data["id"]])
        self.assertEqual(listed.data[0]["face"], None)

    def test_validation(self):
        bad = [
            ({}, "goals"), ({"goals": "  "}, "goals"), ({"goals": "x" * 4001}, "goals"),
            ({"goals": "ok", "languages": "fr"}, "languages"),
            ({"goals": "ok", "deadline": "2001-01-01"}, "deadline"), ({"goals": "ok", "deadline": "soon"}, "deadline"),
            ({"goals": "ok", "employees_count": 0}, "employees_count"), ({"goals": "ok", "employees_count": "ten"}, "employees_count"),
            ({"goals": "ok", "style_examples": ["javascript:alert(1)"]}, "style_examples"),
            ({"goals": "ok", "style_examples": ["https://a.com"] * 6}, "style_examples"),
            ({"goals": "ok", "style_examples": ["https://a.com/has space"]}, "style_examples"),
            ({"goals": "ok", "allow_team_names": "yes"}, "allow_team_names"),
            ({"goals": "ok", "follows_face": 99999}, "follows_face"),
        ]
        for body, field in bad:
            res = self.owner.client.post(self.url, body, format="json")
            self.assertEqual(res.status_code, 400, body)
            self.assertIn(field, res.data["error"]["fields"], body)
        self.assertEqual(DesignRequest.objects.count(), 0)

    def test_one_open_request_per_company_until_closed(self):
        first = self.new_request(self.owner)
        again = self.owner.client.post(self.url, {"goals": "again"}, format="json")
        self.assertEqual(again.status_code, 409)
        self.assertEqual(again.data["error"]["code"], "request_open")
        self.owner.client.post(f"{self.url}/{first['id']}/withdraw")
        self.assertEqual(self.owner.client.post(self.url, {"goals": "again"}, format="json").status_code, 201)

    def test_other_company_may_have_its_own_open_request(self):
        self.new_request(self.owner)
        other = self.company_with_owner("o2@other.test", "Other Co")
        self.new_request(other)
        self.assertEqual(DesignRequest.objects.filter(status="new").count(), 2)

    def test_only_owner_or_admin_of_a_company(self):
        emp = self.invite(self.owner, self.owner.company, "emp@acme.test")
        joined = self.join(emp)
        self.assertEqual(joined.client.get(self.url).status_code, 403)
        self.assertEqual(joined.client.post(self.url, {"goals": "x"}, format="json").status_code, 403)
        admin_invite = self.invite(self.owner, self.owner.company, "adm@acme.test", role="admin")
        admin = self.join(admin_invite)
        self.assertEqual(admin.client.post(self.url, {"goals": "from the admin"}, format="json").status_code, 201)

    def test_personal_workspace_cannot_ask(self):
        person = self.signup("solo@example.com")
        res = person.client.post(f"{API}workspaces/{person.ws}/design-requests", {"goals": "x"}, format="json")
        self.assertEqual(res.status_code, 404)

    def test_signed_out_gets_401(self):
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().get(self.url).status_code, 401)


class TenantIsolationTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.a = self.company_with_owner("a@acme.test", "Acme")
        self.b = self.company_with_owner("b@bravo.test", "Bravo")
        self.req = self.new_request(self.a)
        res = self.a.client.post(
            f"{API}workspaces/{self.a.company}/design-requests/{self.req['id']}/files", {"file": png_upload(name="logo.png")}, format="multipart",
        )
        self.file = res.data

    def paths(self, ws):
        base = f"{API}workspaces/{ws}/design-requests/{self.req['id']}"
        return base

    def test_company_b_cannot_reach_company_a_through_its_own_workspace(self):
        base = self.paths(self.b.company)
        self.assertEqual(self.b.client.get(base).status_code, 404)
        self.assertEqual(self.b.client.post(base + "/messages", {"body": "hi"}, format="json").status_code, 404)
        self.assertEqual(self.b.client.post(base + "/withdraw").status_code, 404)
        self.assertEqual(self.b.client.post(base + "/approve").status_code, 404)
        self.assertEqual(self.b.client.post(base + "/request-changes", {"comment": "x"}, format="json").status_code, 404)
        self.assertEqual(self.b.client.get(base + "/preview").status_code, 404)
        self.assertEqual(self.b.client.get(f"{base}/files/{self.file['id']}/download").status_code, 404)
        self.assertEqual(self.b.client.get(f"{API}workspaces/{self.b.company}/design-requests").data, [])

    def test_company_b_cannot_reach_company_a_through_company_a_workspace(self):
        base = self.paths(self.a.company)
        self.assertEqual(self.b.client.get(base).status_code, 404)
        self.assertEqual(self.b.client.get(f"{base}/files/{self.file['id']}/download").status_code, 404)
        self.assertEqual(self.b.client.post(base + "/messages", {"body": "hi"}, format="json").status_code, 404)
        self.assertEqual(self.b.client.get(f"{API}workspaces/{self.a.company}/custom-faces").status_code, 404)

    def test_owner_still_reads_own_file(self):
        res = self.a.client.get(f"{self.paths(self.a.company)}/files/{self.file['id']}/download")
        self.assertEqual(res.status_code, 200)


class ThreadTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.company_with_owner()
        self.req = self.new_request(self.owner)
        self.base = f"{API}workspaces/{self.owner.company}/design-requests/{self.req['id']}"
        self.staff = self.make_staff("support@ilaf.test", "support")
        self.sbase = f"{API}staff/design-requests/{self.req['id']}"
        mail.outbox.clear()

    def test_customer_message_and_internal_notes_stay_apart(self):
        self.owner.client.post(self.base + "/messages", {"body": "Please use our teal."}, format="json")
        self.staff.client.post(self.sbase + "/messages", {"body": "Will do, thanks."}, format="json")
        self.staff.client.post(self.sbase + "/messages", {"body": "Budget is tight, keep it simple.", "internal": True}, format="json")
        customer_view = self.owner.client.get(self.base).data
        bodies = [m["body"] for m in customer_view["messages"] if m["kind"] == "message"]
        self.assertEqual(bodies, ["Please use our teal.", "Will do, thanks."])
        self.assertNotIn("Budget is tight", str(customer_view))
        staff_view = self.staff.client.get(self.sbase).data
        notes = [m for m in staff_view["messages"] if m["internal"]]
        self.assertEqual(len(notes), 1)
        self.assertEqual(notes[0]["author_name"], "Support")

    def test_unread_badge_and_seen(self):
        self.staff.client.post(self.sbase + "/messages", {"body": "Hello"}, format="json")
        self.staff.client.post(self.sbase + "/messages", {"body": "secret", "internal": True}, format="json")
        summary = self.owner.client.get(f"{API}workspaces/{self.owner.company}/design-requests/summary").data
        self.assertEqual(summary["unread"], 1)
        self.assertEqual(summary["open"], 1)
        self.assertEqual(self.owner.client.post(self.base + "/seen").status_code, 204)
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.owner.company}/design-requests/summary").data["unread"], 0)

    def test_status_changes_appear_in_the_thread(self):
        self.staff.client.post(self.sbase + "/status", {"status": "contacted"}, format="json")
        detail = self.owner.client.get(self.base).data
        self.assertEqual(detail["status"], "contacted")
        self.assertIn("contacted", [m["status_to"] for m in detail["messages"] if m["kind"] == "status"])

    def test_staff_moves_are_checked(self):
        self.assertEqual(self.staff.client.post(self.sbase + "/status", {"status": "approved"}, format="json").status_code, 409)
        self.assertEqual(self.staff.client.post(self.sbase + "/status", {"status": "live"}, format="json").status_code, 409)
        self.assertEqual(self.staff.client.post(self.sbase + "/status", {"status": "in_review"}, format="json").status_code, 409)
        self.assertEqual(self.staff.client.post(self.sbase + "/status", {"status": "nonsense"}, format="json").status_code, 409)
        self.assertEqual(self.staff.client.post(self.sbase + "/status", {"status": "closed"}, format="json").status_code, 200)
        self.assertEqual(self.staff.client.post(self.sbase + "/status", {"status": "contacted"}, format="json").status_code, 409)

    def test_empty_and_oversized_messages(self):
        self.assertEqual(self.owner.client.post(self.base + "/messages", {"body": "   "}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.post(self.base + "/messages", {"body": "x" * 5001}, format="json").status_code, 400)
        self.assertEqual(self.staff.client.post(self.sbase + "/messages", {"body": ""}, format="json").status_code, 400)

    def test_cannot_write_to_a_finished_request(self):
        self.owner.client.post(self.base + "/withdraw")
        self.assertEqual(self.owner.client.post(self.base + "/messages", {"body": "late"}, format="json").status_code, 409)
        self.assertEqual(self.owner.client.post(self.base + "/withdraw").status_code, 409)

    def test_assign_only_support_or_admin_people(self):
        reader = self.make_staff("reader@ilaf.test", "read_only")
        bad = self.staff.client.post(self.sbase + "/assign", {"staff_id": str(reader.user.id)}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = self.staff.client.post(self.sbase + "/assign", {"staff_id": str(self.staff.user.id)}, format="json")
        self.assertEqual(ok.data["assigned"]["email"], "support@ilaf.test")
        mine = self.staff.client.get(API + "staff/design-requests", {"assignee": "me"})
        self.assertEqual(mine.data["count"], 1)
        none = self.staff.client.get(API + "staff/design-requests", {"assignee": "none"})
        self.assertEqual(none.data["count"], 0)

    def test_board_filters_and_counts(self):
        res = self.staff.client.get(API + "staff/design-requests", {"status": "new"})
        self.assertEqual(res.data["count"], 1)
        self.assertEqual(res.data["counts"], {"new": 1})
        self.assertEqual(self.staff.client.get(API + "staff/design-requests", {"status": "live"}).data["count"], 0)
        self.assertEqual(self.staff.client.get(API + "staff/design-requests", {"q": "acme"}).data["count"], 1)
        self.assertEqual(self.staff.client.get(API + "staff/design-requests", {"q": "zzz"}).data["count"], 0)
        row = res.data["results"][0]
        self.assertTrue(row["waiting_for_staff"])
        self.staff.client.post(self.sbase + "/messages", {"body": "On it"}, format="json")
        row = self.staff.client.get(API + "staff/design-requests").data["results"][0]
        self.assertFalse(row["waiting_for_staff"])


class FileTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.company_with_owner()
        self.req = self.new_request(self.owner)
        self.base = f"{API}workspaces/{self.owner.company}/design-requests/{self.req['id']}"

    def put(self, file):
        return self.owner.client.post(self.base + "/files", {"file": file}, format="multipart")

    def test_accepts_png_jpg_webp_pdf_by_their_bytes(self):
        for name, f, ctype in (
            ("a.png", png_upload(name="a.png"), "image/png"),
            ("b.jpg", png_upload(name="b.jpg", fmt="JPEG"), "image/jpeg"),
            ("c.webp", png_upload(name="c.webp", fmt="WEBP"), "image/webp"),
            ("d.pdf", upload("d.pdf", PDF), "application/pdf"),
        ):
            res = self.put(f)
            self.assertEqual(res.status_code, 201, name)
            self.assertEqual(res.data["content_type"], ctype)
            self.assertEqual(res.data["by"], "customer")

    def test_refuses_wrong_content_whatever_the_name_says(self):
        for name, data in (
            ("evil.png", b"MZ\x90\x00 this is an executable"), ("page.png", b"<html><script>alert(1)</script></html>"),
            ("x.pdf", b"<svg xmlns='http://www.w3.org/2000/svg'><script>1</script></svg>"), ("empty.png", b""),
            ("shell.jpg", b"#!/bin/sh\nrm -rf /"), ("gif.png", b"GIF89a\x01\x00\x01\x00"), ("zip.pdf", b"PK\x03\x04"),
        ):
            res = self.put(upload(name, data, "image/png"))
            self.assertEqual(res.status_code, 400, name)
        self.assertEqual(DesignRequestFile.objects.count(), 0)

    def test_pdf_header_is_enough_but_declared_type_is_ignored(self):
        res = self.put(upload("report.png", PDF, "image/png"))
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["content_type"], "application/pdf")

    def test_size_limit_is_ten_megabytes(self):
        big = b"\x89PNG\r\n\x1a\n" + b"0" * (10 * 1024 * 1024)
        self.assertEqual(self.put(upload("big.png", big)).status_code, 400)
        ok = b"\x89PNG\r\n\x1a\n" + b"0" * (10 * 1024 * 1024 - 8)
        self.assertEqual(self.put(upload("edge.png", ok)).status_code, 201)

    def test_at_most_ten_files(self):
        for i in range(10):
            self.assertEqual(self.put(upload(f"f{i}.pdf", PDF)).status_code, 201)
        res = self.put(upload("one-more.pdf", PDF))
        self.assertEqual(res.status_code, 400)
        self.assertIn("10", res.data["error"]["fields"]["file"][0])

    def test_stored_name_is_random_and_private(self):
        self.put(upload("../../etc/passwd.pdf", PDF))
        row = DesignRequestFile.objects.get()
        self.assertNotIn("passwd", row.file.name)
        self.assertNotIn("..", row.file.name)
        self.assertTrue(row.file.path.startswith(os.path.realpath(PRIVATE_DIR)))
        self.assertTrue(os.path.exists(row.file.path))
        self.assertNotIn("/media/", row.file.name)
        self.assertNotIn("/", row.original_name)
        names = {self.put(upload("same.pdf", PDF)).data["id"] for _ in range(3)}
        stored = set(DesignRequestFile.objects.exclude(pk=row.pk).values_list("file", flat=True))
        self.assertEqual(len(stored), 3)
        self.assertEqual(len(names), 3)

    def test_download_is_authenticated_and_safe(self):
        fid = self.put(png_upload(name="logo.png")).data["id"]
        url = f"{self.base}/files/{fid}/download"
        from rest_framework.test import APIClient

        self.assertEqual(APIClient().get(url).status_code, 401)
        res = self.owner.client.get(url)
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "image/png")
        self.assertEqual(res["X-Content-Type-Options"], "nosniff")
        self.assertIn("default-src 'none'", res["Content-Security-Policy"])
        self.assertEqual(res["Cache-Control"], "private, no-store")
        self.assertTrue(b"".join(res.streaming_content).startswith(b"\x89PNG"))
        pdf = self.put(upload("brief.pdf", PDF)).data["id"]
        res = self.owner.client.get(f"{self.base}/files/{pdf}/download")
        self.assertTrue(res["Content-Disposition"].startswith("attachment"))
        self.assertNotIn("/media/", str(self.owner.client.get(self.base).data))

    def test_no_public_url_for_uploads(self):
        self.put(png_upload(name="logo.png"))
        row = DesignRequestFile.objects.get()
        with self.assertRaises(ValueError):
            row.file.url
        detail = self.owner.client.get(self.base).data
        self.assertNotIn("url", detail["files"][0])

    def test_files_on_staff_internal_notes_are_hidden_from_the_company(self):
        staff = self.make_staff("support@ilaf.test", "support")
        sbase = f"{API}staff/design-requests/{self.req['id']}"
        res = staff.client.post(sbase + "/files", {"file": upload("cost.pdf", PDF)}, format="multipart")
        self.assertEqual(res.status_code, 201)
        fid = res.data["id"]
        staff.client.post(sbase + "/messages", {"body": "internal", "internal": True, "file_ids": [fid]}, format="json")
        self.assertEqual(self.owner.client.get(f"{self.base}/files/{fid}/download").status_code, 404)
        self.assertEqual(staff.client.get(f"{sbase}/files/{fid}/download").status_code, 200)
        self.assertTrue(StaffAuditEvent.objects.filter(action="design_request.file_downloaded").exists())

    def test_files_attach_to_a_message(self):
        fid = self.put(png_upload(name="ref.png")).data["id"]
        res = self.owner.client.post(self.base + "/messages", {"body": "See the reference", "file_ids": [fid]}, format="json")
        self.assertEqual(res.status_code, 201)
        msg = [m for m in res.data["messages"] if m["kind"] == "message"][0]
        self.assertEqual([f["id"] for f in msg["files"]], [fid])

    def test_cannot_attach_a_file_of_another_request(self):
        other = self.company_with_owner("o2@other.test", "Other Co")
        other_req = self.new_request(other)
        other_file = other.client.post(
            f"{API}workspaces/{other.company}/design-requests/{other_req['id']}/files", {"file": png_upload()}, format="multipart",
        ).data["id"]
        res = self.owner.client.post(self.base + "/messages", {"body": "stealing", "file_ids": [other_file]}, format="json")
        msg = [m for m in res.data["messages"] if m["kind"] == "message"][0]
        self.assertEqual(msg["files"], [])


class MailAndAuditTests(StaffTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.company_with_owner()
        self.admin = self.make_staff("admin@ilaf.test", "admin")
        self.support = self.make_staff("support@ilaf.test", "support")
        mail.outbox.clear()

    def test_new_request_tells_support_and_admin_staff(self):
        self.new_request(self.owner)
        recipients = sorted(m.to[0] for m in mail.outbox)
        self.assertEqual(recipients, ["admin@ilaf.test", "support@ilaf.test"])
        self.assertIn("Acme Ltd", mail.outbox[0].subject)
        self.assertIn("/staff/requests/", mail.outbox[0].body)

    def test_read_only_staff_get_no_mail_and_the_setting_adds_addresses(self):
        self.make_staff("reader@ilaf.test", "read_only")
        mail.outbox.clear()
        with self.settings(STAFF_NOTIFY_EMAILS=["desk@ilaf.test"]):
            self.new_request(self.owner)
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ["admin@ilaf.test", "desk@ilaf.test", "support@ilaf.test"])

    def test_assigned_person_alone_gets_customer_messages(self):
        req = self.new_request(self.owner)
        self.support.client.post(f"{API}staff/design-requests/{req['id']}/assign", {"staff_id": str(self.support.user.id)}, format="json")
        mail.outbox.clear()
        self.owner.client.post(f"{API}workspaces/{self.owner.company}/design-requests/{req['id']}/messages", {"body": "Hello"}, format="json")
        self.assertEqual([m.to[0] for m in mail.outbox], ["support@ilaf.test"])
        self.assertIn("Hello", mail.outbox[0].body)

    def test_staff_reply_and_status_mail_reach_the_customer_in_english(self):
        req = self.new_request(self.owner)
        mail.outbox.clear()
        self.support.client.post(f"{API}staff/design-requests/{req['id']}/messages", {"body": "Welcome aboard"}, format="json")
        self.support.client.post(f"{API}staff/design-requests/{req['id']}/status", {"status": "contacted"}, format="json")
        self.support.client.post(f"{API}staff/design-requests/{req['id']}/messages", {"body": "private", "internal": True}, format="json")
        self.assertEqual(len(mail.outbox), 2)
        reply, status = mail.outbox
        self.assertEqual(reply.to, ["owner@acme.test"])
        self.assertIn("Welcome aboard", reply.body)
        self.assertEqual(reply.subject, "Our team replied to your design request")
        self.assertIn("We received your custom design request", status.subject)
        self.assertIn(f"/app/requests/{req['id']}", status.body)
        self.assertNotIn("private", "".join(m.body for m in mail.outbox))

    def test_customer_mail_follows_the_account_language(self):
        from accounts.models import User

        User.objects.filter(email="owner@acme.test").update(language="ar")
        req = self.new_request(self.owner)
        mail.outbox.clear()
        self.support.client.post(f"{API}staff/design-requests/{req['id']}/status", {"status": "in_design"}, format="json")
        msg = mail.outbox[0]
        self.assertIn("تصميم بطاقتك المخصص قيد العمل", msg.subject)
        html = msg.alternatives[0][0]
        self.assertIn('dir="rtl"', html)
        self.assertIn("بدأ مصممونا العمل", html)

    def test_company_activity_log_and_staff_audit_log(self):
        req = self.new_request(self.owner)
        base = f"{API}workspaces/{self.owner.company}/design-requests/{req['id']}"
        self.owner.client.post(base + "/messages", {"body": "hi"}, format="json")
        self.support.client.post(f"{API}staff/design-requests/{req['id']}/status", {"status": "contacted"}, format="json")
        self.owner.client.post(base + "/withdraw")
        actions = list(AuditEvent.objects.filter(workspace_id=self.owner.company).values_list("action", flat=True))
        for a in ("design_request.created", "design_request.message", "design_request.status_changed", "design_request.withdrawn"):
            self.assertIn(a, actions)
        staff_row = AuditEvent.objects.get(action="design_request.status_changed")
        self.assertEqual(staff_row.actor_name, "Design team")
        self.assertEqual(staff_row.actor_email, "")
        self.assertIsNone(staff_row.actor)
        audit = StaffAuditEvent.objects.filter(action="design_request.status").first()
        self.assertEqual(audit.details, {"from": "new", "to": "contacted"})
        self.assertEqual(audit.actor_email, "support@ilaf.test")
        self.assertTrue(StaffAuditEvent.objects.filter(action="design_request.created").exists())
        # the company sees these rows in its Activity page
        res = self.owner.client.get(f"{API}workspaces/{self.owner.company}/audit")
        self.assertEqual(res.status_code, 200)
        self.assertIn("design_request.created", {r["action"] for r in res.data["results"]})
