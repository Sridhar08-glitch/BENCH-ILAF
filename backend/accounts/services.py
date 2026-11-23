"""Account creation and sign-in rules shared by e-mail sign-up, Google sign-in and invites."""
import time

from django.conf import settings
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from ilaf.errors import ApiError
from workspaces.models import Member, Workspace

from .models import User


def tokens_for(user, request=None, method="password"):
    """A new pair of tokens for a sign-in. `auth_time` records when the person proved who they are (password,
    Google, invite or restore); it is carried through token refreshes and read by require_recent_auth.

    With a `request` the sign-in is also recorded as a signed-in device (security.Session) and its id rides in the
    tokens as `sid`, so the person can see and end it in Settings > Devices."""
    refresh = RefreshToken.for_user(user)
    refresh["auth_time"] = int(time.time())
    if request is not None:
        from security import services as security

        security.attach_session(refresh, security.start_session(request, user, method, jti=str(refresh["jti"])))
    return {"access": str(refresh.access_token), "refresh": str(refresh)}


MAX_LOGIN_PASSWORD_CHARS = 256


def burn_password_time(password):
    """Do the same expensive hashing work a real password check does. Used when there is no password to check
    (unknown address, Google-only account) so the answer takes as long as for a wrong password."""
    User().set_password(password[:MAX_LOGIN_PASSWORD_CHARS])


def check_login_password(user, password):
    """True when `password` is right for `user` (which may be None). Always costs one password hash, whatever the
    case, and overlong input is refused after that hash instead of being hashed in full."""
    if user is None or not user.has_usable_password():
        burn_password_time(password)
        return False
    if len(password) > MAX_LOGIN_PASSWORD_CHARS:
        burn_password_time(password)
        return False
    return user.check_password(password)


def revoke_refresh_tokens(user):
    """Blacklist every refresh token this user holds, so no session can be renewed any more. Access tokens that
    were already issued keep working until they expire (60 minutes at most). Returns how many were revoked."""
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    ids = list(
        OutstandingToken.objects.filter(user=user, blacklistedtoken__isnull=True).values_list("id", flat=True)
    )
    BlacklistedToken.objects.bulk_create([BlacklistedToken(token_id=pk) for pk in ids], ignore_conflicts=True)
    from security import services as security

    security.forget_all_sessions(user)  # the device list and the remembered browsers go with the tokens
    return len(ids)


def create_account(email, password, full_name, **extra):
    """Create a user with a personal workspace and an owner seat in it.

    `password=None` makes an account that can only sign in through Google until a password is set.
    """
    with transaction.atomic():
        user = User.objects.create_user(email, password, full_name=full_name, **extra)
        if password is None:
            user.set_unusable_password()
            user.save(update_fields=["password"])
        workspace = Workspace.objects.create(kind="personal", name=full_name or email, created_by=user)
        Member.objects.create(
            workspace=workspace, user=user, email=user.email, full_name=user.full_name,
            role="owner", status="active", joined_at=timezone.now(),
        )
    return user


def sign_in_blocker(user):
    """The ApiError that keeps a disabled account out, or None for an active one."""
    if user.is_active:
        return None
    if user.deletion_due_at and not user.deleted_at:
        err = ApiError(
            "account_scheduled_for_deletion",
            "This account is scheduled for deletion. You can restore it until the grace period ends.",
            403,
            {"restore_until": [user.deletion_due_at.isoformat().replace("+00:00", "Z")]},
        )
        return err
    return ApiError("account_suspended", "This account has been disabled. Please contact support.", 403)


def google_required_for(user):
    """True when a company that requires Google sign-in has this person on a non-owner seat."""
    return Member.objects.filter(
        user=user, status="active", workspace__require_google_signin=True, workspace__deleted_at__isnull=True,
    ).exclude(role="owner").exists()


def require_recent_auth(request, data=None):
    """Let a sensitive action through only when the person signed in within the last REAUTH_WINDOW_SECONDS (ten
    minutes), or proves who they are again in the request: `password`, or a fresh Google `credential` for accounts
    without a password. Otherwise 403 `reauth_required`."""
    token = getattr(request, "auth", None)
    try:
        auth_time = int(token.get("auth_time")) if token is not None and token.get("auth_time") is not None else None
    except (TypeError, ValueError, AttributeError):
        auth_time = None
    window = int(getattr(settings, "REAUTH_WINDOW_SECONDS", 600))
    if auth_time is not None and 0 <= time.time() - auth_time <= window:
        return
    data = data if isinstance(data, dict) else {}
    if not data.get("password") and not data.get("credential"):
        raise ApiError(
            "reauth_required", "For your security, confirm it is you: enter your password (or sign in again).", 403,
            {"password": ["Enter your password to confirm."]},
        )
    confirm_identity(request.user, data)


def email_domain(email):
    return email.rsplit("@", 1)[-1].strip().lower() if "@" in email else ""


def domain_allowed(workspace, email):
    """The company's e-mail domain rule: an empty list means everyone is welcome."""
    domains = workspace.allowed_email_domains or []
    return not domains or email_domain(email) in domains


RECENT_GOOGLE_SECONDS = 5 * 60


def confirm_identity(user, data):
    """Re-confirm the signed-in person before something serious: their password, or a Google
    sign-in made in the last five minutes (`credential`) when the account uses Google."""
    from .google import verify_id_token
    from ilaf.errors import validation_error

    password = data.get("password")
    credential = data.get("credential")
    if password:
        if not user.check_password(str(password)):
            raise validation_error({"password": ["That password is not correct."]})
        return
    if credential:
        claims = verify_id_token(str(credential), max_age=RECENT_GOOGLE_SECONDS)
        if not user.google_sub or claims["sub"] != user.google_sub:
            raise ApiError("google_account_mismatch", "That is not the Google account linked to this account.", 403)
        return
    if user.has_usable_password():
        raise validation_error({"password": ["Enter your password to confirm."]})
    raise ApiError("reauth_required", "Please sign in with Google again to confirm this.", 403)
