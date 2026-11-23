"""Sign in with Google, linking and unlinking it, setting a first password, restoring a scheduled deletion."""
from django.db import IntegrityError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError
from ilaf.throttles import GoogleAuthThrottle, InviteAcceptThrottle, LoginThrottle, UserApiThrottle

from . import google
from .models import User
from .services import (
    check_login_password, create_account, domain_allowed, google_required_for, require_recent_auth, sign_in_blocker, tokens_for,
)
from .views import check_password_rules, user_json
from security import services as security


def _credential(request):
    data = request.data if isinstance(request.data, dict) else {}
    return data.get("credential") or data.get("id_token") or ""


def resolve_google_user(claims, create=True):
    """Find the account for a verified Google identity, link it by verified e-mail, or create it.

    Rules: the stable Google id wins; else an account with the same address is linked only when
    that address was proven before (otherwise anyone could pre-register a victim's address and
    wait); else a new account without a password is created."""
    sub, email = claims["sub"], claims["email"]
    user = User.objects.filter(google_sub=sub).first()
    if user is not None:
        return user, False
    user = User.objects.filter(email__iexact=email, deleted_at__isnull=True).first()
    if user is not None:
        if not user.email_verified:
            raise ApiError(
                "account_exists_unverified",
                "An account with this email already exists. Sign in with your password, then connect Google in Settings.",
                409,
            )
        if user.google_sub and user.google_sub != sub:
            raise ApiError("google_account_mismatch", "A different Google account is already linked to this account.", 409)
        user.google_sub = sub
        user.google_email = email
        user.save(update_fields=["google_sub", "google_email"])
        return user, False
    if not create:
        raise ApiError("not_found", "Not found.", 404)
    try:
        user = create_account(
            email, None, claims["name"] or email.split("@")[0].title(),
            email_verified=True, google_sub=sub, google_email=email,
        )
    except IntegrityError:  # two sign-ins at once: the other one won, use its account
        return resolve_google_user(claims, create=False)
    return user, True


class GoogleLoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [GoogleAuthThrottle]

    def post(self, request):
        claims = google.verify_id_token(_credential(request))
        user, created = resolve_google_user(claims)
        blocker = sign_in_blocker(user)
        if blocker is not None:
            raise blocker
        gate = security.sign_in_gate(request, user, "google", request.data)
        if gate is not None:
            return Response(gate)
        return Response({"user": user_json(user, request), **tokens_for(user, request, "google")}, status=201 if created else 200)


class GoogleLinkView(APIView):
    throttle_classes = [GoogleAuthThrottle, UserApiThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        # The Google credential proves the new Google account; the person behind this session must be proven too.
        require_recent_auth(request, {"password": data.get("password")})
        claims = google.verify_id_token(_credential(request))
        user = request.user
        other = User.objects.filter(google_sub=claims["sub"]).exclude(pk=user.pk).exists()
        if other:
            raise ApiError("google_in_use", "That Google account is already linked to another account.", 409)
        if user.google_sub and user.google_sub != claims["sub"]:
            raise ApiError("google_already_linked", "A different Google account is already linked. Remove it first.", 409)
        user.google_sub = claims["sub"]
        user.google_email = claims["email"]
        fields = ["google_sub", "google_email"]
        if claims["email"] == user.email and not user.email_verified:
            user.email_verified = True  # Google has proven the address
            fields.append("email_verified")
        user.save(update_fields=fields)
        return Response(user_json(user, request))


class GoogleUnlinkView(APIView):
    def post(self, request):
        require_recent_auth(request, request.data)
        user = request.user
        if not user.google_sub:
            raise ApiError("not_linked", "No Google account is linked.", 409)
        if not user.has_usable_password():
            raise ApiError(
                "no_other_sign_in", "Set a password first, so you can still sign in after Google is removed.", 409
            )
        if google_required_for(user):
            raise ApiError(
                "google_signin_required", "Your company requires Google sign-in, so it cannot be removed.", 403
            )
        user.google_sub = None
        user.google_email = ""
        user.save(update_fields=["google_sub", "google_email"])
        return Response(user_json(user, request))


class SetPasswordView(APIView):
    """A first password for an account that so far only signs in with Google."""

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        if request.user.has_usable_password():
            raise ApiError("password_exists", "This account already has a password. Use Change password.", 409)
        # No password to re-enter: a Google sign-in from the last ten minutes (the session's own, or `credential`).
        require_recent_auth(request, {"credential": data.get("credential")})
        password = str(data.get("new_password") or "")
        check_password_rules(password, "new_password")
        request.user.set_password(password)
        request.user.save(update_fields=["password"])
        return Response(status=204)


class RestoreAccountView(APIView):
    """Bring back an account that is inside its deletion grace period.

    Proof is the e-mailed link (`token`), or the account's password, or a fresh Google sign-in."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        from privacy import services

        data = request.data if isinstance(request.data, dict) else {}
        user = None
        if data.get("token"):
            user = services.user_from_restore_token(str(data["token"]))
        elif data.get("credential") or data.get("id_token"):
            claims = google.verify_id_token(_credential(request))
            user = User.objects.filter(google_sub=claims["sub"]).first()
        else:
            email = str(data.get("email") or "").strip().lower()
            candidate = User.objects.filter(email__iexact=email).first() if email else None
            if check_login_password(candidate, str(data.get("password") or "")):
                user = candidate
                if google_required_for(user):  # the company's Google-only rule holds here too
                    raise ApiError(
                        "google_signin_required",
                        "Your company requires you to sign in with Google. Use the Continue with Google button.", 403,
                    )
        if user is None:
            raise ApiError("invalid_credentials", "We could not confirm that. Check the details and try again.", 401)
        services.restore_account(user, request)
        # The e-mailed restore link proves the mailbox, like a reset link; a password or Google proof still needs the second step.
        gate = None if data.get("token") else security.sign_in_gate(request, user, "password", data)
        if gate is not None:
            return Response(gate)
        return Response({"user": user_json(user, request), **tokens_for(user, request)})


class InviteAcceptGoogleView(APIView):
    """Accept a team invite with Google. The Google address must be the invited address, and the
    company's allowed e-mail domains apply."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [InviteAcceptThrottle]

    def post(self, request, token=None):
        from workspaces.services import accept_member
        from workspaces.views import InviteLookupView, _body_token

        member = InviteLookupView.get_member(token or _body_token(request))
        claims = google.verify_id_token(_credential(request))
        if claims["email"] != member.email.lower():
            raise ApiError(
                "invite_email_mismatch",
                f"This invitation is for {member.email}. Sign in with that Google account.",
                403,
            )
        if not domain_allowed(member.workspace, claims["email"]):
            raise ApiError("domain_not_allowed", "Your email domain is not allowed to join this company.", 403)
        user, _ = resolve_google_user(claims)
        blocker = sign_in_blocker(user)
        if blocker is not None:
            raise blocker
        accept_member(member, user, "")
        gate = security.sign_in_gate(request, user, "google", request.data)
        if gate is not None:
            return Response({**gate, "workspace_id": str(member.workspace_id)})
        return Response({**tokens_for(user, request, "google"), "workspace_id": str(member.workspace_id)})
