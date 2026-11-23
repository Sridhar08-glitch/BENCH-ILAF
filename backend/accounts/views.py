import secrets
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.serializers import TokenRefreshSerializer
from rest_framework_simplejwt.tokens import RefreshToken

from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import SUPPORTED_LANGUAGES, from_accept_language, language_or_default, normalise_language, request_language, tr
from ilaf.throttles import ForgotThrottle, LoginThrottle, RegisterThrottle, ResetThrottle
from ilaf.utils import clean_line, file_url, iso, run_after_response
from security import services as security

from security.models import Session

from .models import PasswordResetToken, User
from .services import check_login_password, create_account, google_required_for, revoke_refresh_tokens, sign_in_blocker, tokens_for


def user_json(user, request):
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "photo_url": file_url(request, user.photo),
        "created_at": iso(user.created_at),
        "email_verified": user.email_verified,
        "has_password": user.has_usable_password(),
        "google_linked": bool(user.google_sub),
        "google_email": user.google_email or None,
        "language": user.language or None,
        "product_updates": user.product_updates,
        "two_factor": security.two_factor_status(user),
    }


def check_password_rules(password, field="password"):
    try:
        validate_password(password)
    except DjangoValidationError as exc:
        raise validation_error({field: list(exc.messages)})


class RegisterSerializer(serializers.Serializer):
    email = serializers.EmailField(max_length=254)
    password = serializers.CharField(max_length=128, trim_whitespace=False)
    full_name = serializers.CharField(max_length=120)
    language = serializers.ChoiceField(choices=["", "en", "ar"], required=False, default="")

    def validate_full_name(self, value):
        value = clean_line(value, 120)
        if not value:
            raise ValidationError("Enter your name.")
        return value


class RegisterView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [RegisterThrottle]

    def post(self, request):
        ser = RegisterSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        email = data["email"].strip().lower()
        check_password_rules(data["password"])
        if User.objects.filter(email__iexact=email).exists():
            raise ApiError("email_taken", "An account with this email already exists.", 409)
        try:
            user = create_account(email, data["password"], data["full_name"], language=data["language"] or from_accept_language(request.META.get("HTTP_X_LANGUAGE")) or "")
        except IntegrityError:
            raise ApiError("email_taken", "An account with this email already exists.", 409)
        return Response({"user": user_json(user, request), **tokens_for(user, request)}, status=201)


class LoginView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        email = str(data.get("email") or "").strip().lower()
        password = str(data.get("password") or "")
        user = User.objects.filter(email__iexact=email).first() if email else None
        if not check_login_password(user, password):
            raise ApiError("invalid_credentials", "Email or password is not correct.", 401)
        # Only someone who knows the password learns that the account is disabled or scheduled for deletion.
        blocker = sign_in_blocker(user)
        if blocker is not None:
            raise blocker
        if google_required_for(user):
            raise ApiError(
                "google_signin_required",
                "Your company requires you to sign in with Google. Use the Continue with Google button.",
                403,
            )
        gate = security.sign_in_gate(request, user, "password", data)
        if gate is not None:
            return Response(gate)
        return Response({"user": user_json(user, request), **tokens_for(user, request)})


class RefreshView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        ser = TokenRefreshSerializer(data={"refresh": data.get("refresh") or ""})
        try:
            ser.is_valid(raise_exception=True)
        except (TokenError, ValidationError, Exception) as exc:
            if isinstance(exc, ApiError):
                raise
            raise ApiError("unauthorized", "Your session has expired. Please sign in again.", 401)
        security.touch_session(ser.validated_data["refresh"])
        return Response({"access": ser.validated_data["access"], "refresh": ser.validated_data["refresh"]})


class MeView(APIView):
    def get(self, request):
        return Response(user_json(request.user, request))

    def patch(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        if "full_name" in data:
            try:
                name = clean_line(str(data["full_name"] or ""), 120)
            except ValidationError as exc:
                raise validation_error({"full_name": [str(m) for m in exc.detail]})
            if not name:
                raise validation_error({"full_name": ["Enter your name."]})
            request.user.full_name = name
            request.user.save(update_fields=["full_name"])
        if "language" in data:
            raw = data["language"]
            if raw in (None, ""):
                code = ""  # back to "not chosen": the web app follows the browser again
            else:
                code = raw.strip().lower() if isinstance(raw, str) else ""
                if code not in SUPPORTED_LANGUAGES:
                    raise validation_error({"language": ["Choose one of the available languages."]})
            request.user.language = code
            request.user.save(update_fields=["language"])
        if "product_updates" in data:
            if not isinstance(data["product_updates"], bool):
                raise validation_error({"product_updates": ["Choose yes or no."]})
            request.user.product_updates = data["product_updates"]
            request.user.save(update_fields=["product_updates"])
        return Response(user_json(request.user, request))


class ForgotPasswordView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ForgotThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        email = str(data.get("email") or "").strip().lower()
        user = User.objects.filter(email__iexact=email, is_active=True).first() if email else None
        if user is not None:
            token = secrets.token_urlsafe(32)
            # Only the newest link works: older unused ones are retired when a new one is issued.
            PasswordResetToken.objects.filter(user=user, used_at__isnull=True).update(used_at=timezone.now())
            PasswordResetToken.objects.create(user=user, token_hash=PasswordResetToken.hash_token(token))
            lang = normalise_language(user.language) or request_language(request)
            # The mail goes out after the answer, so asking for an address that has no account takes as long.
            run_after_response(
                send_brand_email,
                user.email,
                tr(lang, "Reset your {product} password", product=settings.PRODUCT_NAME),
                tr(lang, "Reset your password"),
                [
                    tr(lang, "We received a request to reset your password. This link works for {hours} hours.",
                       hours=settings.PASSWORD_RESET_LIFETIME_HOURS),
                    tr(lang, "If you did not ask for this, you can ignore this email."),
                ],
                tr(lang, "Choose a new password"),
                f"{settings.WEB_BASE_URL}/reset/{token}",
                lang=lang,
            )
        else:
            PasswordResetToken.hash_token(secrets.token_urlsafe(32))  # same token work as the real path
        return Response(status=204)  # Always 204 so the answer never reveals which emails have accounts.


class ResetPasswordView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [ResetThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        token = str(data.get("token") or "")
        password = str(data.get("password") or "")
        record = (
            PasswordResetToken.objects.select_related("user")
            .filter(token_hash=PasswordResetToken.hash_token(token), used_at__isnull=True).first()
            if token else None
        )
        expiry = timedelta(hours=settings.PASSWORD_RESET_LIFETIME_HOURS)
        if record is None or timezone.now() - record.created_at > expiry:
            raise validation_error({"token": ["This reset link is invalid or has expired."]})
        check_password_rules(password)
        with transaction.atomic():
            record.user.set_password(password)
            record.user.email_verified = True  # the reset link went to this address
            record.user.save(update_fields=["password", "email_verified"])
            PasswordResetToken.objects.filter(user=record.user, used_at__isnull=True).update(used_at=timezone.now())
            revoke_refresh_tokens(record.user)  # whoever held the old password is signed out everywhere
        return Response(status=204)


class ChangePasswordView(APIView):
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        if not request.user.check_password(str(data.get("old_password") or "")):
            raise validation_error({"old_password": ["Your current password is not correct."]})
        check_password_rules(str(data.get("new_password") or ""), "new_password")
        with transaction.atomic():
            request.user.set_password(data["new_password"])
            request.user.save(update_fields=["password"])
            revoke_refresh_tokens(request.user)
        # Every other session is signed out; this one gets fresh tokens so the person stays signed in here.
        return Response(tokens_for(request.user, request))


class LogoutView(APIView):
    """End this session: the refresh token in the body stops working. Always answers 204 (it is safe to call twice)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [LoginThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        try:
            token = RefreshToken(str(data.get("refresh") or ""))
            token.blacklist()
            if token.get("sid"):
                Session.objects.filter(pk=token["sid"]).delete()
        except Exception:
            pass  # expired, malformed or already revoked: nothing is left to revoke
        return Response(status=204)


class LogoutEverywhereView(APIView):
    """Sign out every device: all refresh tokens of the signed-in person are revoked (the current access token
    lasts until it expires, at most an hour)."""

    def post(self, request):
        count = revoke_refresh_tokens(request.user)
        return Response({"revoked": count})
