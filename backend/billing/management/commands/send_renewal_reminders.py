from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.db.models import Q
from django.utils import timezone

from billing import notices
from billing.models import Subscription
from billing.services import FREE_PLAN_CODE
from ilaf.emails import send_brand_email
from ilaf.i18n import format_date, language_for_email, tr, trn

FREE_SOON_DAYS = 2  # the free week's "ends soon" mail goes out this many days before the end
FREE_ENDED_WINDOW = timedelta(days=3)  # a trial that ended longer ago than this is not written to


class Command(BaseCommand):
    help = (
        "Email owners 7 days and 1 day before a paid period ends (a plan that renews by itself gets one 'renews on' notice "
        "instead), and free-week owners 2 days before the week ends and when it has ended. Run daily; each mail is sent once."
    )

    def handle(self, *args, **options):
        now = timezone.now()
        sent = self.paid(now) + self.free(now)
        self.stdout.write(f"Reminder emails sent: {sent}")

    def paid(self, now):
        sent = 0
        paid = Q(plan__price_minor__gt=0) | Q(plan_id="enterprise")
        subs = Subscription.objects.filter(
            paid, status="active", ends_at__gt=now, ends_at__lte=now + timedelta(days=7)
        ).select_related("workspace", "plan")
        for sub in subs:
            one_day = sub.ends_at <= now + timedelta(days=1)
            renews = sub.auto_renew and not sub.cancel_at_period_end and sub.payment_failed_at is None
            if renews:
                # Stripe charges the card by itself: say so once, a week ahead, and skip the last-day reminder.
                if sub.reminder_7_for != sub.ends_at:
                    sent += notices.send_auto_renewal_notice(sub)
                sub.reminder_7_for = sub.ends_at
                sub.reminder_1_for = sub.ends_at if one_day else sub.reminder_1_for
                sub.save(update_fields=["reminder_1_for", "reminder_7_for"])
                continue
            if one_day:
                if sub.reminder_1_for == sub.ends_at:
                    continue
                days_left = 1
            else:
                if sub.reminder_7_for == sub.ends_at:
                    continue
                days_left = 7
            for email in notices.owner_emails(sub.workspace):
                lang = language_for_email(email)
                when = tr(lang, "tomorrow") if days_left == 1 else tr(lang, "in 7 days")
                send_brand_email(
                    email,
                    tr(lang, "Your {product} plan ends {when}", product=settings.PRODUCT_NAME, when=when),
                    tr(lang, "Your plan is about to end"),
                    [
                        tr(
                            lang, "Your {plan} plan for {company} ends on {date}.",
                            plan=sub.plan.name, company=sub.workspace.name, date=format_date(lang, sub.ends_at),
                        ),
                        trn(
                            lang, settings.CARDS_GRACE_DAYS,
                            "Renew now to keep your cards online. After the end date your cards stay visible for {n} more day, then they are paused.",
                            "Renew now to keep your cards online. After the end date your cards stay visible for {n} more days, then they are paused.",
                        ),
                    ],
                    tr(lang, "Renew now"),
                    f"{settings.WEB_BASE_URL}/app/billing",
                    lang=lang,
                )
                sent += 1
            # The 1-day reminder also covers the 7-day one if that was missed.
            sub.reminder_7_for = sub.ends_at
            if days_left == 1:
                sub.reminder_1_for = sub.ends_at
            sub.save(update_fields=["reminder_1_for", "reminder_7_for"])
        return sent

    def free(self, now):
        """The free week: a mail 2 days before it ends, and one when it has ended ("your card is offline, choose a plan")."""
        sent = 0
        soon = Subscription.objects.filter(
            plan_id=FREE_PLAN_CODE, ends_at__gt=now, ends_at__lte=now + timedelta(days=FREE_SOON_DAYS),
        ).select_related("workspace", "plan")
        for sub in soon:
            if sub.free_reminder_for == sub.ends_at:
                continue
            sent += notices.send_free_ending(sub)
            sub.free_reminder_for = sub.ends_at
            sub.save(update_fields=["free_reminder_for"])
        ended = Subscription.objects.filter(
            plan_id=FREE_PLAN_CODE, ends_at__lte=now, ends_at__gt=now - FREE_ENDED_WINDOW,
        ).select_related("workspace", "plan")
        for sub in ended:
            if sub.free_ended_for == sub.ends_at:
                continue
            sent += notices.send_free_ended(sub)
            sub.free_ended_for = sub.ends_at
            sub.free_reminder_for = sub.ends_at  # the "ends soon" mail is moot once it has ended
            sub.save(update_fields=["free_ended_for", "free_reminder_for"])
        return sent
