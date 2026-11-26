"""Owner and team endpoints for orders and bookings: lists with filters, detail, status changes, CSV export.

Who sees what: a person sees the orders and bookings of their own cards. Owners and admins also see those of the company's own
card, never those of an employee's card. A company waiting for deletion has these closed like its contacts."""
import csv
from datetime import datetime, time, timedelta, timezone as dt_tz

from django.conf import settings
from django.db.models import Q
from django.http import Http404, StreamingHttpResponse
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from cards import booking_mail, booking_slots
from cards.models import BookingSettings
from ilaf.errors import validation_error
from ilaf.i18n import request_language
from ilaf.utils import clean_multiline, iso
from leads.views import _csv_safe, _date, _Echo, lead_access
from operations import audit
from orders import services as order_services
from orders.models import Order
from workspaces.access import commerce_bookings, commerce_cards, commerce_orders

ORDER_STATUSES = tuple(k for k, _ in Order.STATUSES)
PAYMENT_STATUSES = tuple(k for k, _ in Order.PAYMENT_STATUSES)
BOOKING_TRANSITIONS = {"requested": ("confirmed", "cancelled"), "confirmed": ("done", "cancelled")}


def _int(params, name, default, lo, hi):
    try:
        return max(lo, min(int(params.get(name, default)), hi))
    except (TypeError, ValueError):
        raise validation_error({name: ["Must be a number."]})


def _page(qs, params, to_json):
    page = _int(params, "page", 1, 1, 10**6)
    size = _int(params, "page_size", 50, 1, 200)
    count = qs.count()
    pages = max(1, (count + size - 1) // size)
    rows = qs[(page - 1) * size: page * size]
    return {"count": count, "page": page, "pages": pages, "page_size": size, "results": [to_json(r) for r in rows]}


def _card_filter(qs, params, member):
    card_id = params.get("card")
    if card_id:
        try:
            qs = qs.filter(card_id=card_id)
        except Exception:
            raise validation_error({"card": ["Not a valid card id."]})
    return qs


def _day_bounds(params):
    start, end = _date(params, "from"), _date(params, "to")
    lo = datetime.combine(start, time.min, tzinfo=dt_tz.utc) if start else None
    hi = datetime.combine(end + timedelta(days=1), time.min, tzinfo=dt_tz.utc) if end else None
    return lo, hi


# ---------------------------------------------------------------- orders
def scoped_orders(member, params):
    qs = commerce_orders(member)
    qs = _card_filter(qs.select_related("card"), params, member)
    statuses = [x for x in (params.get("status") or "").split(",") if x]
    if statuses:
        qs = qs.filter(status__in=statuses)
    payment = params.get("payment_status")
    if payment:
        qs = qs.filter(payment_status=payment)
    lo, hi = _day_bounds(params)
    if lo:
        qs = qs.filter(created_at__gte=lo)
    if hi:
        qs = qs.filter(created_at__lt=hi)
    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(number__icontains=q) | Q(customer_name__icontains=q) | Q(customer_phone__icontains=q)
            | Q(customer_email__icontains=q)
        )
    return qs.order_by("-created_at", "-id")


class OrdersView(APIView):
    def get(self, request, workspace_id):
        _, member = lead_access(request.user, workspace_id)
        return Response(_page(scoped_orders(member, request.query_params), request.query_params, order_services.order_json))


def _open_order(request, workspace_id, order_id):
    workspace, member = lead_access(request.user, workspace_id)
    order = scoped_orders(member, {}).filter(pk=order_id).first()
    if order is None:
        raise Http404
    return workspace, member, order


class OrderDetailView(APIView):
    def get(self, request, workspace_id, order_id):
        _, _, order = _open_order(request, workspace_id, order_id)
        return Response(order_services.order_json(order))

    def patch(self, request, workspace_id, order_id):
        workspace, _, order = _open_order(request, workspace_id, order_id)
        data = request.data if isinstance(request.data, dict) else {}
        errors, changes = {}, {}
        if "status" in data:
            status = data["status"]
            if status not in ORDER_STATUSES:
                errors["status"] = ["Choose one of the listed statuses."]
            elif status != order.status and order.status in Order.FINAL_STATUSES:
                errors["status"] = ["This order is finished and cannot change status."]
            elif status != order.status:
                changes["status"] = (order.status, status)
        if "payment_status" in data:
            payment = data["payment_status"]
            if payment not in PAYMENT_STATUSES:
                errors["payment_status"] = ["Choose unpaid, paid or refunded."]
            elif payment != order.payment_status:
                changes["payment_status"] = (order.payment_status, payment)
        if "note" in data:
            raw = data["note"]
            if raw is None:
                raw = ""
            if not isinstance(raw, str):
                errors["note"] = ["Must be text."]
            else:
                try:
                    note = clean_multiline(raw, 500)
                except DRFValidationError as exc:
                    errors["note"] = [str(m) for m in exc.detail]
                else:
                    if note != order.note:
                        changes["note"] = (order.note, note)
        if errors:
            raise validation_error(errors)
        if not data or not any(k in data for k in ("status", "payment_status", "note")):
            raise validation_error({"status": ["Send a status, a payment status or a note."]})
        if changes:
            for name, (_, value) in changes.items():
                setattr(order, name, value)
            order.save(update_fields=list(changes) + ["updated_at"])
            audit.log(
                request, workspace, "order.updated", "order", order.id, order.number,
                {name: {"from": old, "to": new} for name, (old, new) in changes.items() if name != "note"} | ({"note": True} if "note" in changes else {}),
            )
        return Response(order_services.order_json(order))


ORDERS_CSV_HEADER = [
    "number", "created_at", "card", "customer_name", "phone", "email", "address", "items", "subtotal", "total", "currency",
    "payment_method", "payment_status", "status", "note", "id",
]


class OrdersExportView(APIView):
    """Orders as a spreadsheet file, same filters as the list, streamed, at most `LEADS_CSV_MAX_ROWS` rows."""

    def get(self, request, workspace_id):
        workspace, member = lead_access(request.user, workspace_id, export=True)
        qs = scoped_orders(member, request.query_params)
        cap = int(getattr(settings, "LEADS_CSV_MAX_ROWS", 50000))
        total = qs.count()
        qs = qs[:cap]
        audit.log(
            request, workspace, "order.exported", "orders", "", "",
            {"rows": min(total, cap), "truncated": total > cap,
             "filters": {k: v for k, v in request.query_params.items() if k in ("card", "status", "payment_status", "q", "from", "to")}},
        )
        writer = csv.writer(_Echo())

        def lines():
            yield "﻿" + writer.writerow(ORDERS_CSV_HEADER)
            for order in qs.iterator(chunk_size=500):
                yield writer.writerow([
                    order.number, iso(order.created_at), _csv_safe(order.card.name if order.card_id else order.card_name),
                    _csv_safe(order.customer_name), _csv_safe(order.customer_phone), _csv_safe(order.customer_email),
                    _csv_safe(order.address), _csv_safe("; ".join(order_services.summary_lines(order))),
                    order_services.money(order.subtotal), order_services.money(order.total), order.currency,
                    order.payment_method, order.payment_status, order.status, _csv_safe(order.note), order.id,
                ])

        response = StreamingHttpResponse(lines(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="orders.csv"'
        response["Cache-Control"] = "no-store"
        if total > cap:
            response["X-Rows-Truncated"] = "1"
        return response


# ---------------------------------------------------------------- bookings
def _settings_of(booking):
    try:
        return booking.card.booking_settings
    except BookingSettings.DoesNotExist:
        return BookingSettings(card=booking.card)


def booking_json(booking):
    row = _settings_of(booking)
    return {
        "id": str(booking.id),
        "card_id": str(booking.card_id),
        "card_name": booking.card.name,
        "start_at": iso(booking.start_at),
        "end_at": iso(booking.end_at),
        "local_start": booking_slots.format_local(row, booking.start_at),
        "timezone": row.timezone,
        "name": booking.name,
        "email": booking.email,
        "phone": booking.phone,
        "note": booking.note,
        "status": booking.status,
        "consented_at": iso(booking.consented_at),
        "shared_with_company": bool(booking.shared_with_company),
        "created_at": iso(booking.created_at),
    }


def scoped_bookings(member, params):
    qs = commerce_bookings(member).select_related("card", "card__booking_settings")
    qs = _card_filter(qs, params, member)
    statuses = [x for x in (params.get("status") or "").split(",") if x]
    if statuses:
        qs = qs.filter(status__in=statuses)
    lo, hi = _day_bounds(params)
    if lo:
        qs = qs.filter(start_at__gte=lo)
    if hi:
        qs = qs.filter(start_at__lt=hi)
    return qs.order_by("start_at", "id")


class BookingsView(APIView):
    def get(self, request, workspace_id):
        _, member = lead_access(request.user, workspace_id)
        return Response(_page(scoped_bookings(member, request.query_params), request.query_params, booking_json))


class BookingDetailView(APIView):
    def _open(self, request, workspace_id, booking_id):
        workspace, member = lead_access(request.user, workspace_id)
        booking = scoped_bookings(member, {}).filter(pk=booking_id).first()
        if booking is None:
            raise Http404
        return workspace, booking

    def get(self, request, workspace_id, booking_id):
        _, booking = self._open(request, workspace_id, booking_id)
        return Response(booking_json(booking))

    def patch(self, request, workspace_id, booking_id):
        workspace, booking = self._open(request, workspace_id, booking_id)
        data = request.data if isinstance(request.data, dict) else {}
        status = data.get("status")
        if status not in ("confirmed", "cancelled", "done"):
            raise validation_error({"status": ["Choose confirmed, cancelled or done."]})
        if status not in BOOKING_TRANSITIONS.get(booking.status, ()):
            raise validation_error({"status": ["This booking can no longer change to that status."]})
        old = booking.status
        booking.status = status
        booking.save(update_fields=["status", "updated_at"])
        audit.log(request, workspace, "booking.updated", "booking", booking.id, booking.name, {"status": {"from": old, "to": status}})
        if status in ("confirmed", "cancelled"):
            lang = booking.card.language if booking.card.language in ("en", "ar") else request_language(request)
            booking_mail.send_visitor_booking_email(booking, _settings_of(booking), status, lang)
        return Response(booking_json(booking))


class CommerceAccessView(APIView):
    """What the menu shows for orders and bookings. A person sees them when they are allowed to sell (or take bookings) and have set up a
    shop (or a booking page) on one of their cards, or when they already have some (their old orders stay reachable after the company turns
    the shop off). Someone who never sells is not shown two empty pages."""

    def get(self, request, workspace_id):
        from operations.rules import extras_for

        from cards.models import CardSection, Product

        workspace, member = lead_access(request.user, workspace_id)
        allowed = extras_for(workspace, member)
        cards = commerce_cards(member)
        has_shop = Product.objects.filter(card__in=cards).exists() or CardSection.objects.filter(card__in=cards, kind="products").exists()
        has_booking = BookingSettings.objects.filter(card__in=cards).exists() or CardSection.objects.filter(card__in=cards, kind="booking").exists()
        return Response({
            "orders": ("products" in allowed and has_shop) or commerce_orders(member).exists(),
            "bookings": ("booking" in allowed and has_booking) or commerce_bookings(member).exists(),
            "extras": allowed,
        })
