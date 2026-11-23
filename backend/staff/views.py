"""The staff API: who am I, two-step verification, the audit log, a read-only company list and staff roles."""
import math
from django.db.models import Q
from django.utils import timezone
from rest_framework.response import Response

from accounts.models import User
from billing.services import get_subscription, is_live, seats_used
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import request_language, translate_message
from ilaf.utils import iso
from workspaces.models import Workspace

from . import services
from .models import StaffAuditEvent
from .permissions import StaffView

ROLE_LABELS = {"read_only": "Read only", "support": "Support", "admin": "Admin"}


def _int(params, key, default, low, high):
    try:
        return max(low, min(high, int(params.get(key, default))))
    except (TypeError, ValueError):
        return default


def paged(request, qs, to_json, default_size=25):
    size = _int(request.query_params, "page_size", default_size, 1, 100)
    count = qs.count()
    pages = max(1, math.ceil(count / size))
    page = _int(request.query_params, "page", 1, 1, pages)
    return {
        "count": count, "page": page, "pages": pages, "page_size": size,
        "results": [to_json(row) for row in qs[(page - 1) * size: page * size]],
    }


def staff_json(user):
    return {
        "id": str(user.id), "email": user.email, "full_name": user.full_name, "staff_role": user.staff_role,
        "totp_enrolled": services.is_enrolled(user), "is_active": user.is_active,
    }


# ---------------------------------------------------------------- who am I (first step is enough)
class MeView(StaffView):
    second_step = False

    def get(self, request):
        session = services.session_for(request.user, request.META.get("HTTP_X_STAFF_TOKEN", ""))
        return Response({
            **staff_json(request.user),
            "verified": session is not None,
            "verified_until": iso(session.expires_at) if session else None,
            "recovery_codes_left": services.recovery_codes_left(request.user),
            "roles": {key: label for key, label in ROLE_LABELS.items()},
        })


# ---------------------------------------------------------------- two-step verification
class EnrolView(StaffView):
    """Start enrolling an authenticator app: returns the secret and the otpauth address for the QR code."""

    second_step = False
    write_roles = ("read_only", "support", "admin")  # setting up one's own second step is not a data change

    def post(self, request):
        row = services.begin_enrolment(request.user)
        if row is None:
            raise ApiError("already_enrolled", "Two-step verification is already set up for this account.", 409)
        services.log(request, "staff.totp_enrol_started", "user", request.user.id, request.user.email)
        return Response(services.enrolment_payload(row, request.user), status=201)


class ConfirmView(StaffView):
    """Finish enrolling with the first code. Returns ten recovery codes (shown once) and a staff session."""

    second_step = False
    write_roles = ("read_only", "support", "admin")

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            ok = services.check_code(request.user, data.get("code"), confirm=True)
        except services.Locked as locked:
            raise ApiError("staff_locked", "Too many wrong codes. Try again later.", 429) from locked
        if not ok:
            services.log(request, "staff.totp_confirm_failed", "user", request.user.id, request.user.email)
            raise validation_error({"code": ["That code is not right. Check the time on your phone and try again."]})
        codes = services.make_recovery_codes(request.user)
        token, session = services.start_session(request, request.user)
        services.log(request, "staff.totp_enrolled", "user", request.user.id, request.user.email)
        return Response({"recovery_codes": codes, "token": token, "expires_at": iso(session.expires_at)})


class VerifyView(StaffView):
    """The second step after sign-in: an authenticator code or a recovery code opens a 12 hour staff session."""

    second_step = False
    write_roles = ("read_only", "support", "admin")

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        if not services.is_enrolled(request.user):
            raise ApiError("totp_not_enrolled", "Set up two-step verification first.", 409)
        recovery = str(data.get("recovery_code") or "").strip()
        try:
            if recovery:
                ok = services.use_recovery_code(request.user, recovery)
                method = "recovery"
            else:
                ok = services.check_code(request.user, data.get("code"))
                method = "totp"
        except services.Locked as locked:
            raise ApiError("staff_locked", "Too many wrong codes. Try again later.", 429) from locked
        if not ok:
            services.log(request, "staff.verify_failed", "user", request.user.id, request.user.email, {"method": method})
            raise validation_error({"code": ["That code is not right."]})
        token, session = services.start_session(request, request.user, method)
        services.log(request, "staff.verified", "user", request.user.id, request.user.email, {"method": method})
        return Response({
            "token": token, "expires_at": iso(session.expires_at), "method": method,
            "recovery_codes_left": services.recovery_codes_left(request.user),
        })


class RecoveryCodesView(StaffView):
    """Ten new recovery codes (the old ones stop working)."""

    write_roles = ("read_only", "support", "admin")

    def post(self, request):
        codes = services.make_recovery_codes(request.user)
        services.log(request, "staff.recovery_codes_renewed", "user", request.user.id, request.user.email)
        return Response({"recovery_codes": codes})


class LogoutView(StaffView):
    second_step = False
    write_roles = ("read_only", "support", "admin")

    def post(self, request):
        session = services.session_for(request.user, request.META.get("HTTP_X_STAFF_TOKEN", ""))
        if session is not None:
            session.revoked_at = timezone.now()
            session.save(update_fields=["revoked_at"])
            services.log(request, "staff.session_ended", "user", request.user.id, request.user.email)
        return Response(status=204)


# ---------------------------------------------------------------- audit log
AUDIT_ACTIONS = {
    "staff.totp_enrol_started": "Started setting up two-step verification",
    "staff.totp_enrolled": "Finished setting up two-step verification",
    "staff.totp_confirm_failed": "Entered a wrong code while setting up two-step verification",
    "staff.verified": "Passed two-step verification",
    "staff.verify_failed": "Entered a wrong two-step code",
    "staff.recovery_codes_renewed": "Made new recovery codes",
    "staff.session_ended": "Signed out of the staff area",
    "staff.role_granted": "Gave someone a staff role",
    "staff.role_changed": "Changed a staff role",
    "staff.role_removed": "Removed a staff role",
    "staff.totp_reset": "Reset someone's two-step verification",
    "design_request.viewed": "Opened a design request",
    "design_request.reply": "Replied on a design request",
    "design_request.note": "Added an internal note",
    "design_request.status": "Changed the status of a design request",
    "design_request.assigned": "Assigned a design request",
    "design_request.file_downloaded": "Downloaded a file of a design request",
    "face.created": "Created a custom face",
    "face.saved": "Saved a custom face",
    "face.version_restored": "Restored an earlier version of a custom face",
    "face.sent_for_review": "Sent a custom face for review",
    "face.published": "Published a custom face to the company",
    "face.disabled": "Disabled a custom face",
    "face.enabled": "Enabled a custom face again",
    "face.preview_revoked": "Revoked a preview link",
    "staff.ip_changed": "Used a staff session from a new network address",
    "staff.unlabelled_write": "Made a change that was not described (should not happen)",
    "staff.invited": "Invited someone to the staff",
    "staff.sessions_revoked": "Ended all staff sessions of someone",
    "company.suspended": "Suspended a company",
    "company.restored": "Restored a company",
    "company.note_added": "Added an internal note to a company",
    "company.bulk": "Ran a bulk action on companies",
    "card.suspended": "Suspended a card",
    "card.restored": "Restored a card",
    "support_view.started": "Started a support view",
    "support_view.ended": "Ended a support view",
    "abuse.note": "Added a note to a card report",
    "abuse.reviewing": "Started looking at a card report",
    "abuse.assign": "Assigned a card report",
    "abuse.dismiss": "Dismissed a card report",
    "abuse.warn": "Warned the owner about a reported card",
    "abuse.suspend_card": "Suspended a reported card",
    "abuse.suspend_company": "Suspended a company after a card report",
    "data_request.export_started": "Started a data export",
    "data_request.deleted": "Confirmed and ran a data deletion",
    "data_request.done": "Marked a data request as done",
    "user.signed_out": "Signed a customer out everywhere",
    "application.updated": "Updated an application",
    "announcement.created": "Created an announcement",
    "announcement.previewed": "Previewed an announcement audience",
    "announcement.cancelled": "Cancelled an announcement",
    "analytics.exported": "Downloaded the analytics CSV",
    "audit.exported": "Downloaded the audit log CSV",
    "flag.changed": "Changed a feature switch",
    "plan.granted": "Granted a free plan period",
    "email.resent": "Sent a failed e-mail again",
}

# The groups of the audit log filter: a label and the action prefixes it covers.
AUDIT_CATEGORIES = {
    "support_view": ("Support view", ("support_view.",)),
    "abuse": ("Abuse", ("abuse.",)),
    "card": ("Card", ("card.",)),
    "company": ("Company", ("company.",)),
    "data": ("Data request", ("data_request.", "user.")),
    "flag": ("Feature switch", ("flag.",)),
    "plan": ("Plan", ("plan.",)),
    "staff": ("Staff", ("staff.",)),
    "announcement": ("Announcement", ("announcement.",)),
    "design": ("Design", ("design_request.", "face.")),
}


def audit_json(e, lang="en"):
    return {
        "id": str(e.id), "actor_email": e.actor_email, "actor_role": e.actor_role, "action": e.action,
        "label": translate_message(lang, AUDIT_ACTIONS.get(e.action, e.action)), "target_type": e.target_type, "target_id": e.target_id,
        "target_label": e.target_label, "details": e.details, "ip_hash": e.ip_hash, "created_at": iso(e.created_at),
    }


def filtered_audit(params):
    """The audit events a request asks for. Filters: action, category, role, actor, q, from, to (days, UTC)."""
    from datetime import datetime, time, timedelta, timezone as tz

    from django.utils.dateparse import parse_date

    qs = StaffAuditEvent.objects.all()
    if params.get("action"):
        qs = qs.filter(action=params["action"])
    category = AUDIT_CATEGORIES.get(params.get("category", ""))
    if category:
        cond = Q()
        for prefix in category[1]:
            cond |= Q(action__startswith=prefix)
        qs = qs.filter(cond)
    if params.get("role") in ("read_only", "support", "admin"):
        qs = qs.filter(actor_role=params["role"])
    if params.get("actor"):
        qs = qs.filter(actor_email__icontains=params["actor"][:100])
    if params.get("q"):
        term = params["q"][:100]
        qs = qs.filter(Q(target_label__icontains=term) | Q(actor_email__icontains=term) | Q(target_id__icontains=term))
    for key, field in (("from", "created_at__gte"), ("to", "created_at__lt")):
        day = parse_date(params.get(key) or "") if params.get(key) else None
        if day is not None:
            qs = qs.filter(**{field: datetime.combine(day + (timedelta(days=1) if key == "to" else timedelta()), time.min, tz.utc)})
    return qs


class AuditView(StaffView):
    perm = "view"

    def get(self, request):
        qs = filtered_audit(request.query_params)
        lang = request_language(request)
        body = paged(request, qs, lambda e: audit_json(e, lang), 50)
        body["actions"] = [{"key": k, "label": translate_message(lang, v)} for k, v in AUDIT_ACTIONS.items()]
        body["categories"] = [{"key": k, "label": label} for k, (label, _p) in AUDIT_CATEGORIES.items()]
        return Response(body)


# ---------------------------------------------------------------- companies (read only)
def company_status(workspace):
    if workspace.suspended_at is not None:
        return "suspended"
    if workspace.deletion_due_at is not None:
        return "deletion_pending"
    sub = get_subscription(workspace)
    if sub is None:
        return "no_plan"
    if is_live(workspace):
        return "active"
    return "expired" if sub.status == "active" else sub.status


def company_json(workspace, open_requests=0):
    sub = get_subscription(workspace)
    owner = workspace.members.filter(role="owner").first()
    return {
        "id": str(workspace.id), "name": workspace.name,
        "country": workspace.country or "",
        "plan": sub.plan.name if sub else None,
        "seats_used": seats_used(workspace), "seats_total": sub.seats_total if sub else 0,
        "status": company_status(workspace),
        "owner_email": owner.email if owner else "",
        "open_design_requests": open_requests,
        "created_at": iso(workspace.created_at),
    }


class CompaniesView(StaffView):
    def get(self, request):
        from designs.models import DesignRequest

        qs = Workspace.objects.filter(kind="company", deleted_at__isnull=True).order_by("name", "id")
        term = (request.query_params.get("q") or "").strip()[:100]
        if term:
            qs = qs.filter(Q(name__icontains=term) | Q(members__email__icontains=term, members__role="owner")).distinct()
        open_counts = {}
        for row in DesignRequest.objects.filter(status__in=DesignRequest.OPEN).values("workspace_id").order_by():
            open_counts[row["workspace_id"]] = open_counts.get(row["workspace_id"], 0) + 1
        return Response(paged(request, qs, lambda w: company_json(w, open_counts.get(w.id, 0))))


# ---------------------------------------------------------------- staff roles
class MembersView(StaffView):
    """The people who have a staff role. Only an admin gives, changes or removes roles."""

    def get(self, request):
        qs = User.objects.exclude(staff_role="none").order_by("email")
        return Response([staff_json(u) for u in qs])

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        email = str(data.get("email") or "").strip().lower()
        role = data.get("role")
        if role not in services.ROLES:
            raise validation_error({"role": ["Choose read_only, support or admin."]})
        user = User.objects.filter(email__iexact=email, is_active=True, deleted_at__isnull=True).first()
        if user is None:
            raise validation_error({"email": ["No account has this email address. Ask them to register first."]})
        previous = user.staff_role
        if previous == "admin" and role != "admin" and services.count_admins(exclude=user) == 0:
            raise ApiError("last_admin", "At least one staff admin is required.", 409)
        user.staff_role = role
        user.save(update_fields=["staff_role"])
        action = "staff.role_granted" if previous == "none" else "staff.role_changed"
        services.log(request, action, "user", user.id, user.email, {"from": previous, "to": role})
        return Response(staff_json(user), status=201 if previous == "none" else 200)


class MemberDetailView(StaffView):
    def _user(self, user_id):
        user = User.objects.filter(pk=user_id).exclude(staff_role="none").first()
        if user is None:
            from django.http import Http404

            raise Http404
        return user

    def patch(self, request, user_id):
        user = self._user(user_id)
        role = (request.data if isinstance(request.data, dict) else {}).get("role")
        if role not in services.ROLES:
            raise validation_error({"role": ["Choose read_only, support or admin."]})
        if user.staff_role == "admin" and role != "admin" and services.count_admins(exclude=user) == 0:
            raise ApiError("last_admin", "At least one staff admin is required.", 409)
        previous = user.staff_role
        user.staff_role = role
        user.save(update_fields=["staff_role"])
        services.end_sessions(user) if role != previous else None
        services.log(request, "staff.role_changed", "user", user.id, user.email, {"from": previous, "to": role})
        return Response(staff_json(user))

    def delete(self, request, user_id):
        user = self._user(user_id)
        if user.staff_role == "admin" and services.count_admins(exclude=user) == 0:
            raise ApiError("last_admin", "At least one staff admin is required.", 409)
        previous = user.staff_role
        user.staff_role = "none"
        user.save(update_fields=["staff_role"])
        services.end_sessions(user)
        services.log(request, "staff.role_removed", "user", user.id, user.email, {"from": previous})
        return Response(status=204)


class ResetTotpView(StaffView):
    """An admin resets someone's second step (a lost phone): they enrol again at their next visit."""

    def post(self, request, user_id):
        user = User.objects.filter(pk=user_id).exclude(staff_role="none").first()
        if user is None:
            from django.http import Http404

            raise Http404
        from .models import StaffRecoveryCode, StaffTotp

        StaffTotp.objects.filter(user=user).delete()
        StaffRecoveryCode.objects.filter(user=user).delete()
        services.end_sessions(user)
        services.log(request, "staff.totp_reset", "user", user.id, user.email)
        return Response(staff_json(user))
