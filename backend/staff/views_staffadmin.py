"""Staff and permissions: the team table, invitations, session revocation, the permissions page and the audit CSV."""
from django.conf import settings
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from accounts.models import User
from ilaf.emails import send_brand_email
from ilaf.errors import validation_error
from ilaf.i18n import language_for_email, tr
from ilaf.utils import iso

from . import perms_map, services
from .common import csv_response
from .models import StaffSession
from .permissions import StaffView
from .views import AUDIT_ACTIONS, AUDIT_CATEGORIES, category_of, filtered_audit, staff_json


class PermissionsView(StaffView):
    """The permissions table the server enforces (the same table the views take their roles from)."""

    perm = "view"

    def get(self, request):
        return Response(perms_map.matrix())


def team_json(user):
    sessions = StaffSession.objects.filter(user=user).order_by("-created_at")
    now = timezone.now()
    live = [s for s in sessions[:30] if s.revoked_at is None and s.expires_at > now]
    last = sessions.first()
    return {
        **staff_json(user), "last_sign_in": iso(last.created_at) if last else None, "recovery_codes_left": services.recovery_codes_left(user),
        "sessions": [
            {"id": str(s.id), "method": s.method, "started_at": iso(s.created_at), "expires_at": iso(s.expires_at), "last_seen_at": iso(s.last_seen_at),
             "new_address_seen": bool(s.last_ip_hash), "device": s.device_label, "country": s.country}
            for s in live
        ],
    }


class StaffTeamView(StaffView):
    perm = "view"
    write_roles = perms_map.roles_for("staff")

    def get(self, request):
        return Response({"people": [team_json(u) for u in User.objects.exclude(staff_role="none").order_by("email")], "session_hours": services.SESSION_HOURS})

    def post(self, request):
        """Invite: an existing account gets the role at once; an unknown address gets an e-mail asking them to register first."""
        data = request.data if isinstance(request.data, dict) else {}
        email = str(data.get("email") or "").strip().lower()
        role = data.get("role")
        if role not in services.ROLES:
            raise validation_error({"role": ["Choose read_only, support or admin."]})
        if "@" not in email or len(email) > 254:
            raise validation_error({"email": ["Enter a valid e-mail address."]})
        user = User.objects.filter(email__iexact=email, is_active=True, deleted_at__isnull=True).first()
        if user is not None:
            previous = user.staff_role
            services.ensure_not_last_admin(user, role)
            user.staff_role = role
            user.save(update_fields=["staff_role"])
            services.log(request, "staff.role_granted" if previous == "none" else "staff.role_changed", "user", user.id, user.email, {"from": previous, "to": role, **services.reason_details(data)})
            return Response({"granted": True, "invited": False, "person": team_json(user)}, status=201)
        lang = language_for_email(email)
        send_brand_email(
            email, tr(lang, "You are invited to the {product} team", product=settings.PRODUCT_NAME), tr(lang, "Join the team"),
            [tr(lang, "You were invited to the staff of {product}. Create an account with this e-mail address, then ask an admin to give you your role.", product=settings.PRODUCT_NAME)],
            tr(lang, "Create an account"), f"{settings.WEB_BASE_URL}/register", lang=lang, kind="staff",
        )
        services.log(request, "staff.invited", "user", "", email, {"role": role, **services.reason_details(data)})
        return Response({"granted": False, "invited": True}, status=201)


class StaffSessionsRevokeView(StaffView):
    """Admin: end every staff session of one person (they sign in with their code again)."""

    perm = "view"
    write_roles = perms_map.roles_for("staff")

    def post(self, request, user_id):
        user = User.objects.filter(pk=user_id).exclude(staff_role="none").first()
        if user is None:
            raise Http404
        count = StaffSession.objects.filter(user=user, revoked_at__isnull=True, expires_at__gt=timezone.now()).count()
        services.end_sessions(user)
        services.log(request, "staff.sessions_revoked", "user", user.id, user.email, {"sessions": count, **services.reason_details(request.data)})
        return Response({"revoked": count})


class AuditExportView(StaffView):
    perm = "export"

    def get(self, request):
        rows = list(filtered_audit(request.query_params)[:5000])
        services.log(request, "audit.exported", "export", "", "Staff audit log", {"rows": len(rows)})
        return csv_response(
            "staff-audit-log.csv", ["Time (UTC)", "Person", "Role", "Category", "Action", "What", "Target", "Details"],
            [
                [iso(e.created_at), e.actor_email or "System", e.actor_role, AUDIT_CATEGORIES.get(category_of(e.action), ("",))[0], AUDIT_ACTIONS.get(e.action, e.action), e.target_type, e.target_label, e.details]
                for e in rows
            ],
        )

