"""Two-step verification (authenticator app + recovery codes) and the list of signed-in devices."""
from django.shortcuts import get_object_or_404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.services import confirm_identity, require_recent_auth, sign_in_blocker, tokens_for
from ilaf.errors import ApiError, validation_error
from ilaf.throttles import LoginThrottle, UserApiThrottle
from ilaf.utils import iso

from . import services
from .models import Session, TrustedDevice


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


def status_json(user):
    return {
        **services.two_factor_status(user),
        "recovery_codes_left": services.recovery_codes_left(user) if services.is_enabled(user) else 0,
        "trusted_devices": TrustedDevice.objects.filter(user=user).count(),
    }


class TwoFactorStatusView(APIView):
    def get(self, request):
        return Response(status_json(request.user))


class TwoFactorSetupView(APIView):
    """Start turning two-step verification on: a new secret (and the otpauth address for the QR code)."""

    throttle_classes = [UserApiThrottle]

    def post(self, request):
        require_recent_auth(request, _body(request))
        row = services.begin_enrolment(request.user)
        if row is None:
            raise ApiError("two_factor_already_on", "2-step verification is already on.", 409)
        return Response(services.enrolment_payload(row, request.user), status=201)


class TwoFactorConfirmView(APIView):
    """Finish with the first code from the authenticator app. Answers with ten recovery codes, shown only this once."""

    def post(self, request):
        user = request.user
        if services.is_enabled(user):
            raise ApiError("two_factor_already_on", "2-step verification is already on.", 409)
        if not services.UserTotp.objects.filter(user=user).exists():
            raise ApiError("two_factor_not_started", "Start setting up 2-step verification first.", 409)
        if not services.check_code(user, _body(request).get("code"), confirm=True):
            raise ApiError("invalid_two_factor_code", "That code is not correct. Check the code and try again.", 400)
        codes = services.make_recovery_codes(user)
        services.record(user, "2fa_on", request)
        services.mail_two_factor_changed(request, user, True)
        return Response({"recovery_codes": codes, **status_json(user)})


class RecoveryCodesView(APIView):
    """Ten new recovery codes (the old ones stop working). Needs a current authenticator code."""

    def post(self, request):
        user = request.user
        if not services.is_enabled(user):
            raise ApiError("two_factor_not_enabled", "2-step verification is not turned on.", 409)
        if not services.check_code(user, _body(request).get("code")):
            raise ApiError("invalid_two_factor_code", "That code is not correct. Check the code and try again.", 400)
        codes = services.make_recovery_codes(user)
        services.record(user, "recovery_codes_renewed", request)
        return Response({"recovery_codes": codes, **status_json(user)})


class TwoFactorDisableView(APIView):
    """Turn it off. Needs the password (or a fresh Google sign-in) and a code."""

    def post(self, request):
        user = request.user
        data = _body(request)
        if not services.is_enabled(user):
            raise ApiError("two_factor_not_enabled", "2-step verification is not turned on.", 409)
        confirm_identity(user, data)
        services.verify_second_step(user, data)
        requirement = services.requirement_for(user)
        if requirement is not None:
            raise ApiError(
                "two_factor_required_by_company",
                "Your company requires 2-step verification, so it cannot be turned off.", 403,
            )
        services.disable(user)
        services.record(user, "2fa_off", request)
        services.mail_two_factor_changed(request, user, False)
        return Response(status_json(user))


class LoginMfaView(APIView):
    """The second step of a sign-in: the `mfa_token` from login (or Google sign-in) plus an authenticator code or a
    recovery code. Answers like a finished login; `remember_device` also returns a `device_token` for 30 days."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        from accounts.views import user_json

        data = _body(request)
        user, method = services.read_mfa_token(data.get("mfa_token"))
        blocker = sign_in_blocker(user)
        if blocker is not None:
            raise blocker
        used = services.verify_second_step(user, data)
        answer = {"user": user_json(user, request), **tokens_for(user, request, method)}
        if used == "recovery":
            answer["recovery_codes_left"] = services.recovery_codes_left(user)
            services.record(user, "recovery_used", request)
        if data.get("remember_device") is True:
            answer["device_token"] = services.trust_device(request, user)
        return Response(answer)


# ---------------------------------------------------------------- devices
def session_json(session, current_sid):
    return {
        "id": str(session.id),
        "label": session.label or None,
        "kind": session.device_kind or "other",
        "ip": session.ip_masked or None,
        "country": session.country or None,
        "created_at": iso(session.created_at),
        "last_used_at": iso(session.last_used_at),
        "current": str(session.id) == current_sid,
    }


class DevicesView(APIView):
    def get(self, request):
        current = services.session_id_of(request)
        sessions = Session.objects.filter(user=request.user)
        return Response({
            "current_session_id": current,
            "sessions": [session_json(s, current) for s in sessions],
            "trusted_devices": [
                {"id": str(d.id), "label": d.label or None, "created_at": iso(d.created_at),
                 "last_used_at": iso(d.last_used_at), "expires_at": iso(d.expires_at)}
                for d in TrustedDevice.objects.filter(user=request.user)
            ],
            "events": [
                {"action": e.action, "detail": e.detail, "ip": e.ip_masked or None, "created_at": iso(e.created_at)}
                for e in request.user.security_events.all()[:20]
            ],
        })


class DeviceDetailView(APIView):
    """Sign one other device out."""

    def delete(self, request, session_id):
        session = get_object_or_404(Session, pk=session_id, user=request.user)
        if str(session.id) == services.session_id_of(request):
            raise ApiError("current_session", "This is the device you are using now. Use Sign out instead.", 400)
        services.end_session(session)
        services.record(request.user, "device_signed_out", request, session.label)
        return Response(status=204)


class SignOutOthersView(APIView):
    """Sign out every device except this one (the same effect on refresh tokens as signing out everywhere)."""

    throttle_classes = [UserApiThrottle]

    def post(self, request):
        current = services.session_id_of(request)
        if current is None or not Session.objects.filter(pk=current, user=request.user).exists():
            raise ApiError("current_session_unknown", "Sign in again to use this.", 409)
        count = services.end_other_sessions(request.user, current)
        services.record(request.user, "others_signed_out", request, str(count))
        return Response({"signed_out": count})


class TrustedDeviceDetailView(APIView):
    def delete(self, request, device_id):
        get_object_or_404(TrustedDevice, pk=device_id, user=request.user).delete()
        return Response(status=204)
