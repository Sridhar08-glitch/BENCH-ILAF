"""The actions an owner or admin can run on members and cards, one item at a time.

Each function either does its job or raises ApiError with a plain reason. The single-item endpoints let
the error through; the bulk endpoints catch it and put the reason in that item's result, so one refused
item never stops the others."""
import uuid

from django.db import transaction
from django.utils import timezone

from billing.services import is_live
from cards.models import Card
from cards.services import delete_card
from ilaf.errors import ApiError
from ilaf.i18n import localise_message
from workspaces.models import Member
from workspaces.services import restore_member_card, suspend_member_card

from . import audit

MAX_BULK = 200
CARD_POLICIES = ("keep", "reassign", "delete")


def refuse(message, code="forbidden", status=403):
    raise ApiError(code, message, status)


# ---------------------------------------------------------------- cards
def check_can_manage_card(actor, card):
    """An admin may not publish, suspend, delete or hand over the card of the owner or of another admin; only the
    owner may. Anyone may act on a card they hold themselves, and the owner may act on every card."""
    holder = card.member if card.member_id else None
    if holder is None or actor is None or holder.id == actor.id or actor.role == "owner":
        return
    if holder.role in ("owner", "admin"):
        refuse("Only the owner can change the card of the owner or of an admin.")


def publish_card(request, card, actor, extra=None):
    check_can_manage_card(actor, card)
    if card.status == "suspended":
        refuse("This card is suspended. Restore it first.")
    if card.status == "published":
        refuse("This card is already published.", "validation_error", 400)
    if not is_live(card.workspace):
        refuse("An active plan is required to publish.", "subscription_required", 402)
    if not card.name:
        refuse("Add a name before publishing.", "validation_error", 400)
    card.status = "published"
    card.save(update_fields=["status", "updated_at"])
    audit.log(request, card.workspace, "card.published", "card", card.id, card.name, {"actor_role": actor.role, **(extra or {})})


def unpublish_card(request, card, actor, extra=None):
    check_can_manage_card(actor, card)
    if card.status == "suspended":
        refuse("This card is suspended. Restore it first.")
    if card.status == "draft":
        refuse("This card is not published.", "validation_error", 400)
    card.status = "draft"
    card.save(update_fields=["status", "updated_at"])
    audit.log(request, card.workspace, "card.unpublished", "card", card.id, card.name, {"actor_role": actor.role, **(extra or {})})


def suspend_card(card):
    if card.status == "suspended":
        refuse("This card is already suspended.", "validation_error", 400)
    card.status_before_suspend = card.status
    card.status = "suspended"
    card.save(update_fields=["status", "status_before_suspend", "updated_at"])


def restore_card(card):
    if card.status != "suspended":
        refuse("This card is not suspended.", "validation_error", 400)
    if card.staff_hold:
        refuse("This card was suspended by our support team. Please contact support.", "card_held_by_staff")
    if card.member_id and card.member.status == "suspended":
        refuse("The person holding this card is suspended. Restore them first.", "validation_error", 400)
    card.status = card.status_before_suspend or "draft"
    card.save(update_fields=["status", "updated_at"])


def bulk_suspend_card(request, card, actor, extra=None):
    check_can_manage_card(actor, card)
    suspend_card(card)
    audit.log(request, card.workspace, "card.suspended", "card", card.id, card.name, extra or {})


def bulk_restore_card(request, card, actor, extra=None):
    check_can_manage_card(actor, card)
    restore_card(card)
    audit.log(request, card.workspace, "card.restored", "card", card.id, card.name, extra or {})


def remove_card(request, card, actor, extra=None):
    check_can_manage_card(actor, card)
    audit.log(request, card.workspace, "card.deleted", "card", card.id, card.name, {"public_code": card.public_code, **(extra or {})})
    delete_card(card)


def reassign_card(request, workspace, card, target, reset_details=False, extra=None, actor=None):
    """Hand a company card to another member (or to nobody). The public code, slug, QR and link stay as they are.

    One card per seat: the new holder must not already have a card. A suspended card comes back live
    when the new holder is active; a suspended holder keeps it suspended."""
    if card.workspace_id != workspace.id:
        refuse("Card not found.", "not_found", 404)
    check_can_manage_card(actor, card)
    if target is not None and target.workspace_id != workspace.id:
        refuse("That person is not in this company.", "not_found", 404)
    if target is None and card.member_id is None:
        refuse("This card is already unassigned.", "validation_error", 400)
    if target is not None:
        if card.member_id == target.id:
            refuse("This person already holds this card.", "validation_error", 400)
        other = target.cards.exclude(pk=card.pk).first()
        if other is not None:
            who = target.full_name or target.email
            refuse(
                f"{who} already has a card. Each team member can have one card, so free it up first or choose someone without a card.",
                "target_has_card", 409,
            )
    before = {
        "member_id": str(card.member_id) if card.member_id else None,
        "email": card.member.email if card.member_id else None,
        "status": card.status,
    }
    with transaction.atomic():
        card.member = target
        card.owner = target.user if target is not None else None
        if target is not None and target.status == "suspended":
            if card.status != "suspended":
                card.status_before_suspend = card.status
                card.status = "suspended"
        elif card.status == "suspended":
            card.status = card.status_before_suspend or "draft"
        if reset_details and target is not None:
            name = target.full_name or (target.user.full_name if target.user else "")
            if name:
                card.name = name[:120]
            card.title = (target.title or "")[:120]
        card.save()
    audit.log(
        request, workspace, "card.reassigned", "card", card.id, card.name,
        {"from": before, "to": {"member_id": str(target.id), "email": target.email} if target else None,
         "status_after": card.status, "public_code": card.public_code, **(extra or {})},
    )


# ---------------------------------------------------------------- members
def _end_sessions(member):
    """Someone who loses (or is demoted in) a seat has to sign in again: their refresh tokens are revoked."""
    if member.user_id:
        from accounts.services import revoke_refresh_tokens

        revoke_refresh_tokens(member.user)


def check_can_manage(actor, target):
    if target.role == "owner":
        refuse("The owner cannot be changed or removed.")
    if target.role == "admin" and actor.role != "owner":
        refuse("Only the owner can change an admin.")


def member_suspend(request, workspace, actor, target, extra=None):
    check_can_manage(actor, target)
    if target.id == actor.id:
        refuse("You cannot suspend yourself.")
    if target.status == "suspended":
        refuse("Already suspended.", "validation_error", 400)
    target.status = "suspended"
    suspend_member_card(target)
    target.save()
    _end_sessions(target)
    audit.log(request, workspace, "member.suspended", "member", target.id, target.full_name or target.email, {"email": target.email, **(extra or {})})


def member_restore(request, workspace, actor, target, extra=None):
    check_can_manage(actor, target)
    if target.status != "suspended":
        refuse("This person is not suspended.", "validation_error", 400)
    target.status = "active" if target.user_id else "invited"
    restore_member_card(target)
    target.save()
    audit.log(request, workspace, "member.restored", "member", target.id, target.full_name or target.email, {"email": target.email, **(extra or {})})


def member_set_role(request, workspace, actor, target, role, extra=None):
    check_can_manage(actor, target)
    if role not in ("admin", "employee"):
        refuse("Choose admin or employee.", "validation_error", 400)
    if actor.role != "owner":
        refuse("Only the owner can change roles.")
    if target.role == role:
        refuse(f"Already {role}.", "validation_error", 400)
    before = target.role
    target.role = role
    target.save(update_fields=["role"])
    if before == "admin" and role == "employee":
        _end_sessions(target)
    audit.log(request, workspace, "member.role_changed", "member", target.id, target.full_name or target.email,
              {"email": target.email, "from": before, "to": role, **(extra or {})})


def member_set_department(request, workspace, actor, target, department, extra=None):
    if department is not None and department.workspace_id != workspace.id:
        refuse("Department not found.", "not_found", 404)
    if target.department_id == (department.id if department else None):
        refuse("Already in that department.", "validation_error", 400)
    before = target.department.name if target.department_id else None
    target.department = department
    target.save(update_fields=["department"])
    audit.log(request, workspace, "member.department_changed", "member", target.id, target.full_name or target.email,
              {"email": target.email, "from": before, "to": department.name if department else None, **(extra or {})})


def member_publish(request, workspace, actor, target, extra=None):
    card = target.cards.first()
    if card is None:
        refuse("This person has no card.", "validation_error", 400)
    publish_card(request, card, actor, extra)


def member_unpublish(request, workspace, actor, target, extra=None):
    card = target.cards.first()
    if card is None:
        refuse("This person has no card.", "validation_error", 400)
    unpublish_card(request, card, actor, extra)


def member_remove(request, workspace, actor, target, card_policy="keep", reassign_to=None, extra=None):
    """Remove a member and free the seat. `card_policy` says what happens to their card:
    keep (it stays, suspended, with the company), reassign (to `reassign_to`, a member, or to nobody)
    or delete. Leads always stay with the company."""
    check_can_manage(actor, target)
    if target.id == actor.id:
        refuse("You cannot remove yourself.")
    if card_policy not in CARD_POLICIES:
        refuse("Choose what happens to the card: keep it, reassign it or delete it.", "validation_error", 400)
    new_holder = None
    if card_policy == "reassign" and reassign_to:
        new_holder = Member.objects.filter(workspace=workspace, pk=reassign_to).first()
        if new_holder is None:
            refuse("The person to receive the card is not in this company.", "not_found", 404)
        if new_holder.id == target.id:
            refuse("Choose someone else to receive the card.", "validation_error", 400)
    cards = list(target.cards.all())
    with transaction.atomic():
        for card in cards:
            if card_policy == "reassign":
                reassign_card(request, workspace, card, new_holder, extra={"reason": "offboarding", **(extra or {})}, actor=actor)
            elif card_policy == "delete":
                remove_card(request, card, actor, {"reason": "offboarding"})
            else:
                suspend_member_card(target)
        if card_policy == "keep":
            target.cards.update(member=None)
        audit.log(
            request, workspace, "member.removed", "member", target.id, target.full_name or target.email,
            {"email": target.email, "role": target.role, "card_policy": card_policy,
             "cards": [str(c.id) for c in cards],
             "reassigned_to": new_holder.email if new_holder else None, **(extra or {})},
        )
        user = target.user
        target.delete()
        if user is not None:
            from accounts.services import revoke_refresh_tokens

            revoke_refresh_tokens(user)


# ---------------------------------------------------------------- bulk
MEMBER_ACTIONS = ("publish", "unpublish", "suspend", "restore", "role", "department", "remove")
CARD_ACTIONS = ("publish", "unpublish", "suspend", "restore", "delete")


def _parse_ids(raw):
    from ilaf.errors import validation_error

    if not isinstance(raw, list) or not raw:
        raise validation_error({"ids": ["Choose at least one item."]})
    if len(raw) > MAX_BULK:
        raise validation_error({"ids": [f"Choose at most {MAX_BULK} items at a time."]})
    ids, seen = [], set()
    for value in raw:
        try:
            key = str(uuid.UUID(str(value)))
        except ValueError:
            raise validation_error({"ids": [f"{value} is not a valid id."]})
        if key not in seen:
            seen.add(key)
            ids.append(key)
    return ids


def run_bulk(request, workspace, actor, kind, data):
    """Run one action on a list of members or cards. Returns {action, total, ok, failed, results}."""
    from ilaf.errors import validation_error

    actions = MEMBER_ACTIONS if kind == "members" else CARD_ACTIONS
    action = data.get("action")
    if action not in actions:
        raise validation_error({"action": [f"Choose one of: {', '.join(actions)}."]})
    ids = _parse_ids(data.get("ids"))
    options = {}
    if kind == "members" and action == "role":
        options["role"] = data.get("role")
        if options["role"] not in ("admin", "employee"):
            raise validation_error({"role": ["Choose admin or employee."]})
        if actor.role != "owner":
            raise ApiError("forbidden", "Only the owner can change roles.", 403)
    if kind == "members" and action == "department":
        from .models import Department

        raw = data.get("department_id")
        options["department"] = None
        if raw:
            try:
                uuid.UUID(str(raw))
            except ValueError:
                raise validation_error({"department_id": ["Department not found."]})
            options["department"] = Department.objects.filter(workspace=workspace, pk=raw).first()
            if options["department"] is None:
                raise validation_error({"department_id": ["Department not found."]})
    if kind == "members" and action == "remove":
        options["card_policy"] = data.get("card") or "keep"
        options["reassign_to"] = data.get("reassign_to")
        if options["card_policy"] not in CARD_POLICIES:
            raise validation_error({"card": ["Choose keep, reassign or delete."]})
        if options["card_policy"] == "reassign" and len(ids) > 1 and options["reassign_to"]:
            raise validation_error({"reassign_to": ["One person can only receive one card. Reassign to nobody, or remove people one at a time."]})

    bulk_id = uuid.uuid4().hex[:12]
    extra = {"bulk_id": bulk_id}
    model_qs = (
        Member.objects.filter(workspace=workspace).select_related("user", "department")
        if kind == "members" else Card.objects.filter(workspace=workspace).select_related("member", "workspace")
    )
    found = {str(o.pk): o for o in model_qs.filter(pk__in=ids)}
    results = []
    for item_id in ids:
        obj = found.get(item_id)
        if obj is None:
            results.append({"id": item_id, "name": "", "ok": False, "reason": localise_message(request, "Not found in this company."), "code": "not_found"})
            continue
        name = (obj.full_name or obj.email) if kind == "members" else (obj.name or "Card")
        try:
            with transaction.atomic():
                if kind == "members":
                    _member_action(request, workspace, actor, obj, action, options, extra)
                else:
                    _card_action(request, workspace, actor, obj, action, extra)
            results.append({"id": item_id, "name": name, "ok": True, "reason": None, "code": None})
        except ApiError as exc:
            results.append({"id": item_id, "name": name, "ok": False, "reason": localise_message(request, exc.message), "code": exc.code})
    ok = sum(1 for r in results if r["ok"])
    audit.log(
        request, workspace, "bulk.run", kind, bulk_id, "",
        {"kind": kind, "action": action, "total": len(results), "ok": ok, "failed": len(results) - ok,
         "ids": ids, **({"role": options["role"]} if "role" in options else {})},
    )
    return {"action": action, "total": len(results), "ok": ok, "failed": len(results) - ok, "results": results}


def _member_action(request, workspace, actor, target, action, options, extra):
    if action == "publish":
        member_publish(request, workspace, actor, target, extra)
    elif action == "unpublish":
        member_unpublish(request, workspace, actor, target, extra)
    elif action == "suspend":
        member_suspend(request, workspace, actor, target, extra)
    elif action == "restore":
        member_restore(request, workspace, actor, target, extra)
    elif action == "role":
        member_set_role(request, workspace, actor, target, options["role"], extra)
    elif action == "department":
        check_can_manage(actor, target)
        member_set_department(request, workspace, actor, target, options["department"], extra)
    elif action == "remove":
        member_remove(request, workspace, actor, target, options["card_policy"], options["reassign_to"], extra)


def _card_action(request, workspace, actor, card, action, extra):
    if action == "publish":
        publish_card(request, card, actor, extra)
    elif action == "unpublish":
        unpublish_card(request, card, actor, extra)
    elif action == "suspend":
        bulk_suspend_card(request, card, actor, extra)
    elif action == "restore":
        bulk_restore_card(request, card, actor, extra)
    elif action == "delete":
        remove_card(request, card, actor, extra)
