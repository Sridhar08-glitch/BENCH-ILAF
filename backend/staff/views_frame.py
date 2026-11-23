"""What the staff frame and a few staff screens need on the side: menu counts, announcement pickers (audience count, e-mail
preview) and the Security tab (staff sessions, ending one session)."""
from django.http import Http404
from django.utils import timezone
from rest_framework.response import Response

from accounts.models import User
from ilaf.errors import ApiError, validation_error
from ilaf.utils import iso

from . import announce, services
from .models import Announcement, StaffSession, StaffTotp
from .perms_map import roles_for
from .permissions import StaffView
from .views_growth import _audience
from .views_overview import open_data_requests, open_reports


class CountsView(StaffView):
    """The numbers next to menu items: open abuse reports and open data requests. Two cheap counts, polled by the frame."""

    perm = "view"

    def get(self, request):
        return Response({"open_reports": open_reports().count(), "open_data_requests": open_data_requests().count()})


# ---------------------------------------------------------------- announcement pickers
class AnnouncementAudienceView(StaffView):
    """How many companies and people an audience reaches. Called while the audience is being picked, so it writes nothing."""

    perm = "announce"

    def get(self, request):
        params = request.query_params
        values = [v for v in (params.get("values") or "").split(",") if v.strip()]
        kind, values = _audience({"audience_kind": params.get("kind", "all"), "audience_values": values})
        email_kind = params.get("email_kind", "marketing")
        draft = Announcement(audience_kind=kind, audience_values=values, email_kind=email_kind if email_kind in ("marketing", "transactional") else "marketing")
        return Response({"companies": len(announce.audience_workspaces(draft)), "people": len(announce.audience_users(draft)), "label": announce.audience_label(draft)})


class AnnouncementEmailPreviewView(StaffView):
    """The announcement e-mail as a person receives it, rendered with the same template the broadcast uses."""

    perm = "announce"

    def get(self, request):
        params = request.query_params
        lang = "ar" if params.get("lang") == "ar" else "en"
        title, body = (params.get("title") or "").strip()[:120], (params.get("body") or "").strip()[:600]
        email_kind = params.get("email_kind", "marketing")
        if email_kind not in ("marketing", "transactional"):
            raise validation_error({"email_kind": ["Choose product update or service notice."]})
        return Response(announce.preview_email(title or "Title", body or "Text", email_kind, lang))


# ---------------------------------------------------------------- Security tab
def session_json(s, current_id, with_person=False):
    row = {
        "id": str(s.id), "device": s.device_label, "country": s.country, "method": s.method, "started_at": iso(s.created_at), "expires_at": iso(s.expires_at),
        "last_seen_at": iso(s.last_seen_at), "new_address_seen": bool(s.last_ip_hash), "current": str(s.id) == str(current_id),
    }
    if with_person:
        row["user_id"] = str(s.user_id)
        row["email"] = s.user.email
        row["full_name"] = s.user.full_name
    return row


def live_sessions():
    return StaffSession.objects.filter(revoked_at__isnull=True, expires_at__gt=timezone.now()).exclude(user__staff_role="none")


class SecurityView(StaffView):
    """The signed-in person's own staff sessions. An admin also gets the two-step state of every staff member and their sessions."""

    perm = "view"

    def get(self, request):
        current = getattr(request, "staff_session", None)
        current_id = current.id if current is not None else None
        mine = live_sessions().filter(user=request.user).order_by("-created_at")[:50]
        body = {"mine": [session_json(s, current_id) for s in mine], "everyone": None}
        if request.staff_role == "admin":
            people = list(User.objects.exclude(staff_role="none").order_by("email"))
            enrolled = set(StaffTotp.objects.filter(confirmed_at__isnull=False).values_list("user_id", flat=True))
            sessions = list(live_sessions().exclude(user=request.user).select_related("user").order_by("user__email", "-created_at")[:300])
            body["everyone"] = {
                "two_step": [{"id": str(u.id), "email": u.email, "full_name": u.full_name, "staff_role": u.staff_role, "enrolled": u.id in enrolled} for u in people],
                "sessions": [session_json(s, current_id, with_person=True) for s in sessions],
            }
        return Response(body)


class SecuritySessionRevokeView(StaffView):
    """End one staff session. Anyone ends their own; only an admin ends someone else's."""

    perm = "view"
    write_roles = ("read_only", "support", "admin")

    def post(self, request, session_id):
        session = StaffSession.objects.select_related("user").filter(pk=session_id).first()
        if session is None:
            raise Http404
        if session.user_id != request.user.id and request.staff_role not in roles_for("staff"):
            raise ApiError("forbidden", "Your staff role does not allow this action.", 403)
        ended = services.revoke_session(session)
        services.log(
            request, "staff.session_revoked", "user", session.user_id, session.user.email,
            {"session": str(session.id), "device": session.device_label, "own": session.user_id == request.user.id, "ended": ended, **services.reason_details(request.data)},
        )
        return Response({"revoked": 1 if ended else 0})
