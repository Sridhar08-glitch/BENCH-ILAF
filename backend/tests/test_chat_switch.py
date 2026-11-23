"""The chat switches are enforced by the server: the support setting and the `support_chat` feature switch."""
from rest_framework.test import APIClient

from staff import flags
from staff.models import FeatureFlag
from support import chat, services
from support.models import ChatSession, SupportTicket

from .base import API
from .test_support_chat import ChatTestCase


class ChatSwitchTests(ChatTestCase):
    def setUp(self):
        super().setUp()
        self.open_hours()
        self.go_online()
        self.owner = self.company_with_owner("owner@acme.test", "Acme Ltd")
        self.ws = self.owner.company

    def switch_flag(self, state="off", companies=None):
        FeatureFlag.objects.update_or_create(key="support_chat", defaults={"state": state, "company_ids": companies or []})
        flags.clear_cache()

    def test_the_setting_off_turns_a_new_chat_into_a_ticket_and_says_so(self):
        c = services.cfg()
        c.chat_enabled = False
        c.save()
        status = APIClient().get(API + "support/chat/status").data
        self.assertEqual((status["enabled"], status["online"], status["live"], status["reason"]), (False, False, False, "switched_off"))
        res = self.start()
        self.assertEqual(res.status_code, 201, res.content)
        self.assertEqual(res.data["status"], "offline_converted")
        self.assertTrue(res.data["converted_to_ticket"])
        self.assertEqual(res.data["reason"], "switched_off")
        self.assertTrue(res.data["ticket"])
        self.assertEqual(SupportTicket.objects.count(), 1)

    def test_a_live_start_says_it_is_live(self):
        res = self.start()
        self.assertEqual((res.data["status"], res.data["converted_to_ticket"], res.data["reason"]), ("waiting", False, "online"))
        self.assertTrue(APIClient().get(API + "support/chat/status").data["live"])

    def test_a_chat_that_is_running_may_finish_when_the_setting_is_switched_off(self):
        res = self.start(self.alice)
        chat_id = res.data["id"]
        self.agent.client.post(self.staff_chat(chat_id, "/accept"))
        c = services.cfg()
        c.chat_enabled = False
        c.save()
        sent = self.alice.client.post(self.chat_url(chat_id, "/messages"), {"body": "Still here"}, format="json")
        self.assertEqual(sent.status_code, 201, sent.content)
        chat.sweep()
        self.assertEqual(ChatSession.objects.get(pk=chat_id).status, "active")
        # but nobody new can start one live
        other = self.start(self.bob)
        self.assertEqual(other.data["status"], "offline_converted")

    def test_the_feature_switch_off_is_the_same_as_chat_off(self):
        self.switch_flag("off")
        status = self.alice.client.get(API + "support/chat/status", {"workspace": self.alice.ws}).data
        self.assertEqual((status["enabled"], status["online"], status["reason"]), (False, False, "switched_off"))
        self.assertFalse(APIClient().get(API + "support/chat/status").data["online"])
        res = self.start(self.alice, context={"workspace_id": self.alice.ws})
        self.assertEqual(res.data["status"], "offline_converted")
        self.assertEqual(res.data["reason"], "switched_off")

    def test_the_feature_switch_is_per_company(self):
        self.switch_flag("selected", [self.ws])
        mine = self.owner.client.get(API + "support/chat/status", {"workspace": self.ws}).data
        self.assertTrue(mine["online"])
        theirs = self.alice.client.get(API + "support/chat/status", {"workspace": self.alice.ws}).data
        self.assertFalse(theirs["online"])
        res = self.start(self.alice, context={"workspace_id": self.alice.ws})
        self.assertEqual(res.data["status"], "offline_converted")
        res = self.start(self.owner, context={"workspace_id": self.ws})
        self.assertEqual(res.data["status"], "waiting")

    def test_someone_elses_company_id_is_ignored(self):
        self.switch_flag("selected", [self.ws])
        # the id is not alice's company, so it is ignored: she is treated as a person without a company
        status = self.alice.client.get(API + "support/chat/status", {"workspace": self.ws}).data
        self.assertTrue(status["online"])
        self.switch_flag("off")
        self.assertFalse(self.alice.client.get(API + "support/chat/status", {"workspace": self.ws}).data["online"])

    def test_a_waiting_chat_becomes_a_ticket_when_its_company_switch_goes_off(self):
        res = self.start(self.owner, context={"workspace_id": self.ws})
        chat_id = res.data["id"]
        self.assertEqual(ChatSession.objects.get(pk=chat_id).status, "waiting")
        self.switch_flag("off")
        chat.sweep()
        self.assertEqual(ChatSession.objects.get(pk=chat_id).status, "offline_converted")
