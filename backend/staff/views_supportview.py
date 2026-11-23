"""Support view: a read-only mirror of a company's account for the support team.

Rules (all enforced here, none by the screens):
* a reason is required, a session lasts SUPPORT_VIEW_MINUTES (30) and ends by itself, one session per staff member at a time;
* the mirror pages are GET-only views of their own: they never reuse a customer endpoint, and no view in this file has a
  write method, so nothing in a company can change through them;
* it shows everything to support and admin (read-only people cannot open it);
* the start and the end are written to the staff audit log AND to the company's own Activity log ("support viewed your
  account"), and every page opened is kept on the session.
"""
from datetime import timedelta

from django.conf import settings
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from cards.models import Card
from cards.services import stats_for
from ilaf.errors import ApiError, validation_error
from ilaf.utils import iso
from leads.models import Lead
from operations.audit import ip_hash

from . import services
from .models import SupportViewSession
from .ops_services import customer_event
from .perms_map import roles_for
from .permissions import StaffView
from .views_customers import (
    CompanyDetailView, brand_json, card_row, events_json, get_company, member_json,
)

MIN_REASON = 8


def session_json(s, now=None):
    now = now or timezone.now()
    active = s.ended_at is None and s.expires_at > now
    return {
        "id": str(s.id), "company_id": str(s.workspace_id), "company_name": s.workspace.name, "staff_email": s.staff_email,
        "reason": s.reason, "started_at": iso(s.started_at), "expires_at": iso(s.expires_at), "ended_at": iso(s.ended_at),
        "ended_how": s.ended_how, "active": active, "seconds_left": max(0, int((s.expires_at - now).total_seconds())) if active else 0,
        "pages": s.pages,
    }


def end_session(request, s, how):
    """Close a session once (manual, expired, replaced or role) and leave both records."""
    if s.ended_at is not None:
        return s
    now = timezone.now()
    s.ended_at = min(now, s.expires_at) if how == "expired" else now
    s.ended_how = how
    s.save(update_fields=["ended_at", "ended_how"])
    minutes = max(1, int((s.ended_at - s.started_at).total_seconds() // 60))
    customer_event(request, s.workspace, "support.ended", "workspace", s.workspace_id, s.workspace.name, {"minutes": minutes, "pages": len(s.pages)})
    services.log(request, "support_view.ended", "company", s.workspace_id, s.workspace.name, {"how": how, "pages": [p["page"] for p in s.pages]}, actor=s.staff)
    return s


def expire_due(now=None):
    """End every session whose time ran out. Returns how many were ended (the `expire_support_views` command)."""
    now = now or timezone.now()
    count = 0
    for s in SupportViewSession.objects.filter(ended_at__isnull=True, expires_at__lte=now).select_related("workspace", "staff"):
        end_session(None, s, "expired")
        count += 1
    return count


def active_session(user):
    expire_due()
    return SupportViewSession.objects.filter(staff=user, ended_at__isnull=True).select_related("workspace").first()


class SupportViewStartView(StaffView):
    perm = "support"
    write_roles = roles_for("support")

    def get(self, request):
        """The staff member's open session, if any (so a page reload keeps the banner)."""
        s = active_session(request.user)
        return Response({"session": session_json(s) if s else None})

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        reason = str(data.get("reason") or "").strip()
        if len(reason) < MIN_REASON or len(reason) > 300:
            raise validation_error({"reason": [f"Write the reason for the look, at least {MIN_REASON} characters."]})
        ws = get_company(data.get("company_id"))
        previous = active_session(request.user)
        if previous is not None:
            end_session(request, previous, "replaced")
        s = SupportViewSession.objects.create(
            staff=request.user, staff_email=request.user.email, workspace=ws, reason=reason,
            expires_at=timezone.now() + timedelta(minutes=settings.SUPPORT_VIEW_MINUTES), ip_hash=ip_hash(request),
        )
        customer_event(request, ws, "support.viewed", "workspace", ws.id, ws.name, {"reason": reason, "minutes": settings.SUPPORT_VIEW_MINUTES})
        services.log(request, "support_view.started", "company", ws.id, ws.name, {"reason": reason, "session": str(s.id)})
        return Response(session_json(s), status=201)


class SupportViewEndView(StaffView):
    perm = "support"
    write_roles = roles_for("support")

    def post(self, request, session_id):
        s = SupportViewSession.objects.filter(pk=session_id, staff=request.user).select_related("workspace").first()
        if s is None:
            raise Http404
        if s.ended_at is None:
            end_session(request, s, "manual")
        else:
            services.log(request, "support_view.ended", "company", s.workspace_id, s.workspace.name, {"how": "already_ended"})
        return Response(session_json(s))


class SupportViewHistoryView(StaffView):
    """Finished and running sessions, newest first. Everyone with the support permission sees all of them."""

    perm = "support"

    def get(self, request):
        qs = SupportViewSession.objects.select_related("workspace").order_by("-started_at")
        if request.query_params.get("company"):
            qs = qs.filter(workspace_id=request.query_params["company"])
        now = timezone.now()
        return Response([session_json(s, now) for s in qs[:100]])


# ---------------------------------------------------------------- the mirror pages (GET only)
class MirrorView(StaffView):
    """Base of the mirror pages. Subclasses only define `page` and `get_data`; there is no write method on purpose."""

    perm = "support"
    page = ""

    def get(self, request, session_id):
        s = SupportViewSession.objects.filter(pk=session_id, staff=request.user).select_related("workspace").first()
        if s is None:
            raise Http404
        if s.ended_at is None and s.expires_at <= timezone.now():
            end_session(request, s, "expired")
        if s.ended_at is not None:
            raise ApiError("support_view_ended", "This support view has ended. Start a new one to keep looking.", 410)
        ws = s.workspace
        if ws.deleted_at is not None:
            raise Http404
        last = s.pages[-1]["page"] if s.pages else None
        if last != self.page:
            s.pages = [*s.pages, {"t": iso(timezone.now()), "page": self.page}][-200:]
            s.save(update_fields=["pages"])
        return Response({"session": session_json(s), "data": self.get_data(request, ws, s)})

    def get_data(self, request, ws, session):
        raise NotImplementedError


class MirrorOverviewView(MirrorView):
    page = "overview"

    def get_data(self, request, ws, session):
        return CompanyDetailView().get(request, ws.id).data


class MirrorTeamView(MirrorView):
    page = "team"

    def get_data(self, request, ws, session):
        return [member_json(m) for m in ws.members.select_related("user", "department").order_by("role", "email")]


class MirrorCardsView(MirrorView):
    page = "cards"

    def get_data(self, request, ws, session):
        cards = list(Card.objects.filter(workspace=ws).select_related("owner", "workspace").prefetch_related("items").order_by("name")[:300])
        stats = stats_for([c.id for c in cards])
        return [card_row(c, request, stats[c.id]) for c in cards]


class MirrorLeadsView(MirrorView):
    page = "leads"

    def get_data(self, request, ws, session):
        out = []
        for lead in Lead.objects.filter(workspace=ws).prefetch_related("notes").order_by("-created_at")[:500]:
            out.append({
                "id": str(lead.id), "name": lead.name, "email": lead.email, "phone": lead.phone, "company": lead.company, "note": lead.note,
                "status": lead.status, "source": lead.source, "card_name": lead.card_name, "event_name": lead.event_name, "tag": lead.tag,
                "created_at": iso(lead.created_at), "notes": [{"author": n.author_name, "body": n.body, "created_at": iso(n.created_at)} for n in lead.notes.all()],
            })
        return out


class MirrorBrandView(MirrorView):
    page = "brand"

    def get_data(self, request, ws, session):
        return brand_json(ws, request)


class MirrorActivityView(MirrorView):
    page = "activity"

    def get_data(self, request, ws, session):
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        return events_json(ws, 50, page)


class MirrorLogView(MirrorView):
    page = "log"

    def get_data(self, request, ws, session):
        return {"pages": session.pages}


MIRROR_VIEWS = [MirrorOverviewView, MirrorTeamView, MirrorCardsView, MirrorLeadsView, MirrorBrandView, MirrorActivityView, MirrorLogView]
