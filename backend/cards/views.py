import uuid

from django.core.files.storage import default_storage
from django.db import transaction
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from billing.services import is_live
from ilaf.errors import ApiError, validation_error
from ilaf.files import process_pdf
from ilaf.images import process_cover, process_icon_png, process_jpeg
from ilaf.throttles import SlugCheckThrottle, UserApiThrottle
from ilaf.utils import absolute_url, file_url
from workspaces.access import MANAGER_ROLES, card_for_user, get_workspace_and_member, visible_cards

from operations import audit, changes, rules
from operations.actions import check_can_manage_card, restore_card, suspend_card

from . import linktools
from .models import Card, CardItem
from .serializers import CardWriteSerializer
from .services import (
    apply_card_data, card_json, check_can_create, copy_card_files, delete_card, make_default, new_card, stats_for,
)
from .slugs import generate_public_code, normalise_slug, slug_problem, suggest_slug


def _card_response(card, request, status=200, submitted=None):
    """The card as JSON, with what the signed-in person may change and which changes are waiting."""
    from workspaces.access import active_membership

    waiting = list(getattr(card, "waiting_changes", []) or [])
    card = Card.objects.select_related("workspace", "owner", "member__department").prefetch_related("items").get(pk=card.pk)
    data = card_json(card, request)
    member = active_membership(request.user, card.workspace_id) if request.user.is_authenticated else None
    data["field_access"] = rules.access_for(card.workspace, member)
    data["pending_changes"] = [
        changes.pending_json(c) for c in card.change_requests.filter(status="pending")
    ]
    data["submitted_for_approval"] = [f for f, _, _ in waiting] if submitted is None else submitted
    return Response(data, status=status)


class WorkspaceCardsView(APIView):
    def get(self, request, workspace_id):
        _, member = get_workspace_and_member(request.user, workspace_id)
        cards = list(
            visible_cards(member).select_related("workspace", "owner", "member__department").prefetch_related("items")
        )
        stats = stats_for([c.id for c in cards])
        return Response([card_json(c, request, stats[c.id]) for c in cards])

    def post(self, request, workspace_id):
        workspace, member = get_workspace_and_member(request.user, workspace_id)
        ser = CardWriteSerializer(data=request.data, context={"request": request})
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        check_can_create(workspace, member)
        if not data.get("name"):
            raise validation_error({"name": ["Enter a name for the card."]})
        with transaction.atomic():
            card = new_card(workspace, request.user, member)
            # An employee creating a card is held to the company's field rules exactly like when editing one.
            apply_card_data(card, data, member.role, member=member, enforce=True, creating=True)
        return _card_response(card, request, 201)


MAX_CARD_FILES = 5


class ReorderCardsView(APIView):
    """Put a person's cards in the order they chose: `ids` lists every card of the list, first to last."""

    def post(self, request, workspace_id):
        _, member = get_workspace_and_member(request.user, workspace_id)
        data = request.data if isinstance(request.data, dict) else {}
        ids = data.get("ids")
        mine = {str(c.id): c for c in visible_cards(member)}
        if not isinstance(ids, list) or len(ids) != len(set(map(str, ids))) or set(map(str, ids)) != set(mine):
            raise validation_error({"ids": ["List every card once, in the order you want."]})
        with transaction.atomic():
            for position, card_id in enumerate(ids):
                Card.objects.filter(pk=mine[str(card_id)].pk).update(sort_order=position)
        cards = list(visible_cards(member).select_related("workspace", "owner", "member__department").prefetch_related("items"))
        stats = stats_for([c.id for c in cards])
        return Response([card_json(c, request, stats[c.id]) for c in cards])


class MakeDefaultView(APIView):
    """This card is the one "My QR" and event mode open first."""

    def post(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        with transaction.atomic():
            make_default(card)
            card.save(update_fields=["is_default"])
        return _card_response(card, request)


class CardDetailView(APIView):
    def get(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        return _card_response(card, request)

    def patch(self, request, card_id):
        card, member = card_for_user(request.user, card_id)
        if card.status == "suspended" and member.role not in MANAGER_ROLES:
            raise ApiError("forbidden", "This card is suspended.", 403)
        ser = CardWriteSerializer(data=request.data, partial=True, context={"request": request})
        ser.is_valid(raise_exception=True)
        apply_card_data(card, ser.validated_data, member.role, member=member, enforce=True)
        if card.waiting_changes:
            changes.submit_requests(request, card, request.user, card.waiting_changes)
        return _card_response(card, request)

    def delete(self, request, card_id):
        card, member = card_for_user(request.user, card_id, MANAGER_ROLES)
        check_can_manage_card(member, card)
        audit.log(request, card.workspace, "card.deleted", "card", card.id, card.name, {"public_code": card.public_code})
        delete_card(card)
        return Response(status=204)


class CardPhotoView(APIView):
    def post(self, request, card_id):
        card, member = card_for_user(request.user, card_id)
        content = process_jpeg(request.FILES.get("file"), 800, f"{card.id.hex[:8]}")
        permission = rules.photo_permission(card.workspace, member)
        if permission == "locked":
            message = "Your company has set the photo. Ask an admin if it needs to change."
            raise ApiError("field_locked", message, 403, {"photo": [message]})
        if permission == "approval":
            change = changes.create_photo_request(request, card, request.user, content)
            return Response({
                "photo_url": file_url(request, card.photo), "pending": True, "change_id": str(change.id),
                "message": "Your new photo was sent to an admin. Your card keeps the current photo until it is approved.",
            })
        old_name = card.photo.name
        card.photo.save(content.name, content, save=True)
        if old_name:
            card.photo.storage.delete(old_name)
        return Response({"photo_url": file_url(request, card.photo)})


class CardCoverView(APIView):
    """Wide cover picture for the glass, bands and magazine faces: JPG, PNG or WebP up to 3 MB, stored as 1280x800 JPEG."""

    def post(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        content = process_cover(request.FILES.get("file"), f"{card.id.hex[:8]}")
        old_name = card.cover.name
        card.cover.save(content.name, content, save=True)
        if old_name:
            card.cover.storage.delete(old_name)
        return Response({"cover_url": file_url(request, card.cover)})


class CardIconView(APIView):
    """Upload an image to use as a button icon. Stored as a 128 px PNG; SVG is refused."""

    def post(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        content = process_icon_png(request.FILES.get("file"), 128, f"{card.id.hex[:8]}")
        name = default_storage.save(f"icons/{content.name}", content)
        return Response({"image_url": absolute_url(request, default_storage.url(name))})


class CardFileView(APIView):
    """Upload a PDF for a "Download file" button: up to 10 MB, kept under this card's own folder with a random name."""

    def post(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        content = process_pdf(request.FILES.get("file"), "doc")
        folder = f"files/{card.id.hex}"
        existing = default_storage.listdir(folder)[1] if default_storage.exists(folder) else []
        if len(existing) >= MAX_CARD_FILES:
            raise ApiError("file_limit", "A card can hold up to 5 uploaded files. Remove a Download file button first.", 409)
        name = default_storage.save(f"{folder}/{content.name}", content)
        return Response({
            "file_url": absolute_url(request, default_storage.url(name)),
            "size": content.size,
        }, status=201)


class PublishView(APIView):
    def post(self, request, card_id):
        card, member = card_for_user(request.user, card_id)
        check_can_manage_card(member, card)
        if card.status == "suspended":
            raise ApiError("forbidden", "This card is suspended.", 403)
        if not is_live(card.workspace):
            raise ApiError("subscription_required", "An active plan is required to publish.", 402)
        if not card.name:
            raise validation_error({"name": ["Add a name before publishing."]})
        card.status = "published"
        card.save(update_fields=["status", "updated_at"])
        audit.log(request, card.workspace, "card.published", "card", card.id, card.name, {"actor_role": member.role})
        return _card_response(card, request)


class UnpublishView(APIView):
    def post(self, request, card_id):
        card, member = card_for_user(request.user, card_id)
        check_can_manage_card(member, card)
        if card.status == "suspended":
            raise ApiError("forbidden", "This card is suspended.", 403)
        card.status = "draft"
        card.save(update_fields=["status", "updated_at"])
        audit.log(request, card.workspace, "card.unpublished", "card", card.id, card.name, {"actor_role": member.role})
        return _card_response(card, request)


class SuspendView(APIView):
    """Take a company card offline (owner and admin). The card remembers what it was and comes back on restore."""

    def post(self, request, card_id):
        card, member = card_for_user(request.user, card_id, MANAGER_ROLES)
        if card.workspace.kind != "company":
            raise validation_error({"card": ["Only company cards can be suspended."]})
        check_can_manage_card(member, card)
        suspend_card(card)
        audit.log(request, card.workspace, "card.suspended", "card", card.id, card.name)
        return _card_response(card, request)


class RestoreView(APIView):
    def post(self, request, card_id):
        card, member = card_for_user(request.user, card_id, MANAGER_ROLES)
        check_can_manage_card(member, card)
        restore_card(card)
        audit.log(request, card.workspace, "card.restored", "card", card.id, card.name)
        return _card_response(card, request)


class DuplicateView(APIView):
    def post(self, request, card_id):
        card, member = card_for_user(request.user, card_id)
        check_can_create(card.workspace, member)
        with transaction.atomic():
            copy = new_card(
                card.workspace, request.user, member,
                name=(card.name + " (copy)")[:120], title=card.title, company=card.company,
                address=card.address, save_contact=card.save_contact, label=(card.label + " (copy)")[:40] if card.label else "",
            )
            copy.vc = card.vc
            copy.design = card.design
            if card.cover:
                copy.cover.save(f"{copy.id.hex[:8]}-{uuid.uuid4().hex[:6]}.jpg", card.cover.file, save=False)
            if card.photo:
                copy.photo.save(f"{copy.id.hex[:8]}-{uuid.uuid4().hex[:6]}.jpg", card.photo.file, save=False)
            copy.save()
            for item in card.items.all():
                CardItem.objects.create(
                    card=copy, kind=item.kind, value=item.value, label=item.label, on=item.on,
                    order=item.order, icon=item.icon,
                )
            copy_card_files(card, copy)
        return _card_response(copy, request, 201)


class SlugCheckView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [SlugCheckThrottle]

    def get(self, request):
        slug = normalise_slug(request.query_params.get("slug"))
        card = None
        card_id = request.query_params.get("card_id")
        if card_id:
            try:
                card = Card.objects.filter(pk=card_id).first()
            except Exception:  # not a valid id: treat as no card
                card = None
        problem = slug_problem(slug, card) if slug else ("invalid", "Enter an address.")
        if problem is None:
            return Response({"available": True, "suggestion": None})
        return Response({"available": False, "suggestion": suggest_slug(slug or "card")})


class ResolveLinkThrottle(SimpleRateThrottle):
    """Limits the outbound link fetch per signed-in user."""

    scope = "resolve_link"

    def get_rate(self):
        from django.conf import settings

        return settings.ILAF_THROTTLE_RATES.get(self.scope)

    def get_cache_key(self, request, view):
        return self.cache_format % {"scope": self.scope, "ident": request.user.pk}


class ResolveLinkView(APIView):
    throttle_classes = [ResolveLinkThrottle, UserApiThrottle]

    def post(self, request):
        raw = request.data.get("url") if isinstance(request.data, dict) else None
        if not isinstance(raw, str) or not raw.strip():
            raise validation_error({"url": ["Enter a link."]})
        from ilaf.items import has_unsafe_scheme

        if has_unsafe_scheme(raw.strip()):
            raise validation_error({"url": ["This kind of link is not allowed."]})
        result = linktools.resolve_link(raw)
        favicon = None
        if result["favicon_name"]:
            favicon = absolute_url(request, default_storage.url(result["favicon_name"]))
        return Response({"url": result["url"], "title": result["title"], "favicon_url": favicon})
