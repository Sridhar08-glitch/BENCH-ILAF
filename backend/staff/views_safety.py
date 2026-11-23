"""Trust and safety: the card report queue and data requests."""
import re

from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from accounts.models import User
from cards.models import Card
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import tr, user_language
from ilaf.utils import iso
from privacy import services as privacy
from privacy.models import DataRequest
from workspaces.models import Member

from . import services
from .common import paged
from .models import AbuseReport
from .perms_map import can, roles_for
from .permissions import StaffView
from .views_customers import card_row, get_card, staff_suspend_card, _suspend_company

OPEN = ("new", "reviewing")
REASON_LABELS = {"spam": "Spam", "fake": "Fake or made-up person", "offensive": "Offensive content", "impersonation": "Impersonation", "other": "Other"}


def sla_json(r, now=None):
    now = now or timezone.now()
    if r.status not in OPEN:
        return {"state": "done", "minutes_left": None}
    left = int((r.due_at - now).total_seconds() // 60)
    return {"state": "late" if left < 0 else "soon" if left < 12 * 60 else "ok", "minutes_left": left}


def report_json(r, now=None):
    return {
        "id": str(r.id), "number": r.number, "short_id": r.short_id, "card_id": str(r.card_id) if r.card_id else None, "card_name": r.card_name or (r.card.name if r.card_id else ""),
        "company_id": str(r.workspace_id) if r.workspace_id else None, "company_name": r.workspace.name if r.workspace_id else "",
        "reason": r.reason, "reason_label": REASON_LABELS.get(r.reason, r.reason), "note": r.note, "reporter_email": r.reporter_email,
        "status": r.status, "assignee": r.assignee.email if r.assignee_id else None, "created_at": iso(r.created_at), "due_at": iso(r.due_at),
        "resolved_at": iso(r.resolved_at), "outcome": r.outcome, "sla": sla_json(r, now),
    }


def add_history(r, who, kind, text):
    r.history = [*r.history, {"t": iso(timezone.now()), "who": who, "kind": kind, "text": text[:500]}][-100:]


class AbuseListView(StaffView):
    perm = "view"
    write_roles = roles_for("triage")

    def get(self, request):
        params = request.query_params
        qs = AbuseReport.objects.select_related("card", "workspace", "assignee")
        status = params.get("status", "open")
        if status == "open":
            qs = qs.filter(status__in=OPEN)
        elif status != "all":
            qs = qs.filter(status=status)
        if params.get("reason"):
            qs = qs.filter(reason=params["reason"])
        if params.get("late") == "1":
            qs = qs.filter(status__in=OPEN, due_at__lt=timezone.now())
        term = (params.get("q") or "").strip()[:100]
        if term:
            match = Q(card_name__icontains=term) | Q(workspace__name__icontains=term) | Q(note__icontains=term)
            number = re.fullmatch(r"(?:r-?)?0*(\d{1,9})", term, re.IGNORECASE)
            if number:
                match |= Q(number=int(number.group(1)))
            qs = qs.filter(match)
        qs = qs.order_by("due_at", "id") if status in ("open", "new", "reviewing") else qs.order_by("-created_at", "id")
        now = timezone.now()
        body = paged(request, qs, lambda r: report_json(r, now))
        body["counts"] = {s: AbuseReport.objects.filter(status=s).count() for s in ("new", "reviewing", "actioned", "dismissed")}
        body["late"] = AbuseReport.objects.filter(status__in=OPEN, due_at__lt=now).count()
        return Response(body)


def get_report(report_id):
    r = AbuseReport.objects.filter(pk=report_id).select_related("card", "workspace", "assignee").first()
    if r is None:
        raise Http404
    return r


class AbuseDetailView(StaffView):
    perm = "view"

    def get(self, request, report_id):
        r = get_report(report_id)
        others = AbuseReport.objects.filter(Q(card=r.card) | Q(workspace=r.workspace)).exclude(pk=r.pk).select_related("card", "workspace", "assignee").order_by("-created_at")[:20] if (r.card_id or r.workspace_id) else []
        return Response({
            **report_json(r),
            "history": r.history,
            "card": card_row(get_card(r.card_id), request) if r.card_id else None,
            "related": [report_json(o) for o in others],
        })


def _warn_owner(r, message=""):
    ws = r.workspace
    owner_member = ws.members.filter(role="owner").select_related("user").first() if ws else None
    card = r.card
    email = owner_member.email if owner_member else (card.owner.email if card and card.owner_id else "")
    if not email:
        raise ApiError("no_owner_email", "There is no owner e-mail to warn.", 409)
    user = owner_member.user if owner_member and owner_member.user_id else (card.owner if card else None)
    lang = user_language(user) if user else "en"
    reason = {
        "spam": tr(lang, "it looks like spam or advertising"), "fake": tr(lang, "it looks like a fake or made-up person"),
        "offensive": tr(lang, "it has offensive content"), "impersonation": tr(lang, "it looks like it pretends to be someone else"),
        "other": tr(lang, "it may break our rules"),
    }[r.reason]
    paragraphs = [
        tr(lang, "A visitor reported the card {card} because {reason}.", card=r.card_name or "-", reason=reason),
        tr(lang, "Please check the card and fix anything that breaks our rules. If it is not fixed we may suspend it."),
    ]
    if message:
        paragraphs.append(tr(lang, "Note from our team: {note}", note=message))
    paragraphs.append(tr(lang, "If you think this is a mistake, reply to this e-mail or contact support."))
    send_brand_email(email, tr(lang, "A visitor reported your card"), tr(lang, "A card was reported"), paragraphs, lang=lang)


def apply_action(request, r, action, note="", assignee=None, confirm_name=""):
    """One triage action on one report. Raises ApiError when it cannot be done; the caller logs and saves.
    Suspending the company needs its name typed exactly (`confirm_name`)."""
    who = request.user.email
    if action == "note":
        if not note:
            raise validation_error({"note": ["Write a note."]})
        add_history(r, who, "note", note)
    elif action == "reviewing":
        r.status = "reviewing"
        r.assignee = assignee or request.user
        add_history(r, who, "status", "Started looking at it")
    elif action == "assign":
        r.assignee = assignee or request.user
        if r.status == "new":
            r.status = "reviewing"
        add_history(r, who, "status", f"Assigned to {r.assignee.email}")
    elif action == "dismiss":
        r.status, r.outcome, r.resolved_at = "dismissed", "dismissed", timezone.now()
        add_history(r, who, "status", note or "Dismissed: no problem found")
    elif action == "warn":
        _warn_owner(r, note)
        r.status, r.outcome, r.resolved_at = "actioned", "warned", timezone.now()
        add_history(r, who, "warn", note or "Warned the owner by e-mail")
    elif action == "suspend_card":
        if r.card is None:
            raise ApiError("card_gone", "This card no longer exists.", 409)
        if r.card.status != "suspended":
            staff_suspend_card(request, Card.objects.select_related("workspace").get(pk=r.card_id), f"Card report: {r.reason}")
        r.status, r.outcome, r.resolved_at = "actioned", "card_suspended", timezone.now()
        add_history(r, who, "suspend_card", note or "Suspended the card")
    elif action == "suspend_company":
        if not can(request.staff_role, "suspendCo"):
            raise ApiError("forbidden", "Your staff role does not allow this action.", 403)
        if r.workspace is None:
            raise ApiError("card_gone", "This card no longer exists.", 409)
        if str(confirm_name or "").strip().casefold() != r.workspace.name.strip().casefold():
            raise validation_error({"confirm_name": ["Type the company name exactly to confirm."]})
        if r.workspace.suspended_at is None:
            _suspend_company(request, r.workspace, f"Card report: {r.reason}")
        r.status, r.outcome, r.resolved_at = "actioned", "company_suspended", timezone.now()
        add_history(r, who, "suspend_company", note or "Suspended the company")
    else:
        raise validation_error({"action": ["Choose a valid action."]})
    r.save()
    services.log(request, f"abuse.{action}", "report", r.id, r.card_name, {"company": str(r.workspace_id or "")})


class AbuseActionView(StaffView):
    perm = "view"
    write_roles = roles_for("triage")

    def post(self, request, report_id):
        data = request.data if isinstance(request.data, dict) else {}
        r = get_report(report_id)
        assignee = None
        if data.get("assignee"):
            assignee = User.objects.filter(pk=data["assignee"]).exclude(staff_role="none").first()
            if assignee is None:
                raise validation_error({"assignee": ["Choose a person from the staff."]})
        apply_action(request, r, data.get("action"), str(data.get("note") or "").strip()[:500], assignee, str(data.get("confirm_name") or ""))
        return Response({**report_json(r), "history": r.history})


class AbuseBulkView(StaffView):
    perm = "view"
    write_roles = roles_for("triage")

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        ids, action = data.get("ids"), data.get("action")
        if action not in ("dismiss", "reviewing", "assign", "warn") or not isinstance(ids, list) or not ids or len(ids) > 100:
            raise validation_error({"ids": ["Choose between 1 and 100 reports and an action."]})
        note = str(data.get("note") or "").strip()[:500]
        if action == "warn" and len(note) < 5:
            raise validation_error({"note": ["Write a reason of at least 5 characters. The owners get it in the e-mail."]})
        results = []
        for report_id in ids:
            try:
                report = get_report(report_id)
                if action == "warn" and report.status not in OPEN:
                    raise ApiError("not_open", "This report is already closed.", 409)
                apply_action(request, report, action, note)
                results.append({"id": str(report_id), "ok": True})
            except (ApiError, Http404, ValueError) as exc:
                results.append({"id": str(report_id), "ok": False, "error": getattr(exc, "code", "not_found")})
        return Response({"results": results})


# ---------------------------------------------------------------- data requests
DATA_OPEN = ("pending", "processing", "ready", "failed")


def data_json(dr, now=None):
    now = now or timezone.now()
    left = (dr.due_at - now).total_seconds() / 86400
    owns_company = False
    if dr.user_id:
        for m in Member.objects.filter(user_id=dr.user_id, role="owner", workspace__kind="company", workspace__deleted_at__isnull=True).select_related("workspace"):
            if m.workspace.members.exclude(user_id=dr.user_id).exists():
                owns_company = True
    return {
        "id": str(dr.id), "kind": dr.kind, "scope": dr.scope, "status": dr.status, "requested_at": iso(dr.requested_at), "due_at": iso(dr.due_at),
        "days_left": int(left) if left >= 0 else -int(-left), "overdue": dr.status in DATA_OPEN and left < 0,
        "user_email": dr.user.email if dr.user_id else "", "user_id": str(dr.user_id) if dr.user_id else None,
        "company_id": str(dr.workspace_id) if dr.workspace_id else None, "company_name": dr.workspace.name if dr.workspace_id else "",
        "scheduled_for": iso(dr.scheduled_for), "completed_at": iso(dr.completed_at), "error": dr.error,
        "handled_by": dr.handled_by.email if dr.handled_by_id else None, "owns_company_with_people": owns_company,
        "note": (dr.details or {}).get("staff_note", ""),
    }


class DataRequestsView(StaffView):
    perm = "view"
    write_roles = roles_for("data")

    def get(self, request):
        params = request.query_params
        qs = DataRequest.objects.select_related("user", "workspace", "handled_by")
        status = params.get("status", "open")
        if status == "open":
            qs = qs.filter(status__in=DATA_OPEN)
        elif status != "all":
            qs = qs.filter(status=status)
        if params.get("kind") in ("export", "delete"):
            qs = qs.filter(kind=params["kind"])
        qs = qs.order_by("due_at", "id") if status == "open" else qs.order_by("-requested_at", "id")
        now = timezone.now()
        body = paged(request, qs, lambda d: data_json(d, now))
        body["overdue"] = DataRequest.objects.filter(status__in=DATA_OPEN, due_at__lt=now).count()
        return Response(body)


class DataRequestActionView(StaffView):
    perm = "view"
    write_roles = roles_for("data")

    def post(self, request, request_id):
        dr = DataRequest.objects.select_related("user", "workspace").filter(pk=request_id).first()
        if dr is None:
            raise Http404
        data = request.data if isinstance(request.data, dict) else {}
        action = data.get("action")
        if action == "start_export":
            self._start_export(request, dr)
        elif action == "confirm_delete":
            self._confirm_delete(request, dr, data)
        elif action == "mark_done":
            if dr.status not in DATA_OPEN:
                raise ApiError("request_closed", "This request is already finished.", 409)
            dr.status, dr.completed_at, dr.handled_by = "completed", timezone.now(), request.user
            dr.details = {**(dr.details or {}), "staff_note": str(data.get("note") or "")[:300]}
            dr.save()
            services.log(request, "data_request.done", "data_request", dr.id, dr.user.email if dr.user_id else "", {"kind": dr.kind, **services.reason_details(data)})
        else:
            raise validation_error({"action": ["Choose a valid action."]})
        dr.refresh_from_db()
        return Response(data_json(dr))

    @staticmethod
    def _start_export(request, dr):
        if dr.kind != "export" or dr.status not in ("pending", "failed"):
            raise ApiError("request_closed", "This request cannot be started.", 409)
        if dr.status == "failed":
            dr.status, dr.error = "pending", ""
            dr.save(update_fields=["status", "error"])
        ok = privacy.run_export(dr)
        dr.handled_by = request.user
        dr.save(update_fields=["handled_by"])
        services.log(request, "data_request.export_started", "data_request", dr.id, dr.user.email if dr.user_id else "", {"ok": bool(ok)})

    @staticmethod
    def _confirm_delete(request, dr, data):
        if dr.kind != "delete" or dr.status != "pending":
            raise ApiError("request_closed", "This request cannot be confirmed.", 409)
        typed = str(data.get("typed") or "").strip().lower()
        expected = (dr.workspace.name if dr.scope == "workspace" and dr.workspace_id else dr.user.email if dr.user_id else "").strip().lower()
        if not expected or typed != expected:
            raise validation_error({"typed": ["Type the exact name or e-mail shown to confirm."]})
        info = data_json(dr)
        if (dr.scope == "workspace" or info["owns_company_with_people"]) and data.get("ack_company") is not True:
            raise validation_error({"ack_company": ["Confirm that you know this erases a company that other people use."]})
        if dr.scope != "workspace" and dr.user_id:
            services.ensure_not_last_admin(dr.user, "none")
        label = expected
        if dr.scope == "workspace" and dr.workspace_id:
            privacy.purge_workspace(dr.workspace)
        elif dr.user_id:
            privacy.purge_user(dr.user)
        DataRequest.objects.filter(pk=dr.pk).update(status="completed", completed_at=timezone.now(), handled_by=request.user)
        services.log(request, "data_request.deleted", "data_request", dr.id, label, {"scope": dr.scope, **services.reason_details(data)})

