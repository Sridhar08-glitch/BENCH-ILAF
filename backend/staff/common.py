"""Small helpers shared by the staff views: paging, CSV, week series, the company and card summaries."""
import csv
import math
from datetime import timedelta

from django.http import HttpResponse
from django.utils import timezone

from ilaf.utils import iso


def int_param(params, key, default, low, high):
    try:
        return max(low, min(high, int(params.get(key, default))))
    except (TypeError, ValueError):
        return default


def paged(request, qs, to_json, default_size=25):
    size = int_param(request.query_params, "page_size", default_size, 1, 100)
    count = qs.count()
    pages = max(1, math.ceil(count / size))
    page = int_param(request.query_params, "page", 1, 1, pages)
    return {
        "count": count, "page": page, "pages": pages, "page_size": size,
        "results": [to_json(row) for row in qs[(page - 1) * size: page * size]],
    }


def csv_safe(value):
    """A cell that a spreadsheet will not run as a formula."""
    text = "" if value is None else str(value)
    return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text


def csv_response(name, header, rows):
    response = HttpResponse(content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="{name}"'
    response.write("﻿")
    writer = csv.writer(response)
    writer.writerow(header)
    for row in rows:
        writer.writerow([csv_safe(c) for c in row])
    return response


def week_start(day):
    """Monday 00:00 of the week of `day` (a datetime)."""
    return (day - timedelta(days=day.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)


def weekly_counts(dates, weeks=12, now=None):
    """Counts of `dates` (datetimes) in each of the last `weeks` weeks, oldest first: [{"week": "2026-11-16", "n": 3}]."""
    now = now or timezone.now()
    this = week_start(now)
    starts = [this - timedelta(weeks=w) for w in range(weeks - 1, -1, -1)]
    counts = {s: 0 for s in starts}
    for d in dates:
        w = week_start(d)
        if w in counts:
            counts[w] += 1
    return [{"week": s.date().isoformat(), "n": counts[s]} for s in starts]


def person_json(user):
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name} if user else None


def when(value):
    return iso(value) if value else None
