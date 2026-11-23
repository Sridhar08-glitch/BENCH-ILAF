"""Back office: role edges of every staff endpoint, company and card suspension, support view, audit coverage."""
import ast
from datetime import timedelta
from pathlib import Path

from django.core import mail
from django.test import SimpleTestCase
from django.urls import get_resolver
from django.utils import timezone

from cards.models import Card
from operations.models import AuditEvent
from staff import perms_map
from staff.models import StaffAuditEvent, SupportViewSession
from staff.views_supportview import MIRROR_VIEWS, expire_due
from workspaces.models import Workspace

from .base import API
from .bo_base import BackOfficeCase


class RoleEdgeTests(BackOfficeCase):
    """Every row: (method, path, body, roles that may call it). A role not listed gets 403; a listed one never does."""

    def rows(self):
        c, k, u = self.ws, self.card["id"], str(self.user_of("owner@acme.test").id)
        everyone = ("admin", "support", "read_only")
        writers = ("admin", "support")
        admin = ("admin",)
        return [
            ("get", "overview", None, everyone), ("get", "companies", None, everyone), ("get", f"companies/{c}", None, everyone),
            ("get", f"companies/{c}/team", None, everyone), ("get", f"companies/{c}/cards", None, everyone), ("get", f"companies/{c}/leads", None, everyone),
            ("get", f"companies/{c}/brand", None, everyone), ("get", f"companies/{c}/activity", None, everyone), ("get", f"companies/{c}/notes", None, everyone),
            ("post", f"companies/{c}/notes", {"body": "Called the owner"}, writers),
            ("post", f"companies/{c}/suspend", {"reason": "Fraud check"}, admin), ("post", f"companies/{c}/restore", {"reason": "ok"}, admin),
            ("post", "companies/bulk", {"ids": [c], "action": "restore", "reason": "x"}, admin),
            ("get", "search?q=acme", None, everyone), ("get", f"cards/{k}", None, everyone),
            ("post", f"cards/{k}/suspend", {"reason": "Looks fake"}, writers), ("post", f"cards/{k}/restore", {"reason": "ok"}, writers),
            ("get", f"users/{u}", None, everyone), ("post", f"users/{u}/sign-out", None, admin),
            ("get", "support-view", None, writers), ("get", "support-view/history", None, writers), ("post", "support-view", {"company_id": c, "reason": "Customer asked for help"}, writers),
            ("get", "abuse", None, everyone), ("get", "data-requests", None, everyone), ("get", "applications", None, everyone),
            ("get", "announcements", None, everyone), ("post", "announcements/preview", {"audience_kind": "all"}, admin),
            ("get", "analytics", None, everyone), ("get", "analytics/export", None, writers),
            ("get", "system/health", None, everyone), ("get", "system/jobs", None, everyone), ("get", "system/email", None, everyone), ("get", "system/errors", None, everyone),
            ("get", "flags", None, everyone), ("patch", "flags/directory", {"state": "everyone"}, admin),
            ("get", "billing", None, everyone), ("post", "billing/grant", {"company_id": c, "reason": "pilot"}, admin),
            ("get", "permissions", None, everyone), ("get", "team", None, everyone), ("post", "team", {"email": "new@person.test", "role": "support"}, admin),
            ("get", "audit", None, everyone), ("get", "audit/export", None, writers),
        ]

    def test_every_role_gets_exactly_what_the_table_allows(self):
        for method, path, body, allowed in self.rows():
            for role in ("admin", "support", "read_only"):
                client = self.person(role).client
                call = getattr(client, method)
                res = call(self.url(path), body, format="json") if method != "get" else call(self.url(path))
                if role in allowed:
                    self.assertNotIn(res.status_code, (401, 403), f"{role} should reach {method} {path}: {res.content[:200]}")
                else:
                    self.assertEqual(res.status_code, 403, f"{role} must not reach {method} {path}")

    def test_a_customer_cannot_see_the_staff_api_at_all(self):
        for path in ("overview", "companies", "support-view", "flags"):
            res = self.owner.client.get(self.url(path))
            self.assertEqual(res.status_code, 404, path)

    def test_without_the_second_step_nothing_opens(self):
        person = self.make_staff("fresh@ilaf.test", "admin", verified=False)
        self.assertEqual(person.client.get(self.url("overview")).status_code, 403)

    def test_the_permission_page_is_the_table_the_server_uses(self):
        res = self.admin.client.get(self.url("permissions"))
        self.assertEqual(res.data, perms_map.matrix())
        keys = {p["key"] for p in res.data["permissions"]}
        self.assertIn("suspendCo", keys)

    def test_a_read_only_person_has_no_write_anywhere(self):
        for method, path, body, allowed in self.rows():
            if method == "get":
                continue
            res = getattr(self.ro.client, method)(self.url(path), body, format="json")
            self.assertEqual(res.status_code, 403, path)


class AuditCoverageTests(SimpleTestCase):
    def test_every_staff_write_method_logs(self):
        """Static check: each post/patch/put/delete of the staff views calls the audit log, directly or through a helper that does."""
        root = Path(__file__).resolve().parent.parent / "staff"
        files = [p for p in root.glob("views*.py")] + [root / "public_views.py"]
        helper_names = {"log", "apply_action", "_suspend_company", "_restore_company", "staff_suspend_card", "staff_restore_card", "end_session", "_start_export", "_confirm_delete"}
        public = {"public_views.py"}
        missing = []
        for path in files:
            if path.name in public:
                continue
            tree = ast.parse(path.read_text(encoding="utf-8"))
            for cls in [n for n in ast.walk(tree) if isinstance(n, ast.ClassDef)]:
                for fn in [n for n in cls.body if isinstance(n, ast.FunctionDef) and n.name in ("post", "patch", "put", "delete")]:
                    if cls.name in ("EnrolView", "ConfirmView", "VerifyView", "LogoutView", "RecoveryCodesView"):
                        continue
                    called = set()
                    for node in ast.walk(fn):
                        if isinstance(node, ast.Call):
                            func = node.func
                            called.add(func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", ""))
                    if not (called & helper_names or "_confirm_delete" in called or "_start_export" in called):
                        missing.append(f"{path.name}:{cls.name}.{fn.name}")
        self.assertEqual(missing, [], "these staff writes do not reach the audit log")

    def test_support_view_mirror_has_no_write_method(self):
        for view in MIRROR_VIEWS:
            for name in ("post", "put", "patch", "delete"):
                self.assertFalse(hasattr(view, name), f"{view.__name__} must be GET only")

    def test_every_support_view_route_serves_only_get_or_the_session_controls(self):
        allowed_writes = {"SupportViewStartView", "SupportViewEndView"}
        patterns = []

        def walk(resolver, prefix=""):
            for p in resolver.url_patterns:
                if hasattr(p, "url_patterns"):
                    walk(p, prefix + str(p.pattern))
                else:
                    patterns.append((prefix + str(p.pattern), p.callback))

        walk(get_resolver())
        found = 0
        for route, callback in patterns:
            if "support-view" not in route:
                continue
            found += 1
            cls = getattr(callback, "view_class", None)
            writes = [m for m in ("post", "put", "patch", "delete") if hasattr(cls, m)]
            if writes:
                self.assertIn(cls.__name__, allowed_writes, route)
        self.assertGreaterEqual(found, 9)


class CompanySuspensionTests(BackOfficeCase):
    def suspend(self, person=None, reason="Chargeback fraud"):
        return (person or self.admin).client.post(self.url(f"companies/{self.ws}/suspend"), {"reason": reason}, format="json")

    def test_admin_suspends_and_the_customer_sees_a_clear_refusal(self):
        res = self.suspend()
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.data["suspended"])
        self.assertEqual(res.data["status"], "suspended")
        refused = self.owner.client.get(f"{API}workspaces/{self.ws}/cards")
        self.assertEqual(refused.status_code, 403)
        self.assertEqual(refused.json()["error"]["code"], "workspace_suspended")
        self.assertIn("suspended", refused.json()["error"]["message"])
        # and in Arabic
        arabic = self.owner.client.get(f"{API}workspaces/{self.ws}/cards", HTTP_X_LANGUAGE="ar")
        self.assertRegex(arabic.json()["error"]["message"], "[؀-ۿ]")

    def test_the_company_record_the_app_loads_is_refused_for_every_member(self):
        self.suspend()
        res = self.owner.client.get(f"{API}workspaces/{self.ws}")
        self.assertEqual((res.status_code, res.json()["error"]["code"]), (403, "workspace_suspended"))
        # the person's other workspaces and the sign-in itself are unaffected
        self.assertEqual(self.owner.client.get(API + "me/workspaces").status_code, 200)
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.owner.ws}").status_code, 200)

    def test_support_and_read_only_cannot_suspend_a_company(self):
        self.assertEqual(self.suspend(self.support).status_code, 403)
        self.assertEqual(self.suspend(self.ro).status_code, 403)
        self.assertIsNone(Workspace.objects.get(pk=self.ws).suspended_at)

    def test_a_reason_is_required(self):
        self.assertEqual(self.suspend(reason="no").status_code, 400)

    def test_public_card_of_a_suspended_company_is_neutral_unavailable(self):
        self.suspend()
        res = self.client_for().get(f"{API}public/cards/{self.card['public_code']}")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.json()["state"], "paused")
        self.assertNotIn("card", res.json())

    def test_restore_brings_everything_back_and_both_sides_are_told(self):
        self.suspend()
        res = self.admin.client.post(self.url(f"companies/{self.ws}/restore"), {"reason": "Mistake"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(self.owner.client.get(f"{API}workspaces/{self.ws}/cards").status_code, 200)
        self.assertEqual(self.client_for().get(f"{API}public/cards/{self.card['public_code']}").json()["state"], "live")
        self.assertEqual(len(mail.outbox), 2)
        events = AuditEvent.objects.filter(workspace_id=self.ws).values_list("action", flat=True)
        self.assertIn("company.suspended", events)
        self.assertIn("company.restored", events)

    def test_the_owner_is_emailed_in_their_language(self):
        owner = self.user_of("owner@acme.test")
        owner.language = "ar"
        owner.save()
        self.suspend()
        self.assertEqual(len(mail.outbox), 1)
        self.assertRegex(mail.outbox[0].subject, "[؀-ۿ]")
        self.assertIn("dir=\"rtl\"", mail.outbox[0].alternatives[0][0])

    def test_suspending_twice_is_refused(self):
        self.suspend()
        self.assertEqual(self.suspend().status_code, 409)

    def test_bulk_suspend_reports_each_company(self):
        res = self.admin.client.post(self.url("companies/bulk"), {"ids": [self.ws, "00000000-0000-0000-0000-000000000000"], "action": "suspend", "reason": "Fraud ring"}, format="json")
        self.assertEqual(res.status_code, 200)
        ok = {r["id"]: r["ok"] for r in res.data["results"]}
        self.assertTrue(ok[self.ws])
        self.assertFalse(ok["00000000-0000-0000-0000-000000000000"])

    def test_the_list_filters_and_pages(self):
        self.suspend()
        res = self.admin.client.get(self.url("companies"), {"status": "suspended"})
        self.assertEqual([r["name"] for r in res.data["results"]], ["Acme Ltd"])
        none = self.admin.client.get(self.url("companies"), {"status": "active"})
        self.assertEqual(none.data["count"], 0)
        self.assertEqual(self.admin.client.get(self.url("companies"), {"q": "nobody"}).data["count"], 0)


class CardSuspensionTests(BackOfficeCase):
    def test_support_suspends_a_card_and_the_company_cannot_undo_it(self):
        res = self.support.client.post(self.url(f"cards/{self.card['id']}/suspend"), {"reason": "Impersonation"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(Card.objects.get(pk=self.card["id"]).status, "suspended")
        self.assertTrue(Card.objects.get(pk=self.card["id"]).staff_hold)
        self.assertEqual(self.client_for().get(f"{API}public/cards/{self.card['public_code']}").json()["state"], "suspended")
        back = self.owner.client.post(f"{API}cards/{self.card['id']}/restore")
        self.assertEqual(back.status_code, 403)
        self.assertEqual(back.json()["error"]["code"], "card_held_by_staff")

    def test_support_restores_it_and_it_goes_back_to_published(self):
        self.support.client.post(self.url(f"cards/{self.card['id']}/suspend"), {"reason": "Impersonation"}, format="json")
        res = self.support.client.post(self.url(f"cards/{self.card['id']}/restore"), {}, format="json")
        self.assertEqual(res.status_code, 200)
        card = Card.objects.get(pk=self.card["id"])
        self.assertEqual((card.status, card.staff_hold), ("published", False))
        self.assertTrue(AuditEvent.objects.filter(workspace_id=self.ws, action="card.suspended", actor_name__contains="support").exists())

    def test_the_card_drawer_has_the_card_history_and_reports(self):
        self.support.client.post(self.url(f"cards/{self.card['id']}/suspend"), {"reason": "Impersonation"}, format="json")
        res = self.ro.client.get(self.url(f"cards/{self.card['id']}"))
        self.assertEqual(res.data["card"]["public_code"], self.card["public_code"])
        self.assertTrue(res.data["card"]["staff_hold"])
        self.assertTrue(any(h["kind"] == "staff" for h in res.data["history"]))

    def test_search_finds_people_cards_and_companies(self):
        for term in ("acme", "owner@acme", self.card["public_code"], "Alice"):
            res = self.ro.client.get(self.url("search"), {"q": term})
            self.assertEqual(res.status_code, 200)
            found = len(res.data["companies"]) + len(res.data["cards"]) + len(res.data["people"])
            self.assertGreater(found, 0, term)
        self.assertEqual(self.ro.client.get(self.url("search"), {"q": "a"}).data["cards"], [])

    def test_user_detail_and_force_sign_out(self):
        uid = str(self.user_of("owner@acme.test").id)
        detail = self.ro.client.get(self.url(f"users/{uid}")).data
        self.assertTrue(detail["sign_in_methods"]["password"])
        self.assertFalse(detail["sign_in_methods"]["google"])
        self.assertGreaterEqual(len(detail["sessions"]), 1)
        self.assertEqual(self.support.client.post(self.url(f"users/{uid}/sign-out")).status_code, 403)
        res = self.admin.client.post(self.url(f"users/{uid}/sign-out"))
        self.assertGreaterEqual(res.data["revoked"], 1)
        refreshed = self.client_for().post(API + "auth/refresh", {"refresh": self.owner.refresh}, format="json")
        self.assertEqual(refreshed.status_code, 401)


class SupportViewTests(BackOfficeCase):
    def start(self, person=None, reason="Customer asked us to check their team"):
        return (person or self.support).client.post(self.url("support-view"), {"company_id": self.ws, "reason": reason}, format="json")

    def test_a_reason_is_required(self):
        self.assertEqual(self.start(reason="short").status_code, 400)

    def test_start_logs_both_records_and_the_customer_sees_it(self):
        res = self.start()
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["seconds_left"] // 60 >= 29, True)
        self.assertIn("support_view.started", self.audit_actions())
        mine = self.owner.client.get(f"{API}workspaces/{self.ws}/audit").json()
        entry = next(e for e in mine["results"] if e["action"] == "support.viewed")
        self.assertIn("support", entry["actor"]["full_name"].lower())
        self.assertEqual(entry["actor"]["email"], "")
        self.assertEqual(entry["details"]["reason"], "Customer asked us to check their team")
        self.assertNotIn("support@ilaf.test", str(entry))

    def test_the_mirror_shows_everything_to_support(self):
        sid = self.start().data["id"]
        team = self.support.client.get(self.url(f"support-view/{sid}/team")).data["data"]
        self.assertEqual(team[0]["email"], "owner@acme.test")
        cards = self.support.client.get(self.url(f"support-view/{sid}/cards")).data["data"]
        self.assertEqual(cards[0]["public_code"], self.card["public_code"])
        self.assertIn("design", cards[0])
        leads = self.support.client.get(self.url(f"support-view/{sid}/leads")).data["data"]
        self.assertEqual(leads[0]["email"], "hannah@mailbox.test")
        self.assertEqual(leads[0]["phone"], "+44 20 7946 0000")
        self.assertEqual(leads[0]["note"], "Wants a quote")
        for page in ("brand", "activity", "overview", "log"):
            self.assertEqual(self.support.client.get(self.url(f"support-view/{sid}/{page}")).status_code, 200, page)

    def test_every_page_opened_is_kept_on_the_session(self):
        sid = self.start().data["id"]
        for page in ("team", "team", "leads"):
            self.support.client.get(self.url(f"support-view/{sid}/{page}"))
        pages = [p["page"] for p in SupportViewSession.objects.get(pk=sid).pages]
        self.assertEqual(pages, ["team", "leads"])
        self.assertEqual([p["page"] for p in self.support.client.get(self.url(f"support-view/{sid}/log")).data["data"]["pages"]], ["team", "leads", "log"])

    def test_the_mirror_cannot_change_anything(self):
        sid = self.start().data["id"]
        before = (Card.objects.get(pk=self.card["id"]).name, self.lead.status)
        for page in ("team", "cards", "leads", "brand", "activity", "overview", "log"):
            for who in (self.support, self.admin):
                for method in ("post", "put", "patch", "delete"):
                    res = getattr(who.client, method)(self.url(f"support-view/{sid}/{page}"), {"name": "Hacked", "status": "won"}, format="json")
                    self.assertIn(res.status_code, (403, 405), f"{method} {page}")
        self.lead.refresh_from_db()
        self.assertEqual((Card.objects.get(pk=self.card["id"]).name, self.lead.status), before)

    def test_a_staff_token_reaches_no_customer_write_endpoint(self):
        self.start()
        res = self.support.client.patch(f"{API}cards/{self.card['id']}", {"name": "Hacked"}, format="json")
        self.assertEqual(res.status_code, 404)
        res = self.support.client.post(f"{API}workspaces/{self.ws}/cards", {"name": "Fake"}, format="json")
        self.assertEqual(res.status_code, 404)
        self.assertEqual(Card.objects.get(pk=self.card["id"]).name, "Alice Anderson")

    def test_it_ends_by_itself_and_both_records_say_so(self):
        sid = self.start().data["id"]
        SupportViewSession.objects.filter(pk=sid).update(expires_at=timezone.now() - timedelta(seconds=1))
        res = self.support.client.get(self.url(f"support-view/{sid}/team"))
        self.assertEqual(res.status_code, 410)
        self.assertEqual(res.json()["error"]["code"], "support_view_ended")
        s = SupportViewSession.objects.get(pk=sid)
        self.assertEqual(s.ended_how, "expired")
        self.assertIn("support.ended", AuditEvent.objects.filter(workspace_id=self.ws).values_list("action", flat=True))
        self.assertIn("support_view.ended", self.audit_actions())

    def test_the_cron_command_ends_forgotten_sessions(self):
        sid = self.start().data["id"]
        SupportViewSession.objects.filter(pk=sid).update(expires_at=timezone.now() - timedelta(minutes=1))
        self.assertEqual(expire_due(), 1)
        self.assertEqual(expire_due(), 0)
        self.assertIsNotNone(SupportViewSession.objects.get(pk=sid).ended_at)

    def test_ending_by_hand_works_once(self):
        sid = self.start().data["id"]
        self.assertEqual(self.support.client.post(self.url(f"support-view/{sid}/end")).data["ended_how"], "manual")
        self.assertEqual(self.support.client.get(self.url(f"support-view/{sid}/team")).status_code, 410)
        ended = [a for a in AuditEvent.objects.filter(workspace_id=self.ws, action="support.ended")]
        self.assertEqual(len(ended), 1)
        self.support.client.post(self.url(f"support-view/{sid}/end"))
        self.assertEqual(AuditEvent.objects.filter(workspace_id=self.ws, action="support.ended").count(), 1)

    def test_only_one_session_per_person_at_a_time(self):
        first = self.start().data["id"]
        second = self.start().data["id"]
        self.assertNotEqual(first, second)
        self.assertEqual(SupportViewSession.objects.get(pk=first).ended_how, "replaced")
        self.assertEqual(SupportViewSession.objects.filter(staff__email="support@ilaf.test", ended_at__isnull=True).count(), 1)
        self.assertEqual(self.support.client.get(self.url(f"support-view/{first}/team")).status_code, 410)

    def test_nobody_else_can_use_someones_session(self):
        sid = self.start().data["id"]
        self.assertEqual(self.admin.client.get(self.url(f"support-view/{sid}/team")).status_code, 404)

    def test_read_only_cannot_open_or_read(self):
        self.assertEqual(self.start(self.ro).status_code, 403)
        sid = self.start().data["id"]
        self.assertEqual(self.ro.client.get(self.url(f"support-view/{sid}/team")).status_code, 403)

    def test_the_customer_entry_exists_in_both_languages(self):
        from ilaf.i18n import translate_message
        from operations.audit import ACTIONS

        self.assertIn("support.viewed", ACTIONS)
        self.assertIn("support.ended", ACTIONS)
        web = Path(__file__).resolve().parent.parent.parent / "web" / "src" / "lib" / "i18n"
        for lang in ("en", "ar"):
            text = (web / lang / "company.ts").read_text(encoding="utf-8")
            for key in ("company.evSupportViewed", "company.evSupportEnded"):
                self.assertIn(f'"{key}"', text, f"{lang} {key}")
        self.assertEqual(translate_message("en", "x"), "x")

    def test_a_company_that_is_deleted_cannot_be_looked_at(self):
        sid = self.start().data["id"]
        Workspace.objects.filter(pk=self.ws).update(deleted_at=timezone.now())
        self.assertEqual(self.support.client.get(self.url(f"support-view/{sid}/team")).status_code, 404)

    def test_history_lists_sessions_for_support_and_admin(self):
        self.start()
        rows = self.admin.client.get(self.url("support-view/history")).data
        self.assertEqual(rows[0]["company_name"], "Acme Ltd")
        self.assertEqual(rows[0]["reason"], "Customer asked us to check their team")


class AuditLogTests(BackOfficeCase):
    def test_filters_category_and_actor(self):
        self.support.client.post(self.url(f"cards/{self.card['id']}/suspend"), {"reason": "Impersonation"}, format="json")
        self.admin.client.post(self.url(f"companies/{self.ws}/suspend"), {"reason": "Fraud check"}, format="json")
        cards = self.ro.client.get(self.url("audit"), {"category": "card"}).data
        self.assertEqual({r["action"] for r in cards["results"]}, {"card.suspended"})
        mine = self.ro.client.get(self.url("audit"), {"actor": "support@"}).data
        self.assertTrue(all(r["actor_email"] == "support@ilaf.test" for r in mine["results"]))
        by_role = self.ro.client.get(self.url("audit"), {"role": "admin", "category": "company"}).data
        self.assertEqual(by_role["count"], 1)
        future = self.ro.client.get(self.url("audit"), {"from": "2999-01-01"}).data
        self.assertEqual(future["count"], 0)

    def test_csv_export_for_support_and_admin_only_and_it_is_logged(self):
        self.assertEqual(self.ro.client.get(self.url("audit/export")).status_code, 403)
        res = self.support.client.get(self.url("audit/export"))
        self.assertEqual(res.status_code, 200)
        self.assertIn("text/csv", res["Content-Type"])
        self.assertIn("audit.exported", self.audit_actions())

    def test_a_new_address_for_a_session_is_logged_once(self):
        res = self.admin.client.get(self.url("overview"), REMOTE_ADDR="203.0.113.77")
        self.assertEqual(res.status_code, 200)
        self.admin.client.get(self.url("overview"), REMOTE_ADDR="203.0.113.77")
        self.assertEqual(self.audit_actions().count("staff.ip_changed"), 1)

    def test_company_notes_are_staff_only_and_listed(self):
        self.support.client.post(self.url(f"companies/{self.ws}/notes"), {"body": "Spoke to the owner"}, format="json")
        rows = self.ro.client.get(self.url(f"companies/{self.ws}/notes")).data
        self.assertEqual(rows[0]["body"], "Spoke to the owner")
        self.assertEqual(self.support.client.post(self.url(f"companies/{self.ws}/notes"), {"body": ""}, format="json").status_code, 400)
        mine = self.owner.client.get(f"{API}workspaces/{self.ws}/audit").content.decode()
        self.assertNotIn("Spoke to the owner", mine)
