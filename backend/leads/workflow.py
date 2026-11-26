"""What can happen to a lead after it arrives: assignment, status changes and notes.

Every change writes a line to the lead's timeline, queues the matching webhook event and, in a company,
adds an entry to the company audit log. The colleague a lead is handed to gets an e-mail.
"""
from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.db.models import Q
from django.utils import timezone

from ilaf.emails import send_brand_email
from ilaf.errors import validation_error
from ilaf.i18n import member_language, tr
from operations import audit
from workspaces.access import commerce_cards
from workspaces.models import Member

from . import webhooks
from .models import Lead, LeadActivity, LeadNote, is_company_owned

STATUS_NAMES = {
    "new": "New", "contacted": "Contacted", "qualified": "Qualified", "won": "Won", "lost": "Lost",
}
STATUS_KEYS = tuple(STATUS_NAMES)
MAX_BULK = 200


def person_name(user):
    if user is None:
        return ""
    return (user.full_name or user.email or "")[:120]


def record(lead, kind, actor=None, **details):
    # An API key can act on a lead: the timeline names the key, and there is no user to link.
    is_key = getattr(actor, "is_api_key", False)
    return LeadActivity.objects.create(
        lead=lead, kind=kind, actor=None if is_key else actor, actor_name=person_name(actor), details=details
    )


def can_see(member, lead):
    """The same rule as visible_leads for one lead: your own cards' leads, those given to you, and (owners and admins) the company
    card's and those of a deleted card. An employee's contact is never shown to an owner or admin."""
    if lead.workspace_id != member.workspace_id and not (lead.card_id and lead.card.workspace_id == member.workspace_id):
        return False
    if lead.assignee_id == member.id:
        return True
    if not lead.card_id:
        return member.role != "employee"
    card = lead.card
    if card.is_company or card.member_id is None:
        return member.role != "employee"
    if lead.shared_with_company and member.role != "employee":
        return True
    return card.member_id == member.id or (bool(member.user_id) and card.owner_id == member.user_id)


def visible_leads(member):
    """Leads this member may see: those that came in on their own cards, and those assigned to them. Owners and admins also see those of the
    company's own card and those an employee shared (their switch was on when the contact arrived), never the other contacts of an employee's card. A lead whose card was deleted has no person behind it, so owners and admins keep it."""
    q = Q(card__in=commerce_cards(member)) | Q(workspace_id=member.workspace_id, assignee_id=member.id)
    if member.role != "employee":
        q |= Q(card__isnull=True, workspace_id=member.workspace_id) | Q(shared_with_company=True, workspace_id=member.workspace_id)
    return Lead.objects.filter(q)


def is_company(lead):
    ws = lead.workspace
    return ws is not None and ws.kind == "company"


def note_created(lead, actor=None):
    """Called once when a lead has just been saved: timeline line and webhook event."""
    record(lead, "created", actor, source=lead.source)
    if lead.workspace_id:
        webhooks.enqueue(lead.workspace, "lead.created", lead)


def note_emailed(lead, count):
    if count:
        record(lead, "emailed", None, recipients=count)


# ---------------------------------------------------------------- status
def set_status(request, lead, status, actor, audit_each=True):
    """Change the status. Returns True when it changed."""
    if status not in STATUS_KEYS:
        raise validation_error({"status": ["Choose one of the listed statuses."]})
    old = lead.status
    if old == status:
        return False
    lead.status = status
    lead.save(update_fields=["status"])
    record(lead, "status_changed", actor, old=old, new=status)
    # The company's activity log shows what happens to the company's own contacts. What an employee does with their own contacts is not
    # written there: the log carries the contact's name, and the admins are not meant to see it.
    if audit_each and is_company(lead) and is_company_owned(lead):
        audit.log(
            request, lead.workspace, "lead.status_changed", "lead", lead.id, lead.name,
            {"old": old, "new": status}, actor=actor,
        )
    webhooks.enqueue(lead.workspace, "lead.updated", lead, {"changes": {"status": {"from": old, "to": status}}})
    return True


# ---------------------------------------------------------------- assignment
def assignable_member(workspace_id, member_id):
    """An active member of this company, or a 400."""
    if member_id in (None, ""):
        return None
    try:
        member = Member.objects.get(pk=member_id, workspace_id=workspace_id, status="active")
    except (Member.DoesNotExist, ValueError, TypeError, DjangoValidationError):
        raise validation_error({"assignee_id": ["Choose an active member of this company."]})
    return member


def assign(request, lead, assignee, actor, audit_each=True, notify=True):
    """Give the lead to `assignee` (None clears it). Returns True when it changed."""
    old = lead.assignee
    if (old.id if old else None) == (assignee.id if assignee else None):
        return False
    lead.assignee = assignee
    lead.assigned_at = timezone.now() if assignee else None
    lead.save(update_fields=["assignee", "assigned_at"])
    record(
        lead, "assigned", actor,
        to=_who(assignee), to_id=str(assignee.id) if assignee else None, previous=_who(old),
    )
    # The company's activity log shows what happens to the company's own contacts. What an employee does with their own contacts is not
    # written there: the log carries the contact's name, and the admins are not meant to see it.
    if audit_each and is_company(lead) and is_company_owned(lead):
        audit.log(
            request, lead.workspace, "lead.assigned", "lead", lead.id, lead.name,
            {"to": _who(assignee), "previous": _who(old)}, actor=actor,
        )
    webhooks.enqueue(
        lead.workspace, "lead.assigned", lead,
        {"previous_assignee": ({"id": str(old.id), "name": old.full_name, "email": old.email} if old else None)},
    )
    if assignee is not None and notify:
        notify_assignee(lead, assignee, actor)
    return True


def _who(member):
    if member is None:
        return None
    return member.full_name or member.email


def notify_assignee(lead, assignee, actor):
    """E-mail the colleague a lead was given to. Not sent when they gave it to themselves. Never raises."""
    if not assignee.email or (actor is not None and assignee.user_id == actor.id):
        return
    lang = member_language(assignee)
    by = person_name(actor) or tr(lang, "A colleague")
    lines = [tr(lang, "{by} gave you a lead.", by=by), tr(lang, "Name: {name}", name=lead.name)]
    for label, value in (("Email", lead.email), ("Phone", lead.phone), ("Company", lead.company)):
        if value:
            lines.append(tr(lang, label + ": {value}", value=value))
    if lead.note:
        lines.append(tr(lang, "Message: {value}", value=lead.note))
    try:
        send_brand_email(
            assignee.email, tr(lang, "A lead was assigned to you: {name}", name=lead.name),
            tr(lang, "A lead was assigned to you"), lines,
            button_text=tr(lang, "Open your contacts"), button_url=f"{settings.WEB_BASE_URL}/app/contacts?lead={lead.id}",
            lang=lang,
        )
        record(lead, "emailed", None, to=assignee.email, reason="assigned")
    except Exception:
        pass


# ---------------------------------------------------------------- notes
def add_note(lead, actor, body):
    note = LeadNote.objects.create(lead=lead, author=actor, author_name=person_name(actor), body=body)
    record(lead, "note_added", actor, note_id=str(note.id))
    return note
