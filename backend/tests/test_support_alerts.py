"""The staff alert counters for the bell: new requests, customer replies and live chats waiting."""
from accounts.models import User
from support.models import ChatMessage, ChatSession, SupportTicket

from .base import API
from .support_base import SupportTestCase

URL = API + "staff/support/alerts"


class AlertsTests(SupportTestCase):
    def alerts(self, person=None):
        res = (person or self.agent).client.get(URL)
        self.assertEqual(res.status_code, 200, res.content)
        return res.data

    def reply(self, ticket_id, body="We are looking into it.", internal=False):
        res = self.agent.client.post(self.staff_url(ticket_id, "/reply"), {"body": body, "internal": internal}, format="json")
        self.assertEqual(res.status_code, 201, res.content)

    def chat(self, messages, status="waiting", **extra):
        user = extra.pop("user", None) or User.objects.get(email="alice@example.com")
        session = ChatSession.objects.create(user=user, status=status, **extra)
        for kind, body in messages:
            ChatMessage.objects.create(session=session, author_kind=kind, body=body)
        return session

    def test_empty(self):
        self.assertEqual(self.alerts(), {"new_tickets": 0, "customer_replies": 0, "chats_waiting": 0, "total": 0, "latest": []})

    def test_new_ticket_counts_until_answered(self):
        t = self.new_ticket()
        data = self.alerts()
        self.assertEqual((data["new_tickets"], data["customer_replies"], data["chats_waiting"], data["total"]), (1, 0, 0, 1))
        item = data["latest"][0]
        self.assertEqual((item["kind"], item["id"], item["subject"], item["requester_name"]), ("ticket", t["id"], "My card will not save", "Alice Anderson"))
        self.assertTrue(item["label"].startswith("BNC-"))
        self.reply(t["id"])
        self.assertEqual(self.alerts()["total"], 0)

    def test_assigned_ticket_is_not_new(self):
        t = self.new_ticket()
        res = self.agent.client.patch(self.staff_url(t["id"]), {"assigned_to": str(self.agent.user.id)}, format="json")
        self.assertEqual(res.status_code, 200, res.content)
        SupportTicket.objects.filter(pk=t["id"]).update(status="new")
        self.assertEqual(self.alerts()["new_tickets"], 0)

    def test_customer_reply_counts_after_staff_reply(self):
        t = self.new_ticket()
        self.reply(t["id"])
        res = self.alice.client.post(f"{API}support/tickets/{t['id']}/messages", {"body": "still broken"}, format="json")
        self.assertEqual(res.status_code, 201, res.content)
        data = self.alerts()
        self.assertEqual((data["new_tickets"], data["customer_replies"], data["total"]), (0, 1, 1))
        self.assertEqual(data["latest"][0]["kind"], "reply")
        self.reply(t["id"], "Fixed in the next release.")
        self.assertEqual(self.alerts()["total"], 0)

    def test_internal_note_does_not_count_or_clear(self):
        t = self.new_ticket()
        self.reply(t["id"])
        self.alice.client.post(f"{API}support/tickets/{t['id']}/messages", {"body": "still broken"}, format="json")
        self.reply(t["id"], "Note for the team", internal=True)
        self.assertEqual(self.alerts()["customer_replies"], 1)
        fresh = self.new_ticket(subject="Another one")
        self.reply(fresh["id"], "A private note", internal=True)
        self.assertEqual(self.alerts()["new_tickets"], 1)

    def test_solved_merged_and_spam_are_not_counted(self):
        a, b, c = self.new_ticket(), self.new_ticket(subject="Two"), self.new_ticket(subject="Three")
        SupportTicket.objects.filter(pk=a["id"]).update(status="solved")
        SupportTicket.objects.filter(pk=b["id"]).update(spam=True)
        SupportTicket.objects.filter(pk=c["id"]).update(merged_into=a["id"])
        self.assertEqual(self.alerts()["total"], 0)

    def test_chat_waiting_until_staff_answers(self):
        waiting = self.chat([("customer", "Hello, I need help")])
        data = self.alerts()
        self.assertEqual((data["chats_waiting"], data["total"]), (1, 1))
        item = data["latest"][0]
        self.assertEqual((item["kind"], item["id"], item["subject"], item["requester_name"]), ("chat", str(waiting.id), "Hello, I need help", "Alice Anderson"))
        ChatMessage.objects.create(session=waiting, author_kind="staff", body="Hi Alice")
        ChatMessage.objects.create(session=waiting, author_kind="system", body="accepted")
        ChatSession.objects.filter(pk=waiting.pk).update(status="active")
        self.assertEqual(self.alerts()["chats_waiting"], 0)
        ChatMessage.objects.create(session=waiting, author_kind="customer", body="One more thing")
        data = self.alerts()
        self.assertEqual(data["chats_waiting"], 1)
        self.assertEqual(data["latest"][0]["subject"], "One more thing")

    def test_ended_chat_and_chat_without_messages_not_counted(self):
        self.chat([("customer", "Bye")], status="ended")
        self.chat([("customer", "Ghost")], status="offline_converted")
        ChatSession.objects.create(user=User.objects.get(email="bob@example.com"), status="waiting")
        self.assertEqual(self.alerts()["chats_waiting"], 0)

    def test_latest_is_newest_first_and_capped(self):
        for i in range(5):
            self.new_ticket(subject=f"Request {i}")
        data = self.alerts()
        self.assertEqual(data["new_tickets"], 5)
        stamps = [i["created_at"] for i in data["latest"]]
        self.assertEqual(stamps, sorted(stamps, reverse=True))
        self.chat([("customer", "Hi 1")])
        self.chat([("customer", "Hi 2")], user=User.objects.get(email="bob@example.com"))
        data = self.alerts()
        self.assertEqual(data["total"], 7)
        self.assertEqual(len(data["latest"]), 6)
        self.assertEqual(data["latest"][0]["kind"], "chat")

    def test_every_staff_role_may_read(self):
        self.new_ticket()
        for person in (self.admin, self.agent, self.viewer):
            self.assertEqual(self.alerts(person)["new_tickets"], 1)

    def test_read_only_cannot_write_but_alerts_is_get_only(self):
        self.assertEqual(self.viewer.client.post(URL, {}, format="json").status_code, 403)

    def test_customer_gets_404(self):
        self.assertEqual(self.alice.client.get(URL).status_code, 404)

    def test_unverified_staff_gets_403(self):
        person = self.make_staff("nostep2@ilaf.test", "support", verified=False)
        res = person.client.get(URL)
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "staff_verification_required")

    def test_signed_out_is_refused(self):
        from rest_framework.test import APIClient

        self.assertIn(APIClient().get(URL).status_code, (401, 403))

    def test_query_count_does_not_grow_with_the_data(self):
        from django.db import connection
        from django.test.utils import CaptureQueriesContext

        self.new_ticket()
        self.chat([("customer", "Hi")])
        with CaptureQueriesContext(connection) as small:
            self.agent.client.get(URL)
        for i in range(6):
            self.new_ticket(subject=f"R{i}")
            self.chat([("customer", f"Hi {i}")], user=User.objects.get(email="bob@example.com"))
        with CaptureQueriesContext(connection) as big:
            self.agent.client.get(URL)
        self.assertEqual(len(small), len(big))
