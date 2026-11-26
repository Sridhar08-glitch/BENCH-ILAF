"""Company operations endpoints: audit log, departments, field rules, change requests, reassignment, bulk actions
and the public directory."""
import csv
import math
from datetime import datetime, time, timedelta, timezone as dt_timezone

from django.db import IntegrityError, transaction
from django.db.models import Count
from django.http import Http404, HttpResponse
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services import require_enterprise
from cards.models import Card
from cards.services import public_url
from ilaf.branding import normalize_branding
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import localise_message
from ilaf.throttles import DirectoryThrottle
from ilaf.utils import clean_line, file_url, iso, sane_date
from rest_framework.exceptions import ValidationError
from workspaces.access import MANAGER_ROLES, card_for_user, get_workspace_and_member
from workspaces.models import Member
from workspaces import domains
from workspaces.services import verified_domain

from . import actions, audit, changes, departments as dept_logic, directory, rules
from .models import AuditEvent, ChangeRequest, Department


def _company(request, workspace_id):
    """(workspace, member) for an owner or admin of a company workspace."""
    ws, member = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
    if ws.kind != "company":
        raise validation_error({"workspace": ["This is only available on company workspaces."]})
    return ws, member


def _enterprise(request, workspace_id):
    """(workspace, member) for an owner or admin of a company on a plan that has the Enterprise-only features."""
    ws, member = _company(request, workspace_id)
    require_enterprise(ws)
    return ws, member


def _is_uuid(value):
    import uuid

    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


def _int(params, name, default, lo, hi):
    try:
        return max(lo, min(int(params.get(name, default)), hi))
    except (TypeError, ValueError):
        raise validation_error({name: ["Must be a number."]})


# ---------------------------------------------------------------- audit log
def audit_json(event):
    return {
        "id": str(event.id),
        "action": event.action,
        "label": audit.ACTIONS.get(event.action, event.action),
        "actor": {"id": str(event.actor_id) if event.actor_id else None, "full_name": event.actor_name, "email": event.actor_email}
        if (event.actor_id or event.actor_email or event.actor_name) else None,
        "target_type": event.target_type,
        "target_id": event.target_id,
        "target_label": event.target_label,
        "details": event.details,
        "created_at": iso(event.created_at),
    }


def _day(value, name, end=False):
    if not value:
        return None
    try:
        day = sane_date(datetime.strptime(value, "%Y-%m-%d").date())
    except ValueError:
        raise validation_error({name: ["Use the date format YYYY-MM-DD."]})
    moment = datetime.combine(day, time.min, tzinfo=dt_timezone.utc)
    return moment + timedelta(days=1) if end else moment


def filtered_events(ws, params):
    qs = AuditEvent.objects.filter(workspace=ws)
    actor = params.get("actor")
    if actor:
        if not _is_uuid(actor):
            raise validation_error({"actor": ["Choose a person from the list."]})
        qs = qs.filter(actor_id=actor)
    action = (params.get("action") or "").strip()
    if action:
        # "member." matches every member action.
        qs = qs.filter(action__startswith=action) if action.endswith(".") else qs.filter(action=action)
    start = _day(params.get("from"), "from")
    end = _day(params.get("to"), "to", end=True)
    if start:
        qs = qs.filter(created_at__gte=start)
    if end:
        qs = qs.filter(created_at__lt=end)
    text = (params.get("q") or "").strip()
    if text:
        from django.db.models import Q

        qs = qs.filter(Q(target_label__icontains=text) | Q(actor_name__icontains=text) | Q(actor_email__icontains=text))
    return qs


class AuditView(APIView):
    def get(self, request, workspace_id):
        ws, _ = _enterprise(request, workspace_id)
        qs = filtered_events(ws, request.query_params)
        size = _int(request.query_params, "page_size", 50, 1, 200)
        count = qs.count()
        pages = max(1, math.ceil(count / size))
        page = _int(request.query_params, "page", 1, 1, pages)
        rows = qs[(page - 1) * size: page * size]
        actors = {}
        for e in AuditEvent.objects.filter(workspace=ws, actor__isnull=False).values("actor_id", "actor_name", "actor_email").distinct()[:500]:
            actors[str(e["actor_id"])] = {"id": str(e["actor_id"]), "full_name": e["actor_name"], "email": e["actor_email"]}
        return Response({
            "count": count, "page": page, "pages": pages, "page_size": size,
            "results": [audit_json(e) for e in rows],
            "actors": list(actors.values()),
            "actions": [{"key": k, "label": v} for k, v in audit.ACTIONS.items()],
        })


def _csv_safe(value):
    value = "" if value is None else str(value)
    if value[:1] in ("=", "+", "-", "@", "\t", "\r"):
        return "'" + value
    return value


class AuditCsvView(APIView):
    MAX_ROWS = 20000

    def get(self, request, workspace_id):
        ws, _ = _enterprise(request, workspace_id)
        qs = filtered_events(ws, request.query_params)[: self.MAX_ROWS]
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="activity.csv"'
        writer = csv.writer(response)
        writer.writerow(["time", "who", "email", "action", "what", "target_type", "target", "details"])
        import json

        for e in qs:
            writer.writerow([
                iso(e.created_at), _csv_safe(e.actor_name), _csv_safe(e.actor_email), e.action,
                _csv_safe(audit.ACTIONS.get(e.action, e.action)), e.target_type, _csv_safe(e.target_label),
                _csv_safe(json.dumps(e.details, ensure_ascii=False, sort_keys=True)),
            ])
        return response


# ---------------------------------------------------------------- departments
def _department_or_404(ws, department_id):
    try:
        return ws.departments.get(pk=department_id)
    except (Department.DoesNotExist, ValueError):
        raise Http404


def _clean_name(ws, raw, ignore=None):
    try:
        name = clean_line(str(raw or ""), 60)
    except ValidationError as exc:
        raise validation_error({"name": [str(m) for m in exc.detail]})
    if not name:
        raise validation_error({"name": ["Enter a department name."]})
    clash = ws.departments.filter(name__iexact=name)
    if ignore is not None:
        clash = clash.exclude(pk=ignore.pk)
    if clash.exists():
        raise validation_error({"name": ["You already have a department with this name."]})
    return name


class DepartmentsView(APIView):
    def get(self, request, workspace_id):
        ws, _ = _company(request, workspace_id)
        # Explicit: Django ignores Meta.ordering on a query with a count annotation, so without this the order was
        # whatever the database returned (a renamed department jumped to the end).
        rows = ws.departments.annotate(n=Count("members")).order_by("name")
        return Response([dept_logic.department_json(d, d.n) for d in rows])

    def post(self, request, workspace_id):
        ws, _ = _enterprise(request, workspace_id)
        data = request.data if isinstance(request.data, dict) else {}
        name = _clean_name(ws, data.get("name"))
        design = dept_logic.clean_design(data.get("design"), ws)
        items = dept_logic.clean_buttons(data.get("items"), "items")
        mandatory = dept_logic.clean_buttons(data.get("mandatory_items"), "mandatory_items")
        try:
            with transaction.atomic():
                dept = Department.objects.create(workspace=ws, name=name, design=design, items=items, mandatory_items=mandatory)
        except IntegrityError:
            raise validation_error({"name": ["You already have a department with this name."]})
        audit.log(request, ws, "department.created", "department", dept.id, dept.name)
        return Response(dept_logic.department_json(dept, 0), status=201)


class DepartmentDetailView(APIView):
    def get(self, request, workspace_id, department_id):
        ws, _ = _company(request, workspace_id)
        return Response(dept_logic.department_json(_department_or_404(ws, department_id)))

    def patch(self, request, workspace_id, department_id):
        ws, _ = _enterprise(request, workspace_id)
        dept = _department_or_404(ws, department_id)
        data = request.data if isinstance(request.data, dict) else {}
        changed = []
        if "name" in data:
            dept.name = _clean_name(ws, data["name"], ignore=dept)
            changed.append("name")
        if "design" in data:
            dept.design = dept_logic.clean_design(data["design"], ws)
            changed.append("design")
        if "items" in data:
            dept.items = dept_logic.clean_buttons(data["items"], "items")
            changed.append("items")
        if "mandatory_items" in data:
            dept.mandatory_items = dept_logic.clean_buttons(data["mandatory_items"], "mandatory_items")
            changed.append("mandatory_items")
        try:
            with transaction.atomic():
                dept.save()
        except IntegrityError:
            raise validation_error({"name": ["You already have a department with this name."]})
        if changed:
            audit.log(request, ws, "department.updated", "department", dept.id, dept.name, {"keys": changed})
        return Response(dept_logic.department_json(dept))

    def delete(self, request, workspace_id, department_id):
        ws, _ = _enterprise(request, workspace_id)
        dept = _department_or_404(ws, department_id)
        count = dept.members.count()
        audit.log(request, ws, "department.deleted", "department", dept.id, dept.name, {"members": count})
        dept.delete()
        return Response(status=204)


class DepartmentAssignView(APIView):
    """Put members into a department (up to 200). Per-item results, like the other bulk actions."""

    def post(self, request, workspace_id, department_id):
        ws, actor = _enterprise(request, workspace_id)
        dept = _department_or_404(ws, department_id)
        data = request.data if isinstance(request.data, dict) else {}
        body = {"action": "department", "ids": data.get("member_ids"), "department_id": str(dept.id)}
        return Response(actions.run_bulk(request, ws, actor, "members", body))


# ---------------------------------------------------------------- field rules
class FieldRulesView(APIView):
    def get(self, request, workspace_id):
        ws, _ = _company(request, workspace_id)
        return Response(rules.normalize_rules(ws.field_rules))

    def patch(self, request, workspace_id):
        ws, _ = _enterprise(request, workspace_id)
        before = rules.normalize_rules(ws.field_rules)
        merged = rules.validate_rules(request.data, ws.field_rules)
        ws.field_rules = merged
        ws.save(update_fields=["field_rules"])
        changed = sorted(k for k in merged if merged[k] != before[k])
        if changed:
            audit.log(request, ws, "fields.rules_changed", "workspace", ws.id, ws.name, {"keys": changed, "rules": {k: merged[k] for k in changed}})
        return Response(merged)


# ---------------------------------------------------------------- change requests
class ChangeRequestsView(APIView):
    def get(self, request, workspace_id):
        ws, _ = _company(request, workspace_id)
        status = request.query_params.get("status", "pending")
        qs = ChangeRequest.objects.filter(workspace=ws).select_related("card", "requested_by", "decided_by")
        if status != "all":
            if status not in ("pending", "approved", "rejected", "withdrawn", "superseded"):
                raise validation_error({"status": ["Choose pending, approved, rejected or all."]})
            qs = qs.filter(status=status)
        card_id = request.query_params.get("card_id")
        if card_id:
            if not _is_uuid(card_id):
                raise validation_error({"card_id": ["Not a valid card id."]})
            qs = qs.filter(card_id=card_id)
        size = _int(request.query_params, "limit", 100, 1, 200)
        return Response({
            "count": qs.count(),
            "pending_count": ChangeRequest.objects.filter(workspace=ws, status="pending").count(),
            "results": [changes.change_json(c, request) for c in qs[:size]],
        })


def _change_or_404(ws, change_id):
    try:
        return ChangeRequest.objects.select_related("card", "requested_by", "decided_by").get(pk=change_id, workspace=ws)
    except (ChangeRequest.DoesNotExist, ValueError):
        raise Http404


class ChangeDecisionView(APIView):
    approve = True

    def post(self, request, workspace_id, change_id):
        ws, member = _enterprise(request, workspace_id)
        change = _change_or_404(ws, change_id)
        data = request.data if isinstance(request.data, dict) else {}
        change = changes.decide(request, change, self.approve, request.user, str(data.get("reason") or ""))
        change = _change_or_404(ws, change.pk)
        return Response(changes.change_json(change, request))


class ChangeApproveView(ChangeDecisionView):
    approve = True


class ChangeRejectView(ChangeDecisionView):
    approve = False


class ChangeBulkView(APIView):
    def post(self, request, workspace_id):
        ws, member = _enterprise(request, workspace_id)
        data = request.data if isinstance(request.data, dict) else {}
        action = data.get("action")
        if action not in ("approve", "reject"):
            raise validation_error({"action": ["Choose approve or reject."]})
        ids = actions._parse_ids(data.get("ids"))
        found = {str(c.pk): c for c in ChangeRequest.objects.filter(workspace=ws, pk__in=ids).select_related("card")}
        results = []
        for cid in ids:
            change = found.get(cid)
            if change is None:
                results.append({"id": cid, "name": "", "ok": False, "reason": localise_message(request, "Not found in this company."), "code": "not_found"})
                continue
            try:
                changes.decide(request, change, action == "approve", request.user, str(data.get("reason") or ""))
                results.append({"id": cid, "name": change.card.name, "ok": True, "reason": None, "code": None})
            except ApiError as exc:
                results.append({"id": cid, "name": change.card.name, "ok": False, "reason": localise_message(request, exc.message), "code": exc.code})
        ok = sum(1 for r in results if r["ok"])
        audit.log(request, ws, "bulk.run", "change_requests", "", "", {
            "kind": "change_requests", "action": action, "total": len(results), "ok": ok, "failed": len(results) - ok,
        })
        return Response({"action": action, "total": len(results), "ok": ok, "failed": len(results) - ok, "results": results})


class ChangeWithdrawView(APIView):
    """The employee who asked can take a waiting request back."""

    def post(self, request, change_id):
        try:
            change = ChangeRequest.objects.select_related("card").get(pk=change_id)
        except (ChangeRequest.DoesNotExist, ValueError):
            raise Http404
        if change.requested_by_id != request.user.id:
            raise Http404
        changes.withdraw(request, change, request.user)
        return Response({"id": str(change.id), "status": change.status})


# ---------------------------------------------------------------- reassign and bulk
class ReassignCardView(APIView):
    def post(self, request, card_id):
        card, actor = card_for_user(request.user, card_id, MANAGER_ROLES)
        ws = card.workspace
        if ws.kind != "company":
            raise validation_error({"card": ["Only company cards can be reassigned."]})
        data = request.data if isinstance(request.data, dict) else {}
        target = None
        raw = data.get("member_id")
        if raw:
            if not _is_uuid(raw):
                raise validation_error({"member_id": ["Choose a person from the list."]})
            target = Member.objects.filter(workspace=ws, pk=raw).select_related("user").first()
            if target is None:
                raise validation_error({"member_id": ["That person is not in this company."]})
        actions.reassign_card(request, ws, card, target, reset_details=bool(data.get("reset_details")), actor=actor)
        from cards.views import _card_response

        return _card_response(Card.objects.get(pk=card.pk), request)


class BulkMembersView(APIView):
    def post(self, request, workspace_id):
        ws, actor = _company(request, workspace_id)
        return Response(actions.run_bulk(request, ws, actor, "members", request.data if isinstance(request.data, dict) else {}))


class BulkCardsView(APIView):
    def post(self, request, workspace_id):
        ws, actor = _company(request, workspace_id)
        return Response(actions.run_bulk(request, ws, actor, "cards", request.data if isinstance(request.data, dict) else {}))


# ---------------------------------------------------------------- public directory
class PublicDirectoryView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DirectoryThrottle]

    def get(self, request, slug):
        ws = None
        from workspaces.models import Workspace

        ws = Workspace.objects.filter(directory_slug=(slug or "").lower(), directory_enabled=True, kind="company").first()
        if ws is None:
            raise Http404
        host = request.query_params.get("host")
        if host:
            # Asked on a company's own domain: only that company's directory is shown there.
            row, state = domains.host_state(host)
            if state != "active" or row.workspace_id != ws.id:
                raise Http404
        from staff.flags import flag_enabled

        if not flag_enabled("directory", ws):
            raise Http404
        params = request.query_params
        dept = params.get("department") or None
        if dept and not _is_uuid(dept):
            dept = None
        size = _int(params, "page_size", directory.PAGE_SIZE, 1, directory.MAX_PAGE_SIZE)
        qs = directory.search_cards(ws, params.get("q", ""), dept)
        count = qs.count()
        pages = max(1, math.ceil(count / size))
        page = _int(params, "page", 1, 1, pages)
        cards = list(qs[(page - 1) * size: page * size])
        counts = (
            directory.listed_cards(ws).filter(member__department__isnull=False)
            .values("member__department_id", "member__department__name").annotate(n=Count("id"))
            .order_by("member__department__name")
        )
        brand = ws.brand or {}
        branding = normalize_branding(brand)
        listed_total = directory.listed_cards(ws).count()
        return Response({
            "company": {
                "name": brand.get("company_name") or ws.name,
                "slug": ws.directory_slug,
                "website": brand.get("website") or None,
                "logo_url": file_url(request, ws.logo),
                "symbol_url": file_url(request, ws.symbol),
                "palette": branding["palette"],
                "logo_display": branding["logo_display"],
                "show_company_name": branding["show_company_name"],
                "verified_domain": verified_domain(ws),
                # Where the directory lives: the company's domain root once verified, else /d/<slug> on the Bench host.
                "url": domains.directory_url(ws),
            },
            "total": listed_total,
            "count": count,
            "page": page,
            "pages": pages,
            "page_size": size,
            "departments": [{"id": str(r["member__department_id"]), "name": r["member__department__name"], "count": r["n"]} for r in counts],
            "results": [
                {
                    "code": c.slug or c.public_code,
                    "name": c.name,
                    "title": c.title,
                    "department": c.member.department.name if c.member and c.member.department_id else None,
                    "photo_url": file_url(request, c.photo),
                    "url": public_url(c),
                }
                for c in cards
            ],
        })
