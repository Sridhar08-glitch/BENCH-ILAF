"""Writing the company audit log. Every admin action in a company workspace goes through `log`."""
import hashlib

from django.conf import settings

from ilaf.utils import client_ip

from .models import AuditEvent

# Every action key, with the plain sentence shown in the Activity page. Keys are dotted: group.verb.
ACTIONS = {
    "invite.sent": "Invited someone",
    "invite.resent": "Sent an invite again",
    "member.role_changed": "Changed a role",
    "member.removed": "Removed a member",
    "member.suspended": "Suspended a member",
    "member.restored": "Restored a member",
    "member.department_changed": "Moved a member to a department",
    "member.share_contacts_changed": "An employee changed whether they share their new contacts with the company",
    "card.created": "Created a card",
    "card.updated": "Changed a card",
    "card.published": "Published a card",
    "card.unpublished": "Unpublished a card",
    "card.suspended": "Suspended a card",
    "card.restored": "Restored a card",
    "card.deleted": "Deleted a card",
    "card.reassigned": "Reassigned a card",
    "brand.updated": "Changed the company details",
    "brand.design_changed": "Changed the company card design",
    "brand.lock_changed": "Changed the design lock",
    "brand.logo_changed": "Changed the company logo or pictures",
    "department.created": "Created a department",
    "department.updated": "Changed a department",
    "department.deleted": "Deleted a department",
    "fields.rules_changed": "Changed the field rules",
    "change.requested": "An employee asked for a change",
    "change.approved": "Approved a change",
    "change.rejected": "Rejected a change",
    "directory.updated": "Changed the company directory",
    "bulk.run": "Ran a bulk action",
    "lead.assigned": "Assigned a lead",
    "lead.status_changed": "Changed a lead's status",
    "lead.bulk_updated": "Updated several leads at once",
    "lead.exported": "Downloaded the contacts as a spreadsheet",
    "webhook.created": "Added a webhook",
    "webhook.updated": "Changed a webhook",
    "webhook.deleted": "Deleted a webhook",
    "webhook.secret_rotated": "Made a new webhook secret",
    "company.security_changed": "Changed the company sign-in rules",
    "company.require_2fa_changed": "Turned the company 2-step rule on or off",
    "company.reply_to_changed": "Changed the company reply-to address",
    "domain.verified": "Verified a company domain",
    "domain.removed": "Removed a company domain",
    "custom_domain.added": "Added a custom web address for the cards",
    "custom_domain.verified": "Verified the custom web address of the cards",
    "custom_domain.broken": "The DNS records of the custom web address went missing",
    "custom_domain.removed": "Removed the custom web address of the cards",
    "company.deletion_requested": "Asked to delete the company",
    "company.deletion_cancelled": "Cancelled the company deletion",
    "apikey.created": "Made an API key",
    "apikey.revoked": "Revoked an API key",
    "apikey.rotated": "Replaced an API key",
    "crm.connected": "Connected a CRM",
    "crm.disconnected": "Disconnected a CRM",
    "crm.settings_changed": "Changed the CRM sync settings",
    "crm.disabled": "A CRM connection stopped working",
    "design_request.created": "Asked for a custom card design",
    "design_request.message": "Wrote on a custom design request",
    "design_request.status_changed": "A custom design request changed status",
    "design_request.approved": "Approved a custom card design",
    "design_request.changes_requested": "Asked for changes to a custom card design",
    "design_request.withdrawn": "Withdrew a custom design request",
    "design_face.live": "A custom card design was made available",
    "design_face.disabled": "A custom card design was switched off",
    "company.suspended": "Our team suspended the company",
    "company.restored": "Our team made the company active again",
    "enterprise.requested": "Asked for an Enterprise quote",
    "enterprise.cancelled": "Withdrew the Enterprise request",
    "enterprise.accepted": "Accepted the Enterprise quote",
    "support.viewed": "Our support team looked at your account",
    "support.ended": "Our support team finished looking at your account",
}


def ip_hash(request):
    """A short one-way hash of the caller's address: enough to tell sessions apart, not to find a person."""
    if request is None:
        return ""
    raw = f"{client_ip(request)}|{settings.SECRET_KEY}"
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()[:32]


def log(request, workspace, action, target_type="", target_id="", target_label="", details=None, actor=None):
    """Add one audit row. `actor` defaults to the signed-in user of the request (None for system actions).

    A call made with an API key is recorded with the key as the actor: the name column holds the key's name and the
    e-mail column its visible prefix (never the secret)."""
    if workspace is None or workspace.kind != "company":
        return None
    user = actor if actor is not None else getattr(request, "user", None)
    if user is not None and not getattr(user, "is_authenticated", False):
        user = None
    if user is not None and getattr(user, "is_api_key", False):
        details = {**(details or {}), "via": "api_key", "key_id": str(user.key.id)}
        return AuditEvent.objects.create(
            workspace=workspace, actor=None, actor_email=f"api:{user.key.prefix}"[:254], actor_name=user.key.name[:120],
            action=action, target_type=target_type, target_id=str(target_id or "")[:64],
            target_label=(target_label or "")[:200], details=details, ip_hash=ip_hash(request),
        )
    return AuditEvent.objects.create(
        workspace=workspace,
        actor=user,
        actor_email=(user.email if user else "")[:254],
        actor_name=(user.full_name if user else "")[:120],
        action=action,
        target_type=target_type,
        target_id=str(target_id or "")[:64],
        target_label=(target_label or "")[:200],
        details=details or {},
        ip_hash=ip_hash(request),
    )
