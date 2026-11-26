"""The e-mails a visitor gets about their booking: received, confirmed, cancelled. Sent the same way lead e-mails
are (the brand template; a no-op until a mail server is configured). Nothing here ever raises."""
from ilaf.emails import send_brand_email
from ilaf.i18n import tr

from . import booking_slots

SUBJECTS = {
    "received": ("Your booking with {name}", "Booking received"),
    "confirmed": ("Your booking with {name} is confirmed", "Your booking is confirmed"),
    "cancelled": ("Your booking with {name} was cancelled", "Your booking was cancelled"),
}


def send_visitor_booking_email(booking, settings_row, kind, lang="en"):
    if not booking.email or kind not in SUBJECTS:
        return
    try:
        card = booking.card
        who = card.name or card.company or "the card owner"
        subject, heading = SUBJECTS[kind]
        lines = [
            tr(lang, "When: {value}", value=booking_slots.format_local(settings_row, booking.start_at, lang)),
            tr(lang, "With: {value}", value=who),
        ]
        if settings_row.location_note:
            lines.append(tr(lang, "Where: {value}", value=settings_row.location_note))
        if settings_row.meet_link and kind != "cancelled":
            lines.append(tr(lang, "Video link: {value}", value=settings_row.meet_link))
        if kind == "received":
            lines.append(tr(lang, "We will confirm your booking shortly."))
        send_brand_email(booking.email, tr(lang, subject, name=who), tr(lang, heading), lines, lang=lang)
    except Exception:
        pass
