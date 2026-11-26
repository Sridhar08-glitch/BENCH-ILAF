"""Booking hours and free slots.

The owner sets weekly windows (day of week, from, to) in the card's timezone, a slot length and a buffer between
bookings. A visitor sees the free slots of the coming days as local HH:MM times; a booking is only accepted when
its start is one of those slots.
"""
import re
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone
from rest_framework.exceptions import ValidationError

from .models_commerce import (
    DEFAULT_TIMEZONE, MAX_BUFFER_MINUTES, MAX_DAYS_AHEAD, MIN_DAYS_AHEAD, SLOT_MINUTES, Booking, BookingSettings,
)

TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
MAX_WINDOWS = 21
MAX_DAYS_PER_REQUEST = 31


def now():
    """The current moment; tests replace this to pin the calendar."""
    return timezone.now()


def valid_timezone(name):
    if not isinstance(name, str) or not name or len(name) > 64 or " " in name:
        return False
    try:
        ZoneInfo(name)
    except Exception:
        return False
    return True


def parse_hhmm(value):
    hours, minutes = value.split(":")
    return time(int(hours), int(minutes))


def settings_json(row):
    """The owner's booking settings (defaults when the card has none yet)."""
    if row is None:
        row = BookingSettings()
    return {
        "enabled": row.enabled,
        "timezone": row.timezone or DEFAULT_TIMEZONE,
        "slot_minutes": row.slot_minutes,
        "buffer_minutes": row.buffer_minutes,
        "days_ahead": row.days_ahead,
        "weekly": list(row.weekly or []),
        "location_note": row.location_note,
        "meet_link": row.meet_link,
    }


def clean_settings(data):
    """Validate a full booking-settings object. Returns the cleaned values. Field errors are raised together."""
    from ilaf.utils import clean_line

    if not isinstance(data, dict):
        raise ValidationError({"non_field_errors": ["Send the settings as an object."]})
    errors = {}
    out = settings_json(None)
    if "enabled" in data:
        if isinstance(data["enabled"], bool):
            out["enabled"] = data["enabled"]
        else:
            errors["enabled"] = ["Must be true or false."]
    tz = data.get("timezone", out["timezone"])
    if valid_timezone(tz):
        out["timezone"] = tz
    else:
        errors["timezone"] = ["Choose a valid time zone, such as Asia/Qatar."]
    slot = data.get("slot_minutes", out["slot_minutes"])
    if isinstance(slot, int) and not isinstance(slot, bool) and slot in SLOT_MINUTES:
        out["slot_minutes"] = slot
    else:
        errors["slot_minutes"] = ["Choose 15, 30, 45 or 60 minutes."]
    buffer = data.get("buffer_minutes", out["buffer_minutes"])
    if isinstance(buffer, int) and not isinstance(buffer, bool) and 0 <= buffer <= MAX_BUFFER_MINUTES:
        out["buffer_minutes"] = buffer
    else:
        errors["buffer_minutes"] = [f"Choose a buffer between 0 and {MAX_BUFFER_MINUTES} minutes."]
    ahead = data.get("days_ahead", out["days_ahead"])
    if isinstance(ahead, int) and not isinstance(ahead, bool) and MIN_DAYS_AHEAD <= ahead <= MAX_DAYS_AHEAD:
        out["days_ahead"] = ahead
    else:
        errors["days_ahead"] = [f"Choose between {MIN_DAYS_AHEAD} and {MAX_DAYS_AHEAD} days."]
    weekly = data.get("weekly", [])
    try:
        out["weekly"] = clean_weekly(weekly)
    except ValidationError as exc:
        errors["weekly"] = [str(m) for m in exc.detail]
    for name, limit in (("location_note", 120),):
        raw = data.get(name, "")
        if raw is None:
            raw = ""
        if not isinstance(raw, str):
            errors[name] = ["Must be text."]
            continue
        try:
            out[name] = clean_line(raw, limit)
        except ValidationError as exc:
            errors[name] = [str(m) for m in exc.detail]
    link = data.get("meet_link", "")
    if link in (None, ""):
        out["meet_link"] = ""
    elif not isinstance(link, str) or len(link) > 500 or not link.startswith("https://") or " " in link or "." not in link[8:]:
        errors["meet_link"] = ["Enter a secure web address starting with https://."]
    else:
        out["meet_link"] = link.strip()
    if errors:
        raise ValidationError(errors)
    return out


def clean_weekly(weekly):
    """[{"d": 0..6, "from": "HH:MM", "to": "HH:MM"}] sorted by day and start; windows of one day may not overlap."""
    if not isinstance(weekly, list):
        raise ValidationError("Send the weekly hours as a list of windows.")
    if len(weekly) > MAX_WINDOWS:
        raise ValidationError(f"Add at most {MAX_WINDOWS} windows a week.")
    cleaned = []
    for window in weekly:
        if not isinstance(window, dict):
            raise ValidationError("Each window needs a day, a start and an end time.")
        day = window.get("d")
        start, end = window.get("from"), window.get("to")
        if not isinstance(day, int) or isinstance(day, bool) or not 0 <= day <= 6:
            raise ValidationError("The day must be a number from 0 (Monday) to 6 (Sunday).")
        if not isinstance(start, str) or not isinstance(end, str) or not TIME_RE.match(start) or not TIME_RE.match(end):
            raise ValidationError("Times must be written as HH:MM, for example 09:00.")
        if start >= end:
            raise ValidationError("A window must end after it starts.")
        cleaned.append({"d": day, "from": start, "to": end})
    cleaned.sort(key=lambda w: (w["d"], w["from"]))
    for earlier, later in zip(cleaned, cleaned[1:]):
        if earlier["d"] == later["d"] and later["from"] < earlier["to"]:
            raise ValidationError("Windows on the same day must not overlap.")
    return cleaned


def week_day(day):
    """The day of the week the way the hours section counts it: Monday 0 to Sunday 6."""
    return day.weekday()


def active_bookings(card, start, end):
    """Bookings that still hold their time and touch the span [start, end]."""
    return list(
        Booking.objects.filter(card=card, status__in=Booking.ACTIVE_STATUSES, start_at__lt=end, end_at__gt=start)
        .only("start_at", "end_at")
    )


def _overlaps(bookings, start, end, buffer):
    return any(b.start_at < end + buffer and b.end_at > start - buffer for b in bookings)


def day_slots(settings, day, bookings, moment):
    """Free local HH:MM start times of one calendar day in the card's timezone."""
    tz = ZoneInfo(settings.timezone or DEFAULT_TIMEZONE)
    slot = timedelta(minutes=settings.slot_minutes)
    buffer = timedelta(minutes=settings.buffer_minutes)
    found = []
    for window in settings.weekly or []:
        if window.get("d") != week_day(day):
            continue
        cursor = datetime.combine(day, parse_hhmm(window["from"]), tzinfo=tz)
        close = datetime.combine(day, parse_hhmm(window["to"]), tzinfo=tz)
        while cursor + slot <= close:
            if cursor > moment and not _overlaps(bookings, cursor, cursor + slot, buffer):
                found.append(cursor.strftime("%H:%M"))
            cursor += slot
    return sorted(set(found))


def availability(settings, card, first_day=None, days=14, moment=None):
    """{timezone, slot_minutes, days: [{date, slots: [...]}]} for `days` days from `first_day` (today by default),
    cut to the booking horizon. Days outside the horizon are left out."""
    moment = moment or now()
    tz = ZoneInfo(settings.timezone or DEFAULT_TIMEZONE)
    today = moment.astimezone(tz).date()
    horizon_end = today + timedelta(days=settings.days_ahead - 1)
    first_day = first_day or today
    days = max(1, min(int(days), MAX_DAYS_PER_REQUEST))
    wanted = [first_day + timedelta(days=i) for i in range(days)]
    wanted = [d for d in wanted if today <= d <= horizon_end]
    out = []
    if wanted:
        span_start = datetime.combine(wanted[0], time.min, tzinfo=tz) - timedelta(days=1)
        span_end = datetime.combine(wanted[-1], time.min, tzinfo=tz) + timedelta(days=2)
        bookings = active_bookings(card, span_start, span_end)
        for day in wanted:
            out.append({"date": day.isoformat(), "slots": day_slots(settings, day, bookings, moment)})
    return {"timezone": settings.timezone or DEFAULT_TIMEZONE, "slot_minutes": settings.slot_minutes, "days": out}


def local_start(settings, day, hhmm):
    """An aware datetime for a local date and HH:MM in the card's timezone."""
    tz = ZoneInfo(settings.timezone or DEFAULT_TIMEZONE)
    return datetime.combine(day, parse_hhmm(hhmm), tzinfo=tz)


def slot_problem(settings, card, start, moment=None, bookings=None):
    """Why a start time cannot be booked: "past", "outside" (not on the booking hours grid or beyond the horizon),
    "taken" (another booking holds it), or None when it is free."""
    moment = moment or now()
    tz = ZoneInfo(settings.timezone or DEFAULT_TIMEZONE)
    local = start.astimezone(tz)
    if start <= moment:
        return "past"
    today = moment.astimezone(tz).date()
    if local.date() > today + timedelta(days=settings.days_ahead - 1):
        return "outside"
    slot = timedelta(minutes=settings.slot_minutes)
    end = start + slot
    on_grid = False
    for window in settings.weekly or []:
        if window.get("d") != week_day(local.date()):
            continue
        open_at = datetime.combine(local.date(), parse_hhmm(window["from"]), tzinfo=tz)
        close_at = datetime.combine(local.date(), parse_hhmm(window["to"]), tzinfo=tz)
        offset = start - open_at
        if offset >= timedelta(0) and end <= close_at and offset % slot == timedelta(0):
            on_grid = True
            break
    if not on_grid:
        return "outside"
    buffer = timedelta(minutes=settings.buffer_minutes)
    if bookings is None:
        bookings = active_bookings(card, start - buffer - timedelta(days=1), end + buffer + timedelta(days=1))
    if _overlaps(bookings, start, end, buffer):
        return "taken"
    return None


def parse_day(value):
    """A YYYY-MM-DD string to a date, or None when it is not one."""
    if not isinstance(value, str):
        return None
    try:
        return date.fromisoformat(value)
    except ValueError:
        return None


def format_local(settings, moment, lang="en"):
    """A booking time the way people read it: "25 Nov 2026, 09:00 (Asia/Qatar)"."""
    from ilaf.i18n import month_name

    tz = ZoneInfo(settings.timezone or DEFAULT_TIMEZONE)
    local = moment.astimezone(tz)
    return f"{local.day} {month_name(lang, local.month, short=True)} {local.year}, {local:%H:%M} ({settings.timezone})"
