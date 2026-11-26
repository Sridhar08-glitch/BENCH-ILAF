"""Growth: applications (company leads), announcements and e-mail broadcasts, business analytics."""
import re
from datetime import timedelta

from django.db.models import Count, Q
from django.db.models.functions import TruncMonth, TruncWeek
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from accounts.models import User
from analytics.models import Event, event_count
from billing.models import Plan
from cards.models import Card
from designs.models import DesignRequest
from ilaf.errors import validation_error
from ilaf.utils import iso
from leads.models import Lead
from workspaces.models import Workspace

from . import announce, billing_data, services
from .common import csv_response, int_param, paged, week_start, weekly_counts
from .models import Announcement, CompanyLead
from .perms_map import roles_for
from .permissions import StaffView

ARABIC = re.compile(r"[؀-ۿ]")
PIPELINE = ("new", "contacted", "qualified", "won", "lost")


# ---------------------------------------------------------------- applications
def lead_json(c):
    return {
        "id": str(c.id), "company": c.company, "name": c.name, "email": c.email, "size": c.size, "message": c.message, "source": c.source,
        "language": c.language, "status": c.status, "assignee": c.assignee.email if c.assignee_id else None, "notes": c.notes,
        "assignee_id": str(c.assignee_id) if c.assignee_id else None, "assignee_name": (c.assignee.full_name or c.assignee.email) if c.assignee_id else None,
        "country": c.country,
        "created_at": iso(c.created_at), "updated_at": iso(c.updated_at),
    }


class ApplicationsView(StaffView):
    perm = "view"
    write_roles = roles_for("notes")

    def get(self, request):
        qs = CompanyLead.objects.select_related("assignee")
        status = request.query_params.get("status")
        if status in PIPELINE:
            qs = qs.filter(status=status)
        term = (request.query_params.get("q") or "").strip()[:100]
        if term:
            qs = qs.filter(Q(company__icontains=term) | Q(name__icontains=term) | Q(email__icontains=term))
        body = paged(request, qs.order_by("-created_at", "id"), lead_json)
        counts = {r["status"]: r["n"] for r in CompanyLead.objects.values("status").annotate(n=Count("id")).order_by()}
        body["counts"] = {s: counts.get(s, 0) for s in PIPELINE}
        body["design_requests_open"] = DesignRequest.objects.filter(status__in=DesignRequest.OPEN).count()
        # Everyone a request can be given to (the staff), for the "Assigned to" picker.
        body["assignees"] = [
            {"id": str(u.id), "email": u.email, "full_name": u.full_name, "staff_role": u.staff_role}
            for u in User.objects.exclude(staff_role="none").filter(is_active=True, deleted_at__isnull=True).order_by("email")
        ]
        return Response(body)


class ApplicationDetailView(StaffView):
    perm = "view"
    write_roles = roles_for("notes")

    def patch(self, request, lead_id):
        c = CompanyLead.objects.filter(pk=lead_id).first()
        if c is None:
            raise Http404
        data = request.data if isinstance(request.data, dict) else {}
        changed = {}
        if "status" in data:
            if data["status"] not in PIPELINE:
                raise validation_error({"status": ["Choose a status from the list."]})
            changed["status"] = [c.status, data["status"]]
            c.status = data["status"]
        if "assignee" in data:
            if data["assignee"]:
                who = User.objects.filter(pk=data["assignee"]).exclude(staff_role="none").first()
                if who is None:
                    raise validation_error({"assignee": ["Choose a person from the staff."]})
                c.assignee = who
            else:
                c.assignee = None
            changed["assignee"] = c.assignee.email if c.assignee else None
        note = str(data.get("note") or "").strip()[:500]
        if note:
            c.notes = [*c.notes, {"t": iso(timezone.now()), "who": request.user.email, "text": note}][-50:]
            changed["note"] = True
        if not changed:
            raise validation_error({"status": ["Nothing to change."]})
        c.save()
        # Giving a request to someone (or taking it back) has its own line in the audit log.
        action = "application.assigned" if set(changed) == {"assignee"} else "application.updated"
        services.log(request, action, "application", c.id, c.company, changed)
        return Response(lead_json(c))


# ---------------------------------------------------------------- announcements
def announcement_json(a, now=None):
    now = now or timezone.now()
    return {
        "id": str(a.id), "title_en": a.title_en, "title_ar": a.title_ar, "body_en": a.body_en, "body_ar": a.body_ar, "severity": a.severity,
        "audience_kind": a.audience_kind, "audience_values": a.audience_values, "audience": announce.audience_label(a), "banner": a.banner,
        "starts_at": iso(a.starts_at), "ends_at": iso(a.ends_at), "send_email": a.send_email, "email_kind": a.email_kind,
        "email_send_at": iso(a.email_send_at), "email_status": a.email_status, "email_sent_count": a.email_sent_count,
        "cancelled": a.cancelled_at is not None, "live": announce.is_live(a, now) and a.banner, "created_at": iso(a.created_at),
    }


def _when(value, name, default=None):
    if value in (None, ""):
        return default
    from django.utils.dateparse import parse_datetime

    parsed = parse_datetime(str(value))
    if parsed is None:
        raise validation_error({name: ["Enter a valid date and time."]})
    if timezone.is_naive(parsed):
        parsed = timezone.make_aware(parsed, timezone.utc)
    return parsed


def _audience(data):
    kind = data.get("audience_kind", "all")
    values = data.get("audience_values") or []
    if kind not in ("all", "plan", "country", "companies") or not isinstance(values, list) or len(values) > 500:
        raise validation_error({"audience_kind": ["Choose who the announcement is for."]})
    if kind != "all" and not values:
        raise validation_error({"audience_values": ["Choose at least one value for this audience."]})
    return kind, [str(v)[:64] for v in values]


class AnnouncementsView(StaffView):
    perm = "view"
    write_roles = roles_for("announce")

    def get(self, request):
        now = timezone.now()
        return Response({
            "results": [announcement_json(a, now) for a in Announcement.objects.all()[:100]],
            "plans": [{"code": p.code, "name": p.name} for p in Plan.objects.filter(kind="company").order_by("sort_order")],
            "countries": announce.audience_countries(),
        })

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        fields = {}
        for key, limit in (("title_en", 120), ("title_ar", 120), ("body_en", 600), ("body_ar", 600)):
            value = str(data.get(key) or "").strip()
            if not value or len(value) > limit:
                fields[key] = [f"Write this text (up to {limit} characters). Both English and Arabic are needed."]
            elif key.endswith("_ar") and not ARABIC.search(value):
                fields[key] = ["The Arabic text must be written in Arabic."]
            fields.setdefault(key, None)
        errors = {k: v for k, v in fields.items() if v}
        if errors:
            raise validation_error(errors)
        severity = data.get("severity", "info")
        if severity not in ("info", "warning", "critical"):
            raise validation_error({"severity": ["Choose info, warning or critical."]})
        kind, values = _audience(data)
        banner, send_email = bool(data.get("banner", True)), bool(data.get("send_email", False))
        if not banner and not send_email:
            raise validation_error({"banner": ["Choose a banner, an e-mail, or both."]})
        email_kind = data.get("email_kind", "marketing")
        if email_kind not in ("marketing", "transactional"):
            raise validation_error({"email_kind": ["Choose product update or service notice."]})
        now = timezone.now()
        starts = _when(data.get("starts_at"), "starts_at", now)
        ends = _when(data.get("ends_at"), "ends_at")
        if ends is not None and ends <= starts:
            raise validation_error({"ends_at": ["The end must be after the start."]})
        send_at = _when(data.get("email_send_at"), "email_send_at")
        a = Announcement.objects.create(
            title_en=data["title_en"].strip(), title_ar=data["title_ar"].strip(), body_en=data["body_en"].strip(), body_ar=data["body_ar"].strip(),
            severity=severity, audience_kind=kind, audience_values=values, banner=banner, starts_at=starts, ends_at=ends,
            send_email=send_email, email_kind=email_kind, email_send_at=send_at, email_status="scheduled" if send_email else "none", created_by=request.user,
        )
        services.log(request, "announcement.created", "announcement", a.id, a.title_en, {"banner": banner, "email": send_email, "audience": announce.audience_label(a)})
        return Response(announcement_json(a), status=201)


class AnnouncementPreviewView(StaffView):
    """How many companies and people an audience reaches (nothing is sent)."""

    perm = "view"
    write_roles = roles_for("announce")

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        kind, values = _audience(data)
        email_kind = data.get("email_kind", "marketing")
        draft = Announcement(audience_kind=kind, audience_values=values, email_kind=email_kind if email_kind in ("marketing", "transactional") else "marketing")
        companies = announce.audience_workspaces(draft)
        people = announce.audience_users(draft)
        services.log(request, "announcement.previewed", "announcement", "", announce.audience_label(draft), {"people": len(people)})
        return Response({
            "companies": len(companies), "people": len(people), "label": announce.audience_label(draft),
            "sample": [u.email for u in people[:5]],
        })


class AnnouncementCancelView(StaffView):
    perm = "view"
    write_roles = roles_for("announce")

    def post(self, request, announcement_id):
        a = Announcement.objects.filter(pk=announcement_id).first()
        if a is None:
            raise Http404
        if a.cancelled_at is None:
            a.cancelled_at = timezone.now()
            a.save(update_fields=["cancelled_at"])
        services.log(request, "announcement.cancelled", "announcement", a.id, a.title_en)
        return Response(announcement_json(a))


# ---------------------------------------------------------------- business analytics
SIZE_BANDS = [("1 to 5", 1, 5), ("6 to 20", 6, 20), ("21 to 50", 21, 50), ("51 to 200", 51, 200), ("More than 200", 201, 10**9)]


def weekly_rows(weeks, now):
    start = week_start(now) - timedelta(weeks=weeks - 1)
    events = {
        r["w"].date().isoformat(): r
        for r in Event.objects.filter(created_at__gte=start).annotate(w=TruncWeek("created_at")).values("w").annotate(
            views=event_count(Q(type="view")), scans=event_count(Q(type="view", source="qr")), saves=event_count(Q(type="save")),
        ).order_by()
    }
    companies = {x["week"]: x["n"] for x in weekly_counts(Workspace.objects.filter(kind="company", deleted_at__isnull=True, created_at__gte=start).values_list("created_at", flat=True), weeks, now)}
    new_cards = {x["week"]: x["n"] for x in weekly_counts(Card.objects.filter(created_at__gte=start).values_list("created_at", flat=True), weeks, now)}
    leads = {x["week"]: x["n"] for x in weekly_counts(Lead.objects.filter(created_at__gte=start).values_list("created_at", flat=True), weeks, now)}
    rows = []
    for i in range(weeks):
        day = (start + timedelta(weeks=i)).date().isoformat()
        ev = events.get(day, {})
        rows.append({
            "week": day, "new_companies": companies.get(day, 0), "new_cards": new_cards.get(day, 0), "views": ev.get("views", 0) or 0,
            "scans": ev.get("scans", 0) or 0, "saves": ev.get("saves", 0) or 0, "leads": leads.get(day, 0),
        })
    return rows


def retention(now, cohorts=8):
    """For each signup week: how many companies there were and how many still had visits on their cards 1, 4 and 8 weeks later."""
    this = week_start(now)
    out = []
    for back in range(cohorts, 0, -1):
        start = this - timedelta(weeks=back)
        ids = list(Workspace.objects.filter(kind="company", deleted_at__isnull=True, created_at__gte=start, created_at__lt=start + timedelta(weeks=1)).values_list("id", flat=True))
        row = {"week": start.date().isoformat(), "companies": len(ids), "after": {}}
        for k in (1, 4, 8):
            window_start = start + timedelta(weeks=k)
            if window_start + timedelta(weeks=1) > now or not ids:
                row["after"][str(k)] = None
                continue
            active = Event.objects.filter(card__workspace_id__in=ids, created_at__gte=window_start, created_at__lt=window_start + timedelta(weeks=1)).values("card__workspace_id").distinct().count()
            row["after"][str(k)] = round(100 * active / len(ids))
        out.append(row)
    return out


def _month_start(day, back=0):
    """The first moment of the month `back` months before the month of `day` (UTC)."""
    index = day.year * 12 + day.month - 1 - back
    return day.replace(year=index // 12, month=index % 12 + 1, day=1, hour=0, minute=0, second=0, microsecond=0)


def monthly_retention(now, cohorts=6):
    """For each of the last finished months: how many companies joined, and the share of them whose cards had visits in the
    month they joined (month 0) and 1, 2 and 3 months later. A month that has not finished yet shows as null."""
    out = []
    for back in range(cohorts, 0, -1):
        start, end = _month_start(now, back), _month_start(now, back - 1)
        ids = list(Workspace.objects.filter(kind="company", deleted_at__isnull=True, created_at__gte=start, created_at__lt=end).values_list("id", flat=True))
        row = {"month": start.date().isoformat()[:7], "companies": len(ids), "after": {}}
        active = {}
        if ids:
            seen = Event.objects.filter(card__workspace_id__in=ids, created_at__gte=start).annotate(m=TruncMonth("created_at")).values_list("m", "card__workspace_id").distinct()
            for m, ws_id in seen:
                active.setdefault((m.year, m.month), set()).add(ws_id)
        for k in range(4):
            window = _month_start(now, back - k)
            if _month_start(now, back - k - 1) > now or not ids:
                row["after"][str(k)] = None
                continue
            row["after"][str(k)] = round(100 * len(active.get((window.year, window.month), ())) / len(ids))
        out.append(row)
    return out


def company_countries(now):
    """Companies per country: the country a company chose, else (marked guessed) the one most of its visitors come from."""
    own = {}
    for code, n in Workspace.objects.filter(kind="company", deleted_at__isnull=True).exclude(country__isnull=True).exclude(country="").values_list("country").annotate(n=Count("id")).order_by():
        own[code] = n
    no_country = list(Workspace.objects.filter(kind="company", deleted_at__isnull=True).filter(Q(country__isnull=True) | Q(country="")).values_list("id", flat=True))
    votes = {}
    if no_country:
        rows = (
            Event.objects.filter(type="view", created_at__gte=now - timedelta(days=90), card__workspace_id__in=no_country)
            .exclude(country__in=("unknown", "")).values("card__workspace_id", "country").annotate(n=event_count()).order_by()
        )
        for r in rows:
            best = votes.get(r["card__workspace_id"])
            if best is None or r["n"] > best[1]:
                votes[r["card__workspace_id"]] = (r["country"], r["n"])
    guessed = {}
    for code, _ in votes.values():
        guessed[code] = guessed.get(code, 0) + 1
    out = [{"country": c, "companies": own.get(c, 0) + guessed.get(c, 0), "guessed": guessed.get(c, 0)} for c in set(own) | set(guessed)]
    out.sort(key=lambda r: (-r["companies"], r["country"]))
    return out[:15]


def analytics_payload(weeks, now):
    countries = list(
        Event.objects.filter(type="view", created_at__gte=now - timedelta(days=90)).exclude(country__in=("unknown", "")).values("country")
        .annotate(n=event_count()).order_by("-n")[:15]
    )
    sizes = {label: 0 for label, _, _ in SIZE_BANDS}
    for n in Workspace.objects.filter(kind="company", deleted_at__isnull=True).annotate(m=Count("members")).values_list("m", flat=True):
        for label, low, high in SIZE_BANDS:
            if low <= n <= high:
                sizes[label] += 1
    top = list(
        Event.objects.filter(type="view", created_at__gte=now - timedelta(days=30)).values("card__workspace_id", "card__workspace__name")
        .annotate(n=event_count()).order_by("-n")[:10]
    )
    start = week_start(now) - timedelta(weeks=weeks - 1)
    live_cards = Card.objects.filter(status="published", workspace__deleted_at__isnull=True)
    active_total = live_cards.filter(created_at__lt=start).count()
    active_cards = []
    for row in weekly_counts(live_cards.filter(created_at__gte=start).values_list("created_at", flat=True), weeks, now):
        active_total += row["n"]
        active_cards.append({"week": row["week"], "n": active_total})
    last_30 = now - timedelta(days=30)
    totals = {
        "companies": Workspace.objects.filter(kind="company", deleted_at__isnull=True).count(),
        "active_cards": live_cards.count(),
        "views_30d": Event.objects.filter(type="view", created_at__gte=last_30).aggregate(n=event_count())["n"],
        "leads_30d": Lead.objects.filter(created_at__gte=last_30).count(),
    }
    return {
        "totals": totals,
        "active_cards": active_cards,
        "retention_monthly": monthly_retention(now),
        "weeks": weekly_rows(weeks, now),
        "countries": [{"country": r["country"], "views": r["n"]} for r in countries],
        "company_countries": company_countries(now),
        "sizes": [{"label": k, "companies": v} for k, v in sizes.items()],
        "top_companies": [{"id": str(r["card__workspace_id"]), "name": r["card__workspace__name"], "views": r["n"]} for r in top],
        "retention": retention(now),
        "money": billing_data.money_block(now),
    }


class AnalyticsView(StaffView):
    perm = "view"

    def get(self, request):
        return Response(analytics_payload(int_param(request.query_params, "weeks", 12, 4, 52), timezone.now()))


class AnalyticsExportView(StaffView):
    perm = "export"

    def get(self, request):
        rows = weekly_rows(int_param(request.query_params, "weeks", 26, 4, 104), timezone.now())
        services.log(request, "analytics.exported", "export", "", "Business analytics", {"rows": len(rows)})
        return csv_response(
            "analytics.csv", ["Week starting", "New companies", "New cards", "Views", "Scans", "Saves", "Leads"],
            [[r["week"], r["new_companies"], r["new_cards"], r["views"], r["scans"], r["saves"], r["leads"]] for r in rows],
        )

