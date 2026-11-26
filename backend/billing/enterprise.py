"""Enterprise by request. A company asks, Bench staff set the seats and the price for that customer, the owner accepts and pays,
and the plan then renews like the others. There is no list price: the Enterprise plan row has price_minor 0."""
from django.db import IntegrityError, transaction
from django.utils import timezone

from ilaf.errors import ApiError, validation_error
from ilaf.utils import clean_line, clean_multiline, iso

from . import notices
from .models import EnterpriseRequest, Plan
from .services import ENTERPRISE_PLAN_CODE, seats_used

MAX_SEATS = 10000
MAX_PRICE_MINOR = 100_000_000


def enterprise_plan():
    return Plan.objects.filter(code=ENTERPRISE_PLAN_CODE).first()


def open_request(workspace):
    return EnterpriseRequest.objects.filter(workspace=workspace, status__in=EnterpriseRequest.OPEN).first()


def latest_request(workspace):
    """The open request, else the most recent closed one."""
    return open_request(workspace) or EnterpriseRequest.objects.filter(workspace=workspace).first()


def request_json(req, staff=False):
    data = {
        "id": str(req.id),
        "status": req.status,
        "seats_wanted": req.seats_wanted,
        "message": req.message,
        "phone": req.phone,
        "quoted_seats": req.quoted_seats,
        "quoted_price_per_seat_minor": req.quoted_price_per_seat_minor,
        "quoted_total_minor": req.quoted_total_minor,
        "currency": req.currency,
        "interval": req.interval,
        "staff_note": req.staff_note,
        "seats_used": seats_used(req.workspace),
        "created_at": iso(req.created_at),
        "quoted_at": iso(req.quoted_at),
        "decided_at": iso(req.decided_at),
    }
    if staff:
        owner = req.requested_by
        data.update({
            "company_id": str(req.workspace_id),
            "company": req.workspace.name,
            "requested_by": {"full_name": owner.full_name, "email": owner.email} if owner else None,
            "quoted_by": req.quoted_by,
        })
    return data


def _seats(value, name, floor):
    if isinstance(value, bool) or not isinstance(value, int) or not 1 <= value <= MAX_SEATS:
        raise validation_error({name: ["Enter a whole number of seats."]})
    if value < floor:
        raise validation_error({name: [f"You already use {floor} seats. Choose at least that many."]})
    return value


def create_request(workspace, user, data):
    """The owner asks for a quote. Seats can never be below the seats already used."""
    seats = _seats(data.get("seats_wanted"), "seats_wanted", max(seats_used(workspace), 1))
    message = data.get("message") or ""
    phone = data.get("phone") or ""
    if not isinstance(message, str) or not isinstance(phone, str):
        raise validation_error({"message": ["Must be text."]})
    message = clean_multiline(message, 1000)
    phone = clean_line(phone, 40)
    if open_request(workspace) is not None:
        raise ApiError("enterprise_request_open", "You already have an Enterprise request open. Wait for our answer or cancel it first.", 409)
    try:
        with transaction.atomic():
            return EnterpriseRequest.objects.create(
                workspace=workspace, requested_by=user, seats_wanted=seats, message=message, phone=phone,
                currency=(enterprise_plan().currency if enterprise_plan() else "QAR"),
            )
    except IntegrityError:
        raise ApiError("enterprise_request_open", "You already have an Enterprise request open. Wait for our answer or cancel it first.", 409)


def cancel_request(req):
    if req.status not in EnterpriseRequest.OPEN:
        raise ApiError("enterprise_request_closed", "This Enterprise request is already closed.", 409)
    req.status = "cancelled"
    req.decided_at = timezone.now()
    req.save(update_fields=["status", "decided_at", "updated_at"])
    return req


def quote_request(req, staff_user, data):
    """Staff set the seats and the price per seat for this customer (again, to change a quote) and the owner is e-mailed."""
    if req.status not in EnterpriseRequest.OPEN:
        raise ApiError("enterprise_request_closed", "This Enterprise request is already closed.", 409)
    seats = _seats(data.get("seats"), "seats", max(seats_used(req.workspace), 1))
    price = data.get("price_per_seat_minor")
    if isinstance(price, bool) or not isinstance(price, int) or not 1 <= price <= MAX_PRICE_MINOR:
        raise validation_error({"price_per_seat_minor": ["Enter the price per seat as a whole number above zero."]})
    note = data.get("note") or ""
    if not isinstance(note, str):
        raise validation_error({"note": ["Must be text."]})
    note = clean_line(note.replace("\r", " ").replace("\n", " "), 500) if note.strip() else ""
    plan = enterprise_plan()
    req.quoted_seats = seats
    req.quoted_price_per_seat_minor = price
    req.currency = plan.currency if plan else req.currency
    req.interval = "year"
    req.staff_note = note
    req.quoted_by = (staff_user.email or "")[:254]
    req.quoted_at = timezone.now()
    req.status = "quoted"
    req.save()
    notices.send_enterprise_quote(req)
    return req


def decline_request(req, staff_user, data):
    if req.status not in EnterpriseRequest.OPEN:
        raise ApiError("enterprise_request_closed", "This Enterprise request is already closed.", 409)
    note = data.get("note") or ""
    if not isinstance(note, str):
        raise validation_error({"note": ["Must be text."]})
    req.staff_note = clean_line(note.replace("\r", " ").replace("\n", " "), 500) if note.strip() else ""
    req.quoted_by = (staff_user.email or "")[:254]
    req.status = "declined"
    req.decided_at = timezone.now()
    req.save()
    notices.send_enterprise_declined(req)
    return req


def checkable_quote(req):
    """The quote the owner may pay now: it must exist and cover at least the seats in use."""
    if req.status != "quoted" or req.quoted_seats is None or req.quoted_price_per_seat_minor is None:
        raise ApiError("enterprise_not_quoted", "There is no quote to accept yet.", 409)
    floor = seats_used(req.workspace)
    if req.quoted_seats < floor:
        raise validation_error({"seats": [f"You already use {floor} seats. Choose at least that many."]})
    return req


def mark_accepted(request_id, workspace):
    """Called when the quoted amount has been paid: the request is closed as accepted."""
    EnterpriseRequest.objects.filter(pk=request_id, workspace=workspace, status__in=EnterpriseRequest.OPEN).update(
        status="accepted", decided_at=timezone.now(),
    )
