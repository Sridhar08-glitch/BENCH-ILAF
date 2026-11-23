"""Staff roles, the second step (authenticator code or recovery code), sessions and the staff audit log."""
import hashlib
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from operations.audit import ip_hash

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
    """Open a 12 hour staff session and return (token, session). Older sessions of the person stay valid."""
    token = secrets.token_urlsafe(32)
    session = StaffSession.objects.create(
        user=user, token_hash=hash_token(token), method=method, ip_hash=ip_hash(request),
        expires_at=timezone.now() + timedelta(hours=SESSION_HOURS),
    )
    return token, session


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
