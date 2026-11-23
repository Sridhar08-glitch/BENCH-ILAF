import csv
from datetime import date, datetime, time, timedelta, timezone as dt_tz

from django.db.models import Count, Prefetch, Q
from django.conf import settings
from django.http import StreamingHttpResponse
from django.http import Http404
from django.core.exceptions import ValidationError as DjangoValidationError
from rest_framework import serializers
from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError, validation_error
from ilaf.i18n import localise_message
from ilaf.utils import clean_line, clean_multiline, iso, sane_date
from cards.features import validate_lead_settings
from workspaces.access import MANAGER_ROLES, active_membership, get_workspace_and_member, refuse_if_pending_deletion, visible_cards

from operations import audit
from workspaces.models import Member

from . import workflow
from .models import Lead, LeadNote


def person_json(member):
    if member is None:
        return None
    return {"id": str(member.id), "name": member.full_name or member.email, "email": member.email}


def lead_json(lead):
    return {
        "id": str(lead.id),
        "card_id": str(lead.card_id) if lead.card_id else None,
        "card_name": lead.card.name if lead.card_id else lead.card_name,
        "name": lead.name,
        "email": lead.email,
        "phone": lead.phone,
        "company": lead.company,
        "note": lead.note,
        "source": lead.source,
        "channel": lead.channel,
        "tag": lead.tag,
        "event_name": lead.event_name,
        "meeting_times": lead.meeting_times or [],
        "status": lead.status,
        "assignee": person_json(lead.assignee) if lead.assignee_id else None,
        "assigned_at": iso(lead.assigned_at),
        "consented_at": iso(lead.consented_at),
        "note_count": lead.note_count if hasattr(lead, "note_count") else lead.notes.count(),
        "created_at": iso(lead.created_at),
    }


def _date(params, name):
    raw = params.get(name)
    if not raw:
        return None
    try:
        return sane_date(date.fromisoformat(raw))
    except ValueError:
        raise validation_error({name: ["Use the form YYYY-MM-DD."]})


def scoped_leads(member, params):
    """Leads this member may see, with the list filters applied.

    Filters: card_id, status (one or several, comma separated), source, assignee (a member id, `me` or `none`),
    q, from and to (dates, UTC). Employees see leads of their own card and leads given to them."""
    qs = workflow.visible_leads(member).select_related("card", "assignee").annotate(note_count=Count("notes", distinct=True))
    card_id = params.get("card_id")
    if card_id:
        try:
            qs = qs.filter(card_id=card_id)
        except Exception:
            raise validation_error({"card_id": ["Not a valid card id."]})
    statuses = [x for x in (params.get("status") or "").split(",") if x]
    if statuses:
        qs = qs.filter(status__in=statuses)
    source = params.get("source")
    if source:
        qs = qs.filter(source=source)
    assignee = params.get("assignee")
    if assignee == "me":
        qs = qs.filter(assignee_id=member.id)
    elif assignee == "none":
        qs = qs.filter(assignee__isnull=True)
    elif assignee:
        try:
            qs = qs.filter(assignee_id=assignee)
        except Exception:
            raise validation_error({"assignee": ["Not a valid member id."]})
    start, end = _date(params, "from"), _date(params, "to")
    if start:
        qs = qs.filter(created_at__gte=datetime.combine(start, time.min, tzinfo=dt_tz.utc))
    if end:
        qs = qs.filter(created_at__lt=datetime.combine(end + timedelta(days=1), time.min, tzinfo=dt_tz.utc))
    q = (params.get("q") or "").strip()
    if q:
        qs = qs.filter(
            Q(name__icontains=q) | Q(email__icontains=q) | Q(phone__icontains=q)
            | Q(company__icontains=q) | Q(note__icontains=q)
        )
    return qs.order_by("-created_at", "-id")


def lead_access(user, workspace_id, roles=None, export=False):
    """(workspace, member) for a route that handles contact data. While the company waits to be deleted its
    contacts are closed to everybody; only the owner may still download them (`export=True`), so the data can be
    taken out before it is erased."""
    workspace, member = get_workspace_and_member(user, workspace_id) if roles is None else get_workspace_and_member(user, workspace_id, roles)
    if workspace.deletion_due_at is not None and not (export and member.role == "owner"):
        raise ApiError(
            "workspace_pending_deletion", "This company is scheduled for deletion and its contacts are closed for now.", 403
        )
    return workspace, member


def _int(params, name, default, lo, hi):
    try:
        return max(lo, min(int(params.get(name, default)), hi))
    except (TypeError, ValueError):
        raise validation_error({name: ["Must be a number."]})


# What a member can save by hand: a scanned paper card (the default) or someone met at an event.
MANUAL_SOURCES = ("scanned_card", "event")
EVENT_TAGS = ("", "hot", "warm", "follow_up")


class WorkspaceLeadsView(APIView):
    def get(self, request, workspace_id):
        _, member = lead_access(request.user, workspace_id)
        qs = scoped_leads(member, request.query_params)
        limit = _int(request.query_params, "limit", 50, 1, 200)
        offset = _int(request.query_params, "offset", 0, 0, 10**9)
        return Response({"count": qs.count(), "results": [lead_json(l) for l in qs[offset:offset + limit]]})

    def post(self, request, workspace_id):
        """Save a contact the user collected themselves (a scanned paper card). No e-mail is sent."""
        workspace, member = lead_access(request.user, workspace_id)
        data = request.data if isinstance(request.data, dict) else {}
        errors = {}
        values = {}
        source = data.get("source") or "scanned_card"
        if source not in MANUAL_SOURCES:
            errors["source"] = ["Choose a valid source."]
        tag = data.get("tag") or ""
        if tag not in EVENT_TAGS:
            errors["tag"] = ["Choose a valid tag."]
        client_ref = data.get("client_ref") or ""
        if not isinstance(client_ref, str) or len(client_ref) > 64:
            errors["client_ref"] = ["Must be text."]
        event_name = ""
        if isinstance(data.get("event_name"), str):
            try:
                event_name = clean_line(data["event_name"], 120)
            except DRFValidationError as exc:
                errors["event_name"] = [str(m) for m in exc.detail]
        for name, limit, multiline in (("name", 120, False), ("email", 254, False), ("phone", 40, False), ("company", 120, False), ("note", 2000, True)):
            raw = data.get(name)
            if raw is None:
                values[name] = ""
            elif not isinstance(raw, str):
                errors[name] = ["Must be text."]
            else:
                try:
                    values[name] = clean_multiline(raw, limit) if multiline else clean_line(raw, limit)
                except DRFValidationError as exc:
                    errors[name] = [str(m) for m in exc.detail]
        if source == "event":
            # Someone met at an event may be saved with no name, as long as something says who they are.
            if not any(values.get(k) for k in ("name", "email", "phone", "company", "note")) and not errors:
                errors["name"] = ["Enter a name."]
        elif not values.get("name") and "name" not in errors:
            errors["name"] = ["Enter a name."]
        if values.get("email") and "email" not in errors:
            try:
                serializers.EmailField().run_validation(values["email"])
            except DRFValidationError:
                errors["email"] = ["Enter a valid email address."]
        if errors:
            raise validation_error(errors)
        card = None
        card_id = data.get("card_id")
        if card_id:
            try:
                card = visible_cards(member).filter(pk=card_id).first()
            except (ValueError, DjangoValidationError):
                card = None
            if card is None:
                raise validation_error({"card_id": ["Choose one of your cards."]})
        elif member.role == "employee":
            card = visible_cards(member).first()
            if card is None:
                raise validation_error({"card_id": ["You have no card to attach this contact to."]})
        if client_ref:
            # The same note sent again (a retry after a lost connection) answers with the lead already saved.
            existing = scoped_leads(member, {}).filter(client_ref=client_ref).first()
            if existing is not None:
                return Response(lead_json(existing), status=200)
        lead = Lead.objects.create(
            card=card, workspace=workspace, card_name=(card.name if card else "")[:120], source=source,
            tag=tag, event_name=event_name, client_ref=client_ref, **values,
        )
        workflow.note_created(lead, request.user)
        return Response(lead_json(lead), status=201)


def _csv_safe(value):
    """Stop spreadsheet formulas: a cell starting with = + - @ gets a leading apostrophe."""
    value = "" if value is None else str(value)
    if value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


CSV_HEADER = [
    "created_at", "card", "name", "email", "phone", "company", "note", "source", "status", "meeting_times",
    "id", "channel", "assignee", "assignee_email", "consent", "consented_at",
]
# Added after the older columns (and after internal_notes) so that no earlier column changes its place.
CSV_EXTRA_HEADER = ["tag", "event_name"]


class _Echo:
    """The csv writer needs something to write to; this hands each line straight back so it can be streamed."""

    def write(self, value):
        return value


class LeadsCsvView(APIView):
    """Leads as a spreadsheet file (UTF-8 with a byte-order mark so Excel reads accents). Same filters as the list;
    `notes=1` adds the internal notes (owner and admin only). The file is streamed, holds at most
    `LEADS_CSV_MAX_ROWS` rows (a `X-Rows-Truncated` header says so when it was cut) and every download is written to
    the company's activity log."""

    def get(self, request, workspace_id):
        workspace, member = lead_access(request.user, workspace_id, export=True)
        with_notes = request.query_params.get("notes") in ("1", "true", "yes")
        if with_notes and member.role not in MANAGER_ROLES:
            raise ApiError("forbidden", "Only an owner or admin can export the internal notes.", 403)
        qs = scoped_leads(member, request.query_params)
        cap = int(getattr(settings, "LEADS_CSV_MAX_ROWS", 50000))
        total = qs.count()
        qs = qs[:cap]
        if with_notes:
            qs = qs.prefetch_related(Prefetch("notes", queryset=LeadNote.objects.order_by("created_at")))
        audit.log(
            request, workspace, "lead.exported", "leads", "", "",
            {"rows": min(total, cap), "notes": with_notes, "truncated": total > cap,
             "filters": {k: v for k, v in request.query_params.items() if k in ("card_id", "status", "source", "assignee", "q", "from", "to")}},
        )
        writer = csv.writer(_Echo())

        def lines():
            yield "\ufeff" + writer.writerow(CSV_HEADER + (["internal_notes"] if with_notes else []) + CSV_EXTRA_HEADER)
            for lead in qs.iterator(chunk_size=500):
                row = [
                    iso(lead.created_at), _csv_safe(lead.card.name if lead.card_id else lead.card_name), _csv_safe(lead.name),
                    _csv_safe(lead.email), _csv_safe(lead.phone), _csv_safe(lead.company), _csv_safe(lead.note),
                    lead.source, lead.status, _csv_safe("; ".join(lead.meeting_times or [])),
                    lead.id, lead.channel,
                    _csv_safe(lead.assignee.full_name or lead.assignee.email) if lead.assignee_id else "",
                    _csv_safe(lead.assignee.email) if lead.assignee_id else "",
                    "yes" if lead.consented_at else "no", iso(lead.consented_at) or "",
                ]
                if with_notes:
                    row.append(_csv_safe(" | ".join(f"{n.author_name or 'Someone'}: {n.body}" for n in lead.notes.all())))
                row += [_csv_safe(lead.tag), _csv_safe(lead.event_name)]
                yield writer.writerow(row)

        response = StreamingHttpResponse(lines(), content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="leads.csv"'
        response["Cache-Control"] = "no-store"
        if total > cap:
            response["X-Rows-Truncated"] = "1"
        return response


def note_json(note):
    return {"id": str(note.id), "author": note.author_name, "body": note.body, "created_at": iso(note.created_at)}


def activity_json(item):
    return {
        "id": str(item.id), "kind": item.kind, "actor": item.actor_name or None,
        "details": item.details or {}, "created_at": iso(item.created_at),
    }


def detail_json(lead):
    data = lead_json(lead)
    data["notes"] = [note_json(n) for n in lead.notes.all()]
    data["activity"] = [activity_json(a) for a in lead.activity.all()]
    return data


def _open_lead(request, lead_id):
    """The lead and the caller's membership, or a 404 when the caller may not see it."""
    try:
        lead = Lead.objects.select_related("card", "workspace", "assignee").get(pk=lead_id)
    except (Lead.DoesNotExist, ValueError):
        raise Http404
    workspace_id = lead.card.workspace_id if lead.card_id else lead.workspace_id
    member = active_membership(request.user, workspace_id)
    if member is None or not workflow.can_see(member, lead):
        raise Http404
    refuse_if_pending_deletion(member)
    if member.workspace.deletion_due_at is not None:
        raise ApiError(
            "workspace_pending_deletion", "This company is scheduled for deletion and its contacts are closed for now.", 403
        )
    return lead, member


class LeadPatchSerializer(serializers.Serializer):
    status = serializers.ChoiceField(choices=list(workflow.STATUS_KEYS), required=False)
    assignee_id = serializers.UUIDField(required=False, allow_null=True)


class LeadDetailView(APIView):
    def get(self, request, lead_id):
        lead, _ = _open_lead(request, lead_id)
        return Response(detail_json(lead))

    def patch(self, request, lead_id):
        lead, member = _open_lead(request, lead_id)
        ser = LeadPatchSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        if not data:
            raise validation_error({"status": ["Send a status or an assignee."]})
        if "assignee_id" in data:
            if member.role not in MANAGER_ROLES:
                raise ApiError("forbidden", "Only an owner or admin can assign leads.", 403)
            if not workflow.is_company(lead):
                raise validation_error({"assignee_id": ["Leads can only be assigned inside a company."]})
            assignee = workflow.assignable_member(lead.workspace_id, data["assignee_id"])
            workflow.assign(request, lead, assignee, request.user)
        if "status" in data:
            workflow.set_status(request, lead, data["status"], request.user)
        lead.refresh_from_db()
        return Response(detail_json(lead))


class LeadNotesView(APIView):
    def post(self, request, lead_id):
        lead, _ = _open_lead(request, lead_id)
        raw = request.data.get("body") if isinstance(request.data, dict) else None
        if not isinstance(raw, str):
            raise validation_error({"body": ["Write the note."]})
        try:
            body = clean_multiline(raw, 2000)
        except DRFValidationError as exc:
            raise validation_error({"body": [str(m) for m in exc.detail]})
        if not body:
            raise validation_error({"body": ["Write the note."]})
        return Response(note_json(workflow.add_note(lead, request.user, body)), status=201)


class LeadBulkView(APIView):
    """Assign or change the status of many leads at once. Items are independent; refused ones carry a reason."""

    def post(self, request, workspace_id):
        workspace, member = lead_access(request.user, workspace_id)
        data = request.data if isinstance(request.data, dict) else {}
        action = data.get("action")
        ids = data.get("ids")
        if action not in ("assign", "status"):
            raise validation_error({"action": ["Choose assign or status."]})
        if not isinstance(ids, list) or not ids:
            raise validation_error({"ids": ["Pick at least one contact."]})
        if len(ids) > workflow.MAX_BULK:
            raise validation_error({"ids": [f"Pick at most {workflow.MAX_BULK} contacts at a time."]})
        assignee = None
        status = None
        if action == "assign":
            if member.role not in MANAGER_ROLES:
                raise ApiError("forbidden", "Only an owner or admin can assign leads.", 403)
            if workspace.kind != "company":
                raise validation_error({"assignee_id": ["Leads can only be assigned inside a company."]})
            assignee = workflow.assignable_member(workspace.id, data.get("assignee_id"))
        else:
            status = data.get("status")
            if status not in workflow.STATUS_KEYS:
                raise validation_error({"status": ["Choose one of the listed statuses."]})
        valid = []
        for raw in ids:
            try:
                valid.append(str(raw))
                Lead._meta.pk.to_python(raw)
            except Exception:
                valid.pop()
        found = {
            str(l.id): l
            for l in workflow.visible_leads(member).filter(pk__in=valid).select_related("card", "workspace", "assignee")
        }
        results, ok = [], 0
        for raw in ids:
            lead = found.get(str(raw))
            if lead is None:
                results.append({"id": str(raw), "name": "", "ok": False, "reason": localise_message(request, "Not found."), "code": "not_found"})
                continue
            if action == "assign":
                workflow.assign(request, lead, assignee, request.user, audit_each=False, notify=False)
            else:
                workflow.set_status(request, lead, status, request.user, audit_each=False)
            ok += 1
            results.append({"id": str(lead.id), "name": lead.name, "ok": True, "reason": None, "code": None})
        if ok and workspace.kind == "company":
            audit.log(
                request, workspace, "lead.bulk_updated", "lead", "", f"{ok} contacts",
                {"action": action, "count": ok, "assignee": (assignee.full_name or assignee.email) if assignee else None, "status": status},
            )
        if action == "assign" and assignee is not None and ok:
            _tell_assignee_once(assignee, request.user, ok)
        return Response({"action": action, "total": len(ids), "ok": ok, "failed": len(ids) - ok, "results": results})


def _tell_assignee_once(assignee, actor, count):
    """One e-mail for a whole bulk assignment instead of one per lead."""
    if not assignee.email or (assignee.user_id == actor.id):
        return
    from django.conf import settings
    from ilaf.emails import send_brand_email
    from ilaf.i18n import member_language, tr, trn

    lang = member_language(assignee)
    try:
        title = trn(lang, count, "{n} lead was assigned to you", "{n} leads were assigned to you")
        send_brand_email(
            assignee.email, title, title,
            [trn(lang, count, "{by} gave you {n} lead.", "{by} gave you {n} leads.",
                 by=workflow.person_name(actor) or tr(lang, "A colleague"))],
            button_text=tr(lang, "Open your contacts"), button_url=f"{settings.WEB_BASE_URL}/app/contacts?assignee=me",
            lang=lang,
        )
    except Exception:
        pass


class LeadAssigneesView(APIView):
    """The people a lead can be handed to (managers) - active members of the company."""

    def get(self, request, workspace_id):
        workspace, member = lead_access(request.user, workspace_id, MANAGER_ROLES)
        rows = Member.objects.filter(workspace=workspace, status="active").order_by("full_name", "email")
        return Response([{**person_json(m), "role": m.role} for m in rows])


class LeadSettingsView(APIView):
    """The company's lead handling: privacy page link and whether admins are e-mailed about every lead."""

    def get(self, request, workspace_id):
        workspace, _ = get_workspace_and_member(request.user, workspace_id)
        return Response(validate_lead_settings({}, base=workspace.lead_settings))

    def patch(self, request, workspace_id):
        workspace, _ = get_workspace_and_member(request.user, workspace_id, roles=MANAGER_ROLES)
        try:
            workspace.lead_settings = validate_lead_settings(request.data, base=workspace.lead_settings)
        except DRFValidationError as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
            raise validation_error({k: [str(m) for m in v] for k, v in detail.items()})
        workspace.save(update_fields=["lead_settings"])
        return Response(workspace.lead_settings)
