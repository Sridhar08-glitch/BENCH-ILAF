"""Exporting and deleting personal and company data.

Workflow
- Export: a request row is created, the ZIP is built at once for small accounts or by the
  `process_data_requests` command for big ones, and a signed link (24 hours, works once) is e-mailed.
  `cleanup_data_exports` deletes the files.
- Delete account / company: disabled at once, cards unpublished, a grace period starts, the owner can
  restore. `purge_deleted_accounts` erases what is still scheduled when the grace period ends.
"""
import logging
import uuid
from datetime import timedelta

from django.conf import settings
from django.core import signing
from django.core.files import File
from django.core.files.storage import FileSystemStorage, default_storage
from django.db import transaction
from django.db.models import Q
from django.utils import timezone

from accounts.models import PasswordResetToken, User
from accounts.services import revoke_refresh_tokens
from cards.models import Card
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError
from ilaf.i18n import format_date, language_for_email, tr, user_language
from ilaf.utils import iso
from leads.models import Lead
from operations import audit
from operations.models import AuditEvent
from workspaces.models import Member, Workspace

from . import exporter
from .models import DataRequest

log = logging.getLogger(__name__)

EXPORT_SALT = "privacy.export.download"
RESTORE_SALT = "privacy.account.restore"
TOMBSTONE_DOMAIN = "deleted.invalid"
ACTIVE_EXPORT_STATES = ("pending", "processing", "ready")


def export_storage():
    """Private disk storage for export files. It is never served as media."""
    return FileSystemStorage(location=settings.EXPORT_ROOT)


def grace():
    return timedelta(days=settings.DELETION_GRACE_DAYS)


def due_date(now=None):
    return (now or timezone.now()) + timedelta(days=settings.DATA_REQUEST_DUE_DAYS)


# ---------------------------------------------------------------- output

def request_json(dr):
    now = timezone.now()
    ready = dr.kind == "export" and dr.status == "ready" and dr.expires_at is not None and dr.expires_at > now
    return {
        "id": str(dr.id),
        "kind": dr.kind,
        "scope": dr.scope,
        "workspace_id": str(dr.workspace_id) if dr.workspace_id else None,
        "workspace_name": dr.workspace.name if dr.workspace_id and dr.workspace.deleted_at is None else None,
        "status": dr.status,
        "requested_at": iso(dr.requested_at),
        "due_at": iso(dr.due_at),
        "completed_at": iso(dr.completed_at),
        "ready_at": iso(dr.ready_at),
        "expires_at": iso(dr.expires_at),
        "download_available": ready,
        "file_size": dr.file_size,
        "scheduled_for": iso(dr.scheduled_for),
        "error": dr.error or None,
    }


# ---------------------------------------------------------------- export

def start_export(user, workspace=None):
    """Create (or return the running) export request. Returns (request, created)."""
    scope = "workspace" if workspace is not None else "user"
    running = DataRequest.objects.filter(
        user=user, kind="export", scope=scope, workspace=workspace, status__in=ACTIVE_EXPORT_STATES,
    ).exclude(status="ready", expires_at__lte=timezone.now()).first()
    if running is not None:
        return running, False
    now = timezone.now()
    recent = DataRequest.objects.filter(user=user, kind="export", requested_at__gte=now - timedelta(days=1)).count()
    if recent >= settings.EXPORT_DAILY_LIMIT:
        raise ApiError(
            "export_limit",
            f"You can ask for {settings.EXPORT_DAILY_LIMIT} exports a day. Please try again tomorrow.",
            429,
        )
    dr = DataRequest.objects.create(
        kind="export", scope=scope, user=user, workspace=workspace, status="pending", due_at=due_date(now),
    )
    cards, leads = exporter.estimate_size(user=user, workspace=workspace)
    if cards <= settings.EXPORT_SYNC_MAX_CARDS and leads <= settings.EXPORT_SYNC_MAX_LEADS:
        run_export(dr)
        dr.refresh_from_db()
    return dr, True


def run_export(dr):
    """Build the ZIP for a pending request. Safe to call from several workers: only one claims it."""
    claimed = DataRequest.objects.filter(pk=dr.pk, status="pending").update(status="processing")
    if not claimed:
        return False
    dr.refresh_from_db()
    try:
        if dr.scope == "workspace":
            archive = exporter.build_workspace_export(dr.workspace)
        else:
            archive = exporter.build_user_export(dr.user)
        try:
            name = export_storage().save(f"{uuid.uuid4().hex}.zip", File(archive))
            size = archive.seek(0, 2)
        finally:
            archive.close()
        now = timezone.now()
        dr.file_name, dr.file_size = name, size
        dr.ready_at = now
        dr.expires_at = now + timedelta(hours=settings.EXPORT_LINK_HOURS)
        dr.status = "ready"
        dr.error = ""
        dr.save()
    except Exception as exc:
        log.exception("Export %s failed", dr.pk)
        # The reason goes to the log; the person (and the admin list) only see a general message.
        DataRequest.objects.filter(pk=dr.pk).update(
            status="failed", error=f"The export could not be built ({type(exc).__name__}). Please try again or contact support."
        )
        return False
    send_export_ready_email(dr)
    return True


def download_token(dr):
    return signing.dumps(str(dr.id), salt=EXPORT_SALT)


def download_page_url(dr):
    return f"{settings.WEB_BASE_URL}/data-download/{download_token(dr)}"


def _bad_link(code="download_invalid", message="This download link is not valid."):
    return ApiError(code, message, 410)


def export_from_token(token, claim=False):
    """The export a download link belongs to. With `claim`, the link is used up: a second call fails."""
    try:
        request_id = signing.loads(token, salt=EXPORT_SALT, max_age=settings.EXPORT_LINK_HOURS * 3600)
    except signing.SignatureExpired:
        raise _bad_link("download_expired", "This download link has expired. Ask for a new export in Settings.")
    except signing.BadSignature:
        raise _bad_link()
    dr = DataRequest.objects.filter(pk=request_id, kind="export").first()
    if dr is None:
        raise _bad_link()
    now = timezone.now()
    if dr.status == "completed" or dr.downloaded_at:
        raise _bad_link("download_used", "This link was already used. Ask for a new export in Settings.")
    if dr.status == "expired" or (dr.expires_at and dr.expires_at <= now):
        raise _bad_link("download_expired", "This download link has expired. Ask for a new export in Settings.")
    if dr.status != "ready" or not dr.file_name:
        raise _bad_link()
    if claim:
        claimed = DataRequest.objects.filter(pk=dr.pk, status="ready", downloaded_at__isnull=True).update(
            status="completed", downloaded_at=now, completed_at=now,
        )
        if not claimed:
            raise _bad_link("download_used", "This link was already used. Ask for a new export in Settings.")
        dr.refresh_from_db()
    return dr


def cleanup_exports(now=None):
    """Delete the files of exports that were downloaded or whose link has expired. Returns the count."""
    now = now or timezone.now()
    storage = export_storage()
    count = 0
    stale = DataRequest.objects.filter(kind="export").exclude(file_name="").filter(
        Q(status="completed") | Q(status="ready", expires_at__lte=now) | Q(status="expired") | Q(status="failed")
    )
    for dr in stale:
        try:
            if storage.exists(dr.file_name):
                storage.delete(dr.file_name)
        except OSError:
            log.warning("Could not delete export file %s", dr.file_name)
            continue
        dr.file_name = ""
        if dr.status == "ready":
            dr.status = "expired"
        dr.save(update_fields=["file_name", "status"])
        count += 1
    # A request that never produced a file (an expired but unfinished one) is simply closed.
    DataRequest.objects.filter(kind="export", status="ready", expires_at__lte=now).update(status="expired")
    return count


def process_pending_exports(limit=20):
    """Build the exports that were left for the background command, and retry any that got stuck."""
    stuck_before = timezone.now() - timedelta(minutes=30)
    DataRequest.objects.filter(kind="export", status="processing", requested_at__lt=stuck_before).update(status="pending")
    done = 0
    for dr in DataRequest.objects.filter(kind="export", status="pending").order_by("requested_at")[:limit]:
        if run_export(dr):
            done += 1
    return done


# ---------------------------------------------------------------- e-mails

def _greeting(name, lang="en"):
    return tr(lang, "Hi {name},", name=name) if name else tr(lang, "Hello,")


def send_export_ready_email(dr):
    user = dr.user
    if user is None:
        return
    lang = user_language(user)
    if dr.scope == "workspace" and dr.workspace_id:
        intro = tr(lang, "The download of {workspace} company data is ready. The link works once and expires in {hours} hours.",
                   workspace=dr.workspace.name, hours=settings.EXPORT_LINK_HOURS)
    else:
        intro = tr(lang, "The download of your data is ready. The link works once and expires in {hours} hours.",
                   hours=settings.EXPORT_LINK_HOURS)
    send_brand_email(
        user.email,
        tr(lang, "Your {product} data export is ready", product=settings.PRODUCT_NAME),
        tr(lang, "Your data export is ready"),
        [
            _greeting(user.full_name, lang),
            intro,
            tr(lang, "If you did not ask for this, ignore this email and change your password."),
        ],
        tr(lang, "Download my data"),
        download_page_url(dr),
        lang=lang,
    )


def _send_deletion_scheduled(user, due, restore_url, company=None):
    """`company` is the company name when a company is being deleted; None means the person's own account."""
    lang = user_language(user)
    when = format_date(lang, due)
    if company is None:
        subject = tr(lang, "Your {product} account is scheduled for deletion", product=settings.PRODUCT_NAME)
        heading = tr(lang, "Your account will be deleted")
        lines = [
            tr(lang, "We received your request to delete your account. It is switched off now, and all data will be erased "
               "permanently on {date}.", date=when),
            tr(lang, "Changed your mind? You can restore your account until then."),
            tr(lang, "If you did not ask for this, restore it now and change your password."),
        ]
        button = tr(lang, "Restore my account")
    else:
        subject = tr(lang, "Your {product} company {company} is scheduled for deletion", product=settings.PRODUCT_NAME, company=company)
        heading = tr(lang, "Your company {company} will be deleted", company=company)
        lines = [
            tr(lang, "We received your request to delete your company {company}. It is switched off now, and all data will be erased "
               "permanently on {date}.", company=company, date=when),
            tr(lang, "Changed your mind? You can restore your company {company} until then.", company=company),
            tr(lang, "If you did not ask for this, restore it now and change your password."),
        ]
        button = tr(lang, "Restore my company {company}", company=company)
    send_brand_email(user.email, subject, heading, [_greeting(user.full_name, lang)] + lines, button, restore_url, lang=lang)


# ---------------------------------------------------------------- account deletion

def owned_companies_with_others(user):
    """Active companies this user owns that have other people on the team."""
    owned = Workspace.objects.filter(
        kind="company", deleted_at__isnull=True, deletion_due_at__isnull=True,
        members__user=user, members__role="owner",
    )
    return [ws for ws in owned if ws.members.exclude(user=user).exists()]


def _owned_workspaces(user):
    return Workspace.objects.filter(deleted_at__isnull=True, members__user=user, members__role="owner").distinct()


def _user_cards(user):
    owned_ids = list(_owned_workspaces(user).values_list("id", flat=True))
    return Card.objects.filter(Q(owner=user) | Q(member__user=user) | Q(workspace_id__in=owned_ids)).distinct()


def restore_token(user):
    return signing.dumps({"u": str(user.id), "d": iso(user.deletion_due_at)}, salt=RESTORE_SALT)


def user_from_restore_token(token):
    try:
        data = signing.loads(token, salt=RESTORE_SALT, max_age=(settings.DELETION_GRACE_DAYS + 1) * 86400)
    except signing.BadSignature:
        raise ApiError("restore_invalid", "This restore link is not valid or has expired.", 410)
    user = User.objects.filter(pk=data.get("u"), deleted_at__isnull=True).first()
    if user is None or user.deletion_due_at is None or iso(user.deletion_due_at) != data.get("d"):
        raise ApiError("restore_invalid", "This restore link is not valid or has expired.", 410)
    return user


def request_account_deletion(user):
    blocking = owned_companies_with_others(user)
    if blocking:
        names = [ws.name for ws in blocking]
        raise ApiError(
            "owns_company",
            f"You own {', '.join(names)} with other people on the team. Delete the company first "
            "(Settings, Privacy and data), then delete your account.",
            409,
            {"companies": names},
        )
    now = timezone.now()
    due = now + grace()
    with transaction.atomic():
        cards = list(_user_cards(user).filter(status="published"))
        ids = [str(c.id) for c in cards]
        Card.objects.filter(pk__in=[c.pk for c in cards]).update(status="draft")
        user.is_active = False
        user.deletion_due_at = due
        user.save(update_fields=["is_active", "deletion_due_at"])
        revoke_refresh_tokens(user)  # no device can renew its session while the account waits for deletion
        dr = DataRequest.objects.create(
            kind="delete", scope="user", user=user, status="pending", due_at=due_date(now), scheduled_for=due,
            details={"published_cards": ids},
        )
    _send_deletion_scheduled(user, due, f"{settings.WEB_BASE_URL}/restore/{restore_token(user)}")
    return dr


def restore_account(user, request=None):
    now = timezone.now()
    if user.deleted_at or user.deletion_due_at is None or user.deletion_due_at <= now:
        raise ApiError("restore_invalid", "This account can no longer be restored.", 410)
    with transaction.atomic():
        dr = DataRequest.objects.filter(user=user, kind="delete", scope="user", status="pending").first()
        ids = (dr.details or {}).get("published_cards", []) if dr else []
        user.is_active = True
        user.deletion_due_at = None
        user.save(update_fields=["is_active", "deletion_due_at"])
        if ids:
            Card.objects.filter(pk__in=ids, status="draft").update(status="published")
        if dr:
            dr.status = "cancelled"
            dr.completed_at = now
            dr.save(update_fields=["status", "completed_at"])
    lang = user_language(user)
    send_brand_email(
        user.email, tr(lang, "Your {product} account is back", product=settings.PRODUCT_NAME), tr(lang, "Your account is restored"),
        [_greeting(user.full_name, lang), tr(lang, "Your account was restored and your cards are live again. Welcome back.")],
        tr(lang, "Sign in"), f"{settings.WEB_BASE_URL}/login", lang=lang,
    )


# ---------------------------------------------------------------- company deletion

def request_company_deletion(workspace, owner, request=None):
    now = timezone.now()
    due = now + grace()
    with transaction.atomic():
        cards = list(Card.objects.filter(workspace=workspace, status="published"))
        ids = [str(c.id) for c in cards]
        Card.objects.filter(pk__in=[c.pk for c in cards]).update(status="draft")
        workspace.deletion_due_at = due
        workspace.save(update_fields=["deletion_due_at"])
        dr = DataRequest.objects.create(
            kind="delete", scope="workspace", user=owner, workspace=workspace, status="pending", due_at=due_date(now),
            scheduled_for=due, details={"published_cards": ids},
        )
        audit.log(request, workspace, "company.deletion_requested", "workspace", workspace.id, workspace.name, {"due": iso(due)})
        emails = list(
            workspace.members.filter(status="active").exclude(user=owner).exclude(email="").values_list("email", flat=True)
        )
    _send_deletion_scheduled(owner, due, f"{settings.WEB_BASE_URL}/app/settings/privacy", workspace.name)
    for email in emails:
        lang = language_for_email(email)
        send_brand_email(
            email, tr(lang, "{workspace} is scheduled for deletion", workspace=workspace.name), tr(lang, "Your company is closing"),
            [tr(lang, "The owner of {workspace} asked to delete the company. Its cards are offline now and all company data "
                "will be erased on {date}.", workspace=workspace.name, date=format_date(lang, due)),
             tr(lang, "Please contact the owner if this is a surprise.")],
            lang=lang,
        )
    return dr


def restore_company(workspace, owner, request=None):
    now = timezone.now()
    if workspace.deleted_at or workspace.deletion_due_at is None or workspace.deletion_due_at <= now:
        raise ApiError("restore_invalid", "This company can no longer be restored.", 410)
    with transaction.atomic():
        dr = DataRequest.objects.filter(workspace=workspace, kind="delete", scope="workspace", status="pending").first()
        ids = (dr.details or {}).get("published_cards", []) if dr else []
        workspace.deletion_due_at = None
        workspace.save(update_fields=["deletion_due_at"])
        if ids:
            Card.objects.filter(pk__in=ids, status="draft").update(status="published")
        if dr:
            dr.status = "cancelled"
            dr.completed_at = now
            dr.save(update_fields=["status", "completed_at"])
        audit.log(request, workspace, "company.deletion_cancelled", "workspace", workspace.id, workspace.name)
    lang = user_language(owner)
    send_brand_email(
        owner.email, tr(lang, "{workspace} was restored", workspace=workspace.name), tr(lang, "Your company is restored"),
        [_greeting(owner.full_name, lang), tr(lang, "{workspace} was restored. Its cards are live again.", workspace=workspace.name)],
        tr(lang, "Open the dashboard"), f"{settings.WEB_BASE_URL}/app", lang=lang,
    )


# ---------------------------------------------------------------- erasure

def _delete_files(names):
    for name in {n for n in names if n}:
        try:
            default_storage.delete(name)
        except Exception:  # a missing file is not a reason to stop erasing
            log.warning("Could not delete file %s", name)


def _card_files(cards):
    names = []
    for card in cards:
        names += [card.photo.name, card.cover.name]
        names += exporter._icon_names(card)
    return names


def _workspace_files(ws):
    return [f.name for f in (ws.logo, ws.symbol, ws.background, ws.template_front, ws.template_back)]


def purge_workspace(workspace):
    """Erase a company or personal workspace. The row stays as an empty shell so invoices keep
    their link, but nothing about the company or its people is left."""
    files = _workspace_files(workspace)
    owner_user = None
    with transaction.atomic():
        cards = list(Card.objects.filter(workspace=workspace).prefetch_related("items"))
        files += _card_files(cards)
        Lead.objects.filter(Q(workspace=workspace) | Q(card__workspace=workspace)).delete()
        Card.objects.filter(workspace=workspace).delete()
        workspace.departments.all().delete()
        workspace.change_requests.all().delete()
        AuditEvent.objects.filter(workspace=workspace).delete()  # queryset delete: rows are only ever added by the app
        workspace.members.all().delete()
        for field in ("logo", "symbol", "background", "template_front", "template_back"):
            setattr(workspace, field, None)
        workspace.name = "Deleted company" if workspace.kind == "company" else "Deleted account"
        workspace.brand = {}
        workspace.custom_domain = None
        workspace.directory_slug = None
        workspace.directory_enabled = False
        workspace.field_rules = {}
        workspace.lead_settings = {}
        workspace.allowed_email_domains = []
        workspace.require_google_signin = False
        workspace.created_by = None
        workspace.deleted_at = timezone.now()
        workspace.save()
        dr = DataRequest.objects.filter(workspace=workspace, kind="delete", scope="workspace", status="pending").first()
        if dr:
            owner_user = dr.user
            dr.status = "completed"
            dr.completed_at = timezone.now()
            dr.save(update_fields=["status", "completed_at"])
    _delete_files(files)
    return owner_user


def purge_user(user):
    """Erase one person: personal data removed or anonymised, pictures deleted, cards deleted.
    Company leads stay with the company; audit rows keep the actor id and lose the name."""
    original_email, original_name = user.email, user.full_name
    original_lang = user_language(user)
    owned = list(_owned_workspaces(user))
    blocked = [ws for ws in owned if ws.kind == "company" and ws.members.exclude(user=user).exists()
               and ws.deletion_due_at is None]
    if blocked:
        raise ApiError("owns_company", "The account still owns a company with other people.", 409)
    owned_ids = [ws.id for ws in owned]
    files = [user.photo.name]
    for ws in owned:
        purge_workspace(ws)

    with transaction.atomic():
        cards = list(Card.objects.filter(Q(owner=user) | Q(member__user=user)).prefetch_related("items"))
        files += _card_files(cards)
        # The company keeps these leads; only the link to the person's card is cut.
        Lead.objects.filter(card__in=cards).exclude(workspace_id__in=owned_ids).update(card_name="Deleted card")
        Card.objects.filter(pk__in=[c.pk for c in cards]).delete()
        member_ids = [str(m) for m in Member.objects.filter(user=user).values_list("id", flat=True)]
        Member.objects.filter(user=user).delete()
        # Audit rows keep the actor id (the user row stays as an empty shell) but lose every name.
        AuditEvent.objects.filter(actor=user).update(actor_name="", actor_email="")
        for event in AuditEvent.objects.filter(target_type="member", target_id__in=member_ids):
            details = {k: v for k, v in (event.details or {}).items() if k not in ("email", "full_name", "name")}
            AuditEvent.objects.filter(pk=event.pk).update(target_label="", details=details)
        PasswordResetToken.objects.filter(user=user).delete()
        _delete_user_exports(user)
        now = timezone.now()
        user.email = f"deleted-{user.id.hex[:12]}@{TOMBSTONE_DOMAIN}"
        user.full_name = ""
        user.photo = None
        user.google_sub = None
        user.google_email = ""
        user.is_active = False
        user.is_staff = False
        user.is_superuser = False
        user.set_unusable_password()
        user.deleted_at = now
        user.deletion_due_at = None
        user.save()
        DataRequest.objects.filter(user=user, kind="delete", scope="user", status="pending").update(
            status="completed", completed_at=now
        )
        _drop_outstanding_tokens(user)
    _delete_files(files)
    send_brand_email(
        original_email, tr(original_lang, "Your {product} account was deleted", product=settings.PRODUCT_NAME),
        tr(original_lang, "Your account is deleted"),
        [_greeting(original_name, original_lang), tr(original_lang, "As you asked, your account and its data have been erased permanently. "
         "Thank you for having used our service.")],
        lang=original_lang,
    )


def _drop_outstanding_tokens(user):
    try:
        from rest_framework_simplejwt.token_blacklist.models import OutstandingToken

        OutstandingToken.objects.filter(user=user).delete()
    except Exception:  # the blacklist app is optional for this step
        log.warning("Could not remove refresh tokens of %s", user.pk)


def _delete_user_exports(user):
    storage = export_storage()
    for dr in DataRequest.objects.filter(user=user, kind="export").exclude(file_name=""):
        try:
            storage.delete(dr.file_name)
        except OSError:
            log.warning("Could not delete export file %s", dr.file_name)
    DataRequest.objects.filter(user=user, kind="export").update(file_name="", status="expired")


def purge_due(now=None):
    """Erase everything whose grace period is over. Returns (workspaces, users) erased."""
    now = now or timezone.now()
    workspaces = users = 0
    for ws in Workspace.objects.filter(kind="company", deletion_due_at__lte=now, deleted_at__isnull=True):
        try:
            owner = purge_workspace(ws)
            workspaces += 1
            if owner is not None and owner.is_active:
                lang = user_language(owner)
                send_brand_email(
                    owner.email, tr(lang, "Your {product} company was deleted", product=settings.PRODUCT_NAME),
                    tr(lang, "Your company is deleted"),
                    [_greeting(owner.full_name, lang), tr(lang, "As you asked, the company and its data have been erased permanently.")],
                    lang=lang,
                )
        except Exception:
            log.exception("Could not erase workspace %s", ws.pk)
    for user in User.objects.filter(deletion_due_at__lte=now, deleted_at__isnull=True):
        try:
            purge_user(user)
            users += 1
        except Exception:
            log.exception("Could not erase user %s", user.pk)
    return workspaces, users
