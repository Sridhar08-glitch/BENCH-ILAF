"""Automatic yearly renewal with Stripe subscriptions: every webhook event (with Stripe objects built by hand, no network),
idempotency, the billing portal, cancelling at the period end, a failed payment and its grace days, seat changes, and the
reminder e-mails (renewing plans, the free week)."""
from datetime import timedelta
from io import StringIO
from types import SimpleNamespace
from unittest import mock

import stripe
from django.core import mail
from django.core.management import call_command
from django.test import override_settings
from django.utils import timezone
from rest_framework.test import APIClient

from accounts.models import User
from billing.models import Payment, Plan, Subscription
from billing.services import ensure_trial, is_live, subscription_json
from workspaces.models import Member, Workspace

from .base import API, ApiTestCase
from .test_billing import signed

URL = API + "stripe/webhook"


def ts(when):
    return int(when.timestamp())


def post(payload_dict):
    payload, sig = signed(payload_dict)
    return APIClient().post(URL, data=payload, content_type="application/json", HTTP_STRIPE_SIGNATURE=sig)


def event(kind, obj, eid="evt_1"):
    return {"id": eid, "object": "event", "type": kind, "data": {"object": obj}}


def meta(ws, plan="personal", seats=1, **extra):
    return {"workspace_id": str(ws), "plan_code": plan, "seats": str(seats), **extra}


def session(ws, plan="personal", seats=1, sid="cs_sub_1", sub="sub_1", cust="cus_1", invoice="in_1", amount=4900, mode="subscription"):
    return event("checkout.session.completed", {
        "id": sid, "object": "checkout.session", "mode": mode, "payment_status": "paid", "amount_total": amount, "currency": "qar",
        "customer": cust, "subscription": sub, "invoice": invoice, "metadata": meta(ws, plan, seats),
    })


def invoice(sub="sub_1", iid="in_2", cust="cus_1", amount=4900, start=None, end=None, reason="subscription_cycle", metadata=None, kind="invoice.paid"):
    start = start or timezone.now()
    end = end or start + timedelta(days=365)
    obj = {
        "id": iid, "object": "invoice", "subscription": sub, "customer": cust, "amount_paid": amount, "currency": "qar",
        "billing_reason": reason, "lines": {"data": [{"period": {"start": ts(start), "end": ts(end)}, "metadata": {}}]},
        "subscription_details": {"metadata": metadata or {}},
    }
    return event(kind, obj, eid="evt_" + iid)


def subscription_object(sub="sub_1", status="active", cancel=False, cancel_at=None, quantity=None, cust="cus_1"):
    obj = {"id": sub, "object": "subscription", "status": status, "cancel_at_period_end": cancel, "cancel_at": cancel_at, "customer": cust}
    if quantity is not None:
        obj["items"] = {"data": [{"quantity": quantity}]}
    return obj


class StripeCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@example.com", "Olga Owner")
        self.ws = self.owner.ws
        self.workspace = Workspace.objects.get(pk=self.ws)

    def sub(self):
        return Subscription.objects.get(workspace_id=self.ws)

    def company_on(self, owner, plan="company"):
        """A company of the owner that has paid for the plan (without going to Stripe, which the tests of this class replace)."""
        from billing.services import activate

        ws = owner.client.post(API + "workspaces", {"name": "Acme"}, format="json").data["id"]
        activate(Workspace.objects.get(pk=ws), Plan.objects.get(code=plan), 5, source="dev")
        return ws

    def subscribed(self, plan="personal", **kw):
        """A workspace that has paid its first period by Stripe subscription."""
        res = post(session(self.ws, plan=plan, **kw))
        self.assertEqual(res.status_code, 200)
        return self.sub()


class CheckoutSessionTests(StripeCase):
    def test_first_payment_grants_the_period_and_remembers_stripe(self):
        sub = self.subscribed()
        self.assertEqual((sub.plan_id, sub.status), ("personal", "active"))
        self.assertEqual((sub.stripe_customer_id, sub.stripe_subscription_id), ("cus_1", "sub_1"))
        self.assertTrue(sub.auto_renew)
        self.assertFalse(sub.cancel_at_period_end)
        self.assertIsNone(sub.payment_failed_at)
        payment = Payment.objects.get()
        self.assertEqual((payment.stripe_session_id, payment.stripe_invoice_id, payment.amount_minor, payment.source), ("cs_sub_1", "in_1", 4900, "stripe"))
        self.assertTrue(payment.number.startswith("INV-"))

    def test_the_same_session_twice_is_applied_once(self):
        self.subscribed()
        end = self.sub().ends_at
        self.assertEqual(post(session(self.ws)).status_code, 200)
        self.assertEqual(Payment.objects.count(), 1)
        self.assertEqual(self.sub().ends_at, end)

    def test_company_seats_come_from_the_session(self):
        owner = self.signup("co@example.com")
        ws = owner.client.post(API + "workspaces", {"name": "Acme"}, format="json").data["id"]
        post(session(ws, plan="company", seats=8, amount=3900 * 8, sid="cs_co", invoice="in_co", sub="sub_co", cust="cus_co"))
        sub = Subscription.objects.get(workspace_id=ws)
        self.assertEqual((sub.plan_id, sub.seats_total, sub.auto_renew), ("company", 8, True))
        self.assertEqual(Payment.objects.get(workspace_id=ws).amount_minor, 31200)

    def test_one_off_sessions_still_work_and_do_not_turn_on_renewal(self):
        res = post(session(self.ws, mode="payment", sub=None, cust=None, invoice=None, sid="cs_once"))
        self.assertEqual(res.status_code, 200)
        sub = self.sub()
        self.assertEqual(sub.plan_id, "personal")
        self.assertFalse(sub.auto_renew)
        self.assertEqual(sub.stripe_subscription_id, "")

    def test_an_unpaid_session_changes_nothing(self):
        bad = session(self.ws)
        bad["data"]["object"]["payment_status"] = "unpaid"
        self.assertEqual(post(bad).status_code, 200)
        self.assertFalse(Payment.objects.exists())

    def test_session_and_invoice_of_the_same_payment_record_it_once_in_any_order(self):
        # session first
        self.subscribed()
        post(invoice(iid="in_1", reason="subscription_create", metadata=meta(self.ws)))
        self.assertEqual(Payment.objects.count(), 1)
        # invoice first, on another company
        other = self.signup("o2@example.com")
        post(invoice(sub="sub_9", iid="in_9", cust="cus_9", reason="subscription_create", metadata=meta(other.ws)))
        self.assertEqual(Payment.objects.filter(workspace_id=other.ws).count(), 1)
        post(session(other.ws, sid="cs_9", sub="sub_9", cust="cus_9", invoice="in_9"))
        self.assertEqual(Payment.objects.filter(workspace_id=other.ws).count(), 1)
        sub = Subscription.objects.get(workspace_id=other.ws)
        self.assertEqual((sub.stripe_subscription_id, sub.stripe_customer_id, sub.auto_renew), ("sub_9", "cus_9", True))

    def test_a_new_subscription_cancels_the_old_one_at_stripe(self):
        self.subscribed()
        with override_settings(STRIPE_SECRET_KEY="sk_test_123"), mock.patch.object(stripe.Subscription, "cancel") as cancel:
            post(session(self.ws, sid="cs_new", sub="sub_new", invoice="in_new"))
        cancel.assert_called_once_with("sub_1")
        self.assertEqual(self.sub().stripe_subscription_id, "sub_new")

    def test_a_failing_cancel_does_not_lose_the_payment(self):
        self.subscribed()
        with override_settings(STRIPE_SECRET_KEY="sk_test_123"), mock.patch.object(stripe.Subscription, "cancel", side_effect=stripe.error.APIConnectionError("down")):
            res = post(session(self.ws, sid="cs_new", sub="sub_new", invoice="in_new"))
        self.assertEqual(res.status_code, 200)
        self.assertEqual(Payment.objects.count(), 2)


class InvoicePaidTests(StripeCase):
    def test_a_renewal_extends_the_period_from_the_invoice(self):
        sub = self.subscribed()
        old_end = sub.ends_at
        res = post(invoice(iid="in_renew", start=old_end, end=old_end + timedelta(days=365)))
        self.assertEqual(res.status_code, 200)
        sub = self.sub()
        self.assertEqual(sub.starts_at.replace(microsecond=0), old_end.replace(microsecond=0))
        self.assertEqual(sub.ends_at.replace(microsecond=0), (old_end + timedelta(days=365)).replace(microsecond=0))
        self.assertEqual(sub.status, "active")
        payments = list(Payment.objects.order_by("paid_at"))
        self.assertEqual(len(payments), 2)
        self.assertEqual((payments[1].stripe_invoice_id, payments[1].amount_minor, payments[1].stripe_session_id), ("in_renew", 4900, None))
        self.assertEqual(len({p.number for p in payments}), 2)
        first, second = (int(p.number.split("-")[-1]) for p in payments)
        self.assertEqual(second, first + 1)  # the invoice numbers stay sequential

    def test_the_same_invoice_twice_is_applied_once(self):
        sub = self.subscribed()
        evt = invoice(iid="in_renew", start=sub.ends_at)
        post(evt)
        end = self.sub().ends_at
        self.assertEqual(post(evt).status_code, 200)
        self.assertEqual(Payment.objects.count(), 2)
        self.assertEqual(self.sub().ends_at, end)

    def test_a_late_renewal_inside_the_grace_days_starts_after_the_old_end(self):
        sub = self.subscribed()
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() - timedelta(days=2))
        start = timezone.now() - timedelta(days=2)
        post(invoice(iid="in_late", start=start, end=start + timedelta(days=365)))
        self.assertGreater(self.sub().ends_at, timezone.now() + timedelta(days=360))
        self.assertTrue(is_live(self.workspace))

    def test_an_invoice_that_overlaps_a_running_period_is_moved_after_it(self):
        sub = self.subscribed()
        old_end = sub.ends_at
        now = timezone.now()
        post(invoice(iid="in_early", start=now, end=now + timedelta(days=365)))  # paid early: must not cut the old period short
        self.assertGreater(self.sub().ends_at, old_end + timedelta(days=360))

    def test_an_invoice_for_an_unknown_subscription_is_acknowledged_without_effect(self):
        res = post(invoice(sub="sub_unknown", iid="in_x"))
        self.assertEqual(res.status_code, 200)
        self.assertFalse(Payment.objects.exists())

    def test_a_one_off_invoice_without_a_subscription_is_ignored(self):
        evt = invoice(iid="in_once")
        evt["data"]["object"]["subscription"] = None
        self.assertEqual(post(evt).status_code, 200)
        self.assertFalse(Payment.objects.exists())

    def test_a_renewal_keeps_the_plan_and_the_seats(self):
        owner = self.signup("co@example.com")
        ws = owner.client.post(API + "workspaces", {"name": "Acme"}, format="json").data["id"]
        post(session(ws, plan="company", seats=9, amount=3900 * 9, sid="cs_co", invoice="in_co", sub="sub_co", cust="cus_co"))
        end = Subscription.objects.get(workspace_id=ws).ends_at
        post(invoice(sub="sub_co", cust="cus_co", iid="in_co2", amount=3900 * 9, start=end))
        sub = Subscription.objects.get(workspace_id=ws)
        self.assertEqual((sub.plan_id, sub.seats_total), ("company", 9))
        self.assertEqual(Payment.objects.filter(workspace_id=ws).latest("paid_at").amount_minor, 3900 * 9)

    def test_a_paid_invoice_clears_a_failed_payment(self):
        sub = self.subscribed()
        post(invoice(iid="in_fail", kind="invoice.payment_failed"))
        self.assertIsNotNone(self.sub().payment_failed_at)
        post(invoice(iid="in_fail", start=sub.ends_at))
        sub = self.sub()
        self.assertIsNone(sub.payment_failed_at)
        self.assertEqual(sub.failed_invoice_id, "")


class PaymentFailedTests(StripeCase):
    def test_the_owner_is_e_mailed_once_per_invoice_with_a_link_to_fix_the_payment(self):
        self.subscribed()
        mail.outbox.clear()
        failed = invoice(iid="in_f1", kind="invoice.payment_failed")
        self.assertEqual(post(failed).status_code, 200)
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["owner@example.com"])
        self.assertIn("could not renew", msg.subject)
        self.assertIn("https://web.test/app/billing", msg.body)
        self.assertIn("Personal", msg.body)
        self.assertIsNotNone(self.sub().payment_failed_at)
        post(failed)  # Stripe retries the same invoice: no second e-mail
        self.assertEqual(len(mail.outbox), 1)
        post(invoice(iid="in_f2", kind="invoice.payment_failed"))  # the next period's invoice fails too
        self.assertEqual(len(mail.outbox), 2)

    def test_the_e_mail_is_in_arabic_for_an_arabic_owner(self):
        User.objects.filter(email="owner@example.com").update(language="ar")
        self.subscribed()
        mail.outbox.clear()
        post(invoice(iid="in_f1", kind="invoice.payment_failed"))
        msg = mail.outbox[0]
        self.assertRegex(msg.subject, "[؀-ۿ]")
        self.assertIn('dir="rtl"', msg.alternatives[0][0])
        self.assertIn("/app/billing", msg.body)

    def test_the_plan_stays_live_through_the_period_and_the_grace_days(self):
        sub = self.subscribed()
        post(invoice(iid="in_f1", kind="invoice.payment_failed"))
        self.assertTrue(is_live(self.workspace))
        data = subscription_json(self.workspace)
        self.assertTrue(data["payment_failed"])
        self.assertTrue(data["live"])
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() - timedelta(days=3))
        self.assertTrue(is_live(self.workspace))  # the grace days still apply
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() - timedelta(days=8))
        self.assertFalse(is_live(self.workspace))

    def test_a_failed_payment_for_an_unknown_subscription_is_ignored(self):
        self.assertEqual(post(invoice(sub="sub_none", kind="invoice.payment_failed")).status_code, 200)
        self.assertEqual(mail.outbox, [])


class SubscriptionEventTests(StripeCase):
    def test_cancel_at_period_end_is_followed_and_can_be_undone(self):
        sub = self.subscribed()
        self.assertEqual(post(event("customer.subscription.updated", subscription_object(cancel=True))).status_code, 200)
        sub = self.sub()
        self.assertTrue(sub.cancel_at_period_end)
        self.assertTrue(sub.auto_renew)  # Stripe still holds the subscription until the end
        data = subscription_json(self.workspace)
        self.assertTrue(data["cancel_at_period_end"])
        self.assertIsNone(data["renews_at"])
        post(event("customer.subscription.updated", subscription_object(cancel=False)))
        sub = self.sub()
        self.assertFalse(sub.cancel_at_period_end)
        self.assertEqual(subscription_json(self.workspace)["renews_at"], subscription_json(self.workspace)["ends_at"])

    def test_a_cancel_date_counts_as_cancelling(self):
        self.subscribed()
        post(event("customer.subscription.updated", subscription_object(cancel_at=ts(timezone.now() + timedelta(days=30)))))
        self.assertTrue(self.sub().cancel_at_period_end)

    def test_a_dead_status_turns_renewal_off_and_the_paid_period_still_runs(self):
        sub = self.subscribed()
        post(event("customer.subscription.updated", subscription_object(status="unpaid")))
        self.assertFalse(self.sub().auto_renew)
        self.assertTrue(is_live(self.workspace))
        post(event("customer.subscription.updated", subscription_object(status="active")))
        self.assertTrue(self.sub().auto_renew)
        self.assertEqual(self.sub().ends_at, sub.ends_at)

    def test_deleted_ends_the_renewal_and_keeps_what_was_paid_for(self):
        sub = self.subscribed()
        self.assertEqual(post(event("customer.subscription.deleted", subscription_object(status="canceled"))).status_code, 200)
        sub2 = self.sub()
        self.assertFalse(sub2.auto_renew)
        self.assertFalse(sub2.cancel_at_period_end)
        self.assertEqual(sub2.stripe_subscription_id, "")
        self.assertEqual(sub2.stripe_customer_id, "cus_1")  # the customer stays, so the portal still opens
        self.assertEqual(sub2.ends_at, sub.ends_at)
        self.assertTrue(is_live(self.workspace))
        data = subscription_json(self.workspace)
        self.assertEqual((data["auto_renew"], data["renews_at"], data["can_manage_billing"]), (False, None, True))

    def test_events_for_other_subscriptions_are_ignored(self):
        self.subscribed()
        post(event("customer.subscription.updated", subscription_object(sub="sub_other", cancel=True)))
        post(event("customer.subscription.deleted", subscription_object(sub="sub_other")))
        sub = self.sub()
        self.assertFalse(sub.cancel_at_period_end)
        self.assertTrue(sub.auto_renew)

    def test_seat_changes_never_go_below_the_seats_in_use(self):
        owner = self.signup("co@example.com")
        ws = owner.client.post(API + "workspaces", {"name": "Acme"}, format="json").data["id"]
        post(session(ws, plan="company", seats=8, amount=3900 * 8, sid="cs_co", invoice="in_co", sub="sub_co", cust="cus_co"))
        for index in range(5):
            self.invite(owner, ws, f"m{index}@example.com")  # 6 people use seats
        post(event("customer.subscription.updated", subscription_object(sub="sub_co", quantity=3, cust="cus_co")))
        self.assertEqual(Subscription.objects.get(workspace_id=ws).seats_total, 6)
        post(event("customer.subscription.updated", subscription_object(sub="sub_co", quantity=12, cust="cus_co")))
        self.assertEqual(Subscription.objects.get(workspace_id=ws).seats_total, 12)

    def test_quantity_is_ignored_for_plans_that_are_not_per_seat(self):
        self.subscribed()
        post(event("customer.subscription.updated", subscription_object(quantity=4)))
        self.assertEqual(self.sub().seats_total, 1)

    def test_unknown_events_are_acknowledged(self):
        self.assertEqual(post(event("customer.created", {"id": "cus_1"})).status_code, 200)
        self.assertEqual(post(event("invoice.finalized", {"id": "in_1"})).status_code, 200)

    def test_every_event_needs_a_valid_signature(self):
        payload, _ = signed(invoice())
        res = APIClient().post(URL, data=payload, content_type="application/json", HTTP_STRIPE_SIGNATURE="t=1,v1=bad")
        self.assertEqual(res.status_code, 400)
        self.assertFalse(Payment.objects.exists())
        for kind, obj in (("customer.subscription.updated", subscription_object(cancel=True)), ("customer.subscription.deleted", subscription_object())):
            payload, _ = signed(event(kind, obj))
            self.assertEqual(APIClient().post(URL, data=payload, content_type="application/json", HTTP_STRIPE_SIGNATURE="").status_code, 400)


class BillingPortalTests(StripeCase):
    def url(self, ws=None):
        return f"{API}workspaces/{ws or self.ws}/billing-portal"

    def test_development_answers_payments_unavailable(self):
        res = self.owner.client.post(self.url())
        self.assertEqual((res.status_code, res.data["error"]["code"]), (503, "payments_unavailable"))

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="")
    def test_no_stripe_key_answers_payments_unavailable(self):
        res = self.owner.client.post(self.url())
        self.assertEqual(res.status_code, 503)

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
    def test_the_owner_gets_a_portal_link(self):
        self.subscribed()
        fake = SimpleNamespace(url="https://billing.stripe.test/session/bps_1")
        with mock.patch.object(stripe.billing_portal.Session, "create", return_value=fake) as create:
            res = self.owner.client.post(self.url())
        self.assertEqual(res.status_code, 200, res.content)
        self.assertEqual(res.data["url"], fake.url)
        self.assertEqual(create.call_args.kwargs, {"customer": "cus_1", "return_url": "https://web.test/app/billing"})

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
    def test_no_payment_by_card_means_nothing_to_manage(self):
        res = self.owner.client.post(self.url())
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "no_billing_account"))

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
    def test_stripe_trouble_is_a_clear_502(self):
        self.subscribed()
        with mock.patch.object(stripe.billing_portal.Session, "create", side_effect=stripe.error.APIConnectionError("down")):
            res = self.owner.client.post(self.url())
        self.assertEqual((res.status_code, res.data["error"]["code"]), (502, "payments_unavailable"))

    @override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
    def test_only_the_owner_opens_it(self):
        owner = self.signup("co@example.com")
        ws = self.company_on(owner)
        Subscription.objects.filter(workspace_id=ws).update(stripe_customer_id="cus_co")
        admin = self.join(self.invite(owner, ws, "admin@example.com", role="admin"))
        eve = self.join(self.invite(owner, ws, "eve@example.com"))
        self.assertEqual(admin.client.post(self.url(ws)).status_code, 403)
        self.assertEqual(eve.client.post(self.url(ws)).status_code, 403)
        self.assertEqual(self.client_for().post(self.url(ws)).status_code, 401)
        stranger = self.signup("x@example.com")
        self.assertEqual(stranger.client.post(self.url(ws)).status_code, 404)
        fake = SimpleNamespace(url="https://billing.stripe.test/s")
        with mock.patch.object(stripe.billing_portal.Session, "create", return_value=fake):
            self.assertEqual(owner.client.post(self.url(ws)).status_code, 200)


@override_settings(CARDS_DEV_ACTIVATE=False, STRIPE_SECRET_KEY="sk_test_123")
class CheckoutWhileRenewingTests(StripeCase):
    def checkout(self, plan="personal"):
        fake = SimpleNamespace(url="https://checkout.stripe.test/x")
        with mock.patch.object(stripe.checkout.Session, "create", return_value=fake) as create:
            res = self.owner.client.post(f"{API}workspaces/{self.ws}/checkout", {"plan_code": plan}, format="json")
        return res, create

    def test_a_plan_that_renews_by_itself_cannot_be_paid_for_again(self):
        self.subscribed()
        res, create = self.checkout()
        self.assertEqual((res.status_code, res.data["error"]["code"]), (409, "already_subscribed"))
        create.assert_not_called()

    def test_after_the_renewal_is_turned_off_the_owner_may_subscribe_again(self):
        self.subscribed()
        post(event("customer.subscription.updated", subscription_object(cancel=True)))
        res, create = self.checkout()
        self.assertEqual(res.status_code, 200, res.content)
        create.assert_called_once()

    def test_an_expired_plan_may_be_bought_again_and_reuses_the_stripe_customer(self):
        sub = self.subscribed()
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() - timedelta(days=30), status="expired")
        post(event("customer.subscription.deleted", subscription_object()))
        res, create = self.checkout()
        self.assertEqual(res.status_code, 200)
        kwargs = create.call_args.kwargs
        self.assertEqual(kwargs["customer"], "cus_1")
        self.assertNotIn("customer_email", kwargs)

    def test_a_free_trial_owner_pays_with_their_e_mail(self):
        ensure_trial(self.workspace)
        res, create = self.checkout()
        self.assertEqual(res.status_code, 200)
        self.assertEqual(create.call_args.kwargs["customer_email"], "owner@example.com")

    def test_the_subscription_json_describes_renewal(self):
        sub = self.subscribed()
        data = self.owner.client.get(f"{API}workspaces/{self.ws}/subscription").data
        self.assertEqual((data["auto_renew"], data["cancel_at_period_end"], data["payment_failed"], data["can_manage_billing"]), (True, False, False, True))
        self.assertEqual(data["renews_at"], data["ends_at"])
        listed = next(w for w in self.owner.client.get(API + "me/workspaces").data if w["id"] == self.ws)
        self.assertTrue(listed["subscription"]["auto_renew"])
        self.assertIsNotNone(sub)

    def test_an_employee_does_not_see_the_billing_details(self):
        owner = self.signup("co@example.com")
        ws = self.company_on(owner)
        Subscription.objects.filter(workspace_id=ws).update(auto_renew=True, stripe_customer_id="cus_c", payment_failed_at=timezone.now())
        eve = self.join(self.invite(owner, ws, "eve@example.com"))
        data = next(w for w in eve.client.get(API + "me/workspaces").data if w["id"] == ws)["subscription"]
        self.assertEqual((data["payment_failed"], data["can_manage_billing"], data["renews_at"], data["ends_at"]), (False, False, None, None))


class RenewalReminderTests(StripeCase):
    def run_command(self):
        call_command("send_renewal_reminders", stdout=StringIO())

    def test_a_renewing_plan_gets_one_renews_on_notice_and_no_last_day_mail(self):
        sub = self.subscribed()
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() + timedelta(days=6))
        mail.outbox.clear()
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertIn("renews", msg.subject)
        self.assertNotIn("ends", msg.subject)
        self.assertIn("automatically", msg.body)
        self.assertIn("Manage billing", msg.alternatives[0][0])
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)
        # Five days later the same period is one day from its end (the 7-day notice was sent for this very end date).
        end = timezone.now() + timedelta(hours=20)
        Subscription.objects.filter(pk=sub.pk).update(ends_at=end, reminder_7_for=end)
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)  # the last-day reminder is skipped: Stripe charges the card
        self.assertEqual(self.sub().reminder_1_for, end)

    def test_a_plan_that_will_not_renew_gets_the_ends_on_reminders(self):
        sub = self.subscribed()
        post(event("customer.subscription.updated", subscription_object(cancel=True)))
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() + timedelta(days=6))
        mail.outbox.clear()
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("ends", mail.outbox[0].subject)
        self.assertIn("Renew now", mail.outbox[0].alternatives[0][0])

    def test_a_renewal_that_is_failing_gets_the_ends_on_reminder(self):
        sub = self.subscribed()
        post(invoice(iid="in_f", kind="invoice.payment_failed"))
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() + timedelta(days=6))
        mail.outbox.clear()
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("ends", mail.outbox[0].subject)

    def test_the_renewal_notice_is_in_arabic_for_an_arabic_owner(self):
        User.objects.filter(email="owner@example.com").update(language="ar")
        sub = self.subscribed()
        Subscription.objects.filter(pk=sub.pk).update(ends_at=timezone.now() + timedelta(days=6))
        mail.outbox.clear()
        self.run_command()
        self.assertRegex(mail.outbox[0].subject, "[؀-ۿ]")
        self.assertIn('dir="rtl"', mail.outbox[0].alternatives[0][0])

    def test_a_plan_without_automatic_renewal_keeps_both_reminders(self):
        self.buy(self.owner, "personal")
        sub = self.sub()
        sub.ends_at = timezone.now() + timedelta(days=6)
        sub.save()
        self.run_command()
        sub.ends_at = timezone.now() + timedelta(hours=20)
        sub.save()
        self.run_command()
        self.assertEqual(len(mail.outbox), 2)


class FreeWeekReminderTests(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("free@example.com", "Fay Free")
        self.workspace = Workspace.objects.get(pk=self.owner.ws)
        ensure_trial(self.workspace)
        self.sub = Subscription.objects.get(workspace=self.workspace)
        mail.outbox.clear()

    def run_command(self):
        call_command("send_renewal_reminders", stdout=StringIO())

    def set_end(self, delta):
        Subscription.objects.filter(pk=self.sub.pk).update(ends_at=timezone.now() + delta)

    def test_nothing_in_the_first_days(self):
        self.set_end(timedelta(days=5))
        self.run_command()
        self.assertEqual(mail.outbox, [])

    def test_two_days_before_the_end_once(self):
        self.set_end(timedelta(days=1, hours=20))
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)
        msg = mail.outbox[0]
        self.assertEqual(msg.to, ["free@example.com"])
        self.assertIn("free week", msg.subject)
        self.assertIn("offline", msg.body)
        self.assertIn("https://web.test/app/billing", msg.body)
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)

    def test_when_it_has_ended_once_and_the_two_day_mail_is_not_sent_after(self):
        self.set_end(timedelta(days=1))
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)
        self.set_end(-timedelta(hours=3))
        self.run_command()
        self.assertEqual(len(mail.outbox), 2)
        self.assertIn("offline", mail.outbox[1].subject)
        self.assertIn("Choose a plan", mail.outbox[1].alternatives[0][0])
        self.run_command()
        self.assertEqual(len(mail.outbox), 2)

    def test_a_trial_that_ended_long_ago_is_left_alone(self):
        self.set_end(-timedelta(days=10))
        self.run_command()
        self.assertEqual(mail.outbox, [])

    def test_a_trial_that_ended_before_the_two_day_mail_goes_straight_to_the_ended_mail(self):
        self.set_end(-timedelta(hours=5))
        self.run_command()
        self.assertEqual(len(mail.outbox), 1)
        self.assertIn("offline", mail.outbox[0].subject)

    def test_a_person_who_already_paid_gets_no_free_week_mail(self):
        self.set_end(timedelta(days=1))
        self.buy(self.owner, "personal")
        mail.outbox.clear()
        self.run_command()
        self.assertEqual(mail.outbox, [])

    def test_the_free_week_mails_are_in_arabic_for_an_arabic_owner(self):
        User.objects.filter(email="free@example.com").update(language="ar")
        self.set_end(timedelta(days=1))
        self.run_command()
        self.assertRegex(mail.outbox[0].subject, "[؀-ۿ]")
        self.assertIn('dir="rtl"', mail.outbox[0].alternatives[0][0])
        self.set_end(-timedelta(hours=1))
        self.run_command()
        self.assertRegex(mail.outbox[1].subject, "[؀-ۿ]")

    def test_company_owners_are_not_mailed_about_a_free_week(self):
        # only a personal workspace has a free plan; a company on a plan that has ended gets the paid-plan reminders
        ws = self.company(self.owner, plan="company")
        Subscription.objects.filter(workspace_id=ws).update(ends_at=timezone.now() + timedelta(days=30))
        mail.outbox.clear()
        self.run_command()
        self.assertEqual(mail.outbox, [])
        self.assertFalse(Member.objects.filter(workspace_id=ws, role="employee").exists())
