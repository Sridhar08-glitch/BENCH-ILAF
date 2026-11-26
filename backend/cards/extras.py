"""Which extras (video, shop, hours, booking ...) a card may have, and whose they are.

A company decides what its employees may add (operations.rules: "extras" and "extra_kinds"). Owners, admins, the company's own card and
personal accounts are not limited. A card whose owner is limited keeps what it already has but cannot get new extras of a kind that
is not allowed, and the public page does not show them.
"""
from ilaf.errors import ApiError
from operations.rules import EXTRA_KINDS, extras_for


def allowed_kinds(card):
    """The extras this card may have."""
    workspace = card.workspace
    if workspace.kind != "company" or card.is_company or card.member_id is None:
        return list(EXTRA_KINDS)
    return extras_for(workspace, card.member)


def is_allowed(card, kind):
    return kind in allowed_kinds(card)


def check_allowed(card, kind):
    """Refuse adding or changing an extra of a kind the company does not allow on this card."""
    if not is_allowed(card, kind):
        raise ApiError("feature_unavailable", "This feature is not available for your company right now.", 403)
