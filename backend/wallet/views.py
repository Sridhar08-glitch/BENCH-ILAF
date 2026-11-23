"""GET cards/{id}/wallet/google -> {save_url}"""
from rest_framework.response import Response
from rest_framework.views import APIView

from billing.services import is_live
from ilaf.errors import ApiError
from staff.flags import require_flag
from workspaces.access import card_for_user

from . import passes


class GoogleWalletView(APIView):
    def get(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        require_flag("wallet_google", card.workspace)
        # Configuration first: when the owner has not set Google up, every answer is the same 503.
        passes.load_service_account()
        if card.status != "published":
            raise ApiError("card_not_published", "Publish the card first, then add it to Google Wallet.", 409)
        if not is_live(card.workspace):
            raise ApiError("subscription_required", "An active plan is required to add this card to Google Wallet.", 402)
        url, warnings = passes.save_link(card, request)
        return Response({"save_url": url, "warnings": warnings})
