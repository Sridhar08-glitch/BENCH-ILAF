"""Staff roles, two-step verification, the audit log and every permission edge of the staff API."""
from datetime import timedelta
from io import StringIO

from django.core.management import call_command
from django.core.management.base import CommandError
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from staff import totp
from staff.models import StaffAuditEvent, StaffSession, StaffTotp

from .base import API, BIG_RATES
from .staff_base import StaffTestCase


class TotpMathTests(StaffTestCase):
    SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"  # the RFC 6238 test key "12345678901234567890"

    def test_rfc_6238_vectors(self):
        # the RFC lists 8 digit codes; ours are the last 6 digits of the same values
        for moment, expected in ((59, "287082"), (1111111109, "081804"), (1111111111, "050471"), (1234567890, "005924"), (2000000000, "279037")):
            self.assertEqual(totp.code_at(self.SECRET, moment), expected)

    def test_window_and_replay(self):
        now = 1234567890
        code = totp.code_at(self.SECRET, now)
        self.assertIsNotNone(totp.verify(self.SECRET, code, now))
        self.assertIsNotNone(totp.verify(self.SECRET, code, now + 30))  # one step late
        self.assertIsNone(totp.verify(self.SECRET, code, now + 90))  # three steps late
        step = totp.verify(self.SECRET, code, now)
        self.assertIsNone(totp.verify(self.SECRET, code, now, last_counter=step))

    def test_rejects_malformed_codes(self):
        for bad in ("", None, "12345", "1234567", "abcdef", "12 34 5x"):
            self.assertIsNone(totp.verify(self.SECRET, bad, 1234567890))

    def test_otpauth_uri(self):
        uri = totp.otpauth_uri("ABC", "a@b.com", "BENCH staff")
        self.assertTrue(uri.startswith("otpauth://totp/BENCH%20staff:a%40b.com?secret=ABC"))
        self.assertIn("period=30", uri)


class StaffAccessTests(StaffTestCase):
    def test_signed_out_gets_401(self):
        self.assertEqual(APIClient().get(API + "staff/me").status_code, 401)

    def test_customer_gets_404_everywhere(self):
        customer = self.signup("cust@example.com")
        for path in ("staff/me", "staff/audit", "staff/companies", "staff/design-requests", "staff/members", "staff/starters"):
            self.assertEqual(customer.client.get(API + path).status_code, 404, path)
        self.assertEqual(customer.client.post(API + "staff/totp/enrol", {}, format="json").status_code, 404)

    def test_inactive_staff_account_is_not_staff(self):
        person = self.make_staff("gone@ilaf.test", "admin")
        User.objects.filter(pk=person.user.pk).update(is_active=False)
        # the sign-in token of an inactive account stops working; the role check also refuses on its own
        from staff import services

        person.user.refresh_from_db()
        self.assertEqual(services.role_of(person.user), "none")

    def test_first_step_alone_is_not_enough(self):
        person = self.make_staff("a@ilaf.test", "admin", verified=False)
        res = person.client.get(API + "staff/design-requests")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "staff_verification_required")
        me = person.client.get(API + "staff/me")
        self.assertEqual(me.status_code, 200)
        self.assertFalse(me.data["verified"])
        self.assertFalse(me.data["totp_enrolled"])

    def test_token_of_someone_else_is_refused(self):
        a = self.make_staff("a@ilaf.test", "admin")
        b = self.make_staff("b@ilaf.test", "admin", verified=False)
        b.client.credentials(HTTP_AUTHORIZATION=b.client._credentials["HTTP_AUTHORIZATION"], HTTP_X_STAFF_TOKEN=a.token)
        self.assertEqual(b.client.get(API + "staff/audit").status_code, 403)

    def test_garbage_token_is_refused(self):
        a = self.make_staff("a@ilaf.test", "admin")
        a.client.credentials(HTTP_AUTHORIZATION=a.client._credentials["HTTP_AUTHORIZATION"], HTTP_X_STAFF_TOKEN="x" * 500)
        self.assertEqual(a.client.get(API + "staff/audit").status_code, 403)

    def test_session_expires_after_twelve_hours(self):
        a = self.make_staff("a@ilaf.test", "admin")
        self.assertEqual(a.client.get(API + "staff/audit").status_code, 200)
        session = StaffSession.objects.get(user=a.user)
        self.assertLess(session.expires_at - session.created_at, timedelta(hours=12, seconds=5))
        self.assertGreater(session.expires_at - session.created_at, timedelta(hours=11, minutes=59))
        StaffSession.objects.filter(pk=session.pk).update(expires_at=timezone.now() - timedelta(seconds=1))
        self.assertEqual(a.client.get(API + "staff/audit").status_code, 403)

    def test_logout_ends_the_session(self):
        a = self.make_staff("a@ilaf.test", "admin")
        self.assertEqual(a.client.post(API + "staff/logout").status_code, 204)
        self.assertEqual(a.client.get(API + "staff/audit").status_code, 403)


class RoleMatrixTests(StaffTestCase):
    """read_only: GET only. support: also handles requests. admin: everything."""

    def setUp(self):
        super().setUp()
        self.owner = self.company_with_owner()
        self.req = self.new_request(self.owner)
        self.admin = self.make_staff("admin@ilaf.test", "admin")
        self.support = self.make_staff("support@ilaf.test", "support")
        self.reader = self.make_staff("reader@ilaf.test", "read_only")

    def test_every_role_can_read(self):
        for person in (self.admin, self.support, self.reader):
            for path in ("staff/design-requests", f"staff/design-requests/{self.req['id']}", "staff/audit", "staff/companies", "staff/starters", "staff/members", "staff/faces"):
                self.assertEqual(person.client.get(API + path).status_code, 200, f"{person.role} {path}")

    def test_read_only_cannot_write_requests(self):
        rid = self.req["id"]
        for path, body in (
            (f"staff/design-requests/{rid}/messages", {"body": "hi"}),
            (f"staff/design-requests/{rid}/status", {"status": "contacted"}),
            (f"staff/design-requests/{rid}/assign", {"staff_id": str(self.support.user.id)}),
            (f"staff/design-requests/{rid}/faces", {"starter": "clean"}),
            ("staff/members", {"email": "x@y.com", "role": "support"}),
        ):
            res = self.reader.client.post(API + path, body, format="json")
            self.assertEqual(res.status_code, 403, path)
            self.assertEqual(res.data["error"]["code"], "forbidden")

    def test_support_handles_requests_but_not_faces(self):
        rid = self.req["id"]
        self.assertEqual(self.support.client.post(f"{API}staff/design-requests/{rid}/messages", {"body": "hello"}, format="json").status_code, 201)
        self.assertEqual(self.support.client.post(f"{API}staff/design-requests/{rid}/messages", {"body": "note", "internal": True}, format="json").status_code, 201)
        self.assertEqual(self.support.client.post(f"{API}staff/design-requests/{rid}/status", {"status": "contacted"}, format="json").status_code, 200)
        self.assertEqual(self.support.client.post(f"{API}staff/design-requests/{rid}/assign", {"staff_id": str(self.support.user.id)}, format="json").status_code, 200)
        self.assertEqual(self.support.client.post(f"{API}staff/design-requests/{rid}/faces", {"starter": "clean"}, format="json").status_code, 403)
        self.assertEqual(self.support.client.post(API + "staff/members", {"email": "x@y.com", "role": "support"}, format="json").status_code, 403)

    def test_admin_does_everything(self):
        rid = self.req["id"]
        res = self.admin.client.post(f"{API}staff/design-requests/{rid}/faces", {"starter": "clean"}, format="json")
        self.assertEqual(res.status_code, 201)
        fid = res.data["id"]
        self.assertEqual(self.admin.client.patch(f"{API}staff/faces/{fid}", {"name": "Renamed"}, format="json").status_code, 200)
        self.assertEqual(self.reader.client.patch(f"{API}staff/faces/{fid}", {"name": "Nope"}, format="json").status_code, 403)
        self.assertEqual(self.support.client.patch(f"{API}staff/faces/{fid}", {"name": "Nope"}, format="json").status_code, 403)
        for person in (self.reader, self.support):
            for action in ("send-for-review", "publish", "disable"):
                self.assertEqual(person.client.post(f"{API}staff/faces/{fid}/{action}", {}, format="json").status_code, 403, action)

    def test_everyone_may_manage_their_own_second_step(self):
        # a read-only person can enrol and renew recovery codes: it changes no data
        fresh = self.make_staff("fresh@ilaf.test", "read_only", verified=False)
        self.assertEqual(fresh.client.post(API + "staff/totp/enrol", {}, format="json").status_code, 201)
        self.assertEqual(self.reader.client.post(API + "staff/recovery-codes", {}, format="json").status_code, 200)

    def test_sanitize_dry_run_is_open_to_all_roles(self):
        for person in (self.admin, self.support, self.reader):
            res = person.client.post(API + "staff/faces/sanitize", {"template": "<script>x</script><div>ok</div>", "css": ""}, format="json")
            self.assertEqual(res.status_code, 200)
            self.assertEqual(res.data["template"], "<div>ok</div>")


class StaffRolesTests(StaffTestCase):
    def test_admin_grants_changes_and_removes_roles(self):
        admin = self.make_staff("admin@ilaf.test", "admin")
        self.signup("newbie@example.com")
        res = admin.client.post(API + "staff/members", {"email": "newbie@example.com", "role": "support"}, format="json")
        self.assertEqual(res.status_code, 201)
        uid = res.data["id"]
        self.assertEqual(User.objects.get(pk=uid).staff_role, "support")
        res = admin.client.patch(f"{API}staff/members/{uid}", {"role": "read_only"}, format="json")
        self.assertEqual(res.data["staff_role"], "read_only")
        self.assertEqual(admin.client.delete(f"{API}staff/members/{uid}").status_code, 204)
        self.assertEqual(User.objects.get(pk=uid).staff_role, "none")

    def test_unknown_account_and_bad_role(self):
        admin = self.make_staff("admin@ilaf.test", "admin")
        self.assertEqual(admin.client.post(API + "staff/members", {"email": "nobody@example.com", "role": "support"}, format="json").status_code, 400)
        self.signup("x@example.com")
        self.assertEqual(admin.client.post(API + "staff/members", {"email": "x@example.com", "role": "god"}, format="json").status_code, 400)
        self.assertEqual(admin.client.post(API + "staff/members", {"email": "x@example.com", "role": "none"}, format="json").status_code, 400)

    def test_last_admin_is_protected(self):
        admin = self.make_staff("admin@ilaf.test", "admin")
        uid = str(admin.user.id)
        for call in (
            lambda: admin.client.patch(f"{API}staff/members/{uid}", {"role": "support"}, format="json"),
            lambda: admin.client.delete(f"{API}staff/members/{uid}"),
            lambda: admin.client.post(API + "staff/members", {"email": "admin@ilaf.test", "role": "read_only"}, format="json"),
        ):
            res = call()
            self.assertEqual(res.status_code, 409)
            self.assertEqual(res.data["error"]["code"], "last_admin")
        self.assertEqual(User.objects.get(pk=uid).staff_role, "admin")

    def test_second_admin_makes_demotion_possible(self):
        a = self.make_staff("a@ilaf.test", "admin")
        b = self.make_staff("b@ilaf.test", "admin")
        self.assertEqual(a.client.patch(f"{API}staff/members/{b.user.id}", {"role": "support"}, format="json").status_code, 200)
        self.assertEqual(b.client.get(API + "staff/me").status_code, 200)

    def test_demotion_ends_sessions(self):
        a = self.make_staff("a@ilaf.test", "admin")
        b = self.make_staff("b@ilaf.test", "support")
        a.client.delete(f"{API}staff/members/{b.user.id}")
        self.assertEqual(b.client.get(API + "staff/audit").status_code, 404)

    def test_command_names_first_admin_and_keeps_one(self):
        User.objects.create_user("boss@ilaf.test", self.password)
        out = StringIO()
        call_command("grant_staff", "boss@ilaf.test", "admin", stdout=out)
        self.assertEqual(User.objects.get(email="boss@ilaf.test").staff_role, "admin")
        with self.assertRaises(CommandError):
            call_command("grant_staff", "boss@ilaf.test", "none")
        with self.assertRaises(CommandError):
            call_command("grant_staff", "nobody@ilaf.test", "admin")

    def test_admin_resets_second_step(self):
        a = self.make_staff("a@ilaf.test", "admin")
        b = self.make_staff("b@ilaf.test", "support")
        self.assertEqual(a.client.post(f"{API}staff/members/{b.user.id}/reset-totp", {}, format="json").status_code, 200)
        self.assertFalse(StaffTotp.objects.filter(user=b.user).exists())
        self.assertEqual(b.client.get(API + "staff/audit").status_code, 403)
        self.assertEqual(b.client.post(f"{API}staff/members/{a.user.id}/reset-totp", {}, format="json").status_code, 403)


class VerificationTests(StaffTestCase):
    def test_enrol_confirm_and_recovery_codes(self):
        person = self.make_staff("a@ilaf.test", "admin", verified=False)
        res = person.client.post(API + "staff/totp/enrol", {}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertTrue(res.data["otpauth_uri"].startswith("otpauth://totp/"))
        self.assertEqual(res.data["qr_payload"], res.data["otpauth_uri"])
        self.assertEqual(len(res.data["secret"]), 32)
        # not confirmed yet: verify refuses
        self.assertEqual(person.client.post(API + "staff/verify", {"code": totp.code_at(res.data["secret"])}, format="json").status_code, 409)
        bad = person.client.post(API + "staff/totp/confirm", {"code": "000000"}, format="json")
        self.assertEqual(bad.status_code, 400)
        ok = person.client.post(API + "staff/totp/confirm", {"code": totp.code_at(res.data["secret"])}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertEqual(len(ok.data["recovery_codes"]), 10)
        self.assertEqual(len(set(ok.data["recovery_codes"])), 10)
        # codes are stored only as hashes
        from staff.models import StaffRecoveryCode

        self.assertFalse(StaffRecoveryCode.objects.filter(code_hash__in=ok.data["recovery_codes"]).exists())
        # enrolling again is refused once confirmed
        self.assertEqual(person.client.post(API + "staff/totp/enrol", {}, format="json").status_code, 409)

    def test_verify_with_code_and_replay(self):
        person = self.make_staff("a@ilaf.test", "admin")
        code = self.fresh_code(person)
        res = person.client.post(API + "staff/verify", {"code": code}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["method"], "totp")
        again = person.client.post(API + "staff/verify", {"code": code}, format="json")
        self.assertEqual(again.status_code, 400)

    def test_recovery_code_works_once(self):
        person = self.make_staff("a@ilaf.test", "admin")
        code = person.recovery[0]
        res = person.client.post(API + "staff/verify", {"recovery_code": code}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["method"], "recovery")
        self.assertEqual(res.data["recovery_codes_left"], 9)
        self.assertEqual(person.client.post(API + "staff/verify", {"recovery_code": code}, format="json").status_code, 400)
        # lower case and spaces are tolerated
        self.assertEqual(person.client.post(API + "staff/verify", {"recovery_code": " " + person.recovery[1].upper() + " "}, format="json").status_code, 200)

    def test_renewing_codes_replaces_old_ones(self):
        person = self.make_staff("a@ilaf.test", "admin")
        old = person.recovery[0]
        res = person.client.post(API + "staff/recovery-codes", {}, format="json")
        self.assertEqual(len(res.data["recovery_codes"]), 10)
        self.assertEqual(person.client.post(API + "staff/verify", {"recovery_code": old}, format="json").status_code, 400)

    def test_five_wrong_codes_lock_the_account(self):
        person = self.make_staff("a@ilaf.test", "admin")
        for _ in range(5):
            self.assertEqual(person.client.post(API + "staff/verify", {"code": "111111"}, format="json").status_code, 400)
        locked = person.client.post(API + "staff/verify", {"code": self.fresh_code(person)}, format="json")
        self.assertEqual(locked.status_code, 429)
        self.assertEqual(locked.data["error"]["code"], "staff_locked")
        StaffTotp.objects.filter(user=person.user).update(locked_until=timezone.now() - timedelta(seconds=1))
        self.assertEqual(person.client.post(API + "staff/verify", {"code": self.fresh_code(person)}, format="json").status_code, 200)

    def test_verification_is_throttled(self):
        person = self.make_staff("a@ilaf.test", "admin")
        with override_settings(ILAF_THROTTLE_RATES={**BIG_RATES, "user_sensitive": "3/min"}):
            from django.core.cache import cache

            cache.clear()
            codes = [client_code for client_code in ("111111", "222222", "333333")]
            statuses = [person.client.post(API + "staff/verify", {"code": c}, format="json").status_code for c in codes]
            self.assertEqual(statuses, [400, 400, 400])
            self.assertEqual(person.client.post(API + "staff/verify", {"code": "444444"}, format="json").status_code, 429)

    def test_secret_is_never_returned_after_enrolment(self):
        person = self.make_staff("a@ilaf.test", "admin")
        me = person.client.get(API + "staff/me")
        self.assertNotIn("secret", str(me.data))
        self.assertTrue(me.data["verified"])
        self.assertEqual(me.data["recovery_codes_left"], 10)


class AuditLogTests(StaffTestCase):
    def test_actions_are_logged_with_a_hashed_address(self):
        a = self.make_staff("a@ilaf.test", "admin")
        owner = self.company_with_owner()
        req = self.new_request(owner)
        a.client.get(f"{API}staff/design-requests/{req['id']}")
        res = a.client.get(API + "staff/audit")
        self.assertEqual(res.status_code, 200)
        actions = {row["action"] for row in res.data["results"]}
        self.assertTrue({"staff.totp_enrolled", "design_request.viewed", "design_request.created"} <= actions)
        row = next(r for r in res.data["results"] if r["action"] == "design_request.viewed")
        self.assertEqual(row["actor_email"], "a@ilaf.test")
        self.assertEqual(row["actor_role"], "admin")
        self.assertEqual(len(row["ip_hash"]), 32)
        self.assertNotIn("127.0.0.1", str(row))
        self.assertEqual(row["target_label"], "Acme Ltd")

    def test_rows_cannot_be_changed_or_deleted(self):
        a = self.make_staff("a@ilaf.test", "admin")
        row = StaffAuditEvent.objects.filter(actor=a.user).first()
        row.action = "x"
        with self.assertRaises(RuntimeError):
            row.save()
        with self.assertRaises(RuntimeError):
            row.delete()

    def test_filters(self):
        a = self.make_staff("a@ilaf.test", "admin")
        self.make_staff("b@ilaf.test", "support")
        only = a.client.get(API + "staff/audit", {"actor": "b@ilaf"})
        self.assertTrue(only.data["count"] > 0)
        self.assertTrue(all(r["actor_email"] == "b@ilaf.test" for r in only.data["results"]))
        one = a.client.get(API + "staff/audit", {"action": "staff.totp_enrolled"})
        self.assertEqual({r["action"] for r in one.data["results"]}, {"staff.totp_enrolled"})

    def test_failed_verification_is_logged(self):
        a = self.make_staff("a@ilaf.test", "admin")
        a.client.post(API + "staff/verify", {"code": "000000"}, format="json")
        self.assertTrue(StaffAuditEvent.objects.filter(action="staff.verify_failed", actor=a.user).exists())

    def test_role_changes_are_logged(self):
        a = self.make_staff("a@ilaf.test", "admin")
        self.signup("n@example.com")
        a.client.post(API + "staff/members", {"email": "n@example.com", "role": "support"}, format="json")
        row = StaffAuditEvent.objects.get(action="staff.role_granted")
        self.assertEqual(row.details, {"from": "none", "to": "support"})


class CompaniesListTests(StaffTestCase):
    def test_list_and_search(self):
        a = self.make_staff("a@ilaf.test", "read_only")
        self.company_with_owner("o1@acme.test", "Acme Ltd")
        self.company_with_owner("o2@globex.test", "Globex Corp")
        res = a.client.get(API + "staff/companies")
        names = {r["name"] for r in res.data["results"]}
        self.assertEqual(names, {"Acme Ltd", "Globex Corp"})
        row = next(r for r in res.data["results"] if r["name"] == "Acme Ltd")
        self.assertEqual(row["seats_total"], 5)
        self.assertEqual(row["seats_used"], 1)
        self.assertEqual(row["status"], "active")
        self.assertTrue(row["plan"])
        self.assertEqual(row["owner_email"], "o1@acme.test")
        found = a.client.get(API + "staff/companies", {"q": "glob"})
        self.assertEqual([r["name"] for r in found.data["results"]], ["Globex Corp"])
        by_owner = a.client.get(API + "staff/companies", {"q": "o1@acme"})
        self.assertEqual([r["name"] for r in by_owner.data["results"]], ["Acme Ltd"])

    def test_personal_workspaces_are_not_listed_and_nothing_is_writable(self):
        a = self.make_staff("a@ilaf.test", "admin")
        self.signup("p@example.com")
        self.assertEqual(a.client.get(API + "staff/companies").data["count"], 0)
        self.assertEqual(a.client.post(API + "staff/companies", {"name": "X"}, format="json").status_code, 405)
