"""Companies, people and cards for the staff area: lists, detail tabs, notes, suspensions, global search, user sign-out."""
from datetime import timedelta

from django.db.models import Count, Q, Sum
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response
from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

from accounts.models import User
from accounts.services import revoke_refresh_tokens
from analytics.models import Event
from billing.models import Plan
from billing.services import get_subscription
from cards.models import Card
from cards.services import card_json, stats_for
from designs.models import DesignRequest
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import tr, user_language
from ilaf.utils import file_url, iso
from leads.models import Lead
from operations import audit as company_audit
from operations.actions import suspend_card
from operations.models import AuditEvent
from workspaces.models import Member, Workspace

from . import services
from .common import int_param, paged
from .models import AbuseReport, CompanyNote, SupportViewSession
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


def member_json(m):
    return {
        "id": str(m.id), "email": m.email, "full_name": m.full_name, "title": m.title, "role": m.role, "status": m.status,
        "user_id": str(m.user_id) if m.user_id else None, "department": m.department.name if m.department_id else "",
        "joined_at": iso(m.joined_at), "invited_at": iso(m.invited_at),
        "last_sign_in": last_sign_in(m.user) if m.user_id else None,
    }


def lead_json(lead, mask=False):
    return {
        "id": str(lead.id), "name": lead.name, "email": mask_email(lead.email) if mask else lead.email,
        "phone": "" if mask else lead.phone, "company": lead.company, "note": "" if mask else lead.note, "status": lead.status,
        "source": lead.source, "card_name": lead.card_name, "created_at": iso(lead.created_at),
    }


from security import company as security_company  # noqa: E402


def brand_json(ws, request):
    brand = ws.brand or {}
    return {
        "company_name": brand.get("company_name") or ws.name, "website": brand.get("website") or "",
        "design": brand.get("design"), "lock_design": bool(brand.get("lock_design")), "show_footer": bool(brand.get("show_footer", True)),
        "logo_url": file_url(request, ws.logo), "symbol_url": file_url(request, ws.symbol),
        "background_url": file_url(request, ws.background),
        "require_google_signin": ws.require_google_signin, "allowed_email_domains": ws.allowed_email_domains,
        "directory_enabled": ws.directory_enabled, "directory_slug": ws.directory_slug, "custom_domain": ws.custom_domain,
        "verified_domains": security_company.verified_domains(ws),
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
class CompaniesListView(StaffView):
    """Search, filter, sort and page the companies. Filters: q, plan (code), status, sort (name, newest, cards)."""

    perm = "view"
    write_roles = roles_for("suspendCo")

    def get(self, request):
        params = request.query_params
        qs = Workspace.objects.filter(kind="company", deleted_at__isnull=True)
        term = (params.get("q") or "").strip()[:100]
        if term:
            qs = qs.filter(Q(name__icontains=term) | Q(members__email__icontains=term, members__role="owner")).distinct()
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
        sort = params.get("sort")
        if sort == "newest":
            qs = qs.order_by("-created_at", "id")
        elif sort == "cards":
            qs = qs.annotate(n_cards=Count("cards", distinct=True)).order_by("-n_cards", "name", "id")
        else:
            qs = qs.order_by("name", "id")
        open_counts = {}
        for row in DesignRequest.objects.filter(status__in=DesignRequest.OPEN).values("workspace_id").order_by():
            open_counts[row["workspace_id"]] = open_counts.get(row["workspace_id"], 0) + 1
        body = paged(request, qs, lambda w: {**company_json(w, open_counts.get(w.id, 0)), "suspended": w.suspended_at is not None, "plan_code": _plan_code(w)})
        body["plans"] = [{"code": p.code, "name": p.name} for p in Plan.objects.filter(kind="company").order_by("sort_order")]
        return Response(body)


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
            "plan_ends_at": iso(sub.ends_at) if sub else None,
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
        return Response([member_json(m) for m in ws.members.select_related("user", "department").order_by("role", "email")])


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
    _tell_owner(ws, "suspended")


def _restore_company(request, ws, reason=""):
    if ws.suspended_at is None:
        raise ApiError("not_suspended", "This company is not suspended.", 409)
    ws.suspended_at = None
    ws.suspended_reason = ""
    ws.save(update_fields=["suspended_at", "suspended_reason"])
    services.log(request, "company.restored", "company", ws.id, ws.name, {"reason": reason})
    customer_event(request, ws, "company.restored", "workspace", ws.id, ws.name)
    _tell_owner(ws, "restored")


def _tell_owner(ws, what):
    owner = ws.members.filter(role="owner").select_related("user").first()
    if owner is None or not owner.email:
        return
    lang = user_language(owner.user) if owner.user_id else "en"
    if what == "suspended":
        send_brand_email(
            owner.email, tr(lang, "{workspace} was suspended", workspace=ws.name), tr(lang, "Your company was suspended"),
            [tr(lang, "Our team suspended {workspace}. Its cards show as unavailable and your team cannot sign in to it for now.", workspace=ws.name),
             tr(lang, "If you think this is a mistake, please contact support and we will look at it with you.")],
            lang=lang,
        )
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
        _suspend_company(request, get_company(company_id), _reason(request))
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


class CardDrawerView(StaffView):
    perm = "view"

    def get(self, request, card_id):
        card = get_card(card_id)
        history = AuditEvent.objects.filter(workspace=card.workspace, target_type="card", target_id=str(card.id)).order_by("-created_at")[:30]
        from .models import StaffAuditEvent

        staff_history = StaffAuditEvent.objects.filter(target_type="card", target_id=str(card.id))[:30]
        return Response({
            "card": card_row(card, request),
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
        services.log(request, "user.signed_out", "user", user.id, user.email, {"sessions": count})
        return Response({"revoked": count})

