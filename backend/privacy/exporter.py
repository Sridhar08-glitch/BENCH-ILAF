"""Building the export ZIP: JSON files for the data, the uploaded pictures, and a readable README.

Rows are written generically (every stored column of the model), so a field added to a model later
is exported without changing this file. Secrets (password hashes, invite tokens) are left out.
"""
import json
import tempfile
import zipfile
from datetime import date, datetime, timedelta
from pathlib import PurePosixPath
from uuid import UUID

from django.conf import settings
from django.core.files.storage import default_storage
from django.db.models import Count, Q
from django.db.models.fields.files import FieldFile
from django.utils import timezone

from analytics.models import Event, event_count
from cards.models import Card
from cards.services import public_url
from leads.models import Lead, company_owned_leads
from operations.models import AuditEvent
from workspaces.models import CustomDomain, Member

SECRET_FIELDS = {"password", "invite_token", "ip_hash", "visitor_hash"}
MAX_MEDIA_BYTES = 25 * 1024 * 1024


def _domain_dump(workspace):
    """(the company's claimed custom domain, its status) for the export; the verification token is not exported."""
    row = CustomDomain.objects.filter(workspace=workspace).first()
    return (row.domain, row.status) if row else (None, None)


def _plain(value):
    if isinstance(value, (datetime, date)):
        return value.isoformat()
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, FieldFile):
        return value.name or None
    return value


def dump_row(obj, skip=()):
    """Every concrete column of a model row as plain JSON values (links become ids)."""
    row = {}
    for field in obj._meta.concrete_fields:
        if field.name in SECRET_FIELDS or field.name in skip:
            continue
        key = field.attname if field.is_relation else field.name
        row[key] = _plain(getattr(obj, key))
    return row


class ZipWriter:
    """Writes JSON and media into a temporary ZIP, remembering what is inside for the README."""

    def __init__(self):
        self.file = tempfile.TemporaryFile()
        self.zip = zipfile.ZipFile(self.file, "w", zipfile.ZIP_DEFLATED)
        self.entries = []   # (path, description)
        self.skipped = []   # media files that could not be read

    def json(self, path, data, description):
        self.zip.writestr(path, json.dumps(data, indent=2, ensure_ascii=False, default=_plain))
        self.entries.append((path, description))

    def media(self, field_file, folder, label):
        """Copy one uploaded file. Missing or oversized files are reported, never fatal."""
        name = getattr(field_file, "name", None) or (field_file if isinstance(field_file, str) else None)
        if not name:
            return None
        try:
            with default_storage.open(name, "rb") as source:
                data = source.read(MAX_MEDIA_BYTES + 1)
        except Exception:
            self.skipped.append(name)
            return None
        if len(data) > MAX_MEDIA_BYTES:
            self.skipped.append(name)
            return None
        path = str(PurePosixPath("media") / folder / PurePosixPath(name).name)
        if path not in {p for p, _ in self.entries}:
            self.zip.writestr(path, data)
            self.entries.append((path, label))
        return path

    def text(self, path, body):
        self.zip.writestr(path, body)

    def finish(self):
        self.zip.close()
        self.file.seek(0)
        return self.file


def _icon_names(card):
    """Storage names of the icons a person uploaded for their buttons (kept as URLs in the items)."""
    names = []
    for item in card.items.all():
        icon = item.icon or {}
        url = icon.get("image_url") if isinstance(icon, dict) else None
        if url and "/icons/" in url:
            names.append("icons/" + url.rsplit("/", 1)[-1].split("?")[0])
    return names


def card_dump(card):
    data = dump_row(card)
    data["public_url"] = public_url(card)
    data["items"] = [dump_row(i) for i in card.items.all()]
    data["slug_history"] = [s.slug for s in card.old_slugs.all()]
    return data


def analytics_summary(card_ids):
    """Totals and a per-day count per card. Visitors are anonymous, so no personal data is in here."""
    rows = (
        Event.objects.filter(card_id__in=card_ids)
        .values("card_id")
        .annotate(
            views=event_count(Q(type="view")),
            scans=event_count(Q(type="view", source="qr")),
            taps=event_count(Q(type="tap") | Q(type="view", source="nfc")),
            saves=event_count(Q(type="save")),
            link_clicks=event_count(Q(type="link_click")),
        )
    )
    summary = {str(cid): {"views": 0, "scans": 0, "taps": 0, "saves": 0, "link_clicks": 0, "per_day": {}} for cid in card_ids}
    for row in rows:
        summary[str(row["card_id"])].update({k: row[k] for k in ("views", "scans", "taps", "saves", "link_clicks")})
    since = timezone.now() - timedelta(days=365)
    for card_id, created, weight in Event.objects.filter(card_id__in=card_ids, created_at__gte=since).values_list(
        "card_id", "created_at", "weight"
    ):
        day = created.date().isoformat()
        per_day = summary[str(card_id)]["per_day"]
        per_day[day] = per_day.get(day, 0) + weight
    return summary


README_TOP = """{product} data export
Prepared for: {who}
Prepared on: {when}

This ZIP holds the data {product} keeps {about}. Every file is plain JSON, which any text editor
or spreadsheet import can read. Dates are in UTC (ISO 8601).

Files:
"""

README_BOTTOM = """
Not included: password hashes and sign-in tokens (secrets), and anonymous visitor identifiers.
{skipped}Questions about your data: contact {company} ({site}).
"""


def _readme(writer, who, about):
    lines = [README_TOP.format(product=settings.PRODUCT_NAME, who=who, when=timezone.now().strftime("%Y-%m-%d %H:%M UTC"), about=about)]
    lines += [f"  {path}\n      {desc}\n" for path, desc in writer.entries if not path.startswith("media/")]
    media = [p for p, _ in writer.entries if p.startswith("media/")]
    if media:
        lines.append(f"  media/  ({len(media)} uploaded pictures: profile photo, card photos and covers, logos)\n")
    skipped = ""
    if writer.skipped:
        skipped = f"These files could not be copied (missing or too large): {', '.join(sorted(set(writer.skipped)))}.\n"
    lines.append(README_BOTTOM.format(skipped=skipped, company=settings.COMPANY_NAME, site=settings.COMPANY_SITE))
    writer.text("README.txt", "".join(lines))


def _audit_about_user(user, member_ids):
    q = Q(actor=user) | Q(target_type="member", target_id__in=[str(m) for m in member_ids])
    return [dump_row(e) for e in AuditEvent.objects.filter(q).order_by("created_at")]


def build_user_export(user):
    """The ZIP (an open temporary file) for one person's own data."""
    from .models import DataRequest

    writer = ZipWriter()
    members = list(Member.objects.filter(user=user).select_related("workspace"))
    cards = list(
        Card.objects.filter(owner=user).prefetch_related("items", "old_slugs").select_related("workspace")
    )
    card_ids = [c.id for c in cards]
    leads = list(Lead.objects.filter(card_id__in=card_ids).order_by("created_at"))

    writer.json("profile.json", {
        "id": str(user.id), "email": user.email, "full_name": user.full_name,
        "photo": user.photo.name or None, "created_at": user.created_at.isoformat(),
        "email_verified": user.email_verified,
        "google_linked": bool(user.google_sub), "google_email": user.google_email or None,
        "has_password": user.has_usable_password(),
    }, "Your profile and sign-in methods")
    writer.json("workspaces.json", [
        {
            "workspace": {"id": str(m.workspace_id), "name": m.workspace.name, "kind": m.workspace.kind},
            "membership": dump_row(m),
        }
        for m in members
    ], "The workspaces you belong to and your role in each")
    writer.json("cards.json", [card_dump(c) for c in cards], "Your cards with their buttons and design")
    writer.json("leads.json", [dump_row(lead) for lead in leads], "Contacts people left on cards you own")
    writer.json("analytics.json", analytics_summary(card_ids), "Visit totals for each of your cards (anonymous)")
    writer.json("audit.json", _audit_about_user(user, [m.id for m in members]), "Activity log entries about you")
    writer.json("consents.json", {
        "lead_consents": [{"lead_id": str(lead.id), "consented_at": _plain(lead.consented_at)} for lead in leads],
        "data_requests": [
            {"kind": r.kind, "scope": r.scope, "status": r.status, "requested_at": r.requested_at.isoformat(),
             "completed_at": _plain(r.completed_at)}
            for r in DataRequest.objects.filter(user=user)
        ],
    }, "When visitors agreed to share their details, and your earlier data requests")

    writer.media(user.photo, "profile", "Your profile photo")
    for ws in {m.workspace_id: m.workspace for m in members if m.workspace.kind == "personal"}.values():
        for field in (ws.logo, ws.symbol):
            writer.media(field, "logos", "A logo")
    for card in cards:
        writer.media(card.photo, f"cards/{card.public_code}", "Card photo")
        writer.media(card.cover, f"cards/{card.public_code}", "Card cover")
        for name in _icon_names(card):
            writer.media(name, f"cards/{card.public_code}", "Button icon")
    _readme(writer, user.email, "about you")
    return writer.finish()


def build_workspace_export(workspace):
    """The ZIP for one company: team, cards, leads and the activity log."""
    writer = ZipWriter()
    members = list(workspace.members.select_related("user", "department"))
    cards = list(Card.objects.filter(workspace=workspace).prefetch_related("items", "old_slugs"))
    card_ids = [c.id for c in cards]
    # The company's own contacts only: an employee's contacts are theirs, and come out in their own export.
    leads = list(company_owned_leads(workspace).distinct().order_by("created_at"))

    writer.json("company.json", {
        "id": str(workspace.id), "name": workspace.name, "created_at": workspace.created_at.isoformat(),
        "brand": workspace.brand, "custom_domain": _domain_dump(workspace)[0], "custom_domain_status": _domain_dump(workspace)[1],
        "directory_enabled": workspace.directory_enabled, "directory_slug": workspace.directory_slug,
        "allowed_email_domains": workspace.allowed_email_domains,
        "require_google_signin": workspace.require_google_signin,
        "field_rules": workspace.field_rules, "lead_settings": workspace.lead_settings,
    }, "Company details, branding and settings")
    writer.json("team.json", [
        {**dump_row(m), "department": m.department.name if m.department_id else None} for m in members
    ], "Everyone on the team: role, status and department")
    writer.json("departments.json", [dump_row(d) for d in workspace.departments.all()], "Departments")
    writer.json("cards.json", [card_dump(c) for c in cards], "All company cards with buttons and design")
    writer.json("leads.json", [dump_row(lead) for lead in leads], "All leads collected by the company")
    writer.json("analytics.json", analytics_summary(card_ids), "Visit totals per card (anonymous)")
    writer.json(
        "activity_log.json",
        [dump_row(e) for e in AuditEvent.objects.filter(workspace=workspace).order_by("created_at")],
        "The company activity log",
    )
    for field in (workspace.logo, workspace.symbol, workspace.background, workspace.template_front, workspace.template_back):
        writer.media(field, "company", "Company picture")
    for card in cards:
        writer.media(card.photo, f"cards/{card.public_code}", "Card photo")
        writer.media(card.cover, f"cards/{card.public_code}", "Card cover")
    _readme(writer, workspace.name, "about this company")
    return writer.finish()


def estimate_size(user=None, workspace=None):
    """(cards, leads) counts used to decide between exporting now and exporting in the background."""
    if workspace is not None:
        cards = Card.objects.filter(workspace=workspace)
        leads = company_owned_leads(workspace)
    else:
        cards = Card.objects.filter(owner=user)
        leads = Lead.objects.filter(card__owner=user)
    return cards.count(), leads.count()

