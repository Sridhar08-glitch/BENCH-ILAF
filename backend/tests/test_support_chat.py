"""Live chat: availability, the life of a chat, offline conversion, transcripts, abuse controls and isolation."""
from datetime import timedelta

from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from staff.models import StaffAuditEvent
from support import chat, services
from support.models import ChatMessage, ChatSession, StaffPresence, SupportTicket

from .base import API, BIG_RATES
from .support_base import PNG, SupportTestCase


class ChatTestCase(SupportTestCase):
    def go_online(self, person=None):
        person = person or self.agent
        return person.client.post(API + "staff/support/presence", {"status": "online"}, format="json")

    def start(self, person=None, **body):
        client = person.client if person else APIClient()
        data = {"message": "Hello, I need help", "context": {"route": "/app/cards"}}
        if person is None:
            data.update({"name": "Visitor Vera", "email": "vera@example.org"})
        data.update(body)
        return client.post(API + "support/chat/start", data, format="json")

    def chat_url(self, chat_id, tail=""):
        return f"{API}support/chat/{chat_id}{tail}"

    def staff_chat(self, chat_id, tail=""):
        return f"{API}staff/support/chats/{chat_id}{tail}"


class AvailabilityTests(ChatTestCase):
    def test_offline_without_staff(self):
        self.open_hours()
        res = APIClient().get(API + "support/chat/status")
        self.assertEqual((res.data["enabled"], res.data["online"]), (True, False))

    def test_online_with_staff_in_hours(self):
        self.open_hours()
        self.go_online()
        self.assertTrue(APIClient().get(API + "support/chat/status").data["online"])

    def test_closed_hours_switch_and_capacity(self):
        self.go_online()
        c = services.cfg()
        c.business_hours = {}
        c.save()
        self.assertFalse(APIClient().get(API + "support/chat/status").data["online"])
        self.open_hours()
        self.assertTrue(APIClient().get(API + "support/chat/status").data["online"])
        self.admin.client.put(API + "staff/support/settings", {"chat_enabled": False}, format="json")
        self.assertFalse(APIClient().get(API + "support/chat/status").data["online"])
        self.admin.client.put(API + "staff/support/settings", {"chat_enabled": True}, format="json")
        StaffPresence.objects.filter(user=self.agent.user).update(capacity=1)
        ChatSession.objects.create(status="active", assigned_staff=self.agent.user, visitor_email="x@y.co")
        self.assertFalse(APIClient().get(API + "support/chat/status").data["online"])

    def test_away_after_five_minutes_without_a_heartbeat(self):
        self.open_hours()
        self.go_online()
        StaffPresence.objects.update(last_seen=timezone.now() - timedelta(minutes=6))
        self.assertFalse(APIClient().get(API + "support/chat/status").data["online"])
        self.assertEqual(StaffPresence.objects.get().status, "away")
        self.go_online()
        self.agent.client.post(API + "staff/support/presence/heartbeat")
        self.assertTrue(APIClient().get(API + "support/chat/status").data["online"])

    def test_read_only_cannot_set_presence(self):
        res = self.viewer.client.post(API + "staff/support/presence", {"status": "online"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(self.agent.client.post(API + "staff/support/presence", {"status": "busy"}, format="json").status_code, 400)


class LifecycleTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.open_hours()
        self.go_online()

    def test_full_chat_with_cursor_typing_read_marks_and_transcript(self):
        res = self.start(self.alice)
        self.assertEqual(res.status_code, 201, res.content)
        cid = res.data["id"]
        self.assertEqual(res.data["status"], "waiting")
        listed = self.agent.client.get(API + "staff/support/chats").data
        self.assertEqual([c["id"] for c in listed["chats"]], [cid])
        self.assertEqual(listed["chats"][0]["visitor_email"], "alice@example.com")
        self.assertEqual(listed["chats"][0]["context"]["route"], "/app/cards")
        # a reply is refused until the chat is accepted
        self.assertEqual(self.agent.client.post(self.staff_chat(cid, "/messages"), {"body": "hi"}, format="json").status_code, 409)
        acc = self.agent.client.post(self.staff_chat(cid, "/accept"))
        self.assertEqual((acc.status_code, acc.data["status"]), (200, "active"))
        self.assertEqual(self.admin.client.post(self.staff_chat(cid, "/accept")).status_code, 409)
        self.agent.client.post(self.staff_chat(cid, "/typing"))
        poll = self.alice.client.get(self.chat_url(cid, "/messages"))
        self.assertTrue(poll.data["typing"])
        self.assertEqual(poll.data["staff_name"], "Agent")
        first = poll.data["messages"][0]
        self.assertEqual((first["author"], first["body"]), ("customer", "Hello, I need help"))
        self.agent.client.post(self.staff_chat(cid, "/messages"), {"body": "How can I help?"}, format="json")
        cursor = poll.data["messages"][-1]["id"]
        after = self.alice.client.get(self.chat_url(cid, f"/messages?since={cursor}"))
        self.assertEqual([m["body"] for m in after.data["messages"] if m["author"] == "staff"], ["How can I help?"])
        self.assertNotIn("Hello, I need help", [m["body"] for m in after.data["messages"]])
        # the visitor read the staff message: staff sees the read mark
        detail = self.agent.client.get(self.staff_chat(cid, f"?since={after.data['messages'][-1]['id']}"))
        self.assertGreaterEqual(detail.data["read_id"], after.data["messages"][-1]["id"])
        self.alice.client.post(self.chat_url(cid, "/messages"), {"body": "My card will not save"}, format="json")
        mail.outbox.clear()
        end = self.alice.client.post(self.chat_url(cid, "/end"))
        self.assertEqual(end.data["status"], "ended")
        session = ChatSession.objects.get(pk=cid)
        ticket = session.ticket
        self.assertEqual((ticket.channel, ticket.status, ticket.requester.email), ("chat", "solved", "alice@example.com"))
        self.assertIsNotNone(ticket.first_response_at)
        transcript = ticket.messages.get(kind="transcript")
        self.assertIn("Hello, I need help", transcript.body)
        self.assertIn("How can I help?", transcript.body)
        sent = [m for m in mail.outbox if m.to == ["alice@example.com"] and "chat" in m.subject.lower()]
        self.assertEqual(len(sent), 1)
        self.assertIn("My card will not save", sent[0].body)
        self.assertEqual(self.alice.client.post(self.chat_url(cid, "/messages"), {"body": "x"}, format="json").status_code, 409)
        # ending twice does not send another transcript
        mail.outbox.clear()
        self.alice.client.post(self.chat_url(cid, "/end"))
        self.assertEqual(mail.outbox, [])

    def test_etag_gives_304_when_nothing_changed(self):
        cid = self.start(self.alice).data["id"]
        first = self.alice.client.get(self.chat_url(cid, "/messages?since=0"))
        again = self.alice.client.get(self.chat_url(cid, "/messages?since=0"), HTTP_IF_NONE_MATCH=first["ETag"])
        self.assertEqual(again.status_code, 304)
        self.agent.client.post(self.staff_chat(cid, "/accept"))
        changed = self.alice.client.get(self.chat_url(cid, "/messages?since=0"), HTTP_IF_NONE_MATCH=first["ETag"])
        self.assertEqual(changed.status_code, 200)

    def test_signed_out_visitor_uses_a_token(self):
        res = self.start()
        cid, token = res.data["id"], res.data["token"]
        self.assertTrue(token)
        anon = APIClient()
        self.assertEqual(anon.get(self.chat_url(cid, "/messages")).status_code, 404)
        self.assertEqual(anon.get(self.chat_url(cid, "/messages"), HTTP_X_CHAT_TOKEN="nope").status_code, 404)
        self.assertEqual(anon.get(self.chat_url(cid, "/messages"), HTTP_X_CHAT_TOKEN=token).status_code, 200)
        # a signed-in stranger cannot read it either
        self.assertEqual(self.bob.client.get(self.chat_url(cid, "/messages"), HTTP_X_CHAT_TOKEN=token).status_code, 404)
        self.assertEqual(anon.post(self.chat_url(cid, "/messages"), {"body": "more"}, format="json", HTTP_X_CHAT_TOKEN=token).status_code, 201)

    def test_isolation_of_signed_in_chats(self):
        cid = self.start(self.alice).data["id"]
        for method, tail in (("get", "/messages"), ("post", "/typing"), ("post", "/end")):
            self.assertEqual(getattr(self.bob.client, method)(self.chat_url(cid, tail)).status_code, 404)
        self.assertEqual(self.bob.client.post(self.chat_url(cid, "/messages"), {"body": "x"}, format="json").status_code, 404)
        self.assertEqual(self.alice.client.get(self.staff_chat(cid)).status_code, 404)

    def test_only_one_open_chat_per_person_and_address(self):
        self.start(self.alice)
        res = self.start(self.alice)
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "support_chat_open_exists"))
        self.start()
        self.assertEqual(self.start(email="other@example.org").status_code, 409)  # same address

    def test_validation_and_abuse_controls(self):
        self.assertEqual(self.start(message="x" * 2001).status_code, 400)
        self.assertEqual(self.start(email="bad").status_code, 400)
        self.assertEqual(self.start(name="").status_code, 400)
        c = services.cfg()
        c.blocked_words = ["casino"]
        c.save()
        self.assertEqual(self.start(message="best CASINO").status_code, 400)
        cid = self.start(self.alice).data["id"]
        res = self.alice.client.post(self.chat_url(cid, "/messages"), {"body": "casino now"}, format="json")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (400, "support_blocked_content"))
        self.assertEqual(ChatSession.objects.get(pk=cid).spam_hits, 1)
        self.assertEqual(self.alice.client.post(self.chat_url(cid, "/messages"), {"body": "  "}, format="json").status_code, 400)

    def test_banned_visitor_cannot_start(self):
        cid = self.start(self.alice).data["id"]
        digest = ChatSession.objects.get(pk=cid).ip_hash
        self.assertTrue(digest)
        self.admin.client.post(API + "staff/support/bans", {"chat_id": cid, "days": 2}, format="json")
        self.assertEqual(ChatSession.objects.get(pk=cid).status, "ended")
        self.assertEqual(self.start(self.bob).status_code, 403)

    def test_start_rate_limit(self):
        with override_settings(ILAF_THROTTLE_RATES={**BIG_RATES, "support_chat_start": "1/hour"}):
            self.assertEqual(self.start().status_code, 201)
            self.assertEqual(self.start(email="b@example.org").status_code, 429)

    def test_chat_files(self):
        cid = self.start(self.alice).data["id"]
        res = self.alice.client.post(self.chat_url(cid, "/messages"), {"body": "screenshot", "files": [__import__("django.core.files.uploadedfile", fromlist=["x"]).SimpleUploadedFile("s.png", PNG)]}, format="multipart")
        self.assertEqual(res.status_code, 201, res.content)
        fid = res.data["files"][0]["id"] if res.data["files"] else None
        poll = self.alice.client.get(self.chat_url(cid, "/messages")).data["messages"]
        fid = next(m["files"][0]["id"] for m in poll if m["files"])
        self.assertEqual(self.alice.client.get(self.chat_url(cid, f"/files/{fid}/download")).status_code, 200)
        self.assertEqual(self.bob.client.get(self.chat_url(cid, f"/files/{fid}/download")).status_code, 404)
        self.assertEqual(self.agent.client.get(self.staff_chat(cid, f"/files/{fid}/download")).status_code, 200)

    def test_transfer_convert_and_role_rules(self):
        cid = self.start(self.alice).data["id"]
        self.agent.client.post(self.staff_chat(cid, "/accept"))
        self.assertEqual(self.viewer.client.post(self.staff_chat(cid, "/messages"), {"body": "x"}, format="json").status_code, 403)
        other = self.make_staff("agent2@ilaf.test", "support")
        self.assertEqual(other.client.post(self.staff_chat(cid, "/messages"), {"body": "x"}, format="json").status_code, 403)
        self.agent.client.post(self.staff_chat(cid, "/transfer"), {"to": str(other.user.id)}, format="json")
        self.assertEqual(other.client.post(self.staff_chat(cid, "/messages"), {"body": "Hi, I took over"}, format="json").status_code, 201)
        self.assertEqual(self.agent.client.post(self.staff_chat(cid, "/transfer"), {"to": str(self.viewer.user.id)}, format="json").status_code, 400)
        res = other.client.post(self.staff_chat(cid, "/convert"))
        self.assertEqual(res.status_code, 200)
        ticket = SupportTicket.objects.get(chats__pk=cid)
        self.assertEqual((ticket.status, ticket.assigned_staff.email), ("open", "agent2@ilaf.test"))
        actions = set(StaffAuditEvent.objects.filter(action__startswith="support.chat").values_list("action", flat=True))
        self.assertTrue({"support.chat.accept", "support.chat.transfer", "support.chat.convert"} <= actions)
        # the viewer can look at a chat but never write
        self.assertEqual(self.viewer.client.get(self.staff_chat(cid)).status_code, 200)

    def test_staff_end_sends_the_transcript(self):
        cid = self.start(self.alice).data["id"]
        self.agent.client.post(self.staff_chat(cid, "/accept"))
        self.agent.client.post(self.staff_chat(cid, "/messages"), {"body": "Fixed!"}, format="json")
        mail.outbox.clear()
        res = self.agent.client.post(self.staff_chat(cid, "/end"))
        self.assertEqual(res.data["status"], "ended")
        self.assertTrue(any("Fixed!" in m.body and m.to == ["alice@example.com"] for m in mail.outbox))
        self.assertTrue(StaffAuditEvent.objects.filter(action="support.chat.end").exists())

    def test_a_ticket_can_start_a_chat(self):
        t = self.new_ticket()
        mail.outbox.clear()
        res = self.agent.client.post(self.staff_url(t["id"], "/start-chat"))
        self.assertEqual((res.status_code, res.data["status"]), (201, "active"))
        self.assertTrue(any("?chat=" in m.body and m.to == ["alice@example.com"] for m in mail.outbox))
        self.assertEqual(self.alice.client.get(f"{API}support/tickets/{t['id']}").data["active_chat_id"], res.data["id"])
        # a signed-out requester cannot be invited
        from rest_framework.test import APIClient as C

        ch = C().get(API + "support/challenge").data
        from .support_base import pow_solve

        C().post(API + "support/contact", {"name": "V", "email": "v@example.org", "subject": "s", "body": "b", "challenge": ch["challenge"], "counter": pow_solve(ch["challenge"], ch["difficulty"])}, format="json")
        anon_ticket = SupportTicket.objects.get(requester_email="v@example.org")
        self.assertEqual(self.agent.client.post(self.staff_url(str(anon_ticket.id), "/start-chat")).status_code, 409)


class OfflineConversionTests(ChatTestCase):
    def test_nobody_online_turns_the_message_into_a_ticket_at_once(self):
        self.open_hours()
        mail.outbox.clear()
        res = self.start(self.alice)
        self.assertEqual(res.status_code, 201)
        self.assertEqual(res.data["status"], "offline_converted")
        self.assertTrue(res.data["ticket"].startswith("BNC-"))
        self.assertIn("Nobody is online", res.data["auto_reply"])
        ticket = SupportTicket.objects.get()
        self.assertEqual((ticket.channel, ticket.status), ("chat", "new"))
        self.assertTrue(ticket.messages.filter(kind="transcript").exists())
        msg = next(m for m in mail.outbox if m.to == ["alice@example.com"])
        self.assertIn("Nobody is online right now", msg.body)

    def test_offline_message_in_arabic(self):
        self.open_hours()
        res = self.alice.client.post(API + "support/chat/start", {"message": "مرحبا"}, format="json", HTTP_X_LANGUAGE="ar")
        self.assertIn("لا يوجد أحد", res.data["auto_reply"])
        msg = next(m for m in mail.outbox if m.to == ["alice@example.com"])
        self.assertIn("لا يوجد أحد متاح الآن", msg.body)

    def test_offline_without_a_message_asks_for_one(self):
        self.open_hours()
        res = self.start(self.alice, message="")
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "support_chat_offline"))
        self.assertEqual(ChatSession.objects.count(), 0)

    def test_outside_business_hours_converts(self):
        self.go_online()
        c = services.cfg()
        c.business_hours = {}
        c.save()
        self.assertEqual(self.start(self.alice).data["status"], "offline_converted")

    def test_chat_switched_off_still_takes_a_message(self):
        self.open_hours()
        self.go_online()
        c = services.cfg()
        c.chat_enabled = False
        c.save()
        res = self.start(self.alice)
        self.assertEqual((res.status_code, res.data["status"]), (201, "offline_converted"))
        self.assertEqual(self.start(self.bob, message="").data["error"]["code"], "support_chat_offline")

    def test_unaccepted_chat_converts_after_the_wait(self):
        self.open_hours()
        self.go_online()
        cid = self.start(self.alice).data["id"]
        self.assertEqual(chat.sweep(), (0, 0))
        ChatSession.objects.filter(pk=cid).update(started_at=timezone.now() - timedelta(seconds=130))
        mail.outbox.clear()
        self.assertEqual(chat.sweep(), (1, 0))
        session = ChatSession.objects.get(pk=cid)
        self.assertEqual(session.status, "offline_converted")
        self.assertIsNotNone(session.ticket)
        self.assertTrue(any(m.to == ["alice@example.com"] and "BNC-" in m.subject for m in mail.outbox))
        poll = self.alice.client.get(self.chat_url(cid, "/messages")).data
        self.assertEqual(poll["status"], "offline_converted")
        self.assertEqual(poll["ticket"], session.ticket.label)

    def test_wait_time_is_a_setting(self):
        self.open_hours()
        self.go_online()
        self.admin.client.put(API + "staff/support/settings", {"chat_accept_seconds": 300}, format="json")
        cid = self.start(self.alice).data["id"]
        ChatSession.objects.filter(pk=cid).update(started_at=timezone.now() - timedelta(seconds=200))
        self.assertEqual(chat.sweep(), (0, 0))

    def test_staff_going_away_converts_waiting_chats(self):
        self.open_hours()
        self.go_online()
        cid = self.start(self.alice).data["id"]
        StaffPresence.objects.update(status="offline")
        self.assertEqual(chat.sweep()[0], 1)
        self.assertEqual(ChatSession.objects.get(pk=cid).status, "offline_converted")

    def test_idle_active_chats_end_and_the_tick_command_runs(self):
        self.open_hours()
        self.go_online()
        cid = self.start(self.alice).data["id"]
        self.agent.client.post(self.staff_chat(cid, "/accept"))
        ChatSession.objects.filter(pk=cid).update(last_activity=timezone.now() - timedelta(minutes=45))
        call_command("support_tick")
        self.assertEqual(ChatSession.objects.get(pk=cid).status, "ended")
        self.assertEqual(ChatSession.objects.get(pk=cid).ended_by, "system")

    def test_chat_logs_hold_no_personal_data(self):
        self.open_hours()
        with self.assertLogs(level="DEBUG") as logs:
            import logging

            logging.getLogger("support").debug("probe")
            self.start(self.alice, message="my secret words")
        text = "\n".join(logs.output)
        self.assertNotIn("my secret words", text)
        self.assertNotIn("alice@example.com", text)
