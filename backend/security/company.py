"""Company-side security features: verified e-mail domains, the reply-to address, and the fields the workspace API shows."""
import hashlib
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.core.validators import validate_email
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db import IntegrityError, transaction
from django.utils import timezone

from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import normalise_language, tr
from ilaf.utils import iso, run_after_response

from .models import VerifiedDomain, WorkspacePolicy
from . import services

DOMAIN_RE = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")
MAX_DOMAINS = 5
LINK_HOURS = 48
MAX_CODE_TRIES = 5
RESEND_SECONDS = 60
STANDARD_MAILBOXES = ("admin", "postmaster", "webmaster")

# Anyone can open a mailbox at these, so owning an address there proves nothing about a company.
FREE_MAIL_DOMAINS = frozenset("""
gmail.com googlemail.com outlook.com hotmail.com live.com msn.com passport.com yahoo.com ymail.com rocketmail.com
yahoo.co.uk yahoo.fr yahoo.de yahoo.in yahoo.co.in yahoo.com.br icloud.com me.com mac.com proton.me protonmail.com
protonmail.ch pm.me aol.com gmx.com gmx.net gmx.de mail.com email.com zoho.com zohomail.com yandex.com yandex.ru
mail.ru bk.ru inbox.ru list.ru qq.com 163.com 126.com sina.com naver.com daum.net hanmail.net tutanota.com tuta.io
tutamail.com fastmail.com hey.com web.de t-online.de libero.it virgilio.it orange.fr wanadoo.fr free.fr laposte.net
rediffmail.com outlook.sa hotmail.co.uk live.co.uk
mailinator.com guerrillamail.com guerrillamail.net sharklasers.com 10minutemail.com tempmail.com temp-mail.org
throwawaymail.com yopmail.com getnada.com trashmail.com dispostable.com maildrop.cc mintemail.com
""".split())


def _hash(value):
    return hashlib.sha256(f"domain:{value}|{settings.SECRET_KEY}".encode("utf-8")).hexdigest()


def normalise_domain(raw):
    value = str(raw or "").strip().lower().lstrip("@")
    value = re.sub(r"^https?://", "", value).split("/")[0]
    if value.startswith("www."):
        value = value[4:]
    return value


def domain_problem(domain):
    """None when the domain can be claimed, else "invalid" (not a domain) or "free_mail" (anyone can have an address there)."""
    if not DOMAIN_RE.match(domain):
        return "invalid"
    if domain in FREE_MAIL_DOMAINS or any(domain.endswith("." + free) for free in FREE_MAIL_DOMAINS):
        return "free_mail"
    return None


# ---------------------------------------------------------------- the workspace API fields
def policy_of(workspace):
    try:
        return workspace.policy
    except WorkspacePolicy.DoesNotExist:
        return None


def verified_domains(workspace):
    return list(VerifiedDomain.objects.filter(workspace=workspace, status="verified").values_list("domain", flat=True))


def verified_domain_of(workspace_id):
    """The first verified domain of a workspace (by name), or None."""
    return VerifiedDomain.objects.filter(workspace_id=workspace_id, status="verified").values_list("domain", flat=True).first()


def verified_domain_map(workspace_ids):
    """{workspace id: domain} for many workspaces at once (the directory and card lists)."""
    out = {}
    for ws_id, domain in VerifiedDomain.objects.filter(workspace_id__in=list(workspace_ids), status="verified").order_by("domain").values_list("workspace_id", "domain"):
        out.setdefault(ws_id, domain)
    return out


def workspace_security_fields(workspace):
    policy = policy_of(workspace)
    domains = verified_domains(workspace)
    allowed = set(workspace.allowed_email_domains or [])
    return {
        "require_2fa": bool(policy and policy.require_2fa),
        "require_2fa_since": iso(policy.require_2fa_since) if policy else None,
        "two_factor_grace_days": services.GRACE_DAYS,
        "reply_to_email": (policy.reply_to_email if policy else "") or "",
        "verified_domains": domains,
        # Verified domains the company has not yet put on its allowed list: offered as a one-click suggestion.
        "suggested_email_domains": [d for d in domains if d not in allowed],
    }


# ---------------------------------------------------------------- reply-to
def set_reply_to(request, workspace, value):
    from operations import audit

    value = str(value or "").strip()
    if len(value) > 254 or re.search(r"[\r\n,;<>\s]", value):
        raise validation_error({"reply_to_email": ["Enter one valid e-mail address."]})
    if value:
        try:
            validate_email(value)
        except DjangoValidationError:
            raise validation_error({"reply_to_email": ["Enter one valid e-mail address."]})
    policy = services.get_or_create_policy(workspace)
    if policy.reply_to_email != value.lower():
        policy.reply_to_email = value.lower()
        policy.save(update_fields=["reply_to_email"])
        audit.log(request, workspace, "company.reply_to_changed", "workspace", workspace.id, workspace.name, {"reply_to": policy.reply_to_email})
    return policy


# ---------------------------------------------------------------- verified domains
def domain_json(row):
    return {
        "id": str(row.id), "domain": row.domain, "status": row.status, "method": row.method,
        "sent_to": row.sent_to or None, "created_at": iso(row.created_at), "verified_at": iso(row.verified_at),
        "expires_at": iso(row.expires_at) if row.status == "pending" else None,
    }


def list_domains(workspace):
    now = timezone.now()
    VerifiedDomain.objects.filter(workspace=workspace, status="pending", expires_at__lt=now).update(status="expired")
    return [domain_json(r) for r in VerifiedDomain.objects.filter(workspace=workspace)]


def _mark_verified(request, workspace, row, how):
    from operations import audit

    row.status = "verified"
    row.verified_at = timezone.now()
    row.token_hash = ""
    row.code_hash = ""
    try:
        with transaction.atomic():
            row.save()
    except IntegrityError:
        raise ApiError("domain_taken", "Another company has already verified this domain.", 409)
    audit.log(request, workspace, "domain.verified", "domain", row.id, row.domain, {"how": how})
    return row


def _mailbox_address(domain, mailbox):
    mailbox = str(mailbox or "admin").strip().lower()
    if "@" not in mailbox:
        if mailbox not in STANDARD_MAILBOXES:
            raise ApiError("domain_mailbox_invalid", "Use admin, postmaster or webmaster, or an address at the domain.", 400)
        return f"{mailbox}@{domain}"
    local, _, host = mailbox.rpartition("@")
    if host != domain or not local or re.search(r"[\s,;<>\"\r\n]", mailbox):
        raise ApiError("domain_mailbox_invalid", "Use admin, postmaster or webmaster, or an address at the domain.", 400)
    try:
        validate_email(mailbox)
    except DjangoValidationError:
        raise ApiError("domain_mailbox_invalid", "Use admin, postmaster or webmaster, or an address at the domain.", 400)
    return mailbox


def claim_domain(request, workspace, raw_domain, mailbox=None):
    """Start proving a domain. When the owner's own verified account address is at the domain the proof is immediate;
    otherwise a code and a link go to a mailbox at the domain. Returns (row, sent)."""
    domain = normalise_domain(raw_domain)
    problem = domain_problem(domain)
    if problem == "invalid":
        raise ApiError("domain_invalid", "Enter a company domain such as northgate.com.", 400)
    if problem == "free_mail":
        raise ApiError("domain_free_mail", "Free e-mail domains such as gmail.com cannot be verified. Use your company's own domain.", 400)
    if VerifiedDomain.objects.filter(domain=domain, status="verified").exclude(workspace=workspace).exists():
        raise ApiError("domain_taken", "Another company has already verified this domain.", 409)
    row = VerifiedDomain.objects.filter(workspace=workspace, domain=domain).first()
    if row is not None and row.status == "verified":
        return row, False
    if row is None and VerifiedDomain.objects.filter(workspace=workspace).count() >= MAX_DOMAINS:
        raise ApiError("domain_limit", "A company can verify up to 5 domains. Remove one first.", 409)
    user = request.user
    if user.email_verified and user.email.rsplit("@", 1)[-1].lower() == domain:
        if row is None:
            row = VerifiedDomain.objects.create(workspace=workspace, domain=domain, sent_to=user.email)
        return _mark_verified(request, workspace, row, "account_email"), False
    address = _mailbox_address(domain, mailbox)
    if row is not None and row.status == "pending" and row.expires_at:
        sent_at = row.expires_at - timedelta(hours=LINK_HOURS)
        if (timezone.now() - sent_at).total_seconds() < RESEND_SECONDS:
            raise ApiError("domain_resend_wait", "A message was just sent. Wait a minute before asking for another.", 429)
    code = f"{secrets.randbelow(10 ** 6):06d}"
    token = secrets.token_urlsafe(32)
    fields = {
        "status": "pending", "sent_to": address, "attempts": 0, "token_hash": _hash(token), "code_hash": _hash(code),
        "expires_at": timezone.now() + timedelta(hours=LINK_HOURS),
    }
    if row is None:
        row = VerifiedDomain.objects.create(workspace=workspace, domain=domain, **fields)
    else:
        for key, value in fields.items():
            setattr(row, key, value)
        row.save()
    _mail_proof(workspace, request.user, address, domain, code, token)
    return row, True


def _mail_proof(workspace, owner, address, domain, code, token):
    lang = normalise_language(owner.language) or "en"
    run_after_response(
        send_brand_email,
        address,
        tr(lang, "Confirm {domain} for {company}", domain=domain, company=workspace.name),
        tr(lang, "Confirm your company domain"),
        [
            tr(lang, "{company} asked to verify the domain {domain} on {product}.", company=workspace.name, domain=domain, product=settings.PRODUCT_NAME),
            tr(lang, "Your confirmation code is {code}. It works for {hours} hours.", code=code, hours=LINK_HOURS),
            tr(lang, "If you did not expect this, ignore this e-mail and nothing changes."),
        ],
        tr(lang, "Confirm the domain"),
        f"{settings.WEB_BASE_URL}/verify-domain/{token}",
        lang=lang,
    )


def verify_with_code(request, workspace, domain_id, code):
    row = VerifiedDomain.objects.filter(workspace=workspace, pk=domain_id).first()
    if row is None:
        raise ApiError("not_found", "Not found.", 404)
    if row.status == "verified":
        return row
    _check_open(row)
    row.attempts += 1
    row.save(update_fields=["attempts"])
    if row.attempts > MAX_CODE_TRIES:
        raise ApiError("domain_code_invalid", "That code is not correct. Ask for a new one.", 400)
    given = "".join(str(code or "").split())
    if not row.code_hash or not secrets.compare_digest(_hash(given), row.code_hash):
        raise ApiError("domain_code_invalid", "That code is not correct. Ask for a new one.", 400)
    return _mark_verified(request, workspace, row, "mailbox_code")


def verify_with_link(request, token):
    """The link in the mail. Anyone holding it proves the mailbox; no sign-in is needed. Returns the row."""
    token = str(token or "")
    row = VerifiedDomain.objects.select_related("workspace").filter(token_hash=_hash(token), status="pending").first() if 8 <= len(token) <= 200 else None
    if row is None:
        raise ApiError("domain_link_invalid", "This confirmation link is not valid or has already been used.", 410)
    _check_open(row)
    return _mark_verified(request, row.workspace, row, "mailbox_link")


def _check_open(row):
    if row.status == "expired" or (row.expires_at and row.expires_at < timezone.now()):
        if row.status != "expired":
            row.status = "expired"
            row.save(update_fields=["status"])
        raise ApiError("domain_expired", "This confirmation has expired. Ask for a new one.", 410)


def remove_domain(request, workspace, domain_id):
    from operations import audit

    row = VerifiedDomain.objects.filter(workspace=workspace, pk=domain_id).first()
    if row is None:
        raise ApiError("not_found", "Not found.", 404)
    audit.log(request, workspace, "domain.removed", "domain", row.id, row.domain, {"was": row.status})
    row.delete()
