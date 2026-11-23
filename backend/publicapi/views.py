"""The public API, version 1. Every route belongs to one company (the key's) and to one scope per method.

Nothing here reads another company's rows: every queryset starts from the key's workspace, and a row outside it is
a 404 exactly like a row that does not exist."""
import uuid
from types import SimpleNamespace

from django.db import transaction
from django.db.models import Count, Q
from django.http import Http404
from rest_framework import serializers
from rest_framework.response import Response

from accounts.services import domain_allowed
from analytics import periods
from analytics.models import Event, event_count
from analytics.views import _totals
from cards.models import Card
from cards.serializers import CardWriteSerializer
from cards.services import apply_card_data, card_json, new_card, stats_for
from ilaf.errors import ApiError, validation_error
from ilaf.utils import iso
from leads import webhooks, workflow
from leads.models import Lead
from operations import audit
from operations import actions as ops
from operations.departments import apply_template
from operations.rules import mandatory_for
from workspaces.models import Member
from workspaces.services import invite_member, seats_left
from workspaces.views import InviteItemSerializer

from .base import PublicApiView, json_body, paginate
from .models import SCOPES

# The key acts as an administrator of its company, but it is not a person: it can never change the owner or an admin.
KEY_ACTOR = SimpleNamespace(id=None, role="admin")
MAX_INVITES_PER_CALL = 50
CARD_STATUSES = ("draft", "published", "suspended")


def via(request):
    return {"key_prefix": request.user.key.prefix}


def get_or_404(queryset, pk):
    try:
        return queryset.get(pk=pk)
    except (queryset.model.DoesNotExist, ValueError):
        raise Http404


# ---------------------------------------------------------------- shapes
def card_out(card, request, stats):
    data = card_json(card, request, stats)
    data.pop("owner", None)
    data["member"] = (
        {"id": str(card.member_id), "email": card.member.email, "full_name": card.member.full_name}
        if card.member_id else None
    )
    return data


def cards_out(rows, request):
    stats = stats_for([c.id for c in rows])
    return [card_out(c, request, stats[c.id]) for c in rows]


def member_out(member):
    card = next(iter(member.cards.all()), None)
    return {
        "id": str(member.id), "email": member.email, "full_name": member.full_name, "title": member.title,
        "role": member.role, "status": member.status,
        "department": {"id": str(member.department_id), "name": member.department.name} if member.department_id else None,
        "card_id": str(card.id) if card else None,
        "invited_at": iso(member.invited_at), "joined_at": iso(member.joined_at),
    }


def lead_out(lead):
    return webhooks.lead_payload(lead)


def company_cards(workspace):
    return Card.objects.filter(workspace=workspace)


def company_leads(workspace):
    return Lead.objects.filter(Q(workspace=workspace) | Q(card__workspace=workspace)).select_related("card", "assignee")


# ---------------------------------------------------------------- who am I
class MeView(PublicApiView):
    required_scopes = {"GET": None}

    def get(self, request):
        key = request.user.key
        ws = key.workspace
        return Response({
            "workspace": {"id": str(ws.id), "name": ws.name},
            "key": {
                "id": str(key.id), "name": key.name, "prefix": key.prefix, "scopes": key.scopes,
                "expires_at": iso(key.expires_at), "rate_limit": {"per_minute": key.rate_per_minute, "per_day": key.rate_per_day},
            },
        })


# ---------------------------------------------------------------- cards
class CardsView(PublicApiView):
    required_scopes = {"GET": "cards:read", "POST": "cards:write"}

    def get(self, request):
        qs = company_cards(self.workspace).select_related("member", "member__department").prefetch_related("items")
        status = request.query_params.get("status")
        if status:
            if status not in CARD_STATUSES:
                raise validation_error({"status": ["Use draft, published or suspended."]})
            qs = qs.filter(status=status)
        email = (request.query_params.get("member_email") or "").strip()
        if email:
            qs = qs.filter(member__email__iexact=email)
        return Response(paginate(request, qs, lambda rows: cards_out(rows, request)))

    def post(self, request):
        ws = self.workspace
        data = dict(json_body(request))
        email = data.pop("member_email", None)
        if not isinstance(email, str) or not email.strip():
            raise validation_error({"member_email": ["Send the e-mail address of the team member who will hold the card."]})
        member = ws.members.select_related("department", "user").filter(email__iexact=email.strip()).first()
        if member is None:
            raise validation_error({"member_email": ["There is no team member with this e-mail address. Invite them first."]})
        if member.status == "suspended":
            raise ApiError("member_suspended", "This team member is suspended.", 409)
        existing = member.cards.first()
        if existing is not None:
            raise ApiError("card_exists", "Each team member can have one card. Change the existing card instead.", 409,
                           {"card_id": [str(existing.id)]})
        ser = CardWriteSerializer(data=data, context={"request": request})
        ser.is_valid(raise_exception=True)
        values = ser.validated_data
        if not values.get("name") and not member.full_name:
            raise validation_error({"name": ["Send a name for the card."]})
        with transaction.atomic():
            card = new_card(ws, member.user, member, name=values.get("name") or member.full_name, title=member.title)
            apply_template(card, ws, member, mandatory_for(ws, member))
            _write(card, values, member, request, creating=True)
            audit.log(request, ws, "card.created", "card", card.id, card.name, {"member": member.email})
        card = company_cards(ws).select_related("member", "member__department").prefetch_related("items").get(pk=card.pk)
        return Response(card_out(card, request, stats_for([card.id])[card.id]), status=201)


def _write(card, values, member, request, creating=False):
    """Apply a card write with the rules that bind the card's holder: an employee's card follows the company's field
    rules (a locked field is refused; a field that would need an admin's approval is refused too, because there is
    nobody to approve it), a locked company design wins. The caller wraps this in a transaction."""
    role = member.role if member is not None and member.role == "employee" else "admin"
    apply_card_data(card, values, role, member=member, enforce=True, creating=creating)
    waiting = getattr(card, "waiting_changes", None)
    if waiting and not creating:
        names = sorted({field for field, _, _ in waiting})
        raise ApiError(
            "approval_required", "These fields need an admin's approval, so they cannot be changed through the API: "
            + ", ".join(names) + ".", 403, {name: ["Needs approval."] for name in names},
        )


class CardDetailView(PublicApiView):
    required_scopes = {"GET": "cards:read", "PATCH": "cards:write"}

    def _card(self, card_id):
        return get_or_404(
            company_cards(self.workspace).select_related("member", "member__department").prefetch_related("items"), card_id
        )

    def get(self, request, card_id):
        card = self._card(card_id)
        return Response(card_out(card, request, stats_for([card.id])[card.id]))

    def patch(self, request, card_id):
        card = self._card(card_id)
        data = dict(json_body(request))
        data.pop("member_email", None)
        if card.status == "suspended":
            raise ApiError("card_suspended", "This card is suspended. Restore it in the app first.", 403)
        ser = CardWriteSerializer(data=data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        values = ser.validated_data
        if not values:
            raise validation_error({"body": ["Send at least one field to change."]})
        with transaction.atomic():
            _write(card, values, card.member, request)
            audit.log(request, card.workspace, "card.updated", "card", card.id, card.name, {"fields": sorted(values)})
        card = self._card(card_id)
        return Response(card_out(card, request, stats_for([card.id])[card.id]))


class CardPublishView(PublicApiView):
    required_scopes = {"POST": "cards:write"}
    publish = True

    def post(self, request, card_id):
        card = get_or_404(company_cards(self.workspace).select_related("member", "workspace"), card_id)
        wanted = "published" if self.publish else "draft"
        if card.status != wanted:
            run = ops.publish_card if self.publish else ops.unpublish_card
            run(request, card, KEY_ACTOR, via(request))
        card = get_or_404(
            company_cards(self.workspace).select_related("member", "member__department").prefetch_related("items"), card_id
        )
        return Response(card_out(card, request, stats_for([card.id])[card.id]))


class CardUnpublishView(CardPublishView):
    publish = False


# ---------------------------------------------------------------- team
class InviteSerializer(InviteItemSerializer):
    # An API key can only bring in employees; an admin is made by the owner in the app.
    role = serializers.ChoiceField(choices=["employee"], required=False, default="employee")


class InvitesSerializer(serializers.Serializer):
    invites = InviteSerializer(many=True, allow_empty=False, max_length=MAX_INVITES_PER_CALL)


def team_members(workspace):
    return workspace.members.select_related("department", "user").prefetch_related("cards")


class MembersView(PublicApiView):
    required_scopes = {"GET": "team:read"}

    def get(self, request):
        qs = team_members(self.workspace)
        status = request.query_params.get("status")
        if status:
            qs = qs.filter(status=status)
        role = request.query_params.get("role")
        if role:
            qs = qs.filter(role=role)
        email = (request.query_params.get("email") or "").strip()
        if email:
            qs = qs.filter(email__iexact=email)
        return Response(paginate(request, qs, lambda rows: [member_out(m) for m in rows], field="invited_at"))


class InvitesView(PublicApiView):
    required_scopes = {"POST": "team:write"}

    def post(self, request):
        ws = self.workspace
        if ws.kind != "company":
            raise validation_error({"workspace": ["Teams are only available on company workspaces."]})
        ser = InvitesSerializer(data=json_body(request))
        ser.is_valid(raise_exception=True)
        entries = ser.validated_data["invites"]
        emails = [e["email"].strip().lower() for e in entries]
        existing = set(ws.members.values_list("email", flat=True))
        errors = {}
        for index, email in enumerate(emails):
            if not domain_allowed(ws, email):
                errors[f"invites.{index}.email"] = ["This email domain is not allowed for this company."]
            elif email in existing:
                errors[f"invites.{index}.email"] = ["This person is already in the team."]
            elif emails.index(email) != index:
                errors[f"invites.{index}.email"] = ["This email appears twice."]
        if errors:
            raise validation_error(errors)
        if len(entries) > seats_left(ws):
            raise ApiError("plan_limit", "Not enough seats. Add seats to the plan to invite more people.", 403)
        departments = {str(d.id): d for d in ws.departments.all()}
        for index, e in enumerate(entries):
            if e["department_id"] and str(e["department_id"]) not in departments:
                errors[f"invites.{index}.department_id"] = ["Department not found."]
        if errors:
            raise validation_error(errors)
        with transaction.atomic():
            created = [
                invite_member(
                    ws, e["email"], e["full_name"], e["title"], "employee",
                    department=departments.get(str(e["department_id"])) if e["department_id"] else None,
                    language=e["language"], request=request,
                )
                for e in entries
            ]
        created = list(team_members(ws).filter(pk__in=[m.pk for m in created]))
        return Response({"data": [member_out(m) for m in created]}, status=201)


class MemberDetailView(PublicApiView):
    required_scopes = {"GET": "team:read", "DELETE": "team:write"}

    def _member(self, member_id):
        return get_or_404(team_members(self.workspace), member_id)

    def get(self, request, member_id):
        return Response(member_out(self._member(member_id)))

    def delete(self, request, member_id):
        """Remove an employee. `card` (query or body) is keep (the default: the card stays, suspended) or delete."""
        target = self._member(member_id)
        body = request.data if isinstance(request.data, dict) else {}
        policy = body.get("card") or request.query_params.get("card") or "keep"
        if policy not in ("keep", "delete"):
            raise validation_error({"card": ["Use keep or delete."]})
        ops.member_remove(request, self.workspace, KEY_ACTOR, target, policy, None, via(request))
        return Response(status=204)


class MemberSuspendView(PublicApiView):
    required_scopes = {"POST": "team:write"}
    suspend = True

    def post(self, request, member_id):
        target = get_or_404(team_members(self.workspace), member_id)
        if self.suspend:
            ops.member_suspend(request, self.workspace, KEY_ACTOR, target, via(request))
        else:
            ops.member_restore(request, self.workspace, KEY_ACTOR, target, via(request))
        return Response(member_out(get_or_404(team_members(self.workspace), member_id)))


class MemberRestoreView(MemberSuspendView):
    suspend = False


# ---------------------------------------------------------------- leads
class LeadsView(PublicApiView):
    required_scopes = {"GET": "leads:read"}

    def get(self, request):
        qs = company_leads(self.workspace)
        params = request.query_params
        statuses = [x for x in (params.get("status") or "").split(",") if x]
        if statuses:
            if any(s not in workflow.STATUS_KEYS for s in statuses):
                raise validation_error({"status": ["Use: " + ", ".join(workflow.STATUS_KEYS) + "."]})
            qs = qs.filter(status__in=statuses)
        if params.get("card_id"):
            try:
                qs = qs.filter(card_id=uuid.UUID(params["card_id"]))
            except ValueError:
                raise validation_error({"card_id": ["Not a valid card id."]})
        if params.get("source"):
            qs = qs.filter(source=params["source"])
        if params.get("assignee_email"):
            qs = qs.filter(assignee__email__iexact=params["assignee_email"].strip())
        if params.get("email"):
            qs = qs.filter(email__iexact=params["email"].strip())
        for name, lookup in (("created_after", "created_at__gte"), ("created_before", "created_at__lt")):
            if params.get(name):
                from django.utils.dateparse import parse_datetime

                when = parse_datetime(params[name])
                if when is None:
                    raise validation_error({name: ["Use a date and time such as 2026-11-01T00:00:00Z."]})
                qs = qs.filter(**{lookup: when})
        return Response(paginate(request, qs, lambda rows: [lead_out(l) for l in rows]))


class LeadDetailView(PublicApiView):
    required_scopes = {"GET": "leads:read", "PATCH": "leads:write"}

    def _lead(self, lead_id):
        return get_or_404(company_leads(self.workspace), lead_id)

    def get(self, request, lead_id):
        return Response(lead_out(self._lead(lead_id)))

    def patch(self, request, lead_id):
        lead = self._lead(lead_id)
        data = json_body(request)
        allowed = {"status", "assignee_id", "assignee_email"}
        unknown = [k for k in data if k not in allowed]
        if unknown or not any(k in data for k in allowed):
            raise validation_error({"body": ["Send status, assignee_id or assignee_email."]})
        ws = self.workspace
        principal = request.user
        with transaction.atomic():
            if "assignee_id" in data or "assignee_email" in data:
                if "assignee_email" in data and data["assignee_email"]:
                    found = ws.members.filter(email__iexact=str(data["assignee_email"]).strip(), status="active").first()
                    if found is None:
                        raise validation_error({"assignee_email": ["Choose an active member of this company."]})
                    assignee = found
                else:
                    raw = data.get("assignee_id")
                    assignee = workflow.assignable_member(ws.id, raw) if raw else None
                workflow.assign(request, lead, assignee, principal)
            if "status" in data:
                workflow.set_status(request, lead, data["status"], principal)
        return Response(lead_out(self._lead(lead_id)))


# ---------------------------------------------------------------- analytics
def _window(request):
    return periods.parse_window(request.query_params)


def _period(window):
    return {"from": window.start_date.isoformat(), "to": window.end_date.isoformat(), "days": window.days, "tz": str(window.tz)}


def _card_numbers(cards, window):
    events = Event.objects.filter(card__in=cards, created_at__gte=window.start, created_at__lt=window.end)
    leads = Lead.objects.filter(card__in=cards, created_at__gte=window.start, created_at__lt=window.end)
    per_card = {
        row["card_id"]: row for row in events.values("card_id").annotate(
            views=event_count(Q(type="view")), saves=event_count(Q(type="save")),
            scans=event_count(Q(type="view", source="qr")), link_clicks=event_count(Q(type="link_click")),
        )
    }
    lead_counts = {r["card_id"]: r["n"] for r in leads.values("card_id").annotate(n=Count("id"))}
    rows = []
    for card in cards.order_by("created_at", "id"):
        row = per_card.get(card.id, {})
        rows.append({
            "card_id": str(card.id), "name": card.name, "status": card.status,
            "views": row.get("views", 0), "scans": row.get("scans", 0), "saves": row.get("saves", 0),
            "link_clicks": row.get("link_clicks", 0), "leads": lead_counts.get(card.id, 0),
        })
    return rows


class AnalyticsSummaryView(PublicApiView):
    required_scopes = {"GET": "analytics:read"}

    def get(self, request):
        window = _window(request)
        cards = company_cards(self.workspace)
        events = Event.objects.filter(card__in=cards, created_at__gte=window.start, created_at__lt=window.end)
        leads = Lead.objects.filter(card__in=cards, created_at__gte=window.start, created_at__lt=window.end)
        prev_events = Event.objects.filter(card__in=cards, created_at__gte=window.prev_start, created_at__lt=window.start)
        prev_leads = Lead.objects.filter(card__in=cards, created_at__gte=window.prev_start, created_at__lt=window.start)
        return Response({
            "period": _period(window),
            "totals": _totals(events, leads),
            "previous_totals": _totals(prev_events, prev_leads),
        })


class AnalyticsCardsView(PublicApiView):
    required_scopes = {"GET": "analytics:read"}

    def get(self, request):
        window = _window(request)
        rows = _card_numbers(company_cards(self.workspace), window)
        rows.sort(key=lambda r: r["views"], reverse=True)
        return Response({"period": _period(window), "data": rows})


class AnalyticsCardView(PublicApiView):
    required_scopes = {"GET": "analytics:read"}

    def get(self, request, card_id):
        window = _window(request)
        card = get_or_404(company_cards(self.workspace), card_id)
        cards = company_cards(self.workspace).filter(pk=card.pk)
        events = Event.objects.filter(card=card, created_at__gte=window.start, created_at__lt=window.end)
        leads = Lead.objects.filter(card=card, created_at__gte=window.start, created_at__lt=window.end)
        prev_events = Event.objects.filter(card=card, created_at__gte=window.prev_start, created_at__lt=window.start)
        prev_leads = Lead.objects.filter(card=card, created_at__gte=window.prev_start, created_at__lt=window.start)
        return Response({
            "period": _period(window), "card_id": str(card.id), "name": card.name,
            "totals": _totals(events, leads), "previous_totals": _totals(prev_events, prev_leads),
        })
