"""E-mails about plans: Enterprise quotes, failed renewal payments, automatic renewal notices and the free week.
Every text goes through `tr` so it has an Arabic version (ilaf/locale_ar_errors.py)."""
from django.conf import settings

from ilaf.emails import send_brand_email
from ilaf.i18n import format_date, language_for_email, tr
from workspaces.models import Member

BILLING_URL = "/app/billing"


def owner_emails(workspace):
    members = Member.objects.filter(workspace=workspace, role="owner", status="active").select_related("user")
    return [m.user.email for m in members if m.user]


def money(minor, currency):
    """1234500 minor units -> "12,345.00 QAR"."""
    return f"{minor / 100:,.2f} {currency}"


def _send(workspace, subject, heading, paragraphs, button, path=BILLING_URL):
    sent = 0
    for email in owner_emails(workspace):
        lang = language_for_email(email)
        send_brand_email(
            email, subject(lang), heading(lang), paragraphs(lang), button(lang) if button else None,
            f"{settings.WEB_BASE_URL}{path}" if button else None, lang=lang,
        )
        sent += 1
    return sent


def send_enterprise_quote(req):
    """Tell the owner their Enterprise quote is ready."""
    ws = req.workspace
    total = money(req.quoted_total_minor, req.currency)
    per_seat = money(req.quoted_price_per_seat_minor, req.currency)

    def paragraphs(lang):
        lines = [
            tr(
                lang, "We prepared an Enterprise quote for {company}: {seats} seats at {price} per seat per year, {total} per year in total.",
                company=ws.name, seats=req.quoted_seats, price=per_seat, total=total,
            ),
        ]
        if req.staff_note:
            lines.append(tr(lang, "A note from our team: {note}", note=req.staff_note))
        lines.append(tr(lang, "Open Billing to accept the quote and pay. It renews every year until you cancel."))
        return lines

    return _send(
        ws,
        lambda lang: tr(lang, "Your {product} Enterprise quote is ready", product=settings.PRODUCT_NAME),
        lambda lang: tr(lang, "Your Enterprise quote"),
        paragraphs,
        lambda lang: tr(lang, "View the quote"),
    )


def send_enterprise_declined(req):
    ws = req.workspace

    def paragraphs(lang):
        lines = [tr(lang, "We cannot offer an Enterprise plan to {company} right now.", company=ws.name)]
        if req.staff_note:
            lines.append(tr(lang, "A note from our team: {note}", note=req.staff_note))
        lines.append(tr(lang, "Your current plan is not changed. You can write to us again at any time."))
        return lines

    return _send(
        ws,
        lambda lang: tr(lang, "About your {product} Enterprise request", product=settings.PRODUCT_NAME),
        lambda lang: tr(lang, "Your Enterprise request"),
        paragraphs,
        lambda lang: tr(lang, "Open billing"),
    )


def send_payment_failed(sub):
    """The renewal payment failed: ask the owner to fix the payment method. The grace days after the period end still apply."""
    ws = sub.workspace

    def paragraphs(lang):
        return [
            tr(lang, "We could not charge your card for the {plan} plan of {company}.", plan=sub.plan.name, company=ws.name),
            tr(
                lang, "Your plan runs until {date}. Please update your payment method in Billing; we will try again. "
                "If the payment keeps failing, your cards are paused a few days after that date.",
                date=format_date(lang, sub.ends_at),
            ),
        ]

    return _send(
        ws,
        lambda lang: tr(lang, "We could not renew your {product} plan", product=settings.PRODUCT_NAME),
        lambda lang: tr(lang, "Your payment did not go through"),
        paragraphs,
        lambda lang: tr(lang, "Fix payment method"),
    )


def send_auto_renewal_notice(sub):
    """A week before an automatic renewal: say when and what will be charged to the card on file."""
    ws = sub.workspace

    def paragraphs(lang):
        return [
            tr(
                lang, "Your {plan} plan for {company} renews automatically on {date}.",
                plan=sub.plan.name, company=ws.name, date=format_date(lang, sub.ends_at),
            ),
            tr(lang, "We will charge the card on file for another year. You do not need to do anything. To change the card or stop the renewal, open Billing."),
        ]

    return _send(
        ws,
        lambda lang: tr(lang, "Your {product} plan renews on {date}", product=settings.PRODUCT_NAME, date=format_date(lang, sub.ends_at)),
        lambda lang: tr(lang, "Your plan renews soon"),
        paragraphs,
        lambda lang: tr(lang, "Manage billing"),
    )


def send_free_ending(sub):
    def paragraphs(lang):
        return [
            tr(lang, "Your free week ends on {date}. After that your card goes offline.", date=format_date(lang, sub.ends_at)),
            tr(lang, "Choose a plan to keep your card online."),
        ]

    return _send(
        sub.workspace,
        lambda lang: tr(lang, "Your free week on {product} ends in 2 days", product=settings.PRODUCT_NAME),
        lambda lang: tr(lang, "Your free week is ending"),
        paragraphs,
        lambda lang: tr(lang, "Choose a plan"),
    )


def send_free_ended(sub):
    def paragraphs(lang):
        return [
            tr(lang, "Your free week ended on {date}, so your card is offline: people who scan it cannot open it.", date=format_date(lang, sub.ends_at)),
            tr(lang, "Choose a plan to put your card back online."),
        ]

    return _send(
        sub.workspace,
        lambda lang: tr(lang, "Your {product} card is offline", product=settings.PRODUCT_NAME),
        lambda lang: tr(lang, "Your free week has ended"),
        paragraphs,
        lambda lang: tr(lang, "Choose a plan"),
    )
