"""Date ranges for the analytics endpoints.

A range is `days=N` (the last N days including today) or `from=YYYY-MM-DD&to=YYYY-MM-DD` (both included).
Days are cut in the time zone given by `tz` (an IANA name such as Asia/Qatar); without it the day is the UTC day.
The workspace has no time zone setting of its own, so the web page sends the viewer's zone. The previous period
is the same number of days right before the range.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone as dt_tz
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from django.utils import timezone

from ilaf.errors import validation_error
from ilaf.utils import sane_date

MAX_DAYS = 365
GROUPS = ("day", "week", "month")


@dataclass
class Window:
    tz: ZoneInfo
    start_date: date
    end_date: date  # the last day, included
    days: int
    start: datetime  # UTC instants
    end: datetime  # first instant after the range
    prev_start: datetime

    @property
    def prev_start_date(self):
        return self.start_date - timedelta(days=self.days)


def parse_tz(params):
    name = (params.get("tz") or "UTC").strip() or "UTC"
    try:
        return ZoneInfo(name)
    except (ZoneInfoNotFoundError, ValueError, OSError):
        raise validation_error({"tz": ["Not a known time zone name."]})


def _day_start(day, tz):
    return datetime.combine(day, time.min, tzinfo=tz).astimezone(dt_tz.utc)


def parse_window(params, default_days=30):
    tz = parse_tz(params)
    today = timezone.now().astimezone(tz).date()
    raw_from, raw_to = params.get("from"), params.get("to")
    if raw_from or raw_to:
        try:
            end_date = sane_date(date.fromisoformat(raw_to)) if raw_to else today
            start_date = sane_date(date.fromisoformat(raw_from)) if raw_from else end_date - timedelta(days=default_days - 1)
        except ValueError:
            raise validation_error({"from": ["Use the form YYYY-MM-DD."]})
        days = (end_date - start_date).days + 1
        if days < 1:
            raise validation_error({"from": ["The start must not be after the end."]})
        if days > MAX_DAYS:
            raise validation_error({"from": [f"Choose a range of at most {MAX_DAYS} days."]})
    else:
        try:
            days = int(params.get("days", default_days))
        except ValueError:
            raise validation_error({"days": ["Must be a number."]})
        if not 1 <= days <= MAX_DAYS:
            raise validation_error({"days": [f"Choose between 1 and {MAX_DAYS} days."]})
        end_date = today
        start_date = today - timedelta(days=days - 1)
    start = _day_start(start_date, tz)
    return Window(
        tz=tz, start_date=start_date, end_date=end_date, days=days, start=start,
        end=_day_start(end_date + timedelta(days=1), tz), prev_start=_day_start(start_date - timedelta(days=days), tz),
    )


def parse_group(params, window):
    group = params.get("group") or "day"
    if group not in GROUPS:
        raise validation_error({"group": ["Choose day, week or month."]})
    return group


def bucket_start(day, group):
    if group == "week":
        return day - timedelta(days=day.weekday())
    if group == "month":
        return day.replace(day=1)
    return day


def bucket_dates(window, group):
    """Every bucket start from the first to the last day of the range, so empty buckets show as zero."""
    out = []
    day = bucket_start(window.start_date, group)
    while day <= window.end_date:
        out.append(day)
        if group == "day":
            day += timedelta(days=1)
        elif group == "week":
            day += timedelta(days=7)
        else:
            day = (day.replace(day=28) + timedelta(days=4)).replace(day=1)
    return out
