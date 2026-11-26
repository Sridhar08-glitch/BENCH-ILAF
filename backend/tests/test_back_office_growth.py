"""Back office: announcements and e-mail broadcasts, feature switches, business analytics and the billing placeholder."""
from datetime import timedelta

from django.core import mail
from django.core.cache import cache
from django.core.management import call_command
from django.utils import timezone

from accounts.models import User
from billing.models import Payment
from staff import announce, flags
from staff.models import Announcement, AnnouncementDelivery, FeatureFlag

from .base import API
from .bo_base import BackOfficeCase

TEXT = {
    "title_en": "Planned maintenance", "title_ar": "صيانة مجدولة", "body_en": "We update on Sunday at 02:00.", "body_ar": "سنجري تحديثًا يوم الأحد الساعة 02:00.",
    "severity": "warning", "audience_kind": "all", "banner": True, "send_email": False,
}


class AnnouncementTests(BackOfficeCase):
    def create(self, person=None, **over):
        return (person or self.admin).client.post(self.url("announcements"), {**TEXT, **over}, format="json")

    def test_only_admin_composes_and_both_languages_are_required(self):
        self.assertEqual(self.create(self.support).status_code, 403)
        self.assertEqual(self.create(self.ro).status_code, 403)
        for missing in ("title_en", "title_ar", "body_en", "body_ar"):
            res = self.create(**{missing: ""})
            self.assertEqual(res.status_code, 400, missing)
            self.assertIn(missing, res.json()["error"]["fields"])
        english_in_arabic = self.create(title_ar="Planned maintenance")
        self.assertEqual(english_in_arabic.status_code, 400)
        self.assertEqual(self.create(banner=False, send_email=False).status_code, 400)
        self.assertEqual(self.create(ends_at="2020-01-01T00:00:00Z", starts_at="2021-01-01T00:00:00Z").status_code, 400)
        self.assertEqual(self.create(severity="loud").status_code, 400)
        self.assertEqual(self.create(audience_kind="plan", audience_values=[]).status_code, 400)

    def test_customers_see_the_banner_in_their_language_and_can_dismiss_it(self):
        self.assertEqual(self.create().status_code, 201)
        en = self.owner.client.get(API + "announcements").json()["results"]
        self.assertEqual((en[0]["title"], en[0]["severity"]), ("Planned maintenance", "warning"))
        ar = self.owner.client.get(API + "announcements", HTTP_X_LANGUAGE="ar").json()["results"]
        self.assertEqual(ar[0]["title"], "صيانة مجدولة")
        self.assertEqual(self.owner.client.post(f"{API}announcements/{en[0]['id']}/dismiss").status_code, 204)
        self.assertEqual(self.owner.client.get(API + "announcements").json()["results"], [])
        other = self.signup("other@person.test", "Other Person")
        self.assertEqual(len(other.client.get(API + "announcements").json()["results"]), 1)

    def test_start_end_and_cancel_limit_the_banner(self):
        future = (timezone.now() + timedelta(days=1)).isoformat()
        self.create(starts_at=future)
        self.assertEqual(self.owner.client.get(API + "announcements").json()["results"], [])
        a = Announcement.objects.get()
        a.starts_at = timezone.now() - timedelta(hours=2)
        a.ends_at = timezone.now() - timedelta(hours=1)
        a.save()
        self.assertEqual(self.owner.client.get(API + "announcements").json()["results"], [])
        a.ends_at = None
        a.save()
        self.assertEqual(len(self.owner.client.get(API + "announcements").json()["results"]), 1)
        self.assertEqual(self.support.client.post(self.url(f"announcements/{a.id}/cancel")).status_code, 403)
        self.admin.client.post(self.url(f"announcements/{a.id}/cancel"))
        self.assertEqual(self.owner.client.get(API + "announcements").json()["results"], [])

    def test_audience_by_plan_and_by_companies(self):
        self.create(audience_kind="plan", audience_values=["personal"])
        self.assertEqual(self.owner.client.get(API + "announcements").json()["results"], [])
        Announcement.objects.all().delete()
        self.create(audience_kind="companies", audience_values=[self.ws])
        self.assertEqual(len(self.owner.client.get(API + "announcements").json()["results"]), 1)
        stranger = self.signup("stranger@person.test", "Stranger")
        self.assertEqual(stranger.client.get(API + "announcements").json()["results"], [])

    def test_audience_by_country_follows_where_visitors_come_from(self):
        from analytics.models import Event

        Event.objects.create(card_id=self.card["id"], type="view", country="QA")
        self.create(audience_kind="country", audience_values=["qa"])
        self.assertEqual(len(self.owner.client.get(API + "announcements").json()["results"]), 1)
        Announcement.objects.all().delete()
        self.create(audience_kind="country", audience_values=["PL"])
        self.assertEqual(self.owner.client.get(API + "announcements").json()["results"], [])

    def test_preview_counts_people_without_sending(self):
        res = self.admin.client.post(self.url("announcements/preview"), {"audience_kind": "companies", "audience_values": [self.ws], "email_kind": "transactional"}, format="json")
        self.assertEqual((res.data["companies"], res.data["people"]), (1, 1))
        self.assertEqual(mail.outbox, [])
        marketing = self.admin.client.post(self.url("announcements/preview"), {"audience_kind": "companies", "audience_values": [self.ws], "email_kind": "marketing"}, format="json")
        self.assertEqual(marketing.data["people"], 0)


class BroadcastTests(BackOfficeCase):
    def setUp(self):
        super().setUp()
        self.ana = self.user_of("owner@acme.test")

    def make(self, **over):
        res = self.admin.client.post(self.url("announcements"), {**TEXT, "banner": False, "send_email": True, **over}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        return Announcement.objects.get(pk=res.data["id"])

    def test_marketing_goes_only_to_people_who_chose_product_updates(self):
        other = User.objects.create_user("quiet@acme.test", self.password)
        from workspaces.models import Member

        Member.objects.create(workspace_id=self.ws, user=other, email=other.email, role="admin", status="active")
        self.ana.product_updates = True
        self.ana.save()
        self.make(email_kind="marketing")
        call_command("send_announcements", verbosity=0)
        self.assertEqual(len(mail.outbox), 1)
        message = mail.outbox[0]
        self.assertEqual(message.to, ["owner@acme.test"])
        self.assertEqual(message.subject, "Planned maintenance")
        self.assertIn("List-Unsubscribe", message.extra_headers)
        self.assertIn("/unsubscribe?t=", message.body)

    def test_a_second_run_sends_nothing_twice(self):
        self.ana.product_updates = True
        self.ana.save()
        a = self.make(email_kind="marketing")
        call_command("send_announcements", verbosity=0)
        call_command("send_announcements", verbosity=0)
        self.assertEqual(len(mail.outbox), 1)
        a.refresh_from_db()
        self.assertEqual((a.email_status, a.email_sent_count), ("sent", 1))
        self.assertEqual(AnnouncementDelivery.objects.filter(announcement=a).count(), 1)

    def test_a_service_notice_reaches_owners_and_admins_in_their_language(self):
        self.ana.language = "ar"
        self.ana.save()
        self.make(email_kind="transactional")
        call_command("send_announcements", verbosity=0)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].subject, "صيانة مجدولة")
        self.assertNotIn("List-Unsubscribe", mail.outbox[0].extra_headers)

    def test_a_scheduled_email_waits_for_its_time(self):
        self.make(email_kind="transactional", email_send_at=(timezone.now() + timedelta(hours=3)).isoformat())
        call_command("send_announcements", verbosity=0)
        self.assertEqual(mail.outbox, [])
        Announcement.objects.update(email_send_at=timezone.now() - timedelta(minutes=1))
        call_command("send_announcements", verbosity=0)
        self.assertEqual(len(mail.outbox), 1)

    def test_batches_stop_at_the_limit_and_continue_next_run(self):
        for i in range(3):
            u = User.objects.create_user(f"p{i}@acme.test", self.password)
            u.product_updates = True
            u.save()
        a = self.make(email_kind="marketing")
        self.assertEqual(announce.run_broadcasts(limit=2), 2)
        a.refresh_from_db()
        self.assertEqual(a.email_status, "sending")
        self.assertEqual(announce.run_broadcasts(limit=2), 1)
        a.refresh_from_db()
        self.assertEqual(a.email_status, "sent")

    def test_a_cancelled_announcement_sends_nothing(self):
        a = self.make(email_kind="transactional")
        self.admin.client.post(self.url(f"announcements/{a.id}/cancel"))
        call_command("send_announcements", verbosity=0)
        self.assertEqual(mail.outbox, [])

    def test_unsubscribe_link_switches_updates_off_and_rejects_bad_tokens(self):
        self.ana.product_updates = True
        self.ana.save()
        token = announce.unsubscribe_token(self.ana)
        client = self.client_for()
        self.assertEqual(client.post(API + "unsubscribe", {"token": "forged"}, format="json").status_code, 400)
        self.assertEqual(client.post(API + "unsubscribe", {"token": token}, format="json").status_code, 200)
        self.ana.refresh_from_db()
        self.assertFalse(self.ana.product_updates)
        self.assertEqual(client.post(API + "unsubscribe", {"token": token}, format="json").status_code, 200)

    def test_a_person_can_choose_product_updates_in_their_account(self):
        res = self.owner.client.patch(API + "auth/me", {"product_updates": True}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertTrue(res.json()["product_updates"])
        self.assertEqual(self.owner.client.patch(API + "auth/me", {"product_updates": "yes"}, format="json").status_code, 400)


class FlagTests(BackOfficeCase):
    def setUp(self):
        super().setUp()
        cache.clear()

    def ask(self, person=None, ws=None):
        res = (person or self.owner).client.get(API + "flags", {"workspace": ws or self.ws})
        self.assertEqual(res.status_code, 200, res.content)
        return res.json()["flags"]

    def test_everything_that_exists_is_on_by_default(self):
        got = self.ask()
        self.assertEqual(set(got), set(flags.KNOWN))
        self.assertTrue(all(got.values()))
        self.assertTrue(flags.flag_enabled("never_heard_of_it"))
        self.assertFalse(flags.flag_enabled("never_heard_of_it", default=False))

    def test_admin_switches_off_and_history_is_kept(self):
        res = self.admin.client.patch(self.url("flags/directory"), {"state": "off"}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["state"], "off")
        self.assertIn("state everyone to off", res.data["history"][0]["text"])
        self.assertFalse(self.ask()["directory"])
        listing = self.ro.client.get(self.url("flags")).data
        directory = next(f for f in listing["flags"] if f["key"] == "directory")
        self.assertEqual(directory["history"][0]["who"], "admin@ilaf.test")
        self.assertIn("flag.changed", self.audit_actions())

    def test_nobody_but_admin_edits(self):
        for person in (self.support, self.ro):
            self.assertEqual(person.client.patch(self.url("flags/directory"), {"state": "off"}, format="json").status_code, 403)
        self.assertEqual(FeatureFlag.objects.count(), 0)

    def test_selected_companies_only(self):
        self.admin.client.patch(self.url("flags/wallet_google"), {"state": "selected", "company_ids": [self.ws, "00000000-0000-0000-0000-000000000000"]}, format="json")
        self.assertEqual(FeatureFlag.objects.get(pk="wallet_google").company_ids, [self.ws])
        self.assertTrue(self.ask()["wallet_google"])
        other = self.signup("second@owner.test", "Second Owner")
        self.assertFalse(self.ask(other, other.ws)["wallet_google"])

    def test_rollout_percent_is_stable_per_company(self):
        self.admin.client.patch(self.url("flags/api_keys"), {"state": "everyone", "rollout_percent": 0}, format="json")
        self.assertFalse(self.ask()["api_keys"])
        self.admin.client.patch(self.url("flags/api_keys"), {"rollout_percent": 100}, format="json")
        self.assertTrue(self.ask()["api_keys"])
        first = [flags.in_rollout("x", f"00000000-0000-0000-0000-0000000000{i:02d}", 50) for i in range(40)]
        second = [flags.in_rollout("x", f"00000000-0000-0000-0000-0000000000{i:02d}", 50) for i in range(40)]
        self.assertEqual(first, second)
        self.assertTrue(0 < sum(first) < 40)

    def test_bad_values_are_refused_and_unknown_keys_are_404(self):
        self.assertEqual(self.admin.client.patch(self.url("flags/directory"), {"state": "maybe"}, format="json").status_code, 400)
        self.assertEqual(self.admin.client.patch(self.url("flags/directory"), {"rollout_percent": 101}, format="json").status_code, 400)
        self.assertEqual(self.admin.client.patch(self.url("flags/not_a_flag"), {"state": "off"}, format="json").status_code, 404)

    def test_the_customer_endpoint_is_not_for_other_peoples_companies(self):
        stranger = self.signup("nosy@person.test", "Nosy Person")
        self.assertEqual(stranger.client.get(API + "flags", {"workspace": self.ws}).status_code, 404)
        self.assertEqual(self.client_for().get(API + "flags").status_code, 401)

    def test_the_answer_is_cached_for_a_minute_and_a_change_clears_it(self):
        self.assertTrue(flags.flag_enabled("directory"))
        FeatureFlag.objects.create(key="directory", state="off")
        self.assertTrue(flags.flag_enabled("directory"), "cached answer")
        flags.clear_cache()
        self.assertFalse(flags.flag_enabled("directory"))

    def test_the_switched_off_features_are_really_refused(self):
        for key in ("wallet_google", "api_keys", "custom_designs", "crm_connectors", "directory"):
            self.admin.client.patch(self.url(f"flags/{key}"), {"state": "off"}, format="json")
        self.assertEqual(self.owner.client.get(f"{API}cards/{self.card['id']}/wallet/google").status_code in (403, 404), True)
        keys = self.owner.client.post(f"{API}workspaces/{self.ws}/api-keys", {"name": "x"}, format="json")
        self.assertEqual((keys.status_code, keys.json()["error"]["code"]), (403, "feature_unavailable"))
        design = self.owner.client.post(f"{API}workspaces/{self.ws}/design-requests", {"goals": "A calm dark card.", "languages": "both"}, format="json")
        self.assertEqual((design.status_code, design.json()["error"]["code"]), (403, "feature_unavailable"))
        crm = self.owner.client.post(f"{API}workspaces/{self.ws}/crm/hubspot/connect")
        self.assertEqual((crm.status_code, crm.json()["error"]["code"]), (403, "feature_unavailable"))


class AnalyticsAndBillingTests(BackOfficeCase):
    def test_analytics_has_every_block(self):
        from analytics.models import Event

        Event.objects.create(card_id=self.card["id"], type="view", country="QA", source="qr")
        Event.objects.create(card_id=self.card["id"], type="save", country="QA")
        res = self.ro.client.get(self.url("analytics"), {"weeks": "8"})
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(len(res.data["weeks"]), 8)
        this = res.data["weeks"][-1]
        self.assertEqual((this["views"], this["scans"], this["saves"], this["leads"], this["new_companies"]), (1, 1, 1, 1, 1))
        self.assertEqual(res.data["countries"][0], {"country": "QA", "views": 1})
        self.assertEqual(res.data["top_companies"][0]["name"], "Acme Ltd")
        self.assertEqual(sum(s["companies"] for s in res.data["sizes"]), 1)
        self.assertEqual(len(res.data["retention"]), 8)

    def test_retention_counts_companies_still_active_after_a_week(self):
        from analytics.models import Event
        from workspaces.models import Workspace

        from staff.common import week_start

        monday = week_start(timezone.now() - timedelta(weeks=3))
        Workspace.objects.filter(pk=self.ws).update(created_at=monday + timedelta(days=1))
        Event.objects.create(card_id=self.card["id"], type="view")
        Event.objects.filter(card_id=self.card["id"]).update(created_at=monday + timedelta(days=9))
        row = next(r for r in self.ro.client.get(self.url("analytics")).data["retention"] if r["companies"] == 1)
        self.assertEqual(row["after"]["1"], 100)
        self.assertIsNone(row["after"]["8"])

    def test_csv_is_for_support_and_admin_and_safe_in_a_spreadsheet(self):
        self.assertEqual(self.ro.client.get(self.url("analytics/export")).status_code, 403)
        res = self.admin.client.get(self.url("analytics/export"))
        self.assertEqual(res.status_code, 200)
        self.assertIn("Week starting", res.content.decode("utf-8-sig"))
        from staff.common import csv_safe

        self.assertEqual(csv_safe("=SUM(A1)"), "'=SUM(A1)")
        self.assertEqual(csv_safe("plain"), "plain")
        self.assertIn("analytics.exported", self.audit_actions())

    def test_billing_page_is_read_only_and_has_the_plans_and_the_summary(self):
        res = self.ro.client.get(self.url("billing"))
        self.assertNotIn("payments_parked", res.data)
        self.assertTrue(any(p["code"] == "company" for p in res.data["plans"]))
        self.assertEqual(res.data["summary"]["currency"], "QAR")

    def test_only_admin_grants_a_plan_period_and_it_is_logged(self):
        before = Payment.objects.count()
        body = {"company_id": self.ws, "plan_code": "company", "seats": 8, "reason": "Pilot customer before the first payment"}
        self.assertEqual(self.support.client.post(self.url("billing/grant"), body, format="json").status_code, 403)
        self.assertEqual(Payment.objects.count(), before)
        res = self.admin.client.post(self.url("billing/grant"), body, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(Payment.objects.filter(source="manual").count(), 1)
        self.assertIn("plan.granted", self.audit_actions())
        self.assertEqual(self.admin.client.get(self.url("billing")).data["grants"][0]["company"], "Acme Ltd")
        self.assertEqual(self.admin.client.post(self.url("billing/grant"), {**body, "reason": "x"}, format="json").status_code, 400)
        self.assertEqual(self.admin.client.post(self.url("billing/grant"), {**body, "plan_code": "nope"}, format="json").status_code, 400)
