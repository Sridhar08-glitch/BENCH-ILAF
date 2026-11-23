"""The staff frame and the screens beside it: menu counts, announcement pickers, feature-switch reasons, the Security tab,
the last-admin guard and the typed reasons that reach the audit log."""
from datetime import timedelta

from django.core import mail
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from privacy.models import DataRequest
from staff.models import AbuseReport, FeatureFlagChange, StaffAuditEvent, StaffSession
from workspaces.models import Workspace

from .base import API
from .bo_base import BackOfficeCase

CHROME_WIN = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
SAFARI_MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"


def last_audit(action):
    return StaffAuditEvent.objects.filter(action=action).order_by("-created_at").first()


class MenuCountsTests(BackOfficeCase):
    def test_counts_open_reports_and_data_requests_for_every_role(self):
        AbuseReport.objects.create(card_id=self.card["id"], workspace_id=self.ws, reason="spam", due_at=timezone.now() + timedelta(hours=40))
        AbuseReport.objects.create(card_id=self.card["id"], workspace_id=self.ws, reason="spam", status="dismissed", due_at=timezone.now())
        DataRequest.objects.create(kind="export", scope="user", user=self.user_of("owner@acme.test"), status="pending", due_at=timezone.now() + timedelta(days=9))
        for role in ("admin", "support", "read_only"):
            res = self.person(role).client.get(self.url("counts"))
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data, {"open_reports": 1, "open_data_requests": 1})

    def test_a_customer_gets_nothing(self):
        self.assertEqual(self.owner.client.get(self.url("counts")).status_code, 404)

    def test_the_count_is_two_queries(self):
        with self.assertNumQueries(5):  # the session, the account and the role check, plus the two counts
            res = self.admin.client.get(self.url("counts"))
        self.assertEqual(res.status_code, 200)


class AnnouncementPickerTests(BackOfficeCase):
    def test_the_list_carries_plans_and_the_countries_companies_chose(self):
        Workspace.objects.filter(pk=self.ws).update(country="QA")
        res = self.admin.client.get(self.url("announcements"))
        self.assertEqual(res.data["countries"], [{"code": "QA", "companies": 1}])
        self.assertIn("plans", res.data)

    def test_the_audience_count_writes_nothing_and_follows_the_picked_values(self):
        Workspace.objects.filter(pk=self.ws).update(country="QA")
        before = StaffAuditEvent.objects.count()
        everyone = self.admin.client.get(self.url("announcements/audience"), {"kind": "all", "email_kind": "transactional"})
        self.assertEqual(everyone.status_code, 200, everyone.content)
        self.assertGreaterEqual(everyone.data["companies"], 1)
        chosen = self.admin.client.get(self.url("announcements/audience"), {"kind": "country", "values": "QA", "email_kind": "transactional"})
        self.assertEqual((chosen.data["companies"], chosen.data["people"]), (1, 1))
        other = self.admin.client.get(self.url("announcements/audience"), {"kind": "country", "values": "PL", "email_kind": "transactional"})
        self.assertEqual((other.data["companies"], other.data["people"]), (0, 0))
        picked = self.admin.client.get(self.url("announcements/audience"), {"kind": "companies", "values": str(self.ws), "email_kind": "transactional"})
        self.assertEqual(picked.data["companies"], 1)
        self.assertEqual(StaffAuditEvent.objects.count(), before)

    def test_a_picked_audience_without_values_is_refused(self):
        self.assertEqual(self.admin.client.get(self.url("announcements/audience"), {"kind": "plan"}).status_code, 400)

    def test_only_an_admin_uses_the_pickers(self):
        for path in ("announcements/audience", "announcements/email-preview"):
            self.assertEqual(self.support.client.get(self.url(path)).status_code, 403, path)
            self.assertEqual(self.ro.client.get(self.url(path)).status_code, 403, path)

    def test_the_email_preview_is_the_brand_mail_in_either_language(self):
        en = self.admin.client.get(self.url("announcements/email-preview"), {"title": "Maintenance", "body": "We pause on Sunday.", "email_kind": "marketing"})
        self.assertEqual(en.status_code, 200, en.content)
        self.assertIn("We pause on Sunday.", en.data["html"])
        self.assertIn("Unsubscribe", en.data["html"])
        ar = self.admin.client.get(self.url("announcements/email-preview"), {"title": "صيانة", "body": "نتوقف يوم الأحد.", "lang": "ar", "email_kind": "transactional"})
        self.assertIn('dir="rtl"', ar.data["html"])
        self.assertNotIn("Unsubscribe", ar.data["html"])

    def test_the_preview_text_is_escaped(self):
        res = self.admin.client.get(self.url("announcements/email-preview"), {"title": "<script>x</script>", "body": "<b>hi</b>"})
        self.assertNotIn("<script>x", res.data["html"])


class FlagReasonTests(BackOfficeCase):
    def test_the_typed_reason_is_stored_in_the_history_and_the_audit_log(self):
        res = self.admin.client.patch(self.url("flags/directory"), {"state": "off", "reason": "Broken search, off until the fix"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["history"][0]["reason"], "Broken search, off until the fix")
        self.assertEqual(FeatureFlagChange.objects.get().reason, "Broken search, off until the fix")
        self.assertEqual(last_audit("flag.changed").details["reason"], "Broken search, off until the fix")
        listing = self.ro.client.get(self.url("flags"))
        self.assertEqual(listing.data["history"][0]["reason"], "Broken search, off until the fix")

    def test_a_change_without_a_reason_still_works(self):
        res = self.admin.client.patch(self.url("flags/directory"), {"state": "off"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["history"][0]["reason"], "")

    def test_chosen_companies_are_kept_with_their_names(self):
        res = self.admin.client.patch(self.url("flags/directory"), {"state": "selected", "company_ids": [str(self.ws)], "reason": "Pilot"}, format="json")
        self.assertEqual(res.data["companies"], [{"id": str(self.ws), "name": "Acme Ltd"}])


class SecurityTabTests(BackOfficeCase):
    def second_session(self, person, **extra):
        """Another staff session for the same person, opened through the real second step."""
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=person.client._credentials["HTTP_AUTHORIZATION"])
        res = client.post(API + "staff/verify", {"recovery_code": person.recovery.pop()}, format="json", **extra)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data["token"]

    def test_a_session_remembers_its_device_and_country(self):
        self.second_session(self.support, HTTP_USER_AGENT=CHROME_WIN, HTTP_CF_IPCOUNTRY="PL")
        row = StaffSession.objects.filter(user=self.support.user).order_by("-created_at").first()
        self.assertEqual((row.device_label, row.country), ("Chrome on Windows", "PL"))

    def test_everyone_sees_their_own_sessions_and_only_an_admin_sees_the_rest(self):
        self.second_session(self.support, HTTP_USER_AGENT=CHROME_WIN, HTTP_CF_IPCOUNTRY="PL")
        mine = self.support.client.get(self.url("security"))
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(len(mine.data["mine"]), 2)
        self.assertEqual(sum(1 for s in mine.data["mine"] if s["current"]), 1)
        self.assertIsNone(mine.data["everyone"])
        everyone = self.admin.client.get(self.url("security")).data["everyone"]
        self.assertEqual(len(everyone["two_step"]), 3)
        self.assertTrue(all(p["enrolled"] for p in everyone["two_step"]))
        emails = {s["email"] for s in everyone["sessions"]}
        self.assertIn("support@ilaf.test", emails)
        self.assertNotIn("admin@ilaf.test", emails)
        self.assertNotIn("token_hash", str(everyone))

    def test_a_person_who_lost_the_staff_role_is_not_listed(self):
        gone = self.make_staff("gone@ilaf.test", "support")
        User.objects.filter(pk=gone.user.pk).update(staff_role="none")
        emails = {s["email"] for s in self.admin.client.get(self.url("security")).data["everyone"]["sessions"]}
        self.assertNotIn("gone@ilaf.test", emails)

    def test_the_security_page_has_a_fixed_query_budget(self):
        for _ in range(4):
            self.second_session(self.support)
        with self.assertNumQueries(7):
            self.admin.client.get(self.url("security"))

    def test_a_person_ends_one_of_their_own_sessions_and_the_reason_is_logged(self):
        self.second_session(self.support, HTTP_USER_AGENT=CHROME_WIN)
        other = StaffSession.objects.filter(user=self.support.user).order_by("-created_at").first()
        res = self.support.client.post(self.url(f"security/sessions/{other.id}/revoke"), {"reason": "Left it open on a shared PC"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data, {"revoked": 1})
        other.refresh_from_db()
        self.assertIsNotNone(other.revoked_at)
        event = last_audit("staff.session_revoked")
        self.assertEqual(event.details["reason"], "Left it open on a shared PC")
        self.assertTrue(event.details["own"])
        self.assertEqual(self.support.client.get(self.url("security")).status_code, 200)  # the current session stays
        again = self.support.client.post(self.url(f"security/sessions/{other.id}/revoke"), {}, format="json")
        self.assertEqual(again.data, {"revoked": 0})

    def test_ending_the_current_session_signs_the_browser_out_of_the_staff_area(self):
        current = StaffSession.objects.get(user=self.ro.user)
        self.assertEqual(self.ro.client.post(self.url(f"security/sessions/{current.id}/revoke"), {}, format="json").status_code, 200)
        self.assertEqual(self.ro.client.get(self.url("overview")).status_code, 403)

    def test_only_an_admin_ends_someone_elses_session(self):
        target = StaffSession.objects.get(user=self.admin.user)
        for person in (self.support, self.ro):
            self.assertEqual(person.client.post(self.url(f"security/sessions/{target.id}/revoke"), {}, format="json").status_code, 403)
        target.refresh_from_db()
        self.assertIsNone(target.revoked_at)
        res = self.admin.client.post(self.url(f"security/sessions/{StaffSession.objects.get(user=self.support.user).id}/revoke"), {"reason": "Phone lost"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertFalse(last_audit("staff.session_revoked").details["own"])
        self.assertEqual(self.support.client.get(self.url("overview")).status_code, 403)

    def test_an_unknown_session_is_not_found(self):
        import uuid

        self.assertEqual(self.admin.client.post(self.url(f"security/sessions/{uuid.uuid4()}/revoke"), {}, format="json").status_code, 404)


class NewPlaceMailTests(BackOfficeCase):
    def sign_in(self, person, **extra):
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=person.client._credentials["HTTP_AUTHORIZATION"])
        res = client.post(API + "staff/verify", {"recovery_code": person.recovery.pop()}, format="json", **extra)
        self.assertEqual(res.status_code, 200, res.content)
        return res

    def test_the_first_session_and_a_repeat_from_the_same_place_send_nothing(self):
        self.assertEqual(mail.outbox, [])
        StaffSession.objects.filter(user=self.admin.user).update(device_label="Chrome on Windows", country="QA")
        self.sign_in(self.admin, HTTP_USER_AGENT=CHROME_WIN, HTTP_CF_IPCOUNTRY="QA")
        self.assertEqual(mail.outbox, [])
        self.assertFalse(last_audit("staff.verified").details["new_place"])

    def test_a_new_country_sends_one_mail_to_the_person(self):
        StaffSession.objects.filter(user=self.admin.user).update(device_label="Chrome on Windows", country="QA")
        self.sign_in(self.admin, HTTP_USER_AGENT=CHROME_WIN, HTTP_CF_IPCOUNTRY="PL")
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ["admin@ilaf.test"])
        self.assertIn("Chrome on Windows (PL)", mail.outbox[0].body)
        self.assertTrue(last_audit("staff.verified").details["new_place"])
        self.sign_in(self.admin, HTTP_USER_AGENT=CHROME_WIN, HTTP_CF_IPCOUNTRY="PL")
        self.assertEqual(len(mail.outbox), 1)  # the second sign-in from there is no longer new

    def test_a_new_device_sends_a_mail_even_in_the_same_country(self):
        StaffSession.objects.filter(user=self.admin.user).update(device_label="Chrome on Windows", country="QA")
        self.sign_in(self.admin, HTTP_USER_AGENT=SAFARI_MAC, HTTP_CF_IPCOUNTRY="QA")
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Safari on macOS", mail.outbox[0].body)

    def test_the_mail_follows_the_persons_language(self):
        User.objects.filter(pk=self.admin.user.pk).update(language="ar")
        StaffSession.objects.filter(user=self.admin.user).update(device_label="Chrome on Windows", country="QA")
        self.sign_in(self.admin, HTTP_USER_AGENT=SAFARI_MAC, HTTP_CF_IPCOUNTRY="QA")
        self.assertRegex(mail.outbox[0].subject, "[؀-ۿ]")

    def test_an_unknown_country_on_a_known_device_is_not_a_new_place(self):
        StaffSession.objects.filter(user=self.admin.user).update(device_label="Chrome on Windows", country="QA")
        self.sign_in(self.admin, HTTP_USER_AGENT=CHROME_WIN)
        self.assertEqual(mail.outbox, [])


class LastAdminTests(BackOfficeCase):
    def test_every_way_of_leaving_no_admin_is_refused(self):
        me = str(self.admin.user.id)
        invite = self.admin.client.post(self.url("team"), {"email": "admin@ilaf.test", "role": "support"}, format="json")
        self.assertEqual(invite.status_code, 409, invite.content)
        self.assertEqual(invite.json()["error"]["code"], "last_admin")
        self.assertEqual(self.admin.client.patch(self.url(f"members/{me}"), {"role": "support"}, format="json").status_code, 409)
        self.assertEqual(self.admin.client.delete(self.url(f"members/{me}")).status_code, 409)
        post = self.admin.client.post(self.url("members"), {"email": "admin@ilaf.test", "role": "read_only"}, format="json")
        self.assertEqual(post.status_code, 409)
        self.admin.user.refresh_from_db()
        self.assertEqual(self.admin.user.staff_role, "admin")

    def test_deleting_the_only_admins_account_is_refused(self):
        from ilaf.errors import ApiError
        from privacy import services as privacy

        with self.assertRaises(ApiError) as caught:
            privacy.request_account_deletion(self.admin.user)
        self.assertEqual(caught.exception.code, "last_admin")
        self.admin.user.refresh_from_db()
        self.assertTrue(self.admin.user.is_active)

    def test_with_a_second_admin_the_first_can_be_demoted_through_an_invite(self):
        self.make_staff("second@ilaf.test", "admin")
        res = self.admin.client.post(self.url("team"), {"email": "admin@ilaf.test", "role": "support"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.admin.user.refresh_from_db()
        self.assertEqual(self.admin.user.staff_role, "support")

    def test_an_inactive_second_admin_does_not_count(self):
        second = self.make_staff("second@ilaf.test", "admin")
        User.objects.filter(pk=second.user.pk).update(is_active=False)
        res = self.admin.client.post(self.url("team"), {"email": "admin@ilaf.test", "role": "support"}, format="json")
        self.assertEqual(res.status_code, 409)

    def test_the_only_admin_cannot_be_deleted_through_a_data_request(self):
        dr = DataRequest.objects.create(kind="delete", scope="user", user=self.admin.user, status="pending", due_at=timezone.now() + timedelta(days=9), scheduled_for=timezone.now())
        res = self.support.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "confirm_delete", "typed": "admin@ilaf.test"}, format="json")
        self.assertEqual(res.status_code, 409, res.content)
        self.assertEqual(res.json()["error"]["code"], "last_admin")
        dr.refresh_from_db()
        self.assertEqual(dr.status, "pending")


class ReasonsReachTheAuditLogTests(BackOfficeCase):
    def test_role_change_removal_reset_and_session_end_keep_the_reason(self):
        other = self.make_staff("other@ilaf.test", "support")
        oid = str(other.user.id)
        self.assertEqual(self.admin.client.patch(self.url(f"members/{oid}"), {"role": "read_only", "reason": "Moved to reporting"}, format="json").status_code, 200)
        self.assertEqual(last_audit("staff.role_changed").details["reason"], "Moved to reporting")
        self.assertEqual(self.admin.client.post(self.url(f"members/{oid}/sessions/revoke"), {"reason": "Shared laptop"}, format="json").status_code, 200)
        self.assertEqual(last_audit("staff.sessions_revoked").details["reason"], "Shared laptop")
        self.assertEqual(self.admin.client.post(self.url(f"members/{oid}/reset-totp"), {"reason": "Lost phone"}, format="json").status_code, 200)
        self.assertEqual(last_audit("staff.totp_reset").details["reason"], "Lost phone")
        self.assertEqual(self.admin.client.delete(self.url(f"members/{oid}"), {"reason": "Left the team"}, format="json").status_code, 204)
        self.assertEqual(last_audit("staff.role_removed").details["reason"], "Left the team")

    def test_the_invite_keeps_its_reason_too(self):
        self.admin.client.post(self.url("team"), {"email": "support@ilaf.test", "role": "read_only", "reason": "Quiet quarter"}, format="json")
        self.assertEqual(last_audit("staff.role_changed").details["reason"], "Quiet quarter")

    def test_signing_a_customer_out_keeps_the_reason(self):
        uid = str(self.user_of("owner@acme.test").id)
        self.admin.client.post(self.url(f"users/{uid}/sign-out"), {"reason": "Phone was stolen"}, format="json")
        self.assertEqual(last_audit("user.signed_out").details["reason"], "Phone was stolen")

    def test_a_data_deletion_and_a_done_mark_keep_the_reason(self):
        gone = self.make_staff("gone@person.test", "read_only", verified=False).user
        dr = DataRequest.objects.create(kind="delete", scope="user", user=gone, status="pending", due_at=timezone.now() + timedelta(days=9), scheduled_for=timezone.now())
        res = self.support.client.post(self.url(f"data-requests/{dr.id}/action"), {"action": "confirm_delete", "typed": "gone@person.test", "reason": "Identity checked by phone"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(last_audit("data_request.deleted").details["reason"], "Identity checked by phone")
        export = DataRequest.objects.create(kind="export", scope="user", user=self.user_of("owner@acme.test"), status="pending", due_at=timezone.now() + timedelta(days=9))
        self.support.client.post(self.url(f"data-requests/{export.id}/action"), {"action": "mark_done", "reason": "Sent by post"}, format="json")
        self.assertEqual(last_audit("data_request.done").details["reason"], "Sent by post")

    def test_a_reason_is_cut_to_300_characters(self):
        self.admin.client.patch(self.url("flags/directory"), {"state": "off", "reason": "x" * 400}, format="json")
        self.assertEqual(len(last_audit("flag.changed").details["reason"]), 300)
