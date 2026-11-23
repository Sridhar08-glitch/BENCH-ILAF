from datetime import timedelta

from django.conf import settings
from django.core.management.base import BaseCommand
from django.utils import timezone

from billing.models import Subscription
from ilaf.emails import send_brand_email
from ilaf.i18n import format_date, language_for_email, tr, trn
from workspaces.models import Member


def _owner_emails(workspace):
    members = Member.objects.filter(workspace=workspace, role="owner", status="active").select_related("user")
    return [m.user.email for m in members if m.user]


class Command(BaseCommand):
    help = "Email owners 7 days and 1 day before their period ends. Run daily; each reminder is sent once."

    def handle(self, *args, **options):
        now = timezone.now()
        sent = 0
        subs = Subscription.objects.filter(
            status="active", ends_at__gt=now, ends_at__lte=now + timedelta(days=7)
        ).select_related("workspace", "plan")
        for sub in subs:
            one_day = sub.ends_at <= now + timedelta(days=1)
            if one_day:
                if sub.reminder_1_for == sub.ends_at:
                    continue
                days_left = 1
            else:
                if sub.reminder_7_for == sub.ends_at:
                    continue
                days_left = 7
            for email in _owner_emails(sub.workspace):
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
        self.stdout.write(f"Reminder emails sent: {sent}")
