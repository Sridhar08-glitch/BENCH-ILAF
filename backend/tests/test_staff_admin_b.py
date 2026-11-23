"""Staff area: support view e-mail and Look entries, company page extras, audit categories, applications table."""
from datetime import timedelta

from django.core import mail
from django.utils import timezone

from analytics.models import Event
from cards.models import Card
from staff.models import CompanyLead, StaffAuditEvent, SupportViewSession
from staff.views import AUDIT_ACTIONS, AUDIT_CATEGORIES, category_of
from workspaces.models import Member, Workspace

from .base import API
from .bo_base import BackOfficeCase


class SupportViewOwnerMailTests(BackOfficeCase):
    def start(self, reason="Customer asked us to check their team"):
        return self.support.client.post(self.url("support-view"), {"company_id": self.ws, "reason": reason}, format="json")

    def test_the_owner_is_told_who_and_until_when(self):
        res = self.start()
        self.assertEqual(res.status_code, 201, res.content)
        sent = [m for m in mail.outbox if m.to == ["owner@acme.test"]]
        self.assertEqual(len(sent), 1)
        body = sent[0].body
        self.assertIn("Support", body)  # the staff member's name (full name made from the address)
        self.assertIn("Acme Ltd", body)
        self.assertIn("Customer asked us to check their team", body)
        until = SupportViewSession.objects.get(pk=res.data["id"]).expires_at
        self.assertIn(f"{until:%H:%M} UTC", body)

    def test_the_owner_gets_it_in_arabic(self):
        owner = self.user_of("owner@acme.test")
        owner.language = "ar"
        owner.save()
        self.start()
        sent = [m for m in mail.outbox if m.to == ["owner@acme.test"]]
        self.assertRegex(sent[0].subject, "[؀-ۿ]")
        self.assertIn('dir="rtl"', sent[0].alternatives[0][0])
        self.assertIn("UTC", sent[0].body)

    def test_a_refused_start_sends_nothing(self):
        self.assertEqual(self.start(reason="short").status_code, 400)
        self.assertEqual([m for m in mail.outbox if m.to == ["owner@acme.test"]], [])


class LookEntriesTests(BackOfficeCase):
    def looks(self):
        return list(StaffAuditEvent.objects.filter(action__startswith="look.").order_by("created_at"))

    def test_pages_of_a_support_view_are_logged_as_looks(self):
        sid = self.support.client.post(self.url("support-view"), {"company_id": self.ws, "reason": "Customer asked for help"}, format="json").data["id"]
        for page in ("team", "leads", "leads", "log"):
            self.support.client.get(self.url(f"support-view/{sid}/{page}"))
        rows = self.looks()
        self.assertEqual([r.action for r in rows], ["look.page", "look.leads"])
        self.assertEqual(rows[1].details["page"], "leads")
        self.assertEqual(rows[1].details["session"], sid)
        self.assertEqual(rows[1].target_label, "Acme Ltd")
        # the customer still sees the session itself in their own log
        mine = self.owner.client.get(f"{API}workspaces/{self.ws}/audit").json()
        self.assertIn("support.viewed", [e["action"] for e in mine["results"]])

    def test_opening_the_leads_tab_is_a_look_and_a_refresh_is_not_logged_twice(self):
        for role in ("read_only", "support", "admin"):
            self.assertEqual(self.person(role).client.get(self.url(f"companies/{self.ws}/leads")).status_code, 200)
        self.person("admin").client.get(self.url(f"companies/{self.ws}/leads"))
        rows = self.looks()
        self.assertEqual(len(rows), 3)
        self.assertEqual({r.actor_role for r in rows}, {"read_only", "support", "admin"})
        self.assertTrue(all(r.details == {"masked": True} for r in rows))

    def test_the_customer_does_not_see_a_leads_look_outside_a_support_view(self):
        self.support.client.get(self.url(f"companies/{self.ws}/leads"))
        mine = self.owner.client.get(f"{API}workspaces/{self.ws}/audit").content.decode()
        self.assertNotIn("look.", mine)

    def test_the_public_page_look_is_open_to_every_role_and_logged(self):
        url = self.url(f"cards/{self.card['id']}/look")
        for role in ("read_only", "support", "admin"):
            self.assertEqual(self.person(role).client.post(url, {"what": "public_page"}, format="json").status_code, 200, role)
        rows = [r for r in self.looks() if r.action == "look.public_page"]
        self.assertEqual(len(rows), 3)
        self.assertEqual(rows[0].target_type, "card")
        self.assertEqual(self.admin.client.post(url, {"what": "other"}, format="json").status_code, 400)
        self.assertEqual(self.owner.client.post(url, {}, format="json").status_code, 404)

    def test_looks_have_the_look_category_in_the_log(self):
        self.support.client.get(self.url(f"companies/{self.ws}/leads"))
        res = self.ro.client.get(self.url("audit"), {"category": "look"}).data
        self.assertEqual([r["action"] for r in res["results"]], ["look.leads"])
        self.assertEqual(res["results"][0]["category"], "look")
        self.assertEqual(res["results"][0]["label"], AUDIT_ACTIONS["look.leads"])


class AuditCategoryTests(BackOfficeCase):
    def test_every_listed_action_has_a_category(self):
        for action in AUDIT_ACTIONS:
            self.assertTrue(category_of(action), action)

    def test_mapping_by_prefix(self):
        for action, key in (
            ("look.leads", "look"), ("audit.exported", "look"), ("application.updated", "application"), ("application.assigned", "application"),
            ("email.resent", "system"), ("staff.ip_changed", "system"), ("staff.invited", "staff"), ("company.suspended", "company"),
            ("support_view.started", "support_view"), ("something.new", ""),
        ):
            self.assertEqual(category_of(action), key, action)
        self.assertIn("look", AUDIT_CATEGORIES)

    def test_the_list_offers_the_new_categories_and_filters_by_them(self):
        self.admin.client.get(self.url("overview"), REMOTE_ADDR="203.0.113.9")  # a new address: staff.ip_changed (System)
        lead = CompanyLead.objects.create(company="Delta Ltd", name="Dana", email="dana@delta.test")
        self.support.client.patch(self.url(f"applications/{lead.id}"), {"status": "contacted"}, format="json")
        data = self.ro.client.get(self.url("audit")).data
        self.assertTrue({"look", "application", "system"} <= {c["key"] for c in data["categories"]})
        apps = self.ro.client.get(self.url("audit"), {"category": "application"}).data
        self.assertEqual([r["action"] for r in apps["results"]], ["application.updated"])
        self.assertEqual(apps["results"][0]["category_label"], "Application")
        system = self.ro.client.get(self.url("audit"), {"category": "system"}).data
        self.assertEqual({r["action"] for r in system["results"]}, {"staff.ip_changed"})
        staff = self.ro.client.get(self.url("audit"), {"category": "staff"}).data
        self.assertNotIn("staff.ip_changed", {r["action"] for r in staff["results"]})

    def test_from_is_the_person_or_system(self):
        self.support.client.post(self.url(f"cards/{self.card['id']}/suspend"), {"reason": "Impersonation"}, format="json")
        StaffAuditEvent.objects.create(action="email.resent", target_label="x")
        rows = {r["action"]: r for r in self.ro.client.get(self.url("audit")).data["results"]}
        self.assertEqual(rows["card.suspended"]["from"], "Support")
        self.assertEqual(rows["card.suspended"]["category"], "card")
        self.assertEqual(rows["email.resent"]["from"], "System")
        self.assertNotIn("ip", " ".join(rows["card.suspended"]).lower().replace("ip_hash", ""))

    def test_the_list_costs_the_same_for_one_row_or_many(self):
        def cost():
            from django.db import connection
            from django.test.utils import CaptureQueriesContext

            with CaptureQueriesContext(connection) as ctx:
                self.ro.client.get(self.url("audit"))
            return len(ctx)

        first = cost()
        for i in range(15):
            self.support.client.post(self.url(f"companies/{self.ws}/notes"), {"body": f"note {i}"}, format="json")
        self.assertLessEqual(cost(), first + 1)


class CompanyPageTests(BackOfficeCase):
    def detail(self):
        return self.ro.client.get(self.url(f"companies/{self.ws}")).data

    def test_views_of_the_last_14_days_with_zeros_filled_in(self):
        card = Card.objects.get(pk=self.card["id"])
        for days_ago in (0, 0, 3, 20):
            event = Event.objects.create(card=card, type="view")
            Event.objects.filter(pk=event.pk).update(created_at=timezone.now() - timedelta(days=days_ago))
        series = self.detail()["views_14d"]
        self.assertEqual(len(series), 14)
        self.assertEqual(series[-1]["day"], timezone.now().date().isoformat())
        self.assertEqual([p["views"] for p in series].count(0), 12)
        self.assertEqual(sum(p["views"] for p in series), 3)

    def test_the_account_panel_has_the_public_address(self):
        self.assertEqual(self.detail()["public_address"], "")
        Workspace.objects.filter(pk=self.ws).update(directory_enabled=True, directory_slug="acme")
        self.assertTrue(self.detail()["public_address"].endswith("/d/acme"))
        Workspace.objects.filter(pk=self.ws).update(custom_domain="cards.acme.test")
        self.assertEqual(self.detail()["public_address"], "https://cards.acme.test")
        self.assertNotIn("industry", self.detail())
        self.assertNotIn("size", self.detail())

    def test_the_team_shows_title_and_card_status(self):
        owner_member = Member.objects.get(workspace_id=self.ws, role="owner")
        Member.objects.filter(pk=owner_member.pk).update(title="Founder")
        Card.objects.filter(pk=self.card["id"]).update(member=owner_member)
        Member.objects.create(workspace_id=self.ws, email="two@acme.test", full_name="Two", role="employee", status="active")
        rows = {r["email"]: r for r in self.ro.client.get(self.url(f"companies/{self.ws}/team")).data}
        self.assertEqual((rows["owner@acme.test"]["title"], rows["owner@acme.test"]["card_status"], rows["owner@acme.test"]["cards"]), ("Founder", "published", 1))
        self.assertEqual((rows["two@acme.test"]["card_status"], rows["two@acme.test"]["cards"]), ("none", 0))

    def test_the_team_costs_the_same_for_many_people(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        self.ro.client.get(self.url(f"companies/{self.ws}/team"))  # first call warms caches
        with CaptureQueriesContext(connection) as one:
            self.ro.client.get(self.url(f"companies/{self.ws}/team"))
        for i in range(6):
            Member.objects.create(workspace_id=self.ws, email=f"p{i}@acme.test", full_name=f"P{i}", role="employee", status="active")
        with CaptureQueriesContext(connection) as many:
            self.ro.client.get(self.url(f"companies/{self.ws}/team"))
        self.assertEqual(len(one), len(many))

    def test_the_brand_tab_has_colours_and_font(self):
        ws = Workspace.objects.get(pk=self.ws)
        ws.brand = {**ws.brand, "colours": {"primary": "#12284b", "accent": "#ff6b35", "mode": "brand"}, "design": {**ws.brand["design"], "font": "cairo"}}
        ws.save()
        brand = self.ro.client.get(self.url(f"companies/{self.ws}/brand")).data
        self.assertEqual(brand["colours"]["primary"], "#12284b")
        self.assertEqual(brand["colours"]["accent"], "#ff6b35")
        self.assertEqual(brand["font"], "cairo")

    def test_seats_for_the_bar(self):
        detail = self.detail()
        self.assertIn("seats_used", detail)
        self.assertIn("seats_total", detail)


class SuspendWithNameTests(BackOfficeCase):
    def suspend(self, **body):
        return self.admin.client.post(self.url(f"companies/{self.ws}/suspend"), {"reason": "Chargeback fraud", **body}, format="json")

    def test_a_wrong_typed_name_is_refused_and_nothing_changes(self):
        res = self.suspend(confirm_name="Acme")
        self.assertEqual(res.status_code, 400)
        self.assertIsNone(Workspace.objects.get(pk=self.ws).suspended_at)
        self.assertEqual(mail.outbox, [])

    def test_the_right_name_suspends_and_the_reason_is_in_the_owner_mail(self):
        res = self.suspend(confirm_name=" acme ltd ")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("Chargeback fraud", mail.outbox[0].body)
        self.assertIn("Reason from our team", mail.outbox[0].body)

    def test_the_reason_is_quoted_in_arabic_too(self):
        owner = self.user_of("owner@acme.test")
        owner.language = "ar"
        owner.save()
        self.suspend(confirm_name="Acme Ltd")
        self.assertIn("Chargeback fraud", mail.outbox[0].body)
        self.assertNotIn("Reason from our team", mail.outbox[0].body)
        self.assertRegex(mail.outbox[0].body, "[؀-ۿ]")

    def test_an_automatic_card_report_reason_is_not_quoted(self):
        from staff.views_customers import _suspend_company

        _suspend_company(None, Workspace.objects.get(pk=self.ws), "Card report: spam")
        self.assertNotIn("Card report", mail.outbox[0].body)

    def test_restore_mail_has_no_reason_line(self):
        self.suspend()
        mail.outbox.clear()
        self.admin.client.post(self.url(f"companies/{self.ws}/restore"), {"reason": "Mistake"}, format="json")
        self.assertNotIn("Mistake", mail.outbox[0].body)


class ApplicationsTableTests(BackOfficeCase):
    def apply(self, **body):
        data = {"company": "Delta Ltd", "name": "Dana", "email": "dana@delta.test", "size": "6-20", **body}
        return self.client_for().post(f"{API}public/company-leads", data, format="json")

    def test_the_form_keeps_the_country(self):
        self.assertEqual(self.apply(country="qa").status_code, 201)
        self.assertEqual(CompanyLead.objects.get().country, "QA")
        row = self.ro.client.get(self.url("applications")).data["results"][0]
        self.assertEqual(row["country"], "QA")

    def test_a_form_without_a_country_still_works_and_a_bad_one_is_refused(self):
        self.assertEqual(self.apply().status_code, 201)
        self.assertEqual(CompanyLead.objects.get().country, "")
        self.assertEqual(self.apply(email="other@delta.test", country="ZZ").status_code, 400)
        self.assertEqual(CompanyLead.objects.count(), 1)

    def test_the_list_carries_the_staff_for_the_picker(self):
        res = self.ro.client.get(self.url("applications")).data
        emails = {p["email"] for p in res["assignees"]}
        self.assertEqual(emails, {"admin@ilaf.test", "support@ilaf.test", "ro@ilaf.test"})
        self.assertNotIn("password", str(res["assignees"]).lower())

    def test_assigning_is_audited_and_shows_the_person(self):
        self.apply()
        lead = CompanyLead.objects.get()
        who = str(self.user_of("support@ilaf.test").id)
        res = self.support.client.patch(self.url(f"applications/{lead.id}"), {"assignee": who}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual((res.data["assignee_id"], res.data["assignee_name"]), (who, "Support"))
        entry = StaffAuditEvent.objects.get(action="application.assigned")
        self.assertEqual(entry.details["assignee"], "support@ilaf.test")
        self.support.client.patch(self.url(f"applications/{lead.id}"), {"assignee": ""}, format="json")
        self.assertEqual(StaffAuditEvent.objects.filter(action="application.assigned").count(), 2)
        self.assertIsNone(CompanyLead.objects.get().assignee_id)

    def test_status_with_assignee_is_one_updated_entry(self):
        self.apply()
        lead = CompanyLead.objects.get()
        who = str(self.user_of("admin@ilaf.test").id)
        self.support.client.patch(self.url(f"applications/{lead.id}"), {"status": "qualified", "assignee": who}, format="json")
        self.assertEqual(StaffAuditEvent.objects.filter(action="application.updated").count(), 1)
        self.assertEqual(StaffAuditEvent.objects.filter(action="application.assigned").count(), 0)

    def test_the_assignee_must_be_staff_and_read_only_cannot_assign(self):
        self.apply()
        lead = CompanyLead.objects.get()
        customer = str(self.user_of("owner@acme.test").id)
        self.assertEqual(self.support.client.patch(self.url(f"applications/{lead.id}"), {"assignee": customer}, format="json").status_code, 400)
        self.assertEqual(self.ro.client.patch(self.url(f"applications/{lead.id}"), {"assignee": str(self.user_of("admin@ilaf.test").id)}, format="json").status_code, 403)
