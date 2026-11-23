import io
import json
import shutil
import tempfile
import zipfile
from datetime import timedelta

from django.core import mail
from django.core.files.storage import default_storage
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from cards.models import Card
from leads.models import Lead
from operations.models import AuditEvent
from privacy.models import DataRequest
from privacy import services
from workspaces.models import Member, Workspace

from .base import API, ApiTestCase, png_upload


class PrivacyBase(ApiTestCase):
    def signup(self, email="alice@example.com", name="Alice Anderson"):
        person = super().signup(email, name)
        self.buy(person, "business")  # a plan with room for several cards
        return person

    def setUp(self):
        super().setUp()
        self.export_dir = tempfile.mkdtemp(prefix="ilaf-test-exports-")
        self.addCleanup(shutil.rmtree, self.export_dir, True)
        override = override_settings(EXPORT_ROOT=self.export_dir)
        override.enable()
        self.addCleanup(override.disable)

    def export(self, person, **body):
        return person.client.post(API + "privacy/export", body, format="json")

    def token_from_mail(self):
        body = [m for m in mail.outbox if "/data-download/" in m.body][-1].body
        return body.split("/data-download/")[1].split()[0]

    def download(self, token):
        return APIClient().get(f"{API}privacy/download/{token}")

    def zip_of(self, response):
        return zipfile.ZipFile(io.BytesIO(b"".join(response.streaming_content)))

    def lead(self, code, name="Visitor Vera", email="vera@example.com"):
        res = APIClient().post(
            f"{API}public/cards/{code}/leads", {"name": name, "email": email, "consent": True, "website_url": ""}, format="json"
        )
        self.assertEqual(res.status_code, 201, res.content)

    def scheduled_email(self):
        return [m for m in mail.outbox if "scheduled for deletion" in m.subject]


class ExportTests(PrivacyBase):
    def test_small_account_is_exported_at_once_and_emailed(self):
        alice = self.signup("alice@example.com")
        card = self.published_card(alice)
        alice.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload()}, format="multipart")
        res = self.export(alice)
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["kind"], "export")
        self.assertEqual(res.data["status"], "ready")
        self.assertTrue(res.data["download_available"])
        self.assertIsNotNone(res.data["expires_at"])
        email = mail.outbox[-1]
        self.assertIn("data export is ready", email.subject)
        self.assertIn("/data-download/", email.body)
        self.assertEqual(email.to, ["alice@example.com"])

    def test_zip_contents(self):
        alice = self.signup("alice@example.com")
        card = self.published_card(alice, name="Alice A")
        alice.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload()}, format="multipart")
        self.lead(card["public_code"])
        APIClient().post(f"{API}public/cards/{card['public_code']}/events", {"type": "view", "source": "qr"}, format="json")
        self.export(alice)
        res = self.download(self.token_from_mail())
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res["Content-Type"], "application/zip")
        self.assertIn("attachment", res["Content-Disposition"])
        archive = self.zip_of(res)
        names = archive.namelist()
        for expected in ("README.txt", "profile.json", "workspaces.json", "cards.json", "leads.json", "analytics.json",
                         "audit.json", "consents.json"):
            self.assertIn(expected, names)
        self.assertTrue(any(n.startswith("media/cards/") for n in names), names)
        profile = json.loads(archive.read("profile.json"))
        self.assertEqual(profile["email"], "alice@example.com")
        self.assertNotIn("password", profile)
        cards = json.loads(archive.read("cards.json"))
        self.assertEqual(cards[0]["name"], "Alice A")
        self.assertIn("items", cards[0])
        self.assertIn("design", cards[0])
        self.assertIn("/c/", cards[0]["public_url"])
        leads = json.loads(archive.read("leads.json"))
        self.assertEqual(leads[0]["email"], "vera@example.com")
        analytics = json.loads(archive.read("analytics.json"))
        self.assertEqual(analytics[card["id"]]["views"], 1)
        consents = json.loads(archive.read("consents.json"))
        self.assertEqual(len(consents["lead_consents"]), 1)
        self.assertEqual(consents["data_requests"][0]["kind"], "export")
        readme = archive.read("README.txt").decode()
        self.assertIn("cards.json", readme)
        self.assertNotIn("password hash", readme.split("Not included")[0])

    def test_link_works_once(self):
        alice = self.signup("alice@example.com")
        self.export(alice)
        token = self.token_from_mail()
        self.assertEqual(APIClient().get(f"{API}privacy/download/{token}/check").status_code, 200)
        self.assertEqual(APIClient().get(f"{API}privacy/download/{token}/check").status_code, 200)  # checking never uses it up
        self.assertEqual(self.download(token).status_code, 200)
        again = self.download(token)
        self.assertEqual(again.status_code, 410)
        self.assertEqual(again.data["error"]["code"], "download_used")
        self.assertEqual(DataRequest.objects.get(user__email="alice@example.com").status, "completed")

    def test_link_expires_after_24_hours_and_tampering_fails(self):
        alice = self.signup("alice@example.com")
        self.export(alice)
        token = self.token_from_mail()
        DataRequest.objects.update(expires_at=timezone.now() - timedelta(minutes=1))
        res = self.download(token)
        self.assertEqual(res.status_code, 410)
        self.assertEqual(res.data["error"]["code"], "download_expired")
        self.assertEqual(self.download(token[:-3] + "xyz").status_code, 410)
        self.assertEqual(self.download("garbage").status_code, 410)

    def test_signed_token_age_limit(self):
        alice = self.signup("alice@example.com")
        self.export(alice)
        token = self.token_from_mail()
        with override_settings(EXPORT_LINK_HOURS=0):
            res = self.download(token)
        self.assertEqual(res.status_code, 410)
        self.assertEqual(res.data["error"]["code"], "download_expired")

    def test_three_exports_a_day(self):
        alice = self.signup("alice@example.com")
        for _ in range(3):
            res = self.export(alice)
            self.assertEqual(res.status_code, 201)
            self.assertEqual(self.download(self.token_from_mail()).status_code, 200)
        res = self.export(alice)
        self.assertEqual(res.status_code, 429)
        self.assertEqual(res.data["error"]["code"], "export_limit")
        # A different person is not affected, and yesterday's requests do not count.
        self.assertEqual(self.export(self.signup("bob@example.com")).status_code, 201)
        DataRequest.objects.filter(user__email="alice@example.com").update(requested_at=timezone.now() - timedelta(days=2))
        self.assertEqual(self.export(alice).status_code, 201)

    def test_asking_again_while_one_is_ready_returns_it(self):
        alice = self.signup("alice@example.com")
        first = self.export(alice)
        second = self.export(alice)
        self.assertEqual(second.status_code, 200)
        self.assertEqual(first.data["id"], second.data["id"])
        self.assertEqual(DataRequest.objects.count(), 1)

    def test_big_accounts_wait_for_the_command(self):
        alice = self.signup("alice@example.com")
        self.make_card(alice)
        with override_settings(EXPORT_SYNC_MAX_CARDS=0):
            res = self.export(alice)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "pending")
        self.assertFalse(res.data["download_available"])
        self.assertEqual(len(mail.outbox), 0)
        call_command("process_data_requests", verbosity=0)
        listing = alice.client.get(API + "privacy/requests").data
        self.assertEqual(listing[0]["status"], "ready")
        self.assertIn("/data-download/", mail.outbox[-1].body)
        self.assertEqual(self.download(self.token_from_mail()).status_code, 200)

    def test_stuck_processing_is_retried(self):
        alice = self.signup("alice@example.com")
        self.make_card(alice)
        with override_settings(EXPORT_SYNC_MAX_CARDS=0):
            self.export(alice)
        DataRequest.objects.update(status="processing", requested_at=timezone.now() - timedelta(hours=1))
        call_command("process_data_requests", verbosity=0)
        self.assertEqual(DataRequest.objects.get().status, "ready")

    def test_cleanup_deletes_files_after_use_and_after_expiry(self):
        alice = self.signup("alice@example.com")
        self.export(alice)
        dr = DataRequest.objects.get()
        storage = services.export_storage()
        self.assertTrue(storage.exists(dr.file_name))
        call_command("cleanup_data_exports", verbosity=0)
        self.assertTrue(storage.exists(dr.file_name))  # still valid
        name = dr.file_name
        DataRequest.objects.update(expires_at=timezone.now() - timedelta(hours=1))
        call_command("cleanup_data_exports", verbosity=0)
        self.assertFalse(storage.exists(name))
        dr.refresh_from_db()
        self.assertEqual(dr.status, "expired")
        self.assertEqual(dr.file_name, "")
        # A downloaded export is removed on the next run too.
        self.export(alice)
        self.download(self.token_from_mail()).close()  # an open file cannot be deleted on Windows
        name = DataRequest.objects.get(status="completed").file_name
        call_command("cleanup_data_exports", verbosity=0)
        self.assertFalse(storage.exists(name))

    def test_export_files_are_private(self):
        alice = self.signup("alice@example.com")
        self.export(alice)
        dr = DataRequest.objects.get()
        self.assertNotIn(self.export_dir, str(default_storage.base_location))
        self.assertTrue(dr.file_name.endswith(".zip"))

    def test_download_link_endpoint_is_for_the_owner_only(self):
        alice = self.signup("alice@example.com")
        bob = self.signup("bob@example.com")
        data = self.export(alice).data
        res = alice.client.post(f"{API}privacy/requests/{data['id']}/download-link")
        self.assertEqual(res.status_code, 200)
        self.assertIn("/data-download/", res.data["url"])
        self.assertEqual(self.download(res.data["url"].split("/data-download/")[1]).status_code, 200)
        self.assertEqual(bob.client.post(f"{API}privacy/requests/{data['id']}/download-link").status_code, 404)
        self.assertEqual(alice.client.post(f"{API}privacy/requests/{data['id']}/download-link").status_code, 409)  # used
        self.assertEqual(bob.client.get(API + "privacy/requests").data, [])

    def test_endpoints_need_sign_in_but_download_does_not(self):
        for method, path in (("get", "privacy/requests"), ("post", "privacy/export"), ("post", "privacy/delete-account")):
            self.assertEqual(getattr(APIClient(), method)(API + path).status_code, 401)

    def test_data_request_record_for_staff(self):
        alice = self.signup("alice@example.com")
        self.export(alice)
        dr = DataRequest.objects.get()
        self.assertEqual(dr.kind, "export")
        self.assertEqual(dr.scope, "user")
        self.assertIsNone(dr.handled_by)
        self.assertAlmostEqual((dr.due_at - dr.requested_at).days, 30, delta=1)

    def test_company_export_is_owner_only_and_has_team_leads_and_log(self):
        owner = self.signup("owner@acme.com", "Olive Owner")
        ws = self.company(owner)
        eve = self.join(self.invite(owner, ws, "eve@acme.com", role="admin"))
        emp = self.join(self.invite(owner, ws, "emp@acme.com"))
        card = self.published_card(owner, ws=ws, name="Olive")
        self.lead(card["public_code"], "Lead Larry", "larry@example.com")
        for person in (eve, emp):
            res = person.client.post(API + "privacy/export", {"workspace_id": ws}, format="json")
            self.assertEqual(res.status_code, 403)
        res = owner.client.post(API + "privacy/export", {"workspace_id": ws}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["scope"], "workspace")
        archive = self.zip_of(self.download(self.token_from_mail()))
        for expected in ("README.txt", "company.json", "team.json", "cards.json", "leads.json", "activity_log.json"):
            self.assertIn(expected, archive.namelist())
        team = json.loads(archive.read("team.json"))
        self.assertEqual({m["email"] for m in team}, {"owner@acme.com", "eve@acme.com", "emp@acme.com"})
        self.assertTrue(all("invite_token" not in m for m in team))
        self.assertEqual(json.loads(archive.read("leads.json"))[0]["email"], "larry@example.com")
        self.assertTrue(len(json.loads(archive.read("activity_log.json"))) >= 2)
        # Personal workspaces cannot be exported through the company route.
        res = owner.client.post(API + "privacy/export", {"workspace_id": owner.ws}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_company_export_for_a_stranger_is_404(self):
        owner = self.signup("owner@acme.com")
        ws = self.company(owner)
        mallory = self.signup("mallory@example.com")
        res = mallory.client.post(API + "privacy/export", {"workspace_id": ws}, format="json")
        self.assertEqual(res.status_code, 404)


class DeleteAccountTests(PrivacyBase):
    def delete(self, person, **body):
        body.setdefault("confirm", "DELETE")
        body.setdefault("password", self.password)
        return person.client.post(API + "privacy/delete-account", body, format="json")

    def test_needs_the_word_and_the_password(self):
        alice = self.signup("alice@example.com")
        self.assertEqual(self.delete(alice, confirm="delete").status_code, 400)
        self.assertEqual(self.delete(alice, confirm="").status_code, 400)
        res = self.delete(alice, password="wrong-pass-1")
        self.assertEqual(res.status_code, 400)
        self.assertIn("password", res.data["error"]["fields"])
        res = alice.client.post(API + "privacy/delete-account", {"confirm": "DELETE"}, format="json")
        self.assertEqual(res.status_code, 400)
        self.assertTrue(User.objects.get(email="alice@example.com").is_active)

    def test_account_is_disabled_at_once(self):
        alice = self.signup("alice@example.com")
        card = self.published_card(alice)
        res = self.delete(alice)
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(res.data["kind"], "delete")
        self.assertEqual(res.data["status"], "pending")
        self.assertIsNotNone(res.data["scheduled_for"])
        user = User.objects.get(email="alice@example.com")
        self.assertFalse(user.is_active)
        self.assertAlmostEqual((user.deletion_due_at - timezone.now()).days, 13, delta=1)
        self.assertEqual(Card.objects.get(pk=card["id"]).status, "draft")
        # Existing sessions stop working.
        self.assertEqual(alice.client.get(API + "auth/me").status_code, 401)
        refresh = APIClient().post(API + "auth/refresh", {"refresh": alice.refresh}, format="json")
        self.assertEqual(refresh.status_code, 401)
        # The public card is no longer live.
        public = APIClient().get(f"{API}public/cards/{card['public_code']}")
        self.assertNotEqual(public.data.get("state"), "live")
        scheduled = self.scheduled_email()
        self.assertEqual(len(scheduled), 1)
        self.assertIn("/restore/", scheduled[0].body)

    def test_login_says_scheduled_only_with_the_right_password(self):
        alice = self.signup("alice@example.com")
        self.delete(alice)
        res = APIClient().post(API + "auth/login", {"email": "alice@example.com", "password": self.password}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "account_scheduled_for_deletion")
        self.assertIn("restore_until", res.data["error"]["fields"])
        res = APIClient().post(API + "auth/login", {"email": "alice@example.com", "password": "nope-nope-1"}, format="json")
        self.assertEqual(res.status_code, 401)
        self.assertEqual(res.data["error"]["code"], "invalid_credentials")

    def test_restore_with_the_emailed_link_republishes_cards(self):
        alice = self.signup("alice@example.com")
        live = self.published_card(alice)
        draft = self.make_card(alice, name="Draft only")
        self.delete(alice)
        token = self.scheduled_email()[0].body.split("/restore/")[1].split()[0]
        res = APIClient().post(API + "auth/restore", {"token": token}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        self.assertIn("access", res.data)
        self.assertEqual(self.client_for(res.data["access"]).get(API + "auth/me").status_code, 200)
        self.assertEqual(Card.objects.get(pk=live["id"]).status, "published")
        self.assertEqual(Card.objects.get(pk=draft["id"]).status, "draft")
        user = User.objects.get(email="alice@example.com")
        self.assertTrue(user.is_active)
        self.assertIsNone(user.deletion_due_at)
        self.assertEqual(DataRequest.objects.get(kind="delete").status, "cancelled")
        self.assertTrue(any("account is back" in m.subject for m in mail.outbox))
        # The link cannot be used again.
        again = APIClient().post(API + "auth/restore", {"token": token}, format="json")
        self.assertEqual(again.status_code, 410)

    def test_restore_with_password(self):
        alice = self.signup("alice@example.com")
        self.delete(alice)
        bad = APIClient().post(API + "auth/restore", {"email": "alice@example.com", "password": "nope-nope-1"}, format="json")
        self.assertEqual(bad.status_code, 401)
        ok = APIClient().post(API + "auth/restore", {"email": "alice@example.com", "password": self.password}, format="json")
        self.assertEqual(ok.status_code, 200)
        self.assertTrue(User.objects.get(email="alice@example.com").is_active)

    def test_restore_after_the_grace_period_is_refused(self):
        alice = self.signup("alice@example.com")
        self.delete(alice)
        User.objects.update(deletion_due_at=timezone.now() - timedelta(minutes=1))
        res = APIClient().post(API + "auth/restore", {"email": "alice@example.com", "password": self.password}, format="json")
        self.assertEqual(res.status_code, 410)

    def test_restore_does_not_unsuspend_other_accounts(self):
        alice = self.signup("alice@example.com")
        User.objects.filter(email="alice@example.com").update(is_active=False)
        res = APIClient().post(API + "auth/restore", {"email": "alice@example.com", "password": self.password}, format="json")
        self.assertEqual(res.status_code, 410)
        self.assertFalse(User.objects.get(email="alice@example.com").is_active)
        self.assertEqual(alice.email, "alice@example.com")

    def test_nothing_is_erased_before_the_grace_period_ends(self):
        alice = self.signup("alice@example.com")
        self.delete(alice)
        call_command("purge_deleted_accounts", verbosity=0)
        user = User.objects.get(email="alice@example.com")
        self.assertIsNone(user.deleted_at)

    def test_purge_erases_and_anonymises(self):
        alice = self.signup("alice@example.com", "Alice Anderson")
        card = self.published_card(alice)
        alice.client.post(f"{API}cards/{card['id']}/photo", {"file": png_upload()}, format="multipart")
        photo_name = Card.objects.get(pk=card["id"]).photo.name
        self.assertTrue(default_storage.exists(photo_name))
        self.lead(card["public_code"])
        self.export(alice)
        export_name = DataRequest.objects.get(kind="export").file_name
        self.delete(alice)
        user = User.objects.get(email="alice@example.com")
        User.objects.filter(pk=user.pk).update(deletion_due_at=timezone.now() - timedelta(minutes=1))
        personal = Workspace.objects.get(created_by=user)
        call_command("purge_deleted_accounts", verbosity=0)
        user.refresh_from_db()
        self.assertTrue(user.email.endswith("@deleted.invalid"))
        self.assertNotIn("alice", user.email)
        self.assertEqual(user.full_name, "")
        self.assertFalse(user.has_usable_password())
        self.assertFalse(user.is_active)
        self.assertIsNotNone(user.deleted_at)
        self.assertIsNone(user.google_sub)
        self.assertFalse(Card.objects.filter(pk=card["id"]).exists())
        self.assertFalse(Lead.objects.exists())  # a personal workspace's leads go with it
        self.assertFalse(default_storage.exists(photo_name))
        self.assertFalse(services.export_storage().exists(export_name))
        personal.refresh_from_db()
        self.assertEqual(personal.name, "Deleted account")
        self.assertIsNotNone(personal.deleted_at)
        self.assertFalse(Member.objects.filter(user=user).exists())
        self.assertEqual(DataRequest.objects.get(kind="delete").status, "completed")
        self.assertIsNotNone(DataRequest.objects.get(kind="delete").completed_at)
        done = [m for m in mail.outbox if "account was deleted" in m.subject]
        self.assertEqual(done[0].to, ["alice@example.com"])
        # The same address can sign up again as a new person.
        again = self.signup("alice@example.com", "Alice Again")
        self.assertNotEqual(again.user["id"], str(user.id))
        # Running the command twice is harmless.
        call_command("purge_deleted_accounts", verbosity=0)

    def test_purge_keeps_company_leads_and_audit_rows(self):
        owner = self.signup("owner@acme.com", "Olive Owner")
        ws = self.company(owner)
        eve = self.join(self.invite(owner, ws, "eve@acme.com", full_name="Eve Employee"), full_name="Eve Employee")
        member = Member.objects.get(workspace_id=ws, email="eve@acme.com")
        card = Card.objects.get(member=member)
        owner.client.post(f"{API}cards/{card.id}/publish")
        self.lead(card.public_code, "Company Lead", "lead@example.com")
        eve_user = member.user
        # An audit row written by Eve and one that names her.
        AuditEvent.objects.create(workspace_id=ws, actor=eve_user, actor_email="eve@acme.com", actor_name="Eve Employee",
                                  action="brand.updated", details={})
        res = eve.client.post(API + "privacy/delete-account", {"confirm": "DELETE", "password": "employee-pass-1"}, format="json")
        self.assertEqual(res.status_code, 202, res.content)
        User.objects.filter(pk=eve_user.pk).update(deletion_due_at=timezone.now() - timedelta(minutes=1))
        call_command("purge_deleted_accounts", verbosity=0)
        # The company still has the lead; its link to the deleted card is cut and the card name made anonymous.
        lead = Lead.objects.get()
        self.assertIsNone(lead.card_id)
        self.assertEqual(lead.workspace_id.hex, ws.replace("-", ""))
        self.assertEqual(lead.card_name, "Deleted card")
        self.assertEqual(lead.email, "lead@example.com")
        shown = owner.client.get(f"{API}workspaces/{ws}/leads").data["results"]
        self.assertEqual([x["name"] for x in shown], ["Company Lead"])
        # Audit rows keep the actor id but no longer carry a name or address.
        mine = AuditEvent.objects.get(action="brand.updated")
        self.assertEqual(mine.actor_id, eve_user.id)
        self.assertEqual((mine.actor_name, mine.actor_email), ("", ""))
        invite_event = AuditEvent.objects.get(action="invite.sent")
        self.assertEqual(invite_event.target_label, "")
        self.assertNotIn("email", invite_event.details)
        # The seat is gone, so it is free again, and the company itself is untouched.
        self.assertFalse(Member.objects.filter(workspace_id=ws, email="eve@acme.com").exists())
        self.assertFalse(Card.objects.filter(pk=card.pk).exists())
        self.assertEqual(Workspace.objects.get(pk=ws).name, "Acme Ltd")

    def test_company_owner_with_a_team_cannot_delete_the_account(self):
        owner = self.signup("owner@acme.com")
        ws = self.company(owner)
        self.invite(owner, ws, "eve@acme.com")
        res = self.delete(owner)
        self.assertEqual(res.status_code, 409)
        self.assertEqual(res.data["error"]["code"], "owns_company")
        self.assertEqual(res.data["error"]["fields"]["companies"], ["Acme Ltd"])
        self.assertTrue(User.objects.get(email="owner@acme.com").is_active)
        # Once the company is scheduled for deletion the account may follow.
        self.assertEqual(owner.client.post(
            f"{API}privacy/workspaces/{ws}/delete", {"confirm_name": "Acme Ltd", "password": self.password}, format="json"
        ).status_code, 202)
        self.assertEqual(self.delete(owner).status_code, 202)

    def test_owner_of_a_company_with_nobody_else_can_delete_and_it_is_erased_too(self):
        owner = self.signup("owner@acme.com")
        ws = self.company(owner, "Solo Ltd", seats=5)
        self.published_card(owner, ws=ws)
        self.assertEqual(self.delete(owner).status_code, 202)
        User.objects.update(deletion_due_at=timezone.now() - timedelta(minutes=1))
        call_command("purge_deleted_accounts", verbosity=0)
        self.assertEqual(Workspace.objects.get(pk=ws).name, "Deleted company")
        self.assertFalse(Card.objects.exists())

    def test_purge_refuses_while_the_account_still_owns_a_team(self):
        owner = self.signup("owner@acme.com")
        ws = self.company(owner)
        self.assertEqual(self.delete(owner).status_code, 202)  # alone at the time
        self.invite_after_deletion(ws)
        User.objects.update(deletion_due_at=timezone.now() - timedelta(minutes=1))
        call_command("purge_deleted_accounts", verbosity=0)
        user = User.objects.get(email="owner@acme.com")
        self.assertIsNone(user.deleted_at)
        self.assertEqual(Workspace.objects.get(pk=ws).name, "Acme Ltd")

    def invite_after_deletion(self, ws):
        Member.objects.create(workspace_id=ws, email="late@acme.com", role="employee", status="invited")


class DeleteCompanyTests(PrivacyBase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@acme.com", "Olive Owner")
        self.ws = self.company(self.owner)
        self.admin = self.join(self.invite(self.owner, self.ws, "admin@acme.com", role="admin"), "admin-pass-1")
        self.emp = self.join(self.invite(self.owner, self.ws, "emp@acme.com"), "emp-pass-1")
        self.card = self.published_card(self.owner, ws=self.ws, name="Olive")

    def delete(self, person=None, **body):
        body.setdefault("confirm_name", "Acme Ltd")
        body.setdefault("password", self.password)
        return (person or self.owner).client.post(f"{API}privacy/workspaces/{self.ws}/delete", body, format="json")

    def test_owner_only_with_the_name_and_password(self):
        self.assertEqual(self.delete(self.admin, password="admin-pass-1").status_code, 403)
        self.assertEqual(self.delete(self.emp, password="emp-pass-1").status_code, 403)
        self.assertEqual(self.delete(confirm_name="acme ltd").status_code, 400)
        self.assertEqual(self.delete(confirm_name="").status_code, 400)
        self.assertEqual(self.delete(password="wrong-pass-1").status_code, 400)
        self.assertEqual(self.delete(password="").status_code, 400)
        self.assertIsNone(Workspace.objects.get(pk=self.ws).deletion_due_at)
        stranger = self.signup("x@example.com")
        self.assertEqual(self.delete(stranger).status_code, 404)

    def test_personal_workspaces_cannot_be_deleted_this_way(self):
        res = self.owner.client.post(
            f"{API}privacy/workspaces/{self.owner.ws}/delete", {"confirm_name": "Olive Owner", "password": self.password}, format="json"
        )
        self.assertEqual(res.status_code, 400)

    def test_grace_period_closes_the_company_and_unpublishes_cards(self):
        res = self.delete()
        self.assertEqual(res.status_code, 202, res.content)
        self.assertEqual(res.data["scope"], "workspace")
        ws = Workspace.objects.get(pk=self.ws)
        self.assertIsNotNone(ws.deletion_due_at)
        self.assertEqual(Card.objects.get(pk=self.card["id"]).status, "draft")
        # Team members are locked out; the owner still sees the company with the due date.
        self.assertEqual(self.emp.client.get(f"{API}workspaces/{self.ws}").status_code, 403)
        self.assertEqual(self.admin.client.get(f"{API}workspaces/{self.ws}").data["error"]["code"], "workspace_pending_deletion")
        shown = self.owner.client.get(f"{API}workspaces/{self.ws}")
        self.assertEqual(shown.status_code, 200)
        self.assertIsNotNone(shown.data["deletion_due_at"])
        # Emails: the owner and the team hear about it.
        recipients = {m.to[0] for m in mail.outbox if "scheduled for deletion" in m.subject}
        self.assertEqual(recipients, {"owner@acme.com", "admin@acme.com", "emp@acme.com"})
        self.assertEqual(self.delete().status_code, 409)
        self.assertTrue(AuditEvent.objects.filter(action="company.deletion_requested").exists())

    def test_restore_brings_everything_back(self):
        self.delete()
        self.assertEqual(self.admin.client.post(f"{API}privacy/workspaces/{self.ws}/restore").status_code, 403)
        res = self.owner.client.post(f"{API}privacy/workspaces/{self.ws}/restore")
        self.assertEqual(res.status_code, 200)
        self.assertIsNone(Workspace.objects.get(pk=self.ws).deletion_due_at)
        self.assertEqual(Card.objects.get(pk=self.card["id"]).status, "published")
        self.assertEqual(self.emp.client.get(f"{API}workspaces/{self.ws}").status_code, 200)
        self.assertEqual(DataRequest.objects.get(kind="delete", scope="workspace").status, "cancelled")
        self.assertTrue(any("was restored" in m.subject for m in mail.outbox))
        self.assertEqual(self.owner.client.post(f"{API}privacy/workspaces/{self.ws}/restore").status_code, 410)

    def test_purge_after_the_grace_period(self):
        self.lead(self.card["public_code"])
        photo_ws = Workspace.objects.get(pk=self.ws)
        self.owner.client.post(f"{API}workspaces/{self.ws}/logo", {"file": png_upload()}, format="multipart")
        photo_ws.refresh_from_db()
        logo = photo_ws.logo.name
        self.assertTrue(logo and default_storage.exists(logo))
        self.delete()
        call_command("purge_deleted_accounts", verbosity=0)
        self.assertIsNone(Workspace.objects.get(pk=self.ws).deleted_at)  # not yet due
        Workspace.objects.filter(pk=self.ws).update(deletion_due_at=timezone.now() - timedelta(minutes=1))
        call_command("purge_deleted_accounts", verbosity=0)
        ws = Workspace.objects.get(pk=self.ws)
        self.assertIsNotNone(ws.deleted_at)
        self.assertEqual(ws.name, "Deleted company")
        self.assertEqual(ws.brand, {})
        self.assertFalse(Card.objects.filter(workspace=ws).exists())
        self.assertFalse(Lead.objects.exists())
        self.assertFalse(Member.objects.filter(workspace=ws).exists())
        self.assertFalse(AuditEvent.objects.filter(workspace=ws).exists())
        self.assertFalse(default_storage.exists(logo))
        self.assertEqual(DataRequest.objects.get(kind="delete", scope="workspace").status, "completed")
        self.assertTrue(any("company was deleted" in m.subject for m in mail.outbox))
        # Invoices still point at the empty shell, and the owner's own account is untouched.
        self.assertTrue(ws.payments.exists())
        self.assertTrue(User.objects.get(email="owner@acme.com").is_active)
        self.assertEqual(self.owner.client.get(API + "me/workspaces").data[0]["kind"], "personal")

    def test_export_suggestion_flow_works_before_deleting(self):
        res = self.owner.client.post(API + "privacy/export", {"workspace_id": self.ws}, format="json")
        self.assertEqual(res.status_code, 201)
        self.assertEqual(self.delete().status_code, 202)
        # The export is still downloadable during the grace period.
        self.assertEqual(self.download(self.token_from_mail()).status_code, 200)
