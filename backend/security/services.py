"""Two-step verification for customer accounts, signed-in devices and the company two-step rule.

The authenticator maths (RFC 6238) is shared with the staff back office in ilaf.totp."""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.db import transaction
from django.utils import timezone
from rest_framework_simplejwt.tokens import RefreshToken

from ilaf import totp
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError
from ilaf.i18n import normalise_language, request_language, tr
from ilaf.utils import client_ip, run_after_response

from . import devices
from .models import KnownDevice, RecoveryCode, SecurityEvent, Session, TrustedDevice, UserTotp, WorkspacePolicy

MAX_FAILURES = 5
LOCK_MINUTES = 15
MFA_TOKEN_SECONDS = 5 * 60
TRUST_DAYS = 30
GRACE_DAYS = 7
MAX_TRUSTED_DEVICES = 10
SESSION_KEEP_DAYS = 31  # a little longer than a refresh token lives (30 days)
_MFA_SALT = "bench.mfa"


def _hash(prefix, value):
    return hashlib.sha256(f"{prefix}:{value}|{settings.SECRET_KEY}".encode("utf-8")).hexdigest()


def _lang(user, request=None):
    return normalise_language(user.language) or (request_language(request) if request is not None else "en")


def record(user, action, request=None, detail=""):
    return SecurityEvent.objects.create(
        user=user, action=action[:40], detail=detail[:200],
        ip_masked=devices.mask_ip(client_ip(request)) if request is not None else "",
    )


# ---------------------------------------------------------------- enrolment
def is_enabled(user):
    return UserTotp.objects.filter(user=user, confirmed_at__isnull=False).exists()


def begin_enrolment(user):
    """A fresh, unconfirmed secret. Returns None when two-step verification is already on."""
    row = UserTotp.objects.filter(user=user).first()
    if row is not None and row.confirmed_at is not None:
        return None
    secret = totp.new_secret()
    if row is None:
        return UserTotp.objects.create(user=user, secret=secret)
    row.secret = secret
    row.last_counter = 0
    row.failed_count = 0
    row.locked_until = None
    row.save(update_fields=["secret", "last_counter", "failed_count", "locked_until"])
    return row


def enrolment_payload(row, user):
    issuer = settings.PRODUCT_NAME
    uri = totp.otpauth_uri(row.secret, user.email, issuer)
    return {"secret": row.secret, "otpauth_uri": uri, "issuer": issuer, "account": user.email}


def make_recovery_codes(user):
    """Replace the recovery codes with ten new ones. The plain codes are returned once and never stored."""
    RecoveryCode.objects.filter(user=user).delete()
    plain = totp.new_recovery_codes()
    RecoveryCode.objects.bulk_create(
        [RecoveryCode(user=user, code_hash=_hash("recovery", totp.normalise_recovery_code(c))) for c in plain]
    )
    return plain


def recovery_codes_left(user):
    return RecoveryCode.objects.filter(user=user, used_at__isnull=True).count()


# ---------------------------------------------------------------- checking a code
def _check_lock(row):
    if row.locked_until and row.locked_until > timezone.now():
        raise ApiError(
            "two_factor_locked", "Too many wrong codes. Wait a few minutes and try again.", 429,
        )


def _fail(row):
    row.failed_count += 1
    if row.failed_count >= MAX_FAILURES:
        row.locked_until = timezone.now() + timedelta(minutes=LOCK_MINUTES)
        row.failed_count = 0
    row.save(update_fields=["failed_count", "locked_until"])


def check_code(user, code, confirm=False):
    """True when `code` is the right authenticator code. Five wrong codes in a row lock the check for a while.
    With `confirm` an enrolment that is not confirmed yet is accepted and becomes confirmed."""
    with transaction.atomic():
        row = UserTotp.objects.select_for_update().filter(user=user).first()
        if row is None or (row.confirmed_at is None and not confirm):
            return False
        _check_lock(row)
        step = totp.verify(row.secret, code, last_counter=row.last_counter)
        if step is None:
            _fail(row)
            return False
        row.last_counter = step
        row.failed_count = 0
        row.locked_until = None
        if confirm and row.confirmed_at is None:
            row.confirmed_at = timezone.now()
        row.save()
        return True


def use_recovery_code(user, code):
    with transaction.atomic():
        row = UserTotp.objects.select_for_update().filter(user=user, confirmed_at__isnull=False).first()
        if row is None:
            return False
        _check_lock(row)
        match = RecoveryCode.objects.select_for_update().filter(
            user=user, code_hash=_hash("recovery", totp.normalise_recovery_code(code)), used_at__isnull=True
        ).first()
        if match is None:
            _fail(row)
            return False
        match.used_at = timezone.now()
        match.save(update_fields=["used_at"])
        row.failed_count = 0
        row.save(update_fields=["failed_count"])
        return True


def verify_second_step(user, data):
    """Check the `code` or `recovery_code` of a request body. Returns "totp" or "recovery"; raises 400 when wrong."""
    data = data if isinstance(data, dict) else {}
    recovery = str(data.get("recovery_code") or "").strip()
    if recovery:
        if use_recovery_code(user, recovery):
            return "recovery"
    elif check_code(user, data.get("code")):
        return "totp"
    raise ApiError("invalid_two_factor_code", "That code is not correct. Check the code and try again.", 400)


def disable(user):
    UserTotp.objects.filter(user=user).delete()
    RecoveryCode.objects.filter(user=user).delete()
    TrustedDevice.objects.filter(user=user).delete()


# ---------------------------------------------------------------- the step between password and tokens
def make_mfa_token(user, method):
    return signing.dumps({"u": str(user.pk), "m": method, "n": secrets.token_hex(4)}, salt=_MFA_SALT)


def read_mfa_token(token):
    """(user, method) from a token made by `make_mfa_token`, or 401 when it is wrong or older than five minutes."""
    from accounts.models import User

    try:
        payload = signing.loads(str(token or ""), salt=_MFA_SALT, max_age=MFA_TOKEN_SECONDS)
        user = User.objects.get(pk=payload["u"])
    except Exception:
        raise ApiError("mfa_token_invalid", "This sign-in step has expired. Sign in again.", 401)
    return user, payload.get("m", "password")


def trust_device(request, user):
    """Remember this browser for TRUST_DAYS days. Returns the token the browser keeps (only its hash is stored)."""
    token = secrets.token_urlsafe(32)
    for old in TrustedDevice.objects.filter(user=user).order_by("-last_used_at")[MAX_TRUSTED_DEVICES - 1:]:
        old.delete()
    TrustedDevice.objects.create(
        user=user, token_hash=_hash("device", token), label=devices.describe(request)["label"],
        expires_at=timezone.now() + timedelta(days=TRUST_DAYS),
    )
    return token


def is_trusted_device(user, token):
    if not token or not isinstance(token, str) or len(token) > 200:
        return False
    row = TrustedDevice.objects.filter(user=user, token_hash=_hash("device", token), expires_at__gt=timezone.now()).first()
    if row is None:
        return False
    row.last_used_at = timezone.now()
    row.save(update_fields=["last_used_at"])
    return True


def sign_in_gate(request, user, method="password", data=None):
    """None when the person may be signed in now; otherwise the answer asking for the second step.

    Two-step verification is skipped for a browser that was remembered (`device_token` in the body)."""
    if not is_enabled(user):
        return None
    data = data if isinstance(data, dict) else {}
    if is_trusted_device(user, data.get("device_token")):
        return None
    return {"mfa_required": True, "mfa_token": make_mfa_token(user, method), "methods": ["totp", "recovery"]}


# ---------------------------------------------------------------- signed-in devices
def start_session(request, user, method="password", jti=""):
    """Record a sign-in. Returns the Session; sends the new-device e-mail the first time this kind of browser is seen."""
    info = devices.describe(request)
    fp = devices.fingerprint(user, devices.request_user_agent(request))
    session = Session.objects.create(
        user=user, refresh_jti=jti, label=info["label"], device_kind=info["kind"], fingerprint=fp,
        ip_masked=info["ip_masked"], country=info["country"], method=method[:12],
    )
    known, created = KnownDevice.objects.get_or_create(user=user, fingerprint=fp, defaults={"label": info["label"]})
    if created and KnownDevice.objects.filter(user=user).exclude(pk=known.pk).exists():
        _mail_new_device(request, user, info)
        record(user, "new_device", request, info["label"])
    return session


def _mail_new_device(request, user, info):
    lang = _lang(user, request)
    when = timezone.now().strftime("%Y-%m-%d %H:%M UTC")
    place = info["label"] or tr(lang, "an unknown device")
    if info["country"]:
        place = f"{place} ({info['country']})"
    run_after_response(
        send_brand_email,
        user.email,
        tr(lang, "New sign-in to your {product} account", product=settings.PRODUCT_NAME),
        tr(lang, "New sign-in from a new device"),
        [
            tr(lang, "Your account was signed in to from {device} at {when}.", device=place, when=when),
            tr(lang, "If this was you, you do not need to do anything. If it was not, change your password now and sign out all other devices in Settings."),
        ],
        tr(lang, "Review your devices"),
        f"{settings.WEB_BASE_URL}/app/settings/devices",
        lang=lang,
    )


def attach_session(refresh, session):
    """Put the session id into a refresh token (the access tokens made from it carry it too)."""
    refresh["sid"] = str(session.id)


def touch_session(refresh_token_string):
    """After a refresh-token rotation: remember the new refresh token's id and the time of use."""
    try:
        token = RefreshToken(refresh_token_string)
        sid = token.get("sid")
        jti = token.get("jti")
    except Exception:
        return
    if sid:
        Session.objects.filter(pk=sid).update(refresh_jti=jti or "", last_used_at=timezone.now())


def session_id_of(request):
    token = getattr(request, "auth", None)
    try:
        return str(token.get("sid")) if token is not None and token.get("sid") else None
    except (AttributeError, TypeError):
        return None


def _blacklist_jti(jti):
    from rest_framework_simplejwt.token_blacklist.models import BlacklistedToken, OutstandingToken

    for row in OutstandingToken.objects.filter(jti=jti):
        BlacklistedToken.objects.get_or_create(token=row)


def end_session(session):
    """Sign one device out: its refresh token stops working (its access token lasts until it expires, an hour at most)."""
    if session.refresh_jti:
        _blacklist_jti(session.refresh_jti)
    session.delete()


def end_other_sessions(user, keep_sid):
    count = 0
    for session in Session.objects.filter(user=user).exclude(pk=keep_sid):
        end_session(session)
        count += 1
    return count


def forget_all_sessions(user):
    """Called when every refresh token of a person is revoked: the device list and remembered browsers go too."""
    Session.objects.filter(user=user).delete()
    TrustedDevice.objects.filter(user=user).delete()


def prune(now=None):
    """Delete sessions that have not been used for longer than a refresh token lives, expired remembered browsers and old events."""
    now = now or timezone.now()
    gone = Session.objects.filter(last_used_at__lt=now - timedelta(days=SESSION_KEEP_DAYS)).delete()[0]
    gone += TrustedDevice.objects.filter(expires_at__lt=now).delete()[0]
    gone += SecurityEvent.objects.filter(created_at__lt=now - timedelta(days=365)).delete()[0]
    return gone


# ---------------------------------------------------------------- e-mails about two-step verification
def mail_two_factor_changed(request, user, on):
    lang = _lang(user, request)
    if on:
        subject = tr(lang, "2-step verification is on for your {product} account", product=settings.PRODUCT_NAME)
        heading = tr(lang, "2-step verification turned on")
        text = tr(lang, "2-step verification was turned on for your account. From now on you need a code from your authenticator app when you sign in.")
    else:
        subject = tr(lang, "2-step verification is off for your {product} account", product=settings.PRODUCT_NAME)
        heading = tr(lang, "2-step verification turned off")
        text = tr(lang, "2-step verification was turned off for your account.")
    run_after_response(
        send_brand_email, user.email, subject, heading,
        [text, tr(lang, "If you did not do this, change your password now and contact support.")],
        tr(lang, "Open security settings"), f"{settings.WEB_BASE_URL}/app/settings/security", lang=lang,
    )


# ---------------------------------------------------------------- the company rule
def policy_for(workspace):
    try:
        return workspace.policy
    except WorkspacePolicy.DoesNotExist:
        return None


def get_or_create_policy(workspace):
    row, _ = WorkspacePolicy.objects.get_or_create(workspace=workspace)
    return row


def two_factor_deadline(policy, member):
    """When a member without two-step verification is locked out of the company: the grace period counts from the
    later of the day the rule was switched on and the day the member joined."""
    start = policy.require_2fa_since or timezone.now()
    if member is not None and member.joined_at and member.joined_at > start:
        start = member.joined_at
    return start + timedelta(days=GRACE_DAYS)


def requirement_for(user):
    """The two-step rule that applies to this person, or None: {workspace_id, workspace_name, deadline, enforced}.
    When several companies require it, the earliest deadline is reported."""
    from workspaces.models import Member

    best = None
    members = Member.objects.filter(
        user=user, status="active", workspace__deleted_at__isnull=True, workspace__policy__require_2fa=True
    ).select_related("workspace", "workspace__policy")
    for member in members:
        deadline = two_factor_deadline(member.workspace.policy, member)
        if best is None or deadline < best["deadline_at"]:
            best = {"workspace_id": str(member.workspace_id), "workspace_name": member.workspace.name, "deadline_at": deadline}
    if best is None:
        return None
    best["enforced"] = best["deadline_at"] <= timezone.now()
    best["deadline"] = best.pop("deadline_at").isoformat().replace("+00:00", "Z")
    return best


def two_factor_status(user):
    enabled = is_enabled(user)
    required = None if enabled else requirement_for(user)
    return {"enabled": enabled, "required": required}


def refuse_if_two_factor_missing(user, member):
    """Past the grace period a member of a company that requires two-step verification can only reach the security page."""
    policy = policy_for(member.workspace)
    if policy is None or not policy.require_2fa:
        return
    if two_factor_deadline(policy, member) > timezone.now() or is_enabled(user):
        return
    raise ApiError(
        "two_factor_required",
        "Your company requires 2-step verification. Turn it on in Settings > Security to continue.", 403,
    )


def set_require_2fa(request, workspace, value):
    """The owner switches the company rule on or off. The owner must have two-step verification on first. Members
    then have GRACE_DAYS days to turn it on; they are told by e-mail."""
    from operations import audit
    from workspaces.models import Member

    policy = get_or_create_policy(workspace)
    if bool(value) == policy.require_2fa:
        return policy
    if value and not is_enabled(request.user):
        raise ApiError(
            "two_factor_owner_required",
            "Turn on 2-step verification for your own account first, then require it for your company.", 409,
        )
    policy.require_2fa = bool(value)
    policy.require_2fa_since = timezone.now() if value else None
    policy.save(update_fields=["require_2fa", "require_2fa_since"])
    audit.log(request, workspace, "company.require_2fa_changed", "workspace", workspace.id, workspace.name, {"require_2fa": bool(value)})
    if value:
        for member in Member.objects.filter(workspace=workspace, status="active", user__isnull=False).exclude(user=request.user).select_related("user"):
            if not is_enabled(member.user):
                _mail_requirement(member.user, workspace)
    return policy


def _mail_requirement(user, workspace):
    lang = _lang(user)
    run_after_response(
        send_brand_email,
        user.email,
        tr(lang, "{company} requires 2-step verification", company=workspace.name),
        tr(lang, "Turn on 2-step verification"),
        [
            tr(lang, "{company} now requires everyone to use 2-step verification.", company=workspace.name),
            tr(lang, "You have {days} days to turn it on. After that you can only reach the security settings until it is on.", days=GRACE_DAYS),
        ],
        tr(lang, "Open security settings"),
        f"{settings.WEB_BASE_URL}/app/settings/security",
        lang=lang,
    )
