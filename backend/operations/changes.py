"""Change requests: an employee's edit to an approval field waits here until an admin decides."""
import uuid

from django.conf import settings
from django.core.files.base import ContentFile
from django.core.files.storage import default_storage
from django.db import transaction
from django.utils import timezone

from cards.services import replace_items
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError
from ilaf.i18n import language_for_email, tr, user_language
from ilaf.utils import absolute_url, iso
from workspaces.models import Member

from . import audit
from .models import ChangeRequest
from .rules import FIELD_LABELS


def _label(field):
    return FIELD_LABELS.get(field, field)


def _remove_pending_file(change):
    if change.field == "photo" and isinstance(change.new_value, dict) and change.new_value.get("file"):
        try:
            default_storage.delete(change.new_value["file"])
        except Exception:  # a file that is already gone is fine
            pass


def pending_json(change):
    return {"id": str(change.id), "field": change.field, "created_at": iso(change.created_at)}


def change_json(change, request):
    card = change.card
    old, new = change.old_value, change.new_value
    if change.field == "photo":
        old = {"url": old.get("url")} if isinstance(old, dict) else None
        new = {"url": absolute_url(request, default_storage.url(new["file"]))} if isinstance(new, dict) and new.get("file") else None
    by = change.requested_by
    decider = change.decided_by
    return {
        "id": str(change.id),
        "card_id": str(card.id),
        "card_name": card.name,
        "field": change.field,
        "old": old,
        "new": new,
        "status": change.status,
        "requested_by": {"id": str(by.id), "full_name": by.full_name, "email": by.email} if by else None,
        "decided_by": {"id": str(decider.id), "full_name": decider.full_name, "email": decider.email} if decider else None,
        "decided_at": iso(change.decided_at),
        "reason": change.reason,
        "created_at": iso(change.created_at),
    }


def _admin_emails(workspace):
    return list(
        Member.objects.filter(workspace=workspace, role__in=("owner", "admin"), status="active", user__isnull=False)
        .values_list("email", flat=True)
    )


@transaction.atomic
def submit_requests(request, card, user, items):
    """Store the waiting changes of one card write: [(field, old, new)]. A new request replaces an older
    pending one for the same field. Admins get one email for the whole write."""
    created = []
    for field, old, new in items:
        for earlier in ChangeRequest.objects.filter(card=card, field=field, status="pending"):
            earlier.status = "superseded"
            earlier.save(update_fields=["status"])
            _remove_pending_file(earlier)
        change = ChangeRequest.objects.create(
            workspace=card.workspace, card=card, field=field, old_value=old, new_value=new, requested_by=user,
        )
        created.append(change)
        audit.log(
            request, card.workspace, "change.requested", "card", card.id, card.name,
            {"field": field, "change_id": str(change.id)}, actor=user,
        )
    if created:
        _notify_admins(card, user, [c.field for c in created])
    return created


def _notify_admins(card, user, fields):
    who = user.full_name or user.email
    url = f"{settings.WEB_BASE_URL}/app/fields?tab=approvals"
    for email in _admin_emails(card.workspace):
        lang = language_for_email(email)
        what = tr(lang, ", ").join(tr(lang, _label(f)) for f in fields)
        send_brand_email(
            email,
            tr(lang, "{who} asked for a change on {workspace}", who=who, workspace=card.workspace.name),
            tr(lang, "A change is waiting for your approval"),
            [tr(lang, "{who} wants to change {what} on their card. The card keeps its current details until you decide.",
                who=who, what=what)],
            tr(lang, "Review the change"),
            url,
            lang=lang,
        )


def create_photo_request(request, card, user, file_content):
    """Keep an uploaded photo aside until an admin approves it. Returns the ChangeRequest."""
    name = default_storage.save(f"pending/{card.id.hex[:8]}-{uuid.uuid4().hex[:8]}.jpg", file_content)
    old = {"url": card.photo.url if card.photo else None}
    return submit_requests(request, card, user, [("photo", old, {"file": name})])[0]


def _apply(change):
    card = change.card
    new = change.new_value
    if change.field in ("name", "title", "company", "address"):
        setattr(card, change.field, new or "")
        card.save(update_fields=[change.field, "updated_at"])
    elif change.field == "buttons":
        replace_items(card, list(new or []))
        card.save(update_fields=["updated_at"])
    elif change.field == "photo":
        name = (new or {}).get("file")
        if name and default_storage.exists(name):
            with default_storage.open(name) as handle:
                content = ContentFile(handle.read(), name=f"{card.id.hex[:8]}-{uuid.uuid4().hex[:6]}.jpg")
            old_name = card.photo.name
            card.photo.save(content.name, content, save=True)
            if old_name:
                card.photo.storage.delete(old_name)
            default_storage.delete(name)


def decide(request, change, approve, user, reason=""):
    """Approve (apply the change) or reject one pending request. Raises 409 when it is not pending."""
    with transaction.atomic():
        # Lock only the request row: PostgreSQL refuses FOR UPDATE on the nullable side of a join (requested_by can be empty).
        change = ChangeRequest.objects.select_for_update(of=("self",)).select_related("card", "workspace", "requested_by").get(pk=change.pk)
        if change.status != "pending":
            raise ApiError("not_pending", "This change has already been decided or withdrawn.", 409)
        if approve:
            _apply(change)
            change.status = "approved"
        else:
            change.status = "rejected"
            _remove_pending_file(change)
        change.decided_by = user
        change.decided_at = timezone.now()
        change.reason = (reason or "").strip()[:300]
        change.save()
        audit.log(
            request, change.workspace, "change.approved" if approve else "change.rejected", "card", change.card_id,
            change.card.name, {"field": change.field, "change_id": str(change.id), "reason": change.reason}, actor=user,
        )
    _notify_requester(change, approve)
    return change


def _notify_requester(change, approve):
    target = change.requested_by
    if target is None:
        return
    lang = user_language(target)
    what = tr(lang, _label(change.field))
    if approve:
        heading = tr(lang, "Your change was approved")
        text = tr(lang, "Your change to {what} on your card was approved and is now live.", what=what)
    else:
        heading = tr(lang, "Your change was not approved")
        text = tr(lang, "Your change to {what} on your card was not approved. Your card still shows the earlier details.", what=what)
    paragraphs = [text]
    if change.reason:
        paragraphs.append(tr(lang, "Reason from your admin: {reason}", reason=change.reason))
    send_brand_email(
        target.email, heading + " - " + change.workspace.name, heading, paragraphs,
        tr(lang, "Open my card"), f"{settings.WEB_BASE_URL}/app/cards/{change.card_id}", lang=lang,
        workspace=change.workspace,
    )


def withdraw(request, change, user):
    if change.status != "pending":
        raise ApiError("not_pending", "This change has already been decided or withdrawn.", 409)
    change.status = "withdrawn"
    change.decided_by = user
    change.decided_at = timezone.now()
    change.save()
    _remove_pending_file(change)
    return change
