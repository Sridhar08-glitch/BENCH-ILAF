"""Companies, people and cards for the staff area: lists, detail tabs, notes, suspensions, global search, user sign-out."""
import uuid
from datetime import datetime, timedelta

from django.db.models import Count, Exists, F, Max, OuterRef, Q, Subquery, Sum
from django.conf import settings
from django.db.models.functions import Coalesce, Lower, TruncDate
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from accounts.models import User
from accounts.services import revoke_refresh_tokens
from analytics.models import Event
from billing.models import Plan
from billing.services import _sub_live, get_subscription, seats_used
from cards.models import Card
from cards.services import card_json, stats_for
from designs.models import DesignRequest
from ilaf.countries import COUNTRIES, country_name
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import tr, user_language
from ilaf.utils import file_url, iso
from leads.models import Lead
from operations import audit as company_audit
from operations.actions import suspend_card
from operations.models import AuditEvent
from workspaces import domains
from workspaces.models import Member, Workspace

from . import services
from .common import csv_response, int_param, paged
from .models import AbuseReport, CompanyNote, StaffTotp, SupportViewSession
from .ops_services import company_country_info, customer_event
from .perms_map import roles_for
from .permissions import StaffView
from .views import company_json, company_status


def get_company(company_id):
    ws = Workspace.objects.filter(pk=company_id, kind="company", deleted_at__isnull=True).first()
    if ws is None:
        raise Http404
    return ws


def mask_email(email):
    local, _, domain = (email or "").partition("@")
    return f"{local[:1]}{'*' * max(1, min(len(local) - 1, 5))}@{domain}" if domain else ""


def last_sign_in(user):
    """The newest refresh token is the best record of a sign-in (the login time itself is not stored)."""
    row = OutstandingToken.objects.filter(user=user).order_by("-created_at").first()
    return iso(row.created_at) if row else None


def card_state(statuses):
    """One word for the cards of a team member: published, suspended, draft, or none."""
    for state in ("published", "suspended", "draft"):
        if state in statuses:
            return state
    return "none"


_ASK = object()


def member_json(m, card_statuses=(), signed_in=_ASK):
    """A company member. `signed_in` is the last sign-in when a list already looked it up for everyone at once."""
    if signed_in is _ASK:
        signed_in = last_sign_in(m.user) if m.user_id else None
    return {
        "id": str(m.id), "email": m.email, "full_name": m.full_name, "title": m.title, "role": m.role, "status": m.status,
        "user_id": str(m.user_id) if m.user_id else None, "department": m.department.name if m.department_id else "",
        "joined_at": iso(m.joined_at), "invited_at": iso(m.invited_at),
        "last_sign_in": signed_in,
        "card_status": card_state(card_statuses), "cards": len(card_statuses),
    }


def team_rows(ws):
    """The people of a company with the state of their cards (one more query for all of them, not one each)."""
    states = {}
    for member_id, status in Card.objects.filter(workspace=ws, member__isnull=False).values_list("member_id", "status"):
        states.setdefault(member_id, []).append(status)
    members = list(ws.members.select_related("department").order_by("role", "email"))
    latest = dict(
        OutstandingToken.objects.filter(user_id__in=[m.user_id for m in members if m.user_id]).values_list("user_id").annotate(last=Max("created_at")).order_by()
    )
    return [member_json(m, states.get(m.id, ()), iso(latest[m.user_id]) if m.user_id in latest else None) for m in members]


def views_series(ws, days=14, now=None):
    """Card views of a company per day for the last `days` days (today included), oldest first, zeros filled in."""
    now = now or timezone.now()
    first = (now - timedelta(days=days - 1)).date()
    rows = (
        Event.objects.filter(card__workspace=ws, type="view", created_at__date__gte=first).annotate(d=TruncDate("created_at"))
        .values("d").annotate(n=Sum("weight")).order_by()
    )
    by_day = {r["d"]: r["n"] or 0 for r in rows}
    return [{"day": (first + timedelta(days=i)).isoformat(), "views": by_day.get(first + timedelta(days=i), 0)} for i in range(days)]


def public_address(ws):
    """The web address the company is found at: its own domain, else its directory page, else nothing."""
    host = domains.domain_for(ws)
    if host:
        return f"https://{host}"
    if ws.directory_enabled and ws.directory_slug:
        return f"{settings.WEB_BASE_URL}/d/{ws.directory_slug}"
    return ""


def lead_json(lead, mask=False):
    return {
        "id": str(lead.id), "name": lead.name, "email": mask_email(lead.email) if mask else lead.email,
        "phone": "" if mask else lead.phone, "company": lead.company, "note": "" if mask else lead.note, "status": lead.status,
        "source": lead.source, "card_name": lead.card_name, "created_at": iso(lead.created_at),
    }


from security import company as security_company  # noqa: E402


def brand_json(ws, request):
    from ilaf.branding import normalize_branding
    from operations.rules import normalize_rules
    from cards.models import Card

    brand = ws.brand or {}
    look = normalize_branding(brand)
    rules = normalize_rules(ws.field_rules)
    return {
        "company_name": brand.get("company_name") or ws.name, "website": brand.get("website") or "",
        "design": brand.get("design"), "lock_design": bool(brand.get("lock_design")), "show_footer": bool(brand.get("show_footer", True)),
        "logo_url": file_url(request, ws.logo), "symbol_url": file_url(request, ws.symbol),
        "background_url": file_url(request, ws.background),
        "require_google_signin": ws.require_google_signin, "allowed_email_domains": ws.allowed_email_domains,
        "directory_enabled": ws.directory_enabled, "directory_slug": ws.directory_slug, "custom_domain": domains.verified_domain_name(ws), "custom_domain_info": domains.info_json(ws),
        "verified_domains": security_company.verified_domains(ws),
        # The two brand colours (primary, accent, mode) and the card font ("face" keeps each face's own fonts).
        "colours": brand.get("colours"), "palette": brand.get("palette"),
        "font": (brand.get("design") or {}).get("font") or "face",
        # How the logo is shown, its size and the places the owner gave it, the artwork, and what employees may add and change.
        "logo_display": look["logo_display"], "logo_placement": look["logo_placement"], "logo_corner": look["logo_corner"],
        "logo_chip": look["logo_chip"], "show_company_name": look["show_company_name"], "logo_size": look["logo_size"],
        "logo_free": look["logo_free"], "artwork_mode": look["artwork"]["mode"],
        "template_front_url": file_url(request, ws.template_front),
        "extras": {"mode": rules["extras"], "kinds": rules["extra_kinds"]},
        "rights": {k: rules[k] for k in ("name", "title", "photo", "company", "address", "button_add", "button_edit", "button_remove", "slug", "features", "vcard")},
        "company_card": Card.objects.filter(workspace=ws, is_company=True).values_list("public_code", flat=True).first(),
    }


def card_row(card, request, stats=None):
    data = card_json(card, request, stats)
    data["workspace_name"] = card.workspace.name
    data["staff_hold"] = card.staff_hold
    return data


def events_json(ws, limit=30, page=1):
    qs = AuditEvent.objects.filter(workspace=ws)
    total = qs.count()
    rows = qs[(page - 1) * limit: page * limit]
    return {
        "count": total, "page": page,
        "results": [
            {"id": str(e.id), "action": e.action, "label": company_audit.ACTIONS.get(e.action, e.action), "actor_email": e.actor_email, "actor_name": e.actor_name,
             "target_label": e.target_label, "details": e.details, "created_at": iso(e.created_at)}
            for e in rows
        ],
    }


# ---------------------------------------------------------------- companies
def _country_codes(term):
    """The country codes whose English or Arabic name contains the typed text (a typed code matches itself)."""
    low = term.lower()
    codes = [code for code, names in COUNTRIES.items() if low in names["en"].lower() or term in names["ar"]]
    if len(term) == 2:
        codes.append(term.upper())
    return codes


def filtered_companies(params):
    """The companies a list or an export asks for. Filters: q (company name, owner e-mail, owner name, country), plan (code), status."""
    qs = Workspace.objects.filter(kind="company", deleted_at__isnull=True)
    term = (params.get("q") or "").strip()[:100]
    if term:
        owner = Q(members__role="owner") & (Q(members__email__icontains=term) | Q(members__full_name__icontains=term))
        qs = qs.filter(Q(name__icontains=term) | owner | Q(country__in=_country_codes(term))).distinct()
    plan = params.get("plan")
    if plan == "none":
        qs = qs.filter(subscription__isnull=True)
    elif plan:
        qs = qs.filter(subscription__plan__code=plan)
    status = params.get("status")
    now = timezone.now()
    if status == "suspended":
        qs = qs.filter(suspended_at__isnull=False)
    elif status == "deletion_pending":
        qs = qs.filter(deletion_due_at__isnull=False)
    elif status == "active":
        qs = qs.filter(suspended_at__isnull=True, deletion_due_at__isnull=True, subscription__status="active", subscription__ends_at__gte=now - timedelta(days=7))
    elif status == "no_plan":
        qs = qs.filter(subscription__isnull=True)
    card_count = Card.objects.filter(workspace=OuterRef("pk")).order_by().values("workspace").annotate(n=Count("id")).values("n")
    qs = qs.annotate(n_cards=Coalesce(Subquery(card_count), 0))
    sort = params.get("sort")
    if sort == "newest":
        return qs.order_by("-created_at", "id")
    if sort == "cards":
        return qs.order_by("-n_cards", "name", "id")
    return qs.order_by("name", "id")


class CompaniesListView(StaffView):
    """Search, filter, sort and page the companies. Filters: q, plan (code), status, sort (name, newest, cards).
    Every row carries its number of cards."""

    perm = "view"
    write_roles = roles_for("suspendCo")

    def get(self, request):
        qs = filtered_companies(request.query_params)
        open_counts = {}
        for row in DesignRequest.objects.filter(status__in=DesignRequest.OPEN).values("workspace_id").order_by():
            open_counts[row["workspace_id"]] = open_counts.get(row["workspace_id"], 0) + 1
        body = paged(request, qs, lambda w: {**company_json(w, open_counts.get(w.id, 0)), "suspended": w.suspended_at is not None, "plan_code": _plan_code(w), "cards": w.n_cards})
        body["plans"] = [{"code": p.code, "name": p.name} for p in Plan.objects.filter(kind="company").order_by("sort_order")]
        return Response(body)


class CompaniesExportView(StaffView):
    """Download companies as a CSV: the ids picked on the list (`ids`, comma separated, up to 500) or, without ids,
    everything the list filters (q, plan, status) match, up to 5000 rows. Admin and support only; written to the audit log."""

    perm = "export"

    def get(self, request):
        params = request.query_params
        qs = filtered_companies(params)
        ids = [part.strip() for part in (params.get("ids") or "").split(",") if part.strip()]
        if ids:
            try:
                qs = qs.filter(pk__in=[uuid.UUID(part) for part in ids[:500]])
            except ValueError:
                raise validation_error({"ids": ["Choose companies from the list."]})
        companies = list(qs[:5000])
        owners = {}
        for m in Member.objects.filter(workspace__in=[w.id for w in companies], role="owner").order_by("-joined_at"):
            owners.setdefault(m.workspace_id, m)
        rows = []
        for w in companies:
            sub = get_subscription(w)
            owner = owners.get(w.id)
            rows.append([
                w.name, sub.plan.name if sub else "", seats_used(w), sub.seats_total if sub else 0, w.n_cards, company_status(w), iso(w.created_at),
                country_name(w.country) if w.country else "", owner.full_name if owner else "", owner.email if owner else "",
            ])
        services.log(request, "company.exported", "export", "", f"{len(rows)} companies", {"rows": len(rows), "picked": bool(ids)})
        return csv_response("companies.csv", ["Company", "Plan", "Seats used", "Seats", "Cards", "Status", "Joined (UTC)", "Country", "Owner", "Owner e-mail"], rows)


def _plan_code(ws):
    sub = get_subscription(ws)
    return sub.plan.code if sub else None


class CompanyDetailView(StaffView):
    perm = "view"

    def get(self, request, company_id):
        ws = get_company(company_id)
        now = timezone.now()
        card_counts = {r["status"]: r["n"] for r in Card.objects.filter(workspace=ws).values("status").annotate(n=Count("id")).order_by()}
        views_30 = Event.objects.filter(card__workspace=ws, type="view", created_at__gte=now - timedelta(days=30)).aggregate(n=Sum("weight"))["n"] or 0
        sub = get_subscription(ws)
        owner = ws.members.filter(role="owner").select_related("user").first()
        country, country_guessed = company_country_info(ws)
        return Response({
            **company_json(ws, DesignRequest.objects.filter(workspace=ws, status__in=DesignRequest.OPEN).count()),
            "suspended": ws.suspended_at is not None, "suspended_at": iso(ws.suspended_at), "suspended_reason": ws.suspended_reason,
            "deletion_due_at": iso(ws.deletion_due_at), "country": country, "country_guessed": country_guessed,
            "plan_ends_at": iso(sub.ends_at) if sub else None, "public_address": public_address(ws), "views_14d": views_series(ws, 14, now),
            "owner": {"email": owner.email, "full_name": owner.full_name, "last_sign_in": last_sign_in(owner.user) if owner.user_id else None} if owner else None,
            "counts": {
                "members": ws.members.count(), "cards_published": card_counts.get("published", 0), "cards_draft": card_counts.get("draft", 0),
                "cards_suspended": card_counts.get("suspended", 0), "leads": Lead.objects.filter(workspace=ws).count(), "views_30d": views_30,
                "open_reports": AbuseReport.objects.filter(workspace=ws, status__in=("new", "reviewing")).count(),
                "notes": ws.staff_notes.count(), "support_views": SupportViewSession.objects.filter(workspace=ws).count(),
            },
        })


class CompanyTeamView(StaffView):
    perm = "view"

    def get(self, request, company_id):
        ws = get_company(company_id)
        return Response(team_rows(ws))


class CompanyCardsView(StaffView):
    perm = "view"

    def get(self, request, company_id):
        ws = get_company(company_id)
        cards = list(Card.objects.filter(workspace=ws).select_related("owner", "workspace").prefetch_related("items").order_by("name")[:200])
        stats = stats_for([c.id for c in cards])
        return Response([card_row(c, request, stats[c.id]) for c in cards])


class CompanyLeadsView(StaffView):
    """The leads tab shows counts and a masked list; the full leads are in a logged support view."""

    perm = "view"

    def get(self, request, company_id):
        ws = get_company(company_id)
        qs = Lead.objects.filter(workspace=ws)
        by_status = {r["status"]: r["n"] for r in qs.values("status").annotate(n=Count("id")).order_by()}
        services.log_look(request, "look.leads", "company", ws.id, ws.name, {"masked": True})
        return Response({"total": qs.count(), "by_status": by_status, "latest": [lead_json(lead, mask=True) for lead in qs.order_by("-created_at")[:20]]})


class CompanyBrandView(StaffView):
    perm = "view"

    def get(self, request, company_id):
        return Response(brand_json(get_company(company_id), request))


class CompanyActivityView(StaffView):
    perm = "view"

    def get(self, request, company_id):
        ws = get_company(company_id)
        return Response(events_json(ws, 30, int_param(request.query_params, "page", 1, 1, 1000)))


class CompanyNotesView(StaffView):
    perm = "view"
    write_roles = roles_for("notes")

    @staticmethod
    def note_json(n):
        return {"id": str(n.id), "author_email": n.author_email, "body": n.body, "created_at": iso(n.created_at)}

    def get(self, request, company_id):
        ws = get_company(company_id)
        return Response([self.note_json(n) for n in ws.staff_notes.all()[:100]])

    def post(self, request, company_id):
        ws = get_company(company_id)
        body = str((request.data if isinstance(request.data, dict) else {}).get("body") or "").strip()
        if not body or len(body) > 2000:
            raise validation_error({"body": ["Write a note of up to 2000 characters."]})
        note = CompanyNote.objects.create(workspace=ws, author=request.user, author_email=request.user.email, body=body)
        services.log(request, "company.note_added", "company", ws.id, ws.name)
        return Response(self.note_json(note), status=201)


def _suspend_company(request, ws, reason):
    if ws.suspended_at is not None:
        raise ApiError("already_suspended", "This company is already suspended.", 409)
    ws.suspended_at = timezone.now()
    ws.suspended_reason = reason
    ws.save(update_fields=["suspended_at", "suspended_reason"])
    services.log(request, "company.suspended", "company", ws.id, ws.name, {"reason": reason})
    customer_event(request, ws, "company.suspended", "workspace", ws.id, ws.name)
    _tell_owner(ws, "suspended", reason)


def _restore_company(request, ws, reason=""):
    if ws.suspended_at is None:
        raise ApiError("not_suspended", "This company is not suspended.", 409)
    ws.suspended_at = None
    ws.suspended_reason = ""
    ws.save(update_fields=["suspended_at", "suspended_reason"])
    services.log(request, "company.restored", "company", ws.id, ws.name, {"reason": reason})
    customer_event(request, ws, "company.restored", "workspace", ws.id, ws.name)
    _tell_owner(ws, "restored")


def _tell_owner(ws, what, reason=""):
    owner = ws.members.filter(role="owner").select_related("user").first()
    if owner is None or not owner.email:
        return
    lang = user_language(owner.user) if owner.user_id else "en"
    if what == "suspended":
        paragraphs = [tr(lang, "Our team suspended {workspace}. Its cards show as unavailable and your team cannot sign in to it for now.", workspace=ws.name)]
        # The reason a person typed is quoted; the automatic "Card report: ..." text is not meant for the customer.
        if reason and not reason.startswith("Card report:"):
            paragraphs.append(tr(lang, "Reason from our team: {reason}", reason=reason))
        paragraphs.append(tr(lang, "If you think this is a mistake, please contact support and we will look at it with you."))
        send_brand_email(owner.email, tr(lang, "{workspace} was suspended", workspace=ws.name), tr(lang, "Your company was suspended"), paragraphs, lang=lang)
    else:
        send_brand_email(
            owner.email, tr(lang, "{workspace} is active again", workspace=ws.name), tr(lang, "Your company is active again"),
            [tr(lang, "{workspace} is active again. Its cards are live and your team can sign in.", workspace=ws.name)], lang=lang,
        )


def _reason(request, needed=True):
    reason = str((request.data if isinstance(request.data, dict) else {}).get("reason") or "").strip()
    if needed and len(reason) < 5:
        raise validation_error({"reason": ["Write a reason of at least 5 characters."]})
    return reason[:300]


class CompanySuspendView(StaffView):
    perm = "view"
    write_roles = roles_for("suspendCo")

    def post(self, request, company_id):
        ws = get_company(company_id)
        typed = (request.data if isinstance(request.data, dict) else {}).get("confirm_name")
        if typed is not None and str(typed).strip().lower() != ws.name.strip().lower():
            raise validation_error({"confirm_name": ["Type the company name exactly to confirm."]})
        _suspend_company(request, ws, _reason(request))
        return Response(CompanyDetailView().get(request, company_id).data)


class CompanyRestoreView(StaffView):
    perm = "view"
    write_roles = roles_for("suspendCo")

    def post(self, request, company_id):
        _restore_company(request, get_company(company_id), _reason(request, needed=False))
        return Response(CompanyDetailView().get(request, company_id).data)


class CompaniesBulkView(StaffView):
    """Suspend or restore several companies. Each result says whether it worked, so one refusal does not stop the rest."""

    perm = "view"
    write_roles = roles_for("suspendCo")

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        action = data.get("action")
        ids = data.get("ids")
        if action not in ("suspend", "restore") or not isinstance(ids, list) or not ids or len(ids) > 100:
            raise validation_error({"ids": ["Choose between 1 and 100 companies and an action."]})
        reason = _reason(request, needed=action == "suspend")
        results = []
        for company_id in ids:
            try:
                ws = get_company(company_id)
                (_suspend_company if action == "suspend" else _restore_company)(request, ws, reason)
                results.append({"id": str(company_id), "ok": True})
            except (ApiError, Http404, ValueError) as exc:
                results.append({"id": str(company_id), "ok": False, "error": getattr(exc, "code", "not_found")})
        services.log(request, "company.bulk", "company", "", f"{action} {len(ids)} companies", {"action": action, "ok": sum(1 for r in results if r["ok"])})
        return Response({"results": results})


# ---------------------------------------------------------------- global search
class SearchView(StaffView):
    perm = "search"

    def get(self, request):
        term = (request.query_params.get("q") or "").strip()[:100]
        if len(term) < 2:
            return Response({"companies": [], "people": [], "cards": []})
        companies = Workspace.objects.filter(kind="company", deleted_at__isnull=True).filter(
            Q(name__icontains=term) | Q(members__email__icontains=term, members__role="owner")
        ).distinct().order_by("name")[:6]
        users = User.objects.filter(Q(email__icontains=term) | Q(full_name__icontains=term)).order_by("email")[:8]
        cards = list(
            Card.objects.filter(
                Q(name__icontains=term) | Q(public_code__iexact=term) | Q(slug__icontains=term) | Q(company__icontains=term)
                | Q(workspace__name__icontains=term) | Q(owner__email__icontains=term) | Q(member__email__icontains=term)
            ).select_related("owner", "workspace").prefetch_related("items").distinct().order_by("name")[:12]
        )
        stats = stats_for([c.id for c in cards])
        return Response({
            "companies": [company_json(w) for w in companies],
            "people": [
                {"id": str(u.id), "email": u.email, "full_name": u.full_name, "staff_role": u.staff_role, "is_active": u.is_active,
                 "companies": [{"id": str(m.workspace_id), "name": m.workspace.name, "role": m.role} for m in u.memberships.filter(workspace__kind="company").select_related("workspace")[:3]]}
                for u in users
            ],
            "cards": [card_row(c, request, stats[c.id]) for c in cards],
        })


# ---------------------------------------------------------------- one card
def get_card(card_id):
    card = Card.objects.filter(pk=card_id).select_related("owner", "workspace", "member").prefetch_related("items").first()
    if card is None:
        raise Http404
    return card


def card_details(card):
    """What the drawer shows beside the card: the holder's account e-mail (or the team seat's), the e-mail shown on the card, and when it was made."""
    holder = card.member.email if card.member_id and card.member.email else (card.owner.email if card.owner_id else "")
    shown = next((i.value for i in card.items.all() if i.kind == "Email" and i.on and i.value), "")
    return {"holder_email": holder, "card_email": shown, "created_at": iso(card.created_at)}


class CardDrawerView(StaffView):
    perm = "view"

    def get(self, request, card_id):
        card = get_card(card_id)
        history = AuditEvent.objects.filter(workspace=card.workspace, target_type="card", target_id=str(card.id)).order_by("-created_at")[:30]
        from .models import StaffAuditEvent

        staff_history = StaffAuditEvent.objects.filter(target_type="card", target_id=str(card.id))[:30]
        return Response({
            "card": card_row(card, request),
            "details": card_details(card),
            "company": company_json(card.workspace),
            "reports": [
                {"id": str(r.id), "reason": r.reason, "status": r.status, "created_at": iso(r.created_at)} for r in AbuseReport.objects.filter(card=card).order_by("-created_at")[:20]
            ],
            "history": [{"at": iso(e.created_at), "text": e.action, "who": e.actor_name or e.actor_email, "kind": "company"} for e in history]
            + [{"at": iso(e.created_at), "text": e.action, "who": e.actor_email, "kind": "staff", "details": e.details} for e in staff_history],
        })


def staff_suspend_card(request, card, reason):
    if card.status == "suspended":
        raise ApiError("already_suspended", "This card is already suspended.", 409)
    suspend_card(card)
    card.staff_hold = True
    card.save(update_fields=["staff_hold"])
    services.log(request, "card.suspended", "card", card.id, card.name, {"reason": reason, "company": str(card.workspace_id)})
    customer_event(request, card.workspace, "card.suspended", "card", card.id, card.name, {"by": "support"})
    _tell_card_owner(card, reason)


def _tell_card_owner(card, reason):
    """E-mail the person who holds the card that it was suspended, with the staff reason when a person wrote one."""
    user = card.owner if card.owner_id else None
    email = (card.member.email if card.member_id and card.member.email else "") or (user.email if user else "")
    if not email:
        owner = card.workspace.members.filter(role="owner").select_related("user").first()
        email, user = (owner.email, owner.user) if owner and owner.email else ("", None)
    if not email:
        return
    lang = user_language(user)
    name = card.name or "-"
    paragraphs = [
        tr(lang, "Our team suspended your card {card}. Its public page now shows a neutral \"not available\" message. Nothing was deleted.", card=name),
    ]
    if reason and not reason.startswith("Card report:"):
        paragraphs.append(tr(lang, "Note from our team: {note}", note=reason))
    paragraphs.append(tr(lang, "If you think this is a mistake, please contact support and we will look at it with you."))
    send_brand_email(email, tr(lang, "Your card {card} was suspended", card=name), tr(lang, "Your card was suspended"), paragraphs, lang=lang)


def staff_restore_card(request, card, reason=""):
    if card.status != "suspended":
        raise ApiError("not_suspended", "This card is not suspended.", 409)
    card.status = card.status_before_suspend or "draft"
    card.staff_hold = False
    card.save(update_fields=["status", "staff_hold", "updated_at"])
    services.log(request, "card.restored", "card", card.id, card.name, {"reason": reason, "company": str(card.workspace_id)})
    customer_event(request, card.workspace, "card.restored", "card", card.id, card.name, {"by": "support"})


class CardSuspendView(StaffView):
    perm = "view"
    write_roles = roles_for("suspendCard")

    def post(self, request, card_id):
        card = get_card(card_id)
        staff_suspend_card(request, card, _reason(request))
        return Response(card_row(card, request))


class CardRestoreView(StaffView):
    perm = "view"
    write_roles = roles_for("suspendCard")

    def post(self, request, card_id):
        card = get_card(card_id)
        staff_restore_card(request, card, _reason(request, needed=False))
        return Response(card_row(card, request))


# ---------------------------------------------------------------- every card, as a list
CARD_STATUS_CHIPS = ("active", "reported", "suspended", "draft")


class CardsListView(StaffView):
    """Every card, newest first, with the same filters as the people list. Looking at the list shows what the card page shows.

    Filters: q (name, title, company, link, code, workspace name, owner or team-seat e-mail), status (active = live, reported = an
    open abuse report, suspended, draft), company (workspace id), sort (newest, name). Paging: offset and limit (1-100, default 25).
    `status_counts` gives the number behind each chip for the current search and company, whatever chip is chosen."""

    perm = "view"

    def get(self, request):
        params = request.query_params
        qs = Card.objects.all()
        term = (params.get("q") or "").strip()[:100]
        if term:
            qs = qs.filter(
                Q(name__icontains=term) | Q(title__icontains=term) | Q(company__icontains=term) | Q(slug__icontains=term) | Q(public_code__icontains=term)
                | Q(workspace__name__icontains=term) | Q(owner__email__icontains=term) | Q(member__email__icontains=term)
            )
        company = (params.get("company") or "").strip()
        if company:
            try:
                qs = qs.filter(workspace_id=uuid.UUID(company))
            except ValueError:
                qs = qs.none()
        reported = Exists(AbuseReport.objects.filter(card=OuterRef("pk"), status__in=("new", "reviewing")))
        qs = qs.annotate(has_report=reported)
        counts = qs.aggregate(
            all=Count("id"), active=Count("id", filter=Q(status="published")), reported=Count("id", filter=Q(has_report=True)),
            suspended=Count("id", filter=Q(status="suspended")), draft=Count("id", filter=Q(status="draft")),
        )
        status = params.get("status")
        if status == "active":
            qs = qs.filter(status="published")
        elif status == "reported":
            qs = qs.filter(has_report=True)
        elif status in ("suspended", "draft"):
            qs = qs.filter(status=status)
        qs = qs.order_by(Lower("name"), "id") if params.get("sort") == "name" else qs.order_by("-created_at", "id")
        count = {"all": counts["all"], "active": counts["active"], "reported": counts["reported"], "suspended": counts["suspended"], "draft": counts["draft"]}[status if status in CARD_STATUS_CHIPS else "all"]
        limit = int_param(params, "limit", 25, 1, 100)
        offset = int_param(params, "offset", 0, 0, 10_000_000)
        cards = list(qs.select_related("owner", "workspace", "member__department").prefetch_related("items")[offset: offset + limit])
        stats = stats_for([c.id for c in cards])
        open_reports = {r["card_id"]: r["n"] for r in AbuseReport.objects.filter(card_id__in=[c.id for c in cards], status__in=("new", "reviewing")).values("card_id").annotate(n=Count("id")).order_by()}
        results = [{**card_row(c, request, stats[c.id]), "open_reports": open_reports.get(c.id, 0)} for c in cards]
        return Response({"count": count, "offset": offset, "limit": limit, "status_counts": counts, "results": results})


# ---------------------------------------------------------------- everyone, as a list
def _sub_state(sub):
    """live (paid period, grace included), expired, or none."""
    if sub is None:
        return "none"
    return "live" if _sub_live(sub) else "expired"


def _plan_cell(ws):
    sub = getattr(ws, "subscription", None)
    return {"plan": sub.plan.name if sub else None, "plan_code": sub.plan_id if sub else None, "state": _sub_state(sub)}


def _day(text):
    try:
        return datetime.strptime(str(text or "")[:10], "%Y-%m-%d").date()
    except ValueError:
        return None


class PeopleListView(StaffView):
    """Every person, newest first, with plan, cards and companies. Looking at the list is not a support view: it shows
    the same fields as the person page (no mail contents, no passwords, no tokens).

    Filters: q (name, e-mail, company name), plan (a plan code or "none"), status (active, disabled, deletion_pending),
    role (customer, staff), joined_from, joined_to (YYYY-MM-DD), has_company (true/false), sort (newest, name, last_active).
    Paging: offset and limit (1-100, default 25)."""

    perm = "view"

    def get(self, request):
        params = request.query_params
        qs = User.objects.filter(deleted_at__isnull=True)
        term = (params.get("q") or "").strip()[:100]
        if term:
            by_company = Member.objects.filter(workspace__kind="company", workspace__deleted_at__isnull=True, workspace__name__icontains=term)
            qs = qs.filter(Q(email__icontains=term) | Q(full_name__icontains=term) | Q(id__in=by_company.values("user_id")))
        plan = (params.get("plan") or "").strip()
        owned = Member.objects.filter(role="owner", workspace__deleted_at__isnull=True)
        if plan == "none":
            qs = qs.exclude(id__in=owned.filter(workspace__subscription__isnull=False).values("user_id"))
        elif plan:
            qs = qs.filter(id__in=owned.filter(workspace__subscription__plan__code=plan).values("user_id"))
        status = params.get("status")
        if status == "active":
            qs = qs.filter(is_active=True)
        elif status == "disabled":
            qs = qs.filter(is_active=False, deletion_due_at__isnull=True)
        elif status == "deletion_pending":
            qs = qs.filter(deletion_due_at__isnull=False)
        role = params.get("role")
        if role == "staff":
            qs = qs.exclude(staff_role="none")
        elif role == "customer":
            qs = qs.filter(staff_role="none")
        start, end = _day(params.get("joined_from")), _day(params.get("joined_to"))
        if start:
            qs = qs.filter(created_at__date__gte=start)
        if end:
            qs = qs.filter(created_at__date__lte=end)
        has_company = params.get("has_company")
        if has_company in ("true", "false", "1", "0"):
            in_company = Member.objects.filter(workspace__kind="company", workspace__deleted_at__isnull=True).values("user_id")
            qs = qs.filter(id__in=in_company) if has_company in ("true", "1") else qs.exclude(id__in=in_company)

        count = qs.count()
        qs = qs.annotate(
            last_in=Subquery(OutstandingToken.objects.filter(user=OuterRef("pk")).order_by("-created_at").values("created_at")[:1]),
            two_step=Exists(StaffTotp.objects.filter(user=OuterRef("pk"), confirmed_at__isnull=False)),
            n_cards=Count("cards", distinct=True),
            n_published=Count("cards", filter=Q(cards__status="published"), distinct=True),
        )
        sort = params.get("sort")
        if sort == "name":
            qs = qs.order_by(Lower("full_name"), "email", "id")
        elif sort == "last_active":
            qs = qs.order_by(F("last_in").desc(nulls_last=True), "-created_at", "id")
        else:
            qs = qs.order_by("-created_at", "id")
        limit = int_param(params, "limit", 25, 1, 100)
        offset = int_param(params, "offset", 0, 0, 10_000_000)
        users = list(qs[offset: offset + limit])

        memberships = {}
        rows = Member.objects.filter(user_id__in=[u.id for u in users], workspace__deleted_at__isnull=True).select_related("workspace", "workspace__subscription__plan")
        for m in rows:
            memberships.setdefault(m.user_id, []).append(m)
        plans = [{"code": p.code, "name": p.name, "kind": p.kind} for p in Plan.objects.order_by("kind", "sort_order")]
        return Response({"count": count, "offset": offset, "limit": limit, "plans": plans, "results": [self._row(u, memberships.get(u.id, [])) for u in users]})

    @staticmethod
    def _row(user, members):
        personal = next((m.workspace for m in members if m.workspace.kind == "personal" and m.role == "owner"), None)
        companies = sorted((m for m in members if m.workspace.kind == "company"), key=lambda m: ({"owner": 0, "admin": 1}.get(m.role, 2), m.workspace.name.lower()))
        country = next((m.workspace.country for m in companies if m.role == "owner" and m.workspace.country), "")
        if user.deletion_due_at:
            status = "deletion_pending"
        else:
            status = "active" if user.is_active else "disabled"
        return {
            "id": str(user.id), "email": user.email, "full_name": user.full_name, "email_verified": user.email_verified,
            "created_at": iso(user.created_at), "last_sign_in": iso(user.last_in) if user.last_in else None,
            "staff_role": user.staff_role, "is_active": user.is_active, "status": status, "deletion_due_at": iso(user.deletion_due_at),
            "two_step": bool(user.two_step), "country": country or "",
            "personal": _plan_cell(personal) if personal else {"plan": None, "plan_code": None, "state": "none"},
            "cards": user.n_cards, "cards_published": user.n_published,
            "company_count": len(companies),
            "companies": [
                {"id": str(m.workspace_id), "name": m.workspace.name, "role": m.role, **_plan_cell(m.workspace), "suspended": m.workspace.suspended_at is not None}
                for m in companies[:3]
            ],
        }


# ---------------------------------------------------------------- one person
class UserDetailView(StaffView):
    perm = "view"

    def get(self, request, user_id):
        user = User.objects.filter(pk=user_id).first()
        if user is None:
            raise Http404
        now = timezone.now()
        tokens = OutstandingToken.objects.filter(user=user, expires_at__gt=now, blacklistedtoken__isnull=True).order_by("-created_at")[:20]
        return Response({
            "id": str(user.id), "email": user.email, "full_name": user.full_name, "language": user.language or None,
            "created_at": iso(user.created_at), "email_verified": user.email_verified, "is_active": user.is_active,
            "staff_role": user.staff_role, "product_updates": user.product_updates,
            "sign_in_methods": {"password": user.has_usable_password(), "google": bool(user.google_sub)},
            "last_sign_in": last_sign_in(user),
            "deletion_due_at": iso(user.deletion_due_at),
            "sessions": [{"id": str(t.id), "started_at": iso(t.created_at), "expires_at": iso(t.expires_at)} for t in tokens],
            "memberships": [
                {"company_id": str(m.workspace_id), "company": m.workspace.name, "kind": m.workspace.kind, "role": m.role, "status": m.status}
                for m in Member.objects.filter(user=user).select_related("workspace")
            ],
        })


class UserSignOutView(StaffView):
    """Admin only: revoke every refresh token of a customer. Their open access tokens last at most 60 more minutes."""

    perm = "view"
    write_roles = roles_for("signOutUser")

    def post(self, request, user_id):
        user = User.objects.filter(pk=user_id).first()
        if user is None:
            raise Http404
        count = revoke_refresh_tokens(user)
        services.log(request, "user.signed_out", "user", user.id, user.email, {"sessions": count, **services.reason_details(request.data)})
        return Response({"revoked": count})

