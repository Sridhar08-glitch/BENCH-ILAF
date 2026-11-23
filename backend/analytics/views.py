from django.db.models import Count, Q
from django.db.models.functions import ExtractHour
from django.http import Http404
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError
from leads.models import Lead
from workspaces.access import MANAGER_ROLES, get_workspace_and_member, visible_cards

from . import breakdowns, periods
from .models import Event, event_count

SOURCES = breakdowns.SOURCE_KEYS


def _totals(events, leads):
    """Totals for one period. Taps are NFC views plus explicit tap events."""
    agg = events.aggregate(
        views=event_count(Q(type="view")),
        scans=event_count(Q(type="view", source="qr")),
        taps=event_count(Q(type="tap") | Q(type="view", source="nfc")),
        saves=event_count(Q(type="save")),
        link_clicks=event_count(Q(type="link_click")),
    )
    unique = (
        events.filter(type="view").exclude(visitor_hash="").values("visitor_hash").distinct().count()
    )
    return {
        "views": agg["views"], "unique_visitors": unique, "scans": agg["scans"], "taps": agg["taps"],
        "saves": agg["saves"], "leads": leads.count(), "link_clicks": agg["link_clicks"],
    }


def scoped_cards(request, workspace_id):
    """(workspace, member, cards): the cards the caller may see, narrowed by `card_id` when given."""
    workspace, member = get_workspace_and_member(request.user, workspace_id)
    cards = visible_cards(member)
    card_id = request.query_params.get("card_id")
    if card_id:
        try:
            cards = cards.filter(pk=card_id)
        except Exception:
            raise Http404
        if not cards.exists():
            raise Http404
    return workspace, member, cards


def period_json(window, group=None):
    data = {
        "from": window.start_date.isoformat(), "to": window.end_date.isoformat(), "days": window.days,
        "prev_from": window.prev_start_date.isoformat(), "tz": str(window.tz),
    }
    if group:
        data["group"] = group
    return data


class AnalyticsView(APIView):
    """The overview. `days=` or `from=&to=`, `group=day|week|month`, `tz=`, `card_id=` (see the contract)."""

    def get(self, request, workspace_id):
        _, _, cards = scoped_cards(request, workspace_id)
        window = periods.parse_window(request.query_params)
        group = periods.parse_group(request.query_params, window)

        all_events = Event.objects.filter(card__in=cards)
        all_leads = Lead.objects.filter(card__in=cards)
        events = all_events.filter(created_at__gte=window.start, created_at__lt=window.end)
        leads = all_leads.filter(created_at__gte=window.start, created_at__lt=window.end)
        prev_events = all_events.filter(created_at__gte=window.prev_start, created_at__lt=window.start)
        prev_leads = all_leads.filter(created_at__gte=window.prev_start, created_at__lt=window.start)

        views = events.filter(type="view")
        series = breakdowns.series(cards, window, group)

        source_counts = {key: 0 for key in SOURCES}
        for row in views.values("source").annotate(n=event_count()):
            source_counts[row["source"] if row["source"] in source_counts else "other"] += row["n"]
        device_counts = {"ios": 0, "android": 0, "desktop": 0, "other": 0}
        for row in views.values("device").annotate(n=event_count()):
            device_counts[row["device"] if row["device"] in device_counts else "other"] += row["n"]

        hours = [0] * 24
        for row in views.annotate(h=ExtractHour("created_at", tzinfo=window.tz)).values("h").annotate(n=event_count()):
            hours[int(row["h"])] = row["n"]  # PostgreSQL may hand the hour back as a Decimal

        per_card = {
            row["card_id"]: row
            for row in events.values("card_id").annotate(
                views=event_count(Q(type="view")), saves=event_count(Q(type="save"))
            )
        }
        lead_per_card = {r["card_id"]: r["n"] for r in leads.values("card_id").annotate(n=Count("id"))}
        card_rows = []
        for card in cards.order_by("created_at"):
            row = per_card.get(card.id, {})
            card_rows.append({
                "card_id": str(card.id), "name": card.name, "views": row.get("views", 0),
                "saves": row.get("saves", 0), "leads": lead_per_card.get(card.id, 0),
            })
        card_rows.sort(key=lambda r: r["views"], reverse=True)

        return Response({
            "period": period_json(window, group),
            "totals": _totals(events, leads),
            "prev_totals": _totals(prev_events, prev_leads),
            "series": series,
            "sources": [{"key": key, "count": source_counts[key]} for key in SOURCES],
            "locations": [
                {"country": r["country"], "count": r["n"]}
                for r in views.values("country").annotate(n=event_count()).order_by("-n")[:20]
            ],
            "devices": [{"key": key, "count": count} for key, count in device_counts.items()],
            "hours": hours,
            "top_buttons": [
                {"kind": r["kind"], "count": r["n"]}
                for r in events.filter(type="link_click").exclude(kind="").values("kind")
                .annotate(n=event_count()).order_by("-n")[:10]
            ],
            "cards": card_rows,
        })


class PeopleView(APIView):
    """One row per person (or per card with `by=card`): the numbers, the previous period and the department.

    Managers see everyone; an employee sees only their own cards."""

    def get(self, request, workspace_id):
        _, _, cards = scoped_cards(request, workspace_id)
        window = periods.parse_window(request.query_params)
        by = "card" if request.query_params.get("by") == "card" else "person"
        rows = breakdowns.people_rows(cards, window, by=by)
        return Response({
            "period": period_json(window), "by": by, "rows": rows,
            "totals": breakdowns.totals_of(rows), "prev_totals": breakdowns.totals_of(rows, "prev"),
        })


class DepartmentsView(APIView):
    """Owner and admin only: the same numbers added up per department."""

    def get(self, request, workspace_id):
        workspace, member = get_workspace_and_member(request.user, workspace_id)
        if member.role not in MANAGER_ROLES:
            raise ApiError("forbidden", "You do not have permission to do that.", 403)
        window = periods.parse_window(request.query_params)
        cards = visible_cards(member)
        rows = breakdowns.department_rows(workspace, cards, window) if workspace.kind == "company" else []
        return Response({
            "period": period_json(window), "rows": rows,
            "totals": breakdowns.totals_of(rows), "prev_totals": breakdowns.totals_of(rows, "prev"),
        })


class LinksView(APIView):
    def get(self, request, workspace_id):
        _, _, cards = scoped_cards(request, workspace_id)
        window = periods.parse_window(request.query_params)
        rows, total = breakdowns.link_rows(cards, window)
        prev_total = sum(r["prev_clicks"] for r in rows)
        return Response({"period": period_json(window), "rows": rows, "total": total, "prev_total": prev_total})


class SourcesView(APIView):
    def get(self, request, workspace_id):
        _, _, cards = scoped_cards(request, workspace_id)
        window = periods.parse_window(request.query_params)
        group = periods.parse_group(request.query_params, window)
        rows, total = breakdowns.source_rows(cards, window)
        return Response({
            "period": period_json(window, group), "rows": rows, "total": total,
            "series": breakdowns.series(cards, window, group, by_source=True),
        })
