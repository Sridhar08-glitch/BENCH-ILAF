"""The weekly report e-mails: the numbers, the HTML and text, the unsubscribe link and the sending.

A week is an ISO week (Monday to Sunday, UTC). The report of a week is sent on the Monday after it, and the
change shown is against the week before. A person gets their own report (their cards); owners and admins of a
company also get a company report.
"""
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone as dt_tz
from html import escape
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core import signing
from django.db.models import Count, Q
from django.utils import timezone

from cards.models import Card
from ilaf.emails import brand_html_page, end_align, send_brand_html
from ilaf.i18n import is_rtl, member_language, month_name, tr, trn
from leads.models import Lead
from operations.models import ChangeRequest

from . import breakdowns
from .periods import Window

SALT = "weekly-report-unsubscribe"
STATUS_ORDER = ("new", "contacted", "qualified", "won", "lost")
STATUS_NAMES = {"new": "New", "contacted": "Contacted", "qualified": "Qualified", "won": "Won", "lost": "Lost"}
UTC = ZoneInfo("UTC")


@dataclass
class Week:
    year: int
    week: int
    window: Window
    partial: bool = False  # the week is still running (a preview)


def _window(monday):
    start = datetime.combine(monday, time.min, tzinfo=dt_tz.utc)
    return Window(
        tz=UTC, start_date=monday, end_date=monday + timedelta(days=6), days=7, start=start,
        end=start + timedelta(days=7), prev_start=start - timedelta(days=7),
    )


def week_of(monday, partial=False):
    iso = monday.isocalendar()
    return Week(iso[0], iso[1], _window(monday), partial)


def last_full_week(now=None):
    today = (now or timezone.now()).astimezone(dt_tz.utc).date()
    return week_of(today - timedelta(days=today.weekday() + 7))


def current_week(now=None):
    today = (now or timezone.now()).astimezone(dt_tz.utc).date()
    return week_of(today - timedelta(days=today.weekday()), partial=True)


def parse_week(text):
    """`2026-W46` -> Week."""
    try:
        year, week = text.upper().split("-W")
        return week_of(date.fromisocalendar(int(year), int(week), 1))
    except (ValueError, AttributeError):
        raise ValueError("Use the form 2026-W46.")


# ---------------------------------------------------------------- the numbers
def own_cards(member):
    """The cards a person holds: theirs by membership, or by owner in a personal space."""
    q = Q(member_id=member.id)
    if member.user_id:
        q |= Q(owner_id=member.user_id)
    return Card.objects.filter(Q(workspace_id=member.workspace_id) & q)


def change(now, prev):
    if prev == 0:
        return None if now == 0 else 100
    return round((now - prev) * 100 / prev)


def personal_data(member, week):
    cards = own_cards(member)
    rows = breakdowns.people_rows(cards, week.window)
    totals, prev = breakdowns.totals_of(rows), breakdowns.totals_of(rows, "prev")
    links, _ = breakdowns.link_rows(cards, week.window)
    return {
        "cards": cards.count(), "totals": totals, "prev": prev,
        "changes": {k: change(totals[k], prev[k]) for k in ("views", "scans", "saves", "link_clicks", "leads")},
        "top_link": links[0] if links else None,
    }


def has_activity(data):
    return any(data["totals"].values()) or any(data["prev"].values())


def company_data(member, week):
    ws = member.workspace
    cards = Card.objects.filter(workspace_id=ws.id)
    # The report is written for a person: it counts the contacts they may see (the company card's), not an employee's.
    from leads.workflow import visible_leads
    from workspaces.access import commerce_cards

    rows = breakdowns.people_rows(cards, week.window, lead_cards=cards.filter(pk__in=commerce_cards(member).values("pk")))
    totals, prev = breakdowns.totals_of(rows), breakdowns.totals_of(rows, "prev")
    by_status = {s: 0 for s in STATUS_ORDER}
    mine = visible_leads(member)
    for r in mine.values("status").annotate(n=Count("id")):
        by_status[r["status"]] = r["n"]
    open_leads = mine.exclude(status__in=("won", "lost"))
    return {
        "company": ws.name, "cards": cards.count(), "totals": totals, "prev": prev,
        "changes": {k: change(totals[k], prev[k]) for k in ("views", "scans", "saves", "link_clicks", "leads")},
        "top_people": [
            {"name": r["person"], "department": r["department"], "views": r["totals"]["views"], "leads": r["totals"]["leads"]}
            for r in rows[:5] if r["totals"]["views"] or r["totals"]["leads"]
        ],
        "leads_by_status": by_status,
        "unassigned_leads": open_leads.filter(assignee__isnull=True).count(),
        "pending_approvals": ChangeRequest.objects.filter(workspace_id=ws.id, status="pending").count(),
    }


# ---------------------------------------------------------------- unsubscribe links
def unsubscribe_token(user_id, workspace_id, kind):
    return signing.dumps({"u": str(user_id), "w": str(workspace_id), "k": kind}, salt=SALT)


def read_token(token):
    """The (user id, workspace id, kind) a token was made for, or None when it is not ours."""
    try:
        data = signing.loads(token, salt=SALT)
        return data["u"], data["w"], data["k"]
    except (signing.BadSignature, KeyError, TypeError):
        return None


def unsubscribe_url(user_id, workspace_id, kind):
    base = settings.API_BASE_URL or "http://localhost:8100"
    return f"{base}/api/v1/reports/unsubscribe?token={unsubscribe_token(user_id, workspace_id, kind)}"


# ---------------------------------------------------------------- the e-mail
def _span(week, lang="en"):
    a, b = week.window.start_date, week.window.end_date
    if a.month == b.month:
        return f"{a.day}-{b.day} {month_name(lang, b.month, short=True)} {b.year}"
    return f"{a.day} {month_name(lang, a.month, short=True)} - {b.day} {month_name(lang, b.month, short=True)} {b.year}"


def _arrow(pct, lang="en"):
    if pct is None:
        return ""
    if pct == 0:
        return tr(lang, "no change")
    return tr(lang, "up {pct}%", pct=abs(pct)) if pct > 0 else tr(lang, "down {pct}%", pct=abs(pct))


def _tile(label, value, pct, lang="en"):
    colour = settings.BRAND_MUTED
    note = _arrow(pct, lang)
    if pct:
        colour = settings.BRAND_GREEN if pct > 0 else "#DC2626"
    sign = ("▲ " if pct and pct > 0 else "▼ " if pct else "") if note else ""
    return (
        f'<td width="33%" style="padding:6px;vertical-align:top;"><div style="border:1px solid {settings.BRAND_BORDER};'
        f'border-radius:14px;padding:14px 14px 12px;">'
        f'<div style="font-size:12px;color:{settings.BRAND_MUTED};">{escape(label)}</div>'
        f'<div style="font-size:26px;font-weight:800;letter-spacing:-1px;margin:2px 0;color:{settings.BRAND_BLACK};">{value:,}</div>'
        f'<div style="font-size:12px;color:{colour};">{sign}{escape(note) if note else "&nbsp;"}</div></div></td>'
    )


def _tiles(data, lang="en"):
    items = [
        (tr(lang, "Views"), data["totals"]["views"], data["changes"]["views"]),
        (tr(lang, "QR scans"), data["totals"]["scans"], data["changes"]["scans"]),
        (tr(lang, "Contacts saved"), data["totals"]["saves"], data["changes"]["saves"]),
        (tr(lang, "Button clicks"), data["totals"]["link_clicks"], data["changes"]["link_clicks"]),
        (tr(lang, "New leads"), data["totals"]["leads"], data["changes"]["leads"]),
        (tr(lang, "Leads won"), data["totals"]["won"], change(data["totals"]["won"], data["prev"]["won"])),
    ]
    rows = ""
    for i in range(0, 6, 3):
        rows += "<tr>" + "".join(_tile(*it, lang=lang) for it in items[i:i + 3]) + "</tr>"
    return f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:8px -6px 4px;">{rows}</table>'


def _button(text, url, lang="en"):
    side = "left" if is_rtl(lang) else "right"
    return (
        f'<a href="{escape(url, quote=True)}" style="display:inline-block;background:{settings.BRAND_ORANGE};'
        f'color:{settings.BRAND_BLACK};text-decoration:none;font-weight:700;font-size:14px;padding:11px 22px;'
        f'border-radius:999px;margin:6px 0 6px 0;margin-{side}:8px;">{escape(text)}</a>'
    )


def _h2(text):
    return f'<h2 style="margin:26px 0 8px;font-size:16px;font-weight:700;color:{settings.BRAND_BLACK};">{escape(text)}</h2>'


def _footer(url, kind, settings_url, lang="en"):
    what = (
        tr(lang, "weekly report for your company") if kind == "company"
        else tr(lang, "weekly report of your own cards")
    )
    link = (
        f'<a href="{escape(url, quote=True)}" style="color:{settings.BRAND_MUTED};">{escape(tr(lang, "Unsubscribe in one click"))}</a> '
        f'{escape(tr(lang, "or"))} '
        if url else ""
    )
    settings_link = f'<a href="{escape(settings_url, quote=True)}" style="color:{settings.BRAND_MUTED};">{escape(tr(lang, "change your report settings"))}</a>'
    return (
        f'<p style="margin:0 0 10px;font-size:12px;color:{settings.BRAND_MUTED};">'
        f'{escape(tr(lang, "You get this because the {what} is on.", what=what))} {link}{settings_link}.</p>'
    )


def _no_earlier(lang):
    return tr(lang, "no earlier data")


def render_personal(member, week, data, unsub_url=None):
    """(subject, text, html) for a person's own report."""
    lang = member_language(member)
    span = _span(week, lang)
    settings_url = f"{settings.WEB_BASE_URL}/app/settings/notifications"
    name = (member.full_name or "").split(" ")[0] or tr(lang, "there")
    t = data["totals"]
    top = data["top_link"]
    body = _tiles(data, lang)
    intro = trn(
        lang, data["cards"], "Hi {name}, here is how your card was used ({span}).",
        "Hi {name}, here is how your cards were used ({span}).", name=name, span=span,
    )
    lines = [
        intro, "",
        tr(lang, "Views: {value} ({change})", value=t["views"], change=_arrow(data["changes"]["views"], lang) or _no_earlier(lang)),
        tr(lang, "QR scans: {value}", value=t["scans"]), tr(lang, "Contacts saved: {value}", value=t["saves"]),
        tr(lang, "Button clicks: {value}", value=t["link_clicks"]), tr(lang, "New leads: {value}", value=t["leads"]),
    ]
    if top:
        clicks = trn(lang, top["clicks"], "{n} click", "{n} clicks")
        body += _h2(tr(lang, "Your most used button")) + (
            f'<p style="margin:0;font-size:15px;">{escape(top["kind"])} - {escape(clicks)}</p>'
        )
        lines.append(tr(lang, "Most used button: {kind} ({clicks})", kind=top["kind"], clicks=clicks))
    open_text = tr(lang, "Open your analytics")
    body += f'<p style="margin:22px 0 0;">{_button(open_text, settings.WEB_BASE_URL + "/app/analytics", lang)}</p>'
    lines += ["", f"{open_text}: {settings.WEB_BASE_URL}/app/analytics"]
    if unsub_url:
        lines += ["", f"{tr(lang, 'Unsubscribe')}: {unsub_url}", f"{tr(lang, 'Report settings')}: {settings_url}"]
    heading = tr(lang, "Your week")
    html = brand_html_page(heading, body, _footer(unsub_url, "personal", settings_url, lang), subtitle=span, lang=lang)
    subject = tr(lang, "Your week: {views} views, {leads} new leads ({span})", views=t["views"], leads=t["leads"], span=span)
    return subject, "\n".join(lines), html


def render_company(member, week, data, unsub_url=None):
    lang = member_language(member)
    span = _span(week, lang)
    settings_url = f"{settings.WEB_BASE_URL}/app/settings/notifications"
    t = data["totals"]
    body = _tiles(data, lang)
    lines = [
        tr(lang, "{company}: how your team's cards did ({span}).", company=data["company"], span=span), "",
        tr(lang, "Views: {value} ({change})", value=t["views"], change=_arrow(data["changes"]["views"], lang) or _no_earlier(lang)),
        tr(lang, "QR scans: {value}", value=t["scans"]), tr(lang, "Contacts saved: {value}", value=t["saves"]),
        tr(lang, "Button clicks: {value}", value=t["link_clicks"]), tr(lang, "New leads: {value}", value=t["leads"]),
    ]
    if data["top_people"]:
        top_max = max(p["views"] for p in data["top_people"]) or 1
        rows = ""
        lines += ["", tr(lang, "Top people")]
        for p in data["top_people"]:
            pct = max(4, round(100 * p["views"] / top_max))
            who = escape(p["name"]) + (
                f' <span style="color:{settings.BRAND_MUTED};font-size:12px;">{escape(p["department"])}</span>' if p["department"] else ""
            )
            summary = tr(lang, "{views} views, {leads} leads", views=f'{p["views"]:,}', leads=p["leads"])
            rows += (
                f'<tr><td style="padding:7px 0;font-size:14px;width:34%;">{who}</td>'
                f'<td style="padding:7px 8px;width:36%;"><div style="background:#F6F7F9;border-radius:999px;height:10px;">'
                f'<div style="background:{settings.BRAND_ORANGE};border-radius:999px;height:10px;width:{pct}%;"></div></div></td>'
                f'<td style="padding:7px 0;font-size:14px;text-align:{end_align(lang)};white-space:nowrap;">{escape(summary)}</td></tr>'
            )
            lines.append(f"  {p['name']}: {tr(lang, '{views} views, {leads} leads', views=p['views'], leads=p['leads'])}")
        body += _h2(tr(lang, "Top people")) + f'<table role="presentation" width="100%" cellspacing="0" cellpadding="0">{rows}</table>'
    chips = "".join(
        f'<td style="padding:4px;"><div style="border:1px solid {settings.BRAND_BORDER};border-radius:12px;padding:8px 12px;'
        f'text-align:center;"><div style="font-size:18px;font-weight:800;">{data["leads_by_status"][s]:,}</div>'
        f'<div style="font-size:12px;color:{settings.BRAND_MUTED};">{escape(tr(lang, STATUS_NAMES[s]))}</div></div></td>'
        for s in STATUS_ORDER
    )
    body += _h2(tr(lang, "Leads by status")) + f'<table role="presentation" cellspacing="0" cellpadding="0" style="margin:0 -4px;"><tr>{chips}</tr></table>'
    lines += ["", tr(lang, "Leads by status: {list}", list=tr(lang, ", ").join(f"{tr(lang, STATUS_NAMES[s])} {data['leads_by_status'][s]}" for s in STATUS_ORDER))]
    todo = ""
    if data["unassigned_leads"]:
        n = data["unassigned_leads"]
        todo += _button(trn(lang, n, "Assign {n} open lead", "Assign {n} open leads"), settings.WEB_BASE_URL + "/app/contacts?assignee=none", lang)
        lines.append(tr(lang, "Open leads nobody owns yet: {value}", value=n))
    if data["pending_approvals"]:
        n = data["pending_approvals"]
        todo += _button(trn(lang, n, "Review {n} change", "Review {n} changes"), settings.WEB_BASE_URL + "/app/fields", lang)
        lines.append(tr(lang, "Changes waiting for approval: {value}", value=n))
    if todo:
        body += _h2(tr(lang, "Needs you")) + f"<p style=\"margin:0;\">{todo}</p>"
    open_text = tr(lang, "Open analytics")
    body += f'<p style="margin:22px 0 0;">{_button(open_text, settings.WEB_BASE_URL + "/app/analytics", lang)}</p>'
    lines += ["", f"{open_text}: {settings.WEB_BASE_URL}/app/analytics"]
    if unsub_url:
        lines += ["", f"{tr(lang, 'Unsubscribe')}: {unsub_url}", f"{tr(lang, 'Report settings')}: {settings_url}"]
    html = brand_html_page(
        tr(lang, "{company} this week", company=data["company"]), body, _footer(unsub_url, "company", settings_url, lang),
        subtitle=span, lang=lang,
    )
    subject = tr(lang, "{company}: {views} views, {leads} new leads ({span})", company=data["company"], views=t["views"], leads=t["leads"], span=span)
    return subject, "\n".join(lines), html


def build(member, kind, week, with_unsubscribe=True):
    """(subject, text, html, data) for one report. The unsubscribe link needs a person with an account."""
    unsub = unsubscribe_url(member.user_id, member.workspace_id, kind) if (with_unsubscribe and member.user_id) else None
    if kind == "company":
        data = company_data(member, week)
        return (*render_company(member, week, data, unsub), data)
    data = personal_data(member, week)
    return (*render_personal(member, week, data, unsub), data)


def send(member, kind, week):
    """Build and send one report to the person. Raises when the mail server fails."""
    subject, text, html, _ = build(member, kind, week)
    url = unsubscribe_url(member.user_id, member.workspace_id, kind)
    send_brand_html(
        member.user.email, subject, text, html,
        headers={"List-Unsubscribe": f"<{url}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"},
    )
