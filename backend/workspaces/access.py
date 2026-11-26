"""Who may touch which workspace. Every workspace, card, lead and member route goes through here."""
from django.core.exceptions import ValidationError as DjangoValidationError
from django.http import Http404

from ilaf.errors import ApiError

from security.services import refuse_if_two_factor_missing

from .models import Member, Workspace

MANAGER_ROLES = ("owner", "admin")
ALL_ROLES = ("owner", "admin", "employee")


def get_workspace_and_member(user, workspace_id, roles=ALL_ROLES):
    """Return (workspace, member) for an active member, else 404 (not a member) or 403 (wrong role).

    A non-member gets 404 so the existence of other people's workspaces is never revealed.
    """
    try:
        member = Member.objects.select_related("workspace", "workspace__policy").get(
            workspace_id=workspace_id, user=user, status="active"
        )
    except (Member.DoesNotExist, ValueError, DjangoValidationError):  # a badly formed id is simply "not found"
        raise Http404
    refuse_if_pending_deletion(member)
    refuse_if_two_factor_missing(user, member)
    if member.role not in roles:
        raise ApiError("forbidden", "You do not have permission to do that.", 403)
    return member.workspace, member


def refuse_if_pending_deletion(member):
    """A company that is waiting to be deleted is closed to everyone except its owner, who can still restore it."""
    if member.workspace.suspended_at is not None:
        raise ApiError(
            "workspace_suspended", "This company has been suspended. Please contact support.", 403
        )
    if member.workspace.deletion_due_at is not None and member.role != "owner":
        raise ApiError(
            "workspace_pending_deletion", "This company is scheduled for deletion and is closed for now.", 403
        )


def active_membership(user, workspace_id):
    return Member.objects.filter(workspace_id=workspace_id, user=user, status="active").first()


def card_for_user(user, card_id, roles=ALL_ROLES):
    """Return (card, member) if the user may use this card: managers any card in their workspace,
    employees only the card assigned to them. Anything else is a 404."""
    from cards.models import Card

    try:
        card = Card.objects.select_related("workspace").get(pk=card_id)
    except (Card.DoesNotExist, ValueError, DjangoValidationError):
        raise Http404
    member = active_membership(user, card.workspace_id)
    if member is None:
        raise Http404
    refuse_if_pending_deletion(member)
    refuse_if_two_factor_missing(user, member)
    if member.role == "employee" and card.member_id != member.id:
        raise Http404
    if member.role not in roles:
        raise ApiError("forbidden", "You do not have permission to do that.", 403)
    return card, member


def visible_cards(member):
    """Queryset of the cards this member may see in their workspace."""
    from cards.models import Card

    qs = Card.objects.filter(workspace_id=member.workspace_id)
    if member.role == "employee":
        qs = qs.filter(member_id=member.id)
    return qs


def commerce_cards(member):
    """The cards whose orders and bookings this member may see: their own cards, and the company's own card for owners and
    admins. Nobody sees what came in on another person's card, an admin included."""
    from django.db.models import Q

    from cards.models import Card

    mine = Q(member_id=member.id)
    if member.user_id:
        mine |= Q(owner_id=member.user_id, is_company=False)
    if member.role in MANAGER_ROLES:
        # The company card, and a card that no person holds any more (its holder was removed and the card was kept): both are the company's.
        mine |= Q(is_company=True) | Q(member__isnull=True)
    return Card.objects.filter(workspace_id=member.workspace_id).filter(mine)


def commerce_orders(member):
    """The orders this member may see: those of their own cards (and the company card for owners and admins), and, for owners and admins,
    those an employee shared. When the card an order came in on has been deleted, nobody owns it any more, so owners and admins keep it."""
    from django.db.models import Q

    from orders.models import Order

    q = Q(card__in=commerce_cards(member))
    if member.role in MANAGER_ROLES:
        # Also the orders an employee shared with the company (their switch was on when the order came in; see workspaces/sharing.py).
        q |= Q(card__isnull=True, workspace_id=member.workspace_id) | Q(shared_with_company=True, workspace_id=member.workspace_id)
    return Order.objects.filter(q)


def commerce_bookings(member):
    """The bookings this member may see: the same rule as the orders."""
    from django.db.models import Q

    from cards.models import Booking

    q = Q(card__in=commerce_cards(member))
    if member.role in MANAGER_ROLES:
        q |= Q(shared_with_company=True, card__workspace_id=member.workspace_id)
    return Booking.objects.filter(q)
