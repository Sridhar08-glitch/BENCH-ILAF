"""Business-hours arithmetic for the support clock: is the team open now, when is a deadline, how many working minutes passed."""
from datetime import date, datetime, time, timedelta
from zoneinfo import ZoneInfo

from django.utils import timezone

DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
MAX_DAYS_AHEAD = 120


def _zone(cfg):
    try:
        return ZoneInfo(cfg.timezone or "Asia/Qatar")
    except Exception:
        return ZoneInfo("Asia/Qatar")


def parse_clock(value):
    """"09:30" as a time, or None when it is not a valid 24 hour clock time."""
    try:
        hour, minute = str(value).split(":")
        return time(int(hour), int(minute))
    except (ValueError, TypeError):
        return None


def valid_hours(hours):
    """True when `hours` is {day: [[start, end], ...]} with valid, increasing windows."""
    if not isinstance(hours, dict):
        return False
    for day, windows in hours.items():
        if day not in DAYS or not isinstance(windows, list) or len(windows) > 4:
            return False
        for window in windows:
            if not isinstance(window, (list, tuple)) or len(window) != 2:
                return False
            start, end = parse_clock(window[0]), parse_clock(window[1])
            if start is None or end is None or start >= end:
                return False
    return True


def _holidays(cfg):
    out = set()
    for raw in cfg.holidays or []:
        try:
            out.add(date.fromisoformat(str(raw)[:10]))
        except ValueError:
            continue
    return out


def _windows_on(cfg, day, holidays):
    """The (start, end) datetimes the team works on a local calendar day."""
    if day in holidays:
        return []
    zone = _zone(cfg)
    out = []
    for window in (cfg.business_hours or {}).get(DAYS[day.weekday()], []):
        start, end = parse_clock(window[0]), parse_clock(window[1])
        if start and end and start < end:
            out.append((datetime.combine(day, start, zone), datetime.combine(day, end, zone)))
    return out


def is_open(cfg, at=None):
    at = at or timezone.now()
    zone = _zone(cfg)
    local = at.astimezone(zone)
    holidays = _holidays(cfg)
    return any(start <= local < end for start, end in _windows_on(cfg, local.date(), holidays))


def add_business_minutes(cfg, start, minutes):
    """The moment `minutes` of working time after `start`. With no working hours at all the plain elapsed time is used."""
    zone = _zone(cfg)
    holidays = _holidays(cfg)
    local = start.astimezone(zone)
    remaining = timedelta(minutes=max(0, minutes))
    if not any((cfg.business_hours or {}).values()):
        return start + remaining
    day = local.date()
    for _ in range(MAX_DAYS_AHEAD):
        for w_start, w_end in _windows_on(cfg, day, holidays):
            if w_end <= local:
                continue
            begin = max(w_start, local)
            room = w_end - begin
            if remaining <= room:
                return (begin + remaining).astimezone(start.tzinfo or timezone.utc)
            remaining -= room
        day += timedelta(days=1)
    return start + timedelta(days=MAX_DAYS_AHEAD)


def business_minutes_between(cfg, start, end):
    """Working minutes between two moments (0 when end is not after start)."""
    if end <= start:
        return 0
    if not any((cfg.business_hours or {}).values()):
        return int((end - start).total_seconds() // 60)
    zone = _zone(cfg)
    holidays = _holidays(cfg)
    a, b = start.astimezone(zone), end.astimezone(zone)
    total = timedelta()
    day = a.date()
    last = b.date()
    guard = 0
    while day <= last and guard < 800:
        for w_start, w_end in _windows_on(cfg, day, holidays):
            lo, hi = max(w_start, a), min(w_end, b)
            if hi > lo:
                total += hi - lo
        day += timedelta(days=1)
        guard += 1
    return int(total.total_seconds() // 60)
