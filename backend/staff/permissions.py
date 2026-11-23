"""Who may call the staff API.

Every staff view is an APIView with `permission_classes = [IsAuthenticated, StaffPermission]` (use `StaffView`).
Class attributes steer the check:

  second_step   True (default): the call also needs a valid X-Staff-Token from the two-step verification.
  write_roles   the roles allowed to use a method that is not GET/HEAD/OPTIONS. The default is admin only;
                read_only people can never write.
  perm          a key of staff.perms_map.PERMISSIONS: the roles that do not have it cannot use the view at all (not even
                to look). Views take write_roles from the same table with `roles_for(...)`.
  audit_exempt  True for a write that is not an action on customer data and is not logged (none today).

Every write that succeeds must leave a staff audit event (`services.log`). With `settings.STAFF_AUDIT_STRICT` on (the back
office tests turn it on) a write that left none is recorded as "staff.unlabelled_write", so a forgotten log line fails
the tests; it stays off in production because some staff writes are deliberately not logged (typing and presence pings).

A person without a staff role gets 404 so the staff API is not revealed to customers.
"""
from django.conf import settings
from django.http import Http404
from rest_framework.permissions import SAFE_METHODS, BasePermission, IsAuthenticated
from rest_framework.views import APIView

from ilaf.errors import ApiError

from . import perms_map, services

ALL_WRITERS = ("support", "admin")
ADMIN_ONLY = ("admin",)


class StaffPermission(BasePermission):
    def has_permission(self, request, view):
        role = services.role_of(request.user)
        if role == "none":
            raise Http404
        request.staff_role = role
        perm = getattr(view, "perm", None)
        if perm and role not in perms_map.roles_for(perm):
            raise ApiError("forbidden", "Your staff role does not allow this action.", 403)
        if request.method not in SAFE_METHODS and role not in getattr(view, "write_roles", ADMIN_ONLY):
            raise ApiError("forbidden", "Your staff role does not allow this action.", 403)
        request.staff_session = None
        if getattr(view, "second_step", True):
            token = request.META.get("HTTP_X_STAFF_TOKEN", "")
            session = services.session_for(request.user, token)
            if session is None:
                raise ApiError(
                    "staff_verification_required", "Confirm it is you with your authenticator code first.", 403
                )
            request.staff_session = session
            services.note_session_use(request, session)
        return True


class StaffView(APIView):
    permission_classes = [IsAuthenticated, StaffPermission]
    second_step = True
    write_roles = ADMIN_ONLY
    perm = None
    audit_exempt = False

    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if (
            getattr(settings, "STAFF_AUDIT_STRICT", False)
            and request.method not in SAFE_METHODS and response.status_code < 400 and not self.audit_exempt
            and getattr(request, "user", None) is not None and request.user.is_authenticated
            and not getattr(getattr(request, "_request", request), "staff_audited", False)
        ):
            services.log(request, "staff.unlabelled_write", "path", "", request.path[:200], {"method": request.method})
        return response
