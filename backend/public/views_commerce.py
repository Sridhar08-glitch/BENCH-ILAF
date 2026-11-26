"""Public selling and booking: the products of a card, placing an order, following it, free slots and bookings.

Writes follow the exchange-contact form's rules: honeypot, a minimum fill time, caps per address and per card,
and a consent tick. Every order and booking also lands in the contacts list as a lead."""
from datetime import timedelta

from django.db import transaction
from django.http import Http404
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response

from cards import booking_mail, booking_slots, extras
from cards.models import Booking, BookingSettings, Product
from cards.slugs import resolve_card
from workspaces.sharing import card_shares_with_company
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import request_language
from ilaf.throttles import PublicLeadThrottle
from ilaf.utils import clean_line, clean_multiline, file_url, iso
from leads import services as lead_services
from orders import services as order_services
from orders.models import Order, new_number

from .views import PublicBase, card_state

EMAIL_OK = serializers.EmailField()


def _live_card(key):
    card = resolve_card(key)
    if card is None or card_state(card) != "live":
        raise Http404
    return card


def _lang(card, request):
    """The visitor's language: the card's fixed language, else the request's."""
    return card.language if card.language in ("en", "ar") else request_language(request)


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


# ---------------------------------------------------------------- products and orders
def public_product_json(product, request):
    return {
        "id": str(product.id), "section_id": str(product.section_id) if product.section_id else None,
        "title": product.title, "description": product.description, "price": order_services.money(product.price),
        "currency": product.currency, "image_url": file_url(request, product.image), "badge": product.badge,
        "meta": product.meta or {}, "order": product.order,
        "sold_out": product.stock is not None and product.stock <= 0,
    }


def public_products(card, request):
    """The items a visitor may order, in order. Used by the products endpoint and by the public card JSON."""
    return [public_product_json(p, request) for p in card.products.filter(on=True)]


class PublicProductsView(PublicBase):
    def get(self, request, key):
        card = _live_card(key)
        items = public_products(card, request)
        return Response({"currency": items[0]["currency"] if items else None, "products": items})


class PublicOrderView(PublicBase):
    """A visitor places an order from the cart. Answers the order number they keep."""

    throttle_classes = [PublicLeadThrottle]

    def post(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        data = _body(request)
        if lead_services.is_honeypot(data):
            # A bot filled the hidden field: pretend it worked, store nothing.
            return Response({"number": new_number(), "status": "new", "total": "0.00", "currency": "QAR"}, status=201)
        if card_state(card) != "live":
            raise Http404
        if not Product.objects.filter(card=card, on=True).exists() or not extras.is_allowed(card, "products"):
            raise ApiError("feature_off", "This card is not taking orders.", 403)
        lead_services.check_not_too_fast(data)
        lead_services.check_card_cap(card, request)
        lead_services.check_consent(data)
        order = order_services.place_order(card, data, request, lang=_lang(card, request))
        lead_services.count_for_cap(card, request)
        return Response({
            "number": order.number, "status": order.status, "total": order_services.money(order.total), "currency": order.currency,
        }, status=201)


class PublicOrderStatusView(PublicBase):
    """Where an order stands, for the buyer: the number plus the phone they ordered with."""

    throttle_classes = [PublicLeadThrottle]

    def get(self, request, number):
        phone = request.query_params.get("phone") or ""
        order = Order.objects.select_related("card").filter(number=str(number).strip().upper()).first()
        if order is None or not order_services.phones_match(order.customer_phone, phone):
            raise Http404
        return Response(order_services.public_json(order))


# ---------------------------------------------------------------- booking
def public_booking(card):
    """What the public page needs to draw the booking block (never the owner's e-mail or internal notes)."""
    row = BookingSettings.objects.filter(card=card).first()
    if row is None or not row.enabled:
        return {"enabled": False}
    return {
        "enabled": True, "timezone": row.timezone, "slot_minutes": row.slot_minutes, "days_ahead": row.days_ahead,
        "location_note": row.location_note, "meet_link": row.meet_link or None,
    }


def _booking_settings(card):
    row = BookingSettings.objects.filter(card=card).first()
    if row is None or not row.enabled:
        raise ApiError("feature_off", "This card is not taking bookings.", 403)
    return row


class PublicBookingInfoView(PublicBase):
    def get(self, request, key):
        return Response(public_booking(_live_card(key)))


class PublicAvailabilityView(PublicBase):
    """Free slots from a date (today by default) for up to 31 days, as local times of the card's timezone."""

    def get(self, request, key):
        card = _live_card(key)
        row = _booking_settings(card)
        first = request.query_params.get("from")
        first_day = booking_slots.parse_day(first) if first else None
        if first and first_day is None:
            raise validation_error({"from": ["Use the form YYYY-MM-DD."]})
        try:
            days = int(request.query_params.get("days", 14))
        except (TypeError, ValueError):
            raise validation_error({"days": ["Must be a number."]})
        if not 1 <= days <= booking_slots.MAX_DAYS_PER_REQUEST:
            raise validation_error({"days": [f"Choose between 1 and {booking_slots.MAX_DAYS_PER_REQUEST} days."]})
        return Response(booking_slots.availability(row, card, first_day, days))


def clean_booking(data):
    """Name, e-mail, optional phone and note of a booking request."""
    errors = {}

    def text(name, limit, multiline=False):
        raw = data.get(name)
        if raw is None:
            return ""
        if not isinstance(raw, str):
            errors[name] = ["Must be text."]
            return ""
        try:
            return clean_multiline(raw, limit) if multiline else clean_line(raw, limit)
        except DRFValidationError as exc:
            errors[name] = [str(m) for m in exc.detail]
            return ""

    name = text("name", 120)
    email = text("email", 254)
    phone = text("phone", 40)
    note = text("note", 500, multiline=True)
    if not name and "name" not in errors:
        errors["name"] = ["Enter your name."]
    if not email and "email" not in errors:
        errors["email"] = ["Enter your email address."]
    elif email:
        try:
            EMAIL_OK.run_validation(email)
        except DRFValidationError:
            errors["email"] = ["Enter a valid email address."]
    if errors:
        raise validation_error(errors)
    return {"name": name, "email": email, "phone": phone, "note": note}


def _requested_start(row, data):
    """The start the visitor picked: `date` (YYYY-MM-DD) and `time` (HH:MM) in the card's timezone."""
    day = booking_slots.parse_day(data.get("date"))
    hhmm = data.get("time")
    if day is None:
        raise validation_error({"date": ["Use the form YYYY-MM-DD."]})
    if not isinstance(hhmm, str) or not booking_slots.TIME_RE.match(hhmm):
        raise validation_error({"time": ["Times must be written as HH:MM, for example 09:00."]})
    return booking_slots.local_start(row, day, hhmm)


SLOT_PROBLEMS = {
    "past": "Choose a time in the future.",
    "outside": "This time is outside the booking hours.",
    "taken": "This time was just taken. Choose another slot.",
}


class PublicBookingView(PublicBase):
    """A visitor books a free slot. The settings row is locked while the slot is checked and saved, so two visitors
    cannot take the same time."""

    throttle_classes = [PublicLeadThrottle]

    def post(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        data = _body(request)
        if lead_services.is_honeypot(data):
            return Response({"id": None, "start_at": None, "end_at": None, "status": "requested"}, status=201)
        if card_state(card) != "live":
            raise Http404
        row = _booking_settings(card)
        if not extras.is_allowed(card, "booking"):
            raise ApiError("feature_off", "This card is not taking bookings.", 403)
        lead_services.check_not_too_fast(data)
        lead_services.check_card_cap(card, request)
        fields = clean_booking(data)
        lead_services.check_consent(data)
        start = _requested_start(row, data)
        with transaction.atomic():
            row = BookingSettings.objects.select_for_update().get(pk=row.pk)
            problem = booking_slots.slot_problem(row, card, start)
            if problem:
                raise validation_error({"time": [SLOT_PROBLEMS[problem]]})
            booking = Booking.objects.create(
                card=card, start_at=start, end_at=start + timedelta(minutes=row.slot_minutes),
                consented_at=timezone.now(), shared_with_company=card_shares_with_company(card), **fields,
            )
        lead_services.count_for_cap(card, request)
        lang = _lang(card, request)
        when = booking_slots.format_local(row, booking.start_at)
        lead_note = f"Booking: {when}" + (f"\n{fields['note']}" if fields["note"] else "")
        try:
            lead_services.save_lead(
                card, "booking", {"name": fields["name"], "email": fields["email"], "phone": fields["phone"], "company": "", "note": lead_note}, data,
            )
        except Exception:  # the booking is saved; a contacts problem must not undo it
            pass
        booking_mail.send_visitor_booking_email(booking, row, "received", lang)
        return Response({
            "id": str(booking.id), "start_at": iso(booking.start_at), "end_at": iso(booking.end_at), "status": booking.status,
        }, status=201)


class PublicBookingCancelView(PublicBase):
    """The visitor cancels with the booking id and the e-mail they booked with."""

    throttle_classes = [PublicLeadThrottle]

    def post(self, request, booking_id):
        email = (request.query_params.get("email") or _body(request).get("email") or "")
        email = email.strip().lower() if isinstance(email, str) else ""
        booking = Booking.objects.select_related("card").filter(pk=booking_id).first()
        if booking is None or not email or booking.email.lower() != email:
            raise Http404
        if booking.status not in Booking.ACTIVE_STATUSES:
            raise validation_error({"booking": ["This booking is already closed."]})
        if booking.start_at <= timezone.now():
            raise validation_error({"booking": ["This booking has already taken place."]})
        booking.status = "cancelled"
        booking.save(update_fields=["status", "updated_at"])
        row = BookingSettings.objects.filter(card=booking.card).first() or BookingSettings(card=booking.card)
        booking_mail.send_visitor_booking_email(booking, row, "cancelled", _lang(booking.card, request))
        return Response({"id": str(booking.id), "status": booking.status})
