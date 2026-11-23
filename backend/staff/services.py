"""Staff roles, the second step (authenticator code or recovery code), sessions and the staff audit log."""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from ilaf.emails import send_brand_email
from ilaf.errors import ApiError
from ilaf.i18n import normalise_language, tr
from ilaf.utils import run_after_response
from operations.audit import ip_hash
from security import devices

from . import totp
from .models import StaffAuditEvent, StaffRecoveryCode, StaffSession, StaffTotp

ROLES = ("read_only", "support", "admin")
RECOVERY_CODE_COUNT = 10
SESSION_HOURS = 12
MAX_FAILURES = 5
LOCK_MINUTES = 15


def role_of(user):
    """The staff role of a signed-in, active account ("none" for customers)."""
    if user is None or not getattr(user, "is_authenticated", False) or not user.is_active:
        return "none"
    if getattr(user, "deleted_at", None) is not None:
        return "none"
    return user.staff_role if user.staff_role in ROLES else "none"


def count_admins(exclude=None):
    from accounts.models import User

    qs = User.objects.filter(staff_role="admin", is_active=True, deleted_at__isnull=True)
    if exclude is not None:
        qs = qs.exclude(pk=exclude.pk)
    return qs.count()


# ---------------------------------------------------------------- audit log
def log(request, action, target_type="", target_id="", target_label="", details=None, actor=None):
    """Add one row to the staff audit log."""
    user = actor if actor is not None else getattr(request, "user", None)
    if user is not None and not getattr(user, "is_authenticated", False):
        user = None
    raw = getattr(request, "_request", request)
    try:
        raw.staff_audited = True
    except AttributeError:
        pass
    return StaffAuditEvent.objects.create(
        actor=user,
        actor_email=(user.email if user else "")[:254],
        actor_role=role_of(user) if user else "",
        action=action[:60],
        target_type=target_type[:30],
        target_id=str(target_id or "")[:64],
        target_label=(target_label or "")[:200],
        details=details or {},
        ip_hash=ip_hash(request),
    )


def log_look(request, action, target_type, target_id, target_label="", details=None, within_seconds=60):
    """Write a "Look" entry (something only read), unless the same person logged the same look at the same thing a moment
    ago: a screen that refreshes itself must not fill the log."""
    user = getattr(request, "user", None)
    if user is not None and getattr(user, "is_authenticated", False):
        since = timezone.now() - timedelta(seconds=within_seconds)
        if StaffAuditEvent.objects.filter(actor=user, action=action, target_id=str(target_id)[:64], created_at__gte=since).exists():
            return None
    return log(request, action, target_type, target_id, target_label, details)


# ---------------------------------------------------------------- hashing
def _hash(value):
    return hashlib.sha256(f"{value}|{settings.SECRET_KEY}".encode("utf-8")).hexdigest()


def hash_code(code):
    return _hash("recovery:" + "".join(str(code).upper().split()).replace("-", ""))


def hash_token(token):
    return _hash("session:" + token)


# ---------------------------------------------------------------- enrolment
def begin_enrolment(user):
    """A fresh, unconfirmed secret. An already confirmed secret is never replaced here."""
    row = StaffTotp.objects.filter(user=user).first()
    if row is not None and row.confirmed_at is not None:
        return None
    secret = totp.new_secret()
    if row is None:
        row = StaffTotp.objects.create(user=user, secret=secret)
    else:
        row.secret = secret
        row.last_counter = 0
        row.save(update_fields=["secret", "last_counter"])
    return row


def enrolment_payload(row, user):
    issuer = settings.PRODUCT_NAME + " staff"
    uri = totp.otpauth_uri(row.secret, user.email, issuer)
    return {"secret": row.secret, "otpauth_uri": uri, "qr_payload": uri, "issuer": issuer, "account": user.email}


def make_recovery_codes(user):
    """Replace the recovery codes with ten new ones. The plain codes are returned once and never stored."""
    StaffRecoveryCode.objects.filter(user=user).delete()
    plain = []
    for _ in range(RECOVERY_CODE_COUNT):
        raw = secrets.token_hex(5)  # 10 hex characters
        plain.append(f"{raw[:5]}-{raw[5:]}")
    StaffRecoveryCode.objects.bulk_create([StaffRecoveryCode(user=user, code_hash=hash_code(c)) for c in plain])
    return plain


def recovery_codes_left(user):
    return StaffRecoveryCode.objects.filter(user=user, used_at__isnull=True).count()


# ---------------------------------------------------------------- the second step
class Locked(Exception):
    def __init__(self, until):
        self.until = until


def _check_lock(row):
    now = timezone.now()
    if row.locked_until and row.locked_until > now:
        raise Locked(row.locked_until)


def _fail(row):
    row.failed_count += 1
    if row.failed_count >= MAX_FAILURES:
        row.locked_until = timezone.now() + timedelta(minutes=LOCK_MINUTES)
        row.failed_count = 0
    row.save(update_fields=["failed_count", "locked_until"])


def check_code(user, code, confirm=False):
    """True when `code` is the right authenticator code. Five wrong codes in a row lock the account for a while."""
    with transaction.atomic():
        row = StaffTotp.objects.select_for_update().filter(user=user).first()
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
        row = StaffTotp.objects.select_for_update().filter(user=user, confirmed_at__isnull=False).first()
        if row is None:
            return False
        _check_lock(row)
        match = StaffRecoveryCode.objects.select_for_update().filter(
            user=user, code_hash=hash_code(code), used_at__isnull=True
        ).first()
        if match is None:
            _fail(row)
            return False
        match.used_at = timezone.now()
        match.save(update_fields=["used_at"])
        row.failed_count = 0
        row.save(update_fields=["failed_count"])
        return True


def is_enrolled(user):
    return StaffTotp.objects.filter(user=user, confirmed_at__isnull=False).exists()


# ---------------------------------------------------------------- sessions
def start_session(request, user, method="totp"):
    """Open a 12 hour staff session and return (token, session). Older sessions of the person stay valid.

    The session remembers a readable device name and the country it started from (the Security tab shows them). When
    the person has signed in before and this is a country or a kind of browser not seen in their earlier sessions,
    they get an e-mail about it; `session.new_place` tells the caller so the audit line can say it too."""
    info = devices.describe(request)
    earlier = list(StaffSession.objects.filter(user=user).order_by("-created_at").values_list("device_label", "country")[:200])
    token = secrets.token_urlsafe(32)
    session = StaffSession.objects.create(
        user=user, token_hash=hash_token(token), method=method, ip_hash=ip_hash(request),
        expires_at=timezone.now() + timedelta(hours=SESSION_HOURS), device_label=info["label"][:80], country=info["country"][:8],
    )
    session.new_place = is_new_place(earlier, info)
    if session.new_place:
        mail_new_place(user, info)
    return token, session


def is_new_place(earlier, info):
    """True when there are earlier sessions and this one comes from a country or a browser/system none of them used."""
    if not earlier:
        return False
    countries = {country for _label, country in earlier if country}
    labels = {label for label, _country in earlier if label}
    new_country = bool(info["country"]) and bool(countries) and info["country"] not in countries
    new_device = bool(info["label"]) and info["label"] not in labels
    return new_country or new_device


def mail_new_place(user, info):
    """Tell a staff member that a staff session was just opened from a new country or device."""
    lang = normalise_language(user.language) or "en"
    place = info["label"] or tr(lang, "an unknown device")
    if info["country"]:
        place = f"{place} ({info['country']})"
    when = timezone.now().strftime("%Y-%m-%d %H:%M UTC")
    run_after_response(
        send_brand_email,
        user.email,
        tr(lang, "New staff sign-in to {product}", product=settings.PRODUCT_NAME),
        tr(lang, "A staff session started from a new place"),
        [
            tr(lang, "A staff session on your account was opened from {device} at {when}.", device=place, when=when),
            tr(lang, "If this was you, you do not need to do anything. If it was not, ask an admin to end your staff sessions and reset your two-step verification."),
        ],
        tr(lang, "Review your staff sessions"),
        f"{settings.WEB_BASE_URL}/staff/team",
        lang=lang,
        kind="staff",
    )


def revoke_session(session):
    """End one staff session. Returns False when it was already over."""
    if session.revoked_at is not None or session.expires_at <= timezone.now():
        return False
    session.revoked_at = timezone.now()
    session.save(update_fields=["revoked_at"])
    return True


def reason_details(data):
    """{"reason": text} when the request body carries the reason typed in the confirmation dialog, else {}. Goes into the audit details."""
    if not isinstance(data, dict):
        return {}
    reason = str(data.get("reason") or "").strip()[:300]
    return {"reason": reason} if reason else {}


def ensure_not_last_admin(user, new_role=None):
    """Refuse a change that would leave no active admin: demoting, removing or deactivating the only one."""
    if user.staff_role == "admin" and new_role != "admin" and count_admins(exclude=user) == 0:
        raise ApiError("last_admin", "At least one staff admin is required.", 409)


def session_for(user, token):
    if not token or not isinstance(token, str) or len(token) > 200:
        return None
    session = StaffSession.objects.filter(token_hash=hash_token(token), user=user, revoked_at__isnull=True).first()
    if session is None or session.expires_at <= timezone.now():
        return None
    return session


def note_session_use(request, session):
    """Remember when a session was last used, and write one audit event when it is used from a new address."""
    now = timezone.now()
    current = ip_hash(request)
    updates = []
    if session.last_seen_at is None or now - session.last_seen_at > timedelta(minutes=1):
        session.last_seen_at = now
        updates.append("last_seen_at")
    known = session.last_ip_hash or session.ip_hash
    if current and known and current != known:
        session.last_ip_hash = current
        updates.append("last_ip_hash")
        log(request, "staff.ip_changed", "session", session.id, request.user.email, {"previous": known[:8], "now": current[:8]})
    if updates:
        session.save(update_fields=updates)


def end_sessions(user):
    StaffSession.objects.filter(user=user, revoked_at__isnull=True).update(revoked_at=timezone.now())
