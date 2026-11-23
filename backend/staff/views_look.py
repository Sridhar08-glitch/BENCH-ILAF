"""Reads that leave a trace: a staff member looking at the public page of a card is written to the audit log (category Look)."""
from rest_framework.response import Response

from ilaf.errors import validation_error

from . import services
from .permissions import StaffView
from .views_customers import get_card

LOOKS = {"public_page": "look.public_page"}


class CardLookView(StaffView):
    """The screen calls this when a staff member opens a card's public page. Every role may: it only records a look."""

    perm = "view"
    write_roles = ("read_only", "support", "admin")

    def post(self, request, card_id):
        card = get_card(card_id)
        what = str((request.data if isinstance(request.data, dict) else {}).get("what") or "public_page")
        if what not in LOOKS:
            raise validation_error({"what": ["Choose what was looked at."]})
        services.log_look(request, LOOKS[what], "card", card.id, card.name, {"company": str(card.workspace_id)})
        return Response({"ok": True})
