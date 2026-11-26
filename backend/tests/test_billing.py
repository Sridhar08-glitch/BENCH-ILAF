import hashlib
import hmac
import json
import time
from datetime import timedelta
from io import StringIO
from types import SimpleNamespace
from unittest import mock

import stripe
from django.conf import settings
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from billing.models import Payment, Plan, Subscription
from billing.services import grant_period, is_live
from workspaces.models import Workspace

from .base import API, ApiTestCase

SECRET = "whsec_test_secret"


def signed(payload_dict, secret=SECRET, timestamp=None):
    payload = json.dumps(payload_dict)
    ts = timestamp or int(time.time())
    sig = hmac.new(secret.encode(), f"{ts}.{payload}".encode(), hashlib.sha256).hexdigest()
    return payload, f"t={ts},v1={sig}"


def session_event(ws, plan="personal", seats=1, session_id="cs_test_1", event_type="checkout.session.completed",
                  payment_status="paid", amount=4900):
    return {
        "id": "evt_1", "object": "event", "type": event_type,
        "data": {"object": {
            "id": session_id, "object": "checkout.session", "payment_status": payment_status,
            "amount_total": amount, "currency": "qar",
            "metadata": {"workspace_id": str(ws), "plan_code": plan, "seats": str(seats)},
        }},
    }


class PlanTests(ApiTestCase):
    def test_plans_are_public_and_seeded(self):
        res = APIClient().get(API + "plans")
        self.assertEqual(res.status_code, 200)
        codes = {p["code"]: p for p in res.data}
        self.assertEqual(set(codes), {"free", "personal", "business", "company", "enterprise"})
        self.assertEqual(codes["personal"]["price_minor"], 4900)
        self.assertEqual(codes["business"]["max_cards"], 5)
        self.assertTrue(codes["company"]["per_seat"])
        self.assertEqual(codes["company"]["min_seats"], 5)
        self.assertEqual(
            set(codes["personal"]),
            {"code", "name", "kind", "interval", "price_minor", "currency", "max_cards", "per_seat", "min_seats", "features", "purchasable", "by_quote"},
        )
        # Enterprise has no price: it is asked for, not bought.
        self.assertEqual(codes["enterprise"]["price_minor"], 0)
        self.assertFalse(codes["enterprise"]["purchasable"])
        self.assertTrue(codes["enterprise"]["by_quote"])
        self.assertEqual(codes["enterprise"]["kind"], "company")
        self.assertTrue(codes["personal"]["purchasable"])
        self.assertFalse(codes["personal"]["by_quote"])

    def test_seed_plans_does_not_overwrite_edited_prices(self):
        Plan.objects.filter(code="personal").update(price_minor=1234)
        call_command("seed_plans", stdout=StringIO())
        self.assertEqual(Plan.objects.get(code="personal").price_minor, 1234)
        call_command("seed_plans", "--reset", stdout=StringIO())
        self.assertEqual(Plan.objects.get(code="personal").price_minor, 4900)


class CheckoutTests(ApiTestCase):
    def test_dev_activation_makes_subscription_live(self):
        person = self.signup()
        res = person.client.post(f"{API}workspaces/{person.ws}/checkout", {"plan_code": "personal"}, format="json")
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["checkout_url"], "https://web.test/app/billing?paid=1")
        sub = person.client.get(f"{API}workspaces/{person.ws}/subscription").data
        self.assertEqual(sub["status"], "active")
        self.assertEqual(sub["plan_code"], "personal")
        self.assertTrue(sub["live"])
        self.assertEqual(sub["seats_total"], 1)
        self.assertEqual(sub["seats_used"], 1)
        self.assertIsNotNone(sub["grace_ends_at"])
        invoices = person.client.get(f"{API}workspaces/{person.ws}/invoices").data
        self.assertEqual(len(invoices), 1)
        self.assertEqual(invoices[0]["plan_code"], "personal")
        self.assertEqual(invoices[0]["amount_minor"], 4900)
        self.assertTrue(invoices[0]["number"].startswith("INV-"))

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="", DEBUG=True)
    def test_debug_without_stripe_key_also_activates(self):
        person = self.signup()
        res = person.client.post(f"{API}workspaces/{person.ws}/checkout", {"plan_code": "personal"}, format="json")
        self.assertEqual(res.data["checkout_url"], "https://web.test/app/billing?paid=1")

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="", DEBUG=False)
    def test_no_stripe_key_and_no_debug_is_unavailable(self):
        person = self.signup()
        res = person.client.post(f"{API}workspaces/{person.ws}/checkout", {"plan_code": "personal"}, format="json")
        self.assertEqual(res.status_code, 503)
        self.assertFalse(Subscription.objects.exists())

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
    def test_stripe_checkout_session_is_created_with_brand_names(self):
        person = self.signup()
        fake = SimpleNamespace(url="https://checkout.stripe.test/pay/cs_1")
        with mock.patch.object(stripe.checkout.Session, "create", return_value=fake) as create:
            res = person.client.post(
                f"{API}workspaces/{person.ws}/checkout", {"plan_code": "personal"}, format="json"
            )
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.data["checkout_url"], fake.url)
        kwargs = create.call_args.kwargs
        self.assertEqual(kwargs["mode"], "subscription")
        item = kwargs["line_items"][0]
        self.assertEqual(item["quantity"], 1)
        line = item["price_data"]
        self.assertEqual(line["unit_amount"], 4900)
        self.assertEqual(line["currency"], "qar")
        self.assertEqual(line["recurring"], {"interval": "year"})
        self.assertIn(settings.PRODUCT_NAME, line["product_data"]["name"])
        self.assertEqual(kwargs["metadata"]["workspace_id"], person.ws)
        self.assertEqual(kwargs["subscription_data"]["metadata"]["plan_code"], "personal")
        self.assertEqual(kwargs["customer_email"], person.email)
        self.assertNotIn("payment_intent_data", kwargs)
        self.assertFalse(Subscription.objects.exists())  # nothing is granted until the webhook arrives

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123", STRIPE_RECURRING=False)
    def test_one_off_payment_is_the_fallback_when_recurring_is_off(self):
        person = self.signup()
        fake = SimpleNamespace(url="https://checkout.stripe.test/pay/cs_1")
        with mock.patch.object(stripe.checkout.Session, "create", return_value=fake) as create:
            res = person.client.post(f"{API}workspaces/{person.ws}/checkout", {"plan_code": "personal"}, format="json")
        self.assertEqual(res.status_code, 200)
        kwargs = create.call_args.kwargs
        self.assertEqual(kwargs["mode"], "payment")
        self.assertEqual(kwargs["line_items"][0]["price_data"]["unit_amount"], 4900)
        self.assertNotIn("recurring", kwargs["line_items"][0]["price_data"])
        self.assertEqual(kwargs["payment_intent_data"]["statement_descriptor_suffix"], settings.STATEMENT_DESCRIPTOR_SUFFIX)

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
    def test_company_amount_is_per_seat(self):
        owner = self.signup()
        ws = owner.client.post(API + "workspaces", {"name": "Acme"}, format="json").data["id"]
        fake = SimpleNamespace(url="https://checkout.stripe.test/x")
        with mock.patch.object(stripe.checkout.Session, "create", return_value=fake) as create:
            owner.client.post(f"{API}workspaces/{ws}/checkout", {"plan_code": "company", "seats": 8}, format="json")
        item = create.call_args.kwargs["line_items"][0]
        self.assertEqual(item["price_data"]["unit_amount"], 3900)  # per seat, Stripe multiplies by the quantity
        self.assertEqual(item["quantity"], 8)
        self.assertEqual(item["price_data"]["recurring"], {"interval": "year"})
        self.assertEqual(create.call_args.kwargs["mode"], "subscription")

    def test_company_seats_have_a_minimum(self):
        owner = self.signup()
        ws = self.company(owner, seats=2, plan="company")
        sub = owner.client.get(f"{API}workspaces/{ws}/subscription").data
        self.assertEqual(sub["seats_total"], 5)

    def test_plan_kind_must_match_workspace(self):
        person = self.signup()
        res = person.client.post(f"{API}workspaces/{person.ws}/checkout", {"plan_code": "company"}, format="json")
        self.assertEqual(res.status_code, 400)
        res = person.client.post(f"{API}workspaces/{person.ws}/checkout", {"plan_code": "nope"}, format="json")
        self.assertEqual(res.status_code, 400)

    def test_employee_cannot_buy_or_see_invoices(self):
        owner = self.signup()
        ws = self.company(owner)
        eve = self.join(self.invite(owner, ws, "eve@example.com"))
        res = eve.client.post(f"{API}workspaces/{ws}/checkout", {"plan_code": "company"}, format="json")
        self.assertEqual(res.status_code, 403)
        self.assertEqual(res.data["error"]["code"], "forbidden")
        self.assertEqual(eve.client.get(f"{API}workspaces/{ws}/invoices").status_code, 403)
        self.assertEqual(eve.client.get(f"{API}workspaces/{ws}/subscription").status_code, 200)


class LiveRuleTests(ApiTestCase):
    def _sub(self, person):
        self.buy(person, "personal")
        return Subscription.objects.get(workspace_id=person.ws)

    def test_live_through_grace_then_not(self):
        person = self.signup()
        sub = self._sub(person)
        ws = Workspace.objects.get(pk=person.ws)
        sub.ends_at = timezone.now() - timedelta(days=3)
        sub.save()
        self.assertTrue(is_live(ws))
        data = person.client.get(f"{API}workspaces/{person.ws}/subscription").data
        self.assertTrue(data["live"])
        self.assertEqual(data["status"], "active")
        sub.ends_at = timezone.now() - timedelta(days=8)
        sub.save()
        self.assertFalse(is_live(ws))
        data = person.client.get(f"{API}workspaces/{person.ws}/subscription").data
        self.assertFalse(data["live"])
        self.assertEqual(data["status"], "expired")

    def test_grace_days_setting_is_respected(self):
        person = self.signup()
        sub = self._sub(person)
        sub.ends_at = timezone.now() - timedelta(days=2)
        sub.save()
        with override_settings(CARDS_GRACE_DAYS=1):
            self.assertFalse(is_live(Workspace.objects.get(pk=person.ws)))

    def test_paying_again_extends_from_end_when_in_grace_else_from_now(self):
        person = self.signup()
        sub = self._sub(person)
        old_end = timezone.now() - timedelta(days=2)
        sub.ends_at = old_end
        sub.save()
        self.buy(person, "personal")
        sub.refresh_from_db()
        self.assertEqual(sub.starts_at, old_end)
        self.assertEqual((sub.ends_at - old_end).days, 365)
        # Past the grace window the new period starts now.
        sub.ends_at = timezone.now() - timedelta(days=30)
        sub.save()
        before = timezone.now()
        self.buy(person, "personal")
        sub.refresh_from_db()
        self.assertGreaterEqual(sub.starts_at, before)
        self.assertEqual(Payment.objects.filter(workspace_id=person.ws).count(), 3)

    def test_paying_while_active_adds_a_full_period_to_the_end(self):
        person = self.signup()
        sub = self._sub(person)
        first_end = sub.ends_at
        self.buy(person, "personal")
        sub.refresh_from_db()
        self.assertEqual(sub.starts_at, first_end)
        self.assertGreater((sub.ends_at - first_end).days, 360)

    def test_expire_command(self):
        person = self.signup()
        sub = self._sub(person)
        sub.ends_at = timezone.now() - timedelta(days=10)
        sub.save()
        out = StringIO()
        call_command("expire_subscriptions", stdout=out)
        sub.refresh_from_db()
        self.assertEqual(sub.status, "expired")
        self.assertIn("1", out.getvalue())

    def test_expire_command_leaves_grace_period_alone(self):
        person = self.signup()
        sub = self._sub(person)
        sub.ends_at = timezone.now() - timedelta(days=2)
        sub.save()
        call_command("expire_subscriptions", stdout=StringIO())
        sub.refresh_from_db()
        self.assertEqual(sub.status, "active")

    def test_reminders_sent_once_per_window(self):
        person = self.signup("owner@example.com")
        sub = self._sub(person)
        sub.ends_at = timezone.now() + timedelta(days=6)
        sub.save()
        call_command("send_renewal_reminders", stdout=StringIO())
        self.assertEqual(len(mail.outbox), 1)
        call_command("send_renewal_reminders", stdout=StringIO())
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn(settings.PRODUCT_NAME, mail.outbox[0].subject)
        self.assertEqual(mail.outbox[0].to, ["owner@example.com"])
        sub.ends_at = timezone.now() + timedelta(hours=20)
        sub.save()
        call_command("send_renewal_reminders", stdout=StringIO())
        self.assertEqual(len(mail.outbox), 2)
        call_command("send_renewal_reminders", stdout=StringIO())
        self.assertEqual(len(mail.outbox), 2)

    def test_no_reminder_far_from_the_end(self):
        person = self.signup()
        self._sub(person)
        call_command("send_renewal_reminders", stdout=StringIO())
        self.assertEqual(len(mail.outbox), 0)

    def test_manual_grant(self):
        person = self.signup()
        ws = Workspace.objects.get(pk=person.ws)
        payment = grant_period(ws)
        self.assertEqual(payment.source, "manual")
        self.assertEqual(payment.amount_minor, 0)
        self.assertTrue(is_live(ws))


class WebhookTests(ApiTestCase):
    url = API + "stripe/webhook"

    def _post(self, payload, signature):
        return APIClient().post(self.url, data=payload, content_type="application/json", HTTP_STRIPE_SIGNATURE=signature)

    def test_valid_event_activates_subscription(self):
        person = self.signup()
        payload, sig = signed(session_event(person.ws))
        res = self._post(payload, sig)
        self.assertEqual(res.status_code, 200)
        sub = Subscription.objects.get(workspace_id=person.ws)
        self.assertEqual(sub.plan_id, "personal")
        payment = Payment.objects.get()
        self.assertEqual(payment.stripe_session_id, "cs_test_1")
        self.assertEqual(payment.source, "stripe")
        self.assertEqual(payment.amount_minor, 4900)
        self.assertEqual(payment.currency, "QAR")

    def test_same_session_twice_is_applied_once(self):
        person = self.signup()
        payload, sig = signed(session_event(person.ws))
        self.assertEqual(self._post(payload, sig).status_code, 200)
        end_after_first = Subscription.objects.get().ends_at
        payload, sig = signed(session_event(person.ws))
        self.assertEqual(self._post(payload, sig).status_code, 200)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(Subscription.objects.get().ends_at, end_after_first)

    def test_different_sessions_extend(self):
        person = self.signup()
        for sid in ("cs_a", "cs_b"):
            payload, sig = signed(session_event(person.ws, session_id=sid))
            self._post(payload, sig)
        self.assertEqual(Payment.objects.count(), 2)
        sub = Subscription.objects.get()
        self.assertGreater((sub.ends_at - timezone.now()).days, 700)

    def test_bad_signature_rejected(self):
        person = self.signup()
        payload, _ = signed(session_event(person.ws))
        res = self._post(payload, "t=1,v1=deadbeef")
        self.assertEqual(res.status_code, 400)
        self.assertEqual(self._post(payload, "").status_code, 400)
        payload, sig = signed(session_event(person.ws), secret="whsec_other")
        self.assertEqual(self._post(payload, sig).status_code, 400)
        self.assertFalse(Payment.objects.exists())

    def test_old_timestamp_rejected(self):
        person = self.signup()
        payload, sig = signed(session_event(person.ws), timestamp=int(time.time()) - 3600)
        self.assertEqual(self._post(payload, sig).status_code, 400)

    @override_settings(STRIPE_WEBHOOK_SECRET="")
    def test_no_secret_configured_rejects_everything(self):
        person = self.signup()
        payload, sig = signed(session_event(person.ws))
        self.assertEqual(self._post(payload, sig).status_code, 400)

    def test_unknown_event_type_is_ignored_with_200(self):
        person = self.signup()
        payload, sig = signed(session_event(person.ws, event_type="customer.created"))
        self.assertEqual(self._post(payload, sig).status_code, 200)
        self.assertFalse(Payment.objects.exists())

    def test_unpaid_session_is_ignored(self):
        person = self.signup()
        payload, sig = signed(session_event(person.ws, payment_status="unpaid"))
        self.assertEqual(self._post(payload, sig).status_code, 200)
        self.assertFalse(Payment.objects.exists())

    def test_missing_metadata_is_acknowledged_without_effect(self):
        event = session_event("00000000-0000-0000-0000-000000000000")
        payload, sig = signed(event)
        self.assertEqual(self._post(payload, sig).status_code, 200)
        self.assertFalse(Payment.objects.exists())
