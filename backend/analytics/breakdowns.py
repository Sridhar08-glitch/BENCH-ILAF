"""Numbers per card, person, department, button and source. One grouped query per table, counted in the database.

The same functions feed the Analytics page and the weekly report e-mails.
"""
from django.db.models import Count, DateField, Q
from django.db.models.functions import TruncDate, TruncMonth, TruncWeek

from leads.models import Lead

from .models import Event, event_count

METRICS = ("views", "scans", "taps", "saves", "link_clicks", "leads", "won")
SOURCE_KEYS = ("nfc", "qr", "link", "email", "other")
EVENT_FILTERS = {
    "views": Q(type="view"),
    "scans": Q(type="view", source="qr"),
    "taps": Q(type="tap") | Q(type="view", source="nfc"),
    "saves": Q(type="save"),
    "link_clicks": Q(type="link_click"),
}


def zero():
    return {m: 0 for m in METRICS}


def lead_scope(cards, lead_cards=None):
    """The contacts of these cards the reader may see: all of them when `lead_cards` is None, else those of `lead_cards` and the ones an
    employee shared with the company (`shared_with_company`) on the other cards."""
    if lead_cards is None:
        return Lead.objects.filter(card__in=cards)
    return Lead.objects.filter(Q(card__in=lead_cards) | Q(card__in=cards, shared_with_company=True))


def shown_card_ids(cards, lead_cards=None):
    """The ids of the cards whose number of contacts may be shown: those of `lead_cards`, plus cards that have shared contacts (the number
    then counts the shared ones only). None when everything is shown."""
    if lead_cards is None:
        return None
    shown = set(lead_cards.values_list("id", flat=True))
    shown.update(Lead.objects.filter(card__in=cards, shared_with_company=True).values_list("card_id", flat=True).distinct())
    return shown


def per_card(cards, window, lead_cards=None):
    """{card_id: {"now": {metric: n}, "prev": {metric: n}}} for the cards (a queryset) over the range and the period before it.
    Contacts are counted only on `lead_cards` (the cards whose contacts the reader may see); views, scans and saves count on all of them."""
    out = {}

    def slot(card_id):
        return out.setdefault(card_id, {"now": zero(), "prev": zero()})

    now_range = Q(created_at__gte=window.start)
    aggs = {}
    for name, cond in EVENT_FILTERS.items():
        aggs[name] = event_count(cond & now_range)
        aggs["prev_" + name] = event_count(cond & ~now_range)
    events = Event.objects.filter(card__in=cards, created_at__gte=window.prev_start, created_at__lt=window.end)
    for row in events.values("card_id").annotate(**aggs):
        s = slot(row["card_id"])
        for name in EVENT_FILTERS:
            s["now"][name] = row[name]
            s["prev"][name] = row["prev_" + name]
    lead_aggs = {
        "leads": Count("id", filter=now_range), "prev_leads": Count("id", filter=~now_range),
        "won": Count("id", filter=now_range & Q(status="won")), "prev_won": Count("id", filter=~now_range & Q(status="won")),
    }
    leads = lead_scope(cards, lead_cards).filter(created_at__gte=window.prev_start, created_at__lt=window.end)
    for row in leads.values("card_id").annotate(**lead_aggs):
        s = slot(row["card_id"])
        s["now"]["leads"], s["prev"]["leads"] = row["leads"], row["prev_leads"]
        s["now"]["won"], s["prev"]["won"] = row["won"], row["prev_won"]
    return out


def add_into(target, source):
    for key in METRICS:
        target[key] += source[key]


def person_of(card):
    """Who a card's numbers belong to: the member holding it, else the owner, else the card itself."""
    if card.member_id:
        m = card.member
        return f"m:{m.id}", (m.full_name or m.email), m.department_id, (m.department.name if m.department_id else None), str(m.id)
    if card.owner_id:
        return f"u:{card.owner_id}", (card.owner.full_name or card.owner.email), None, None, None
    return f"c:{card.id}", card.name or "Card", None, None, None


def people_rows(cards, window, by="person", lead_cards=None):
    """Rows for the people table. `by="card"` gives one row per card instead of one per person."""
    stats = per_card(cards, window, lead_cards)
    shown = shown_card_ids(cards, lead_cards)
    rows = {}
    for card in cards.select_related("member", "member__department", "owner").order_by("created_at"):
        key, name, dept_id, dept_name, member_id = person_of(card)
        if by == "card":
            key = f"card:{card.id}"
        row = rows.get(key)
        if row is None:
            row = rows[key] = {
                "key": key, "member_id": member_id, "name": name if by == "person" else (card.name or name),
                "person": name, "department_id": str(dept_id) if dept_id else None, "department": dept_name,
                "cards": 0, "card_ids": [], "totals": zero(), "prev": zero(),
                # False when the reader may not see this person's contacts: the number of contacts is then left out, not shown as zero.
                "leads_visible": shown is None,
            }
        row["cards"] += 1
        row["card_ids"].append(str(card.id))
        if shown is not None and card.id in shown:
            row["leads_visible"] = True
        s = stats.get(card.id)
        if s:
            add_into(row["totals"], s["now"])
            add_into(row["prev"], s["prev"])
    out = list(rows.values())
    out.sort(key=lambda r: (-r["totals"]["views"], r["name"].lower()))
    return out


def department_rows(workspace, cards, window, lead_cards=None):
    """One row per department of the company, plus a row for people without one."""
    people = people_rows(cards, window, by="person", lead_cards=lead_cards)
    from operations.models import Department

    rows = {}
    for d in Department.objects.filter(workspace=workspace):
        rows[str(d.id)] = {
            "id": str(d.id), "name": d.name, "people": 0, "cards": 0, "totals": zero(), "prev": zero(), "top_person": None,
        }
    for p in people:
        did = p["department_id"] or "none"
        row = rows.get(did)
        if row is None:
            row = rows[did] = {
                "id": None, "name": "No department", "people": 0, "cards": 0, "totals": zero(), "prev": zero(), "top_person": None,
            }
        row["people"] += 1
        row["cards"] += p["cards"]
        add_into(row["totals"], p["totals"])
        add_into(row["prev"], p["prev"])
        if row["top_person"] is None or p["totals"]["views"] > row["top_person"]["views"]:
            row["top_person"] = {"name": p["person"], "views": p["totals"]["views"]}
    out = list(rows.values())
    out.sort(key=lambda r: (-r["totals"]["views"], r["name"].lower()))
    return out


def totals_of(rows, key="totals"):
    t = zero()
    for r in rows:
        add_into(t, r[key])
    return t


def link_rows(cards, window):
    """Button clicks by kind, with the previous period, distinct visitors and the card that got the most."""
    now_range = Q(created_at__gte=window.start)
    base = Event.objects.filter(
        card__in=cards, type="link_click", created_at__gte=window.prev_start, created_at__lt=window.end
    ).exclude(kind="")
    kinds = {}
    for row in base.values("kind").annotate(
        clicks=event_count(now_range), prev=event_count(~now_range),
        visitors=Count("visitor_hash", filter=now_range & ~Q(visitor_hash=""), distinct=True),
    ):
        kinds[row["kind"]] = {
            "kind": row["kind"], "clicks": row["clicks"], "prev_clicks": row["prev"], "visitors": row["visitors"],
            "top_card": None,
        }
    best = {}
    for row in base.filter(now_range).values("kind", "card_id", "card__name").annotate(n=event_count()):
        if row["kind"] not in best or row["n"] > best[row["kind"]]["clicks"]:
            best[row["kind"]] = {"name": row["card__name"], "clicks": row["n"]}
    for kind, top in best.items():
        kinds[kind]["top_card"] = top
    total = sum(r["clicks"] for r in kinds.values())
    out = [r for r in kinds.values() if r["clicks"] or r["prev_clicks"]]
    for r in out:
        r["share"] = round(100 * r["clicks"] / total, 1) if total else 0
    out.sort(key=lambda r: (-r["clicks"], r["kind"]))
    return out, total


def source_rows(cards, window, lead_cards=None):
    """How people reached the card (QR, NFC, link, e-mail): views, saves and leads per source, with the previous period."""
    now_range = Q(created_at__gte=window.start)
    rows = {k: {"key": k, "views": 0, "prev_views": 0, "saves": 0, "leads": 0} for k in SOURCE_KEYS}
    events = Event.objects.filter(card__in=cards, created_at__gte=window.prev_start, created_at__lt=window.end)
    for row in events.values("source").annotate(
        views=event_count(now_range & Q(type="view")), prev=event_count(~now_range & Q(type="view")),
        saves=event_count(now_range & Q(type="save")),
    ):
        key = row["source"] if row["source"] in rows else "other"
        rows[key]["views"] += row["views"]
        rows[key]["prev_views"] += row["prev"]
        rows[key]["saves"] += row["saves"]
    leads = lead_scope(cards, lead_cards).filter(created_at__gte=window.start, created_at__lt=window.end)
    for row in leads.values("channel").annotate(n=Count("id")):
        key = row["channel"] if row["channel"] in rows else "other"
        rows[key]["leads"] += row["n"]
    total = sum(r["views"] for r in rows.values())
    for r in rows.values():
        r["share"] = round(100 * r["views"] / total, 1) if total else 0
    return [rows[k] for k in SOURCE_KEYS], total


def _trunc(group, tz):
    func = {"day": TruncDate, "week": TruncWeek, "month": TruncMonth}[group]
    if group == "day":
        return func("created_at", tzinfo=tz)
    return func("created_at", output_field=DateField(), tzinfo=tz)


def series(cards, window, group, by_source=False, lead_cards=None):
    """Views, saves, taps, button clicks and leads per bucket (day, week or month) in the window's time zone."""
    from .periods import bucket_dates

    dates = bucket_dates(window, group)
    out = {d: {"date": d.isoformat(), "views": 0, "saves": 0, "link_clicks": 0, "leads": 0} for d in dates}
    if by_source:
        for d in dates:
            out[d].update({k: 0 for k in SOURCE_KEYS})
    events = Event.objects.filter(card__in=cards, created_at__gte=window.start, created_at__lt=window.end)
    for row in events.annotate(d=_trunc(group, window.tz)).values("d").annotate(
        views=event_count(Q(type="view")), saves=event_count(Q(type="save")),
        link_clicks=event_count(Q(type="link_click")),
    ):
        slot = out.get(row["d"])
        if slot:
            slot["views"], slot["saves"], slot["link_clicks"] = row["views"], row["saves"], row["link_clicks"]
    if by_source:
        for row in events.filter(type="view").annotate(d=_trunc(group, window.tz)).values("d", "source").annotate(n=event_count()):
            slot = out.get(row["d"])
            if slot:
                slot[row["source"] if row["source"] in SOURCE_KEYS else "other"] += row["n"]
    leads = lead_scope(cards, lead_cards).filter(created_at__gte=window.start, created_at__lt=window.end)
    for row in leads.annotate(d=_trunc(group, window.tz)).values("d").annotate(n=Count("id")):
        slot = out.get(row["d"])
        if slot:
            slot["leads"] = row["n"]
    return [out[d] for d in dates]
