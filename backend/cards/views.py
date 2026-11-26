import uuid

from django.core.files.storage import default_storage
from django.db import transaction
from django.db.models import Max
from django.http import Http404
from rest_framework.exceptions import ValidationError as DrfValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.throttling import SimpleRateThrottle
from rest_framework.views import APIView

from billing.services import ensure_trial, is_live
from ilaf.errors import ApiError, validation_error
from ilaf.files import process_pdf
from ilaf.images import process_cover, process_icon_png, process_jpeg
from ilaf.throttles import SlugCheckThrottle, UserApiThrottle
from ilaf.utils import absolute_url, clean_line, file_url
from workspaces.access import MANAGER_ROLES, card_for_user, commerce_cards, get_workspace_and_member, visible_cards

from operations import audit, changes, rules
from operations.actions import check_can_manage_card, restore_card, suspend_card

from . import extras, linktools, sections
from .features import require_rich_pages
from .models import Card, CardGalleryImage, CardItem, CardSection
from .serializers import CardWriteSerializer
from .services import (
    apply_card_data, card_json, check_can_create, check_video_upload, copy_card_files, delete_card, make_default, new_card,
    stats_for,
)
from .slugs import generate_public_code, normalise_slug, slug_problem, suggest_slug


def _card_response(card, request, status=200, submitted=None):
    """The card as JSON, with what the signed-in person may change and which changes are waiting."""
    from workspaces.access import active_membership

    waiting = list(getattr(card, "waiting_changes", []) or [])
    card = Card.objects.select_related("workspace", "owner", "member__department").prefetch_related("items").get(pk=card.pk)
    member = active_membership(request.user, card.workspace_id) if request.user.is_authenticated else None
    data = card_json(card, request, stats_for([card.id], set(commerce_cards(member).values_list("id", flat=True)) if member else None)[card.id])
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
        stats = stats_for([c.id for c in cards], set(commerce_cards(member).values_list("id", flat=True)))
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


class CompanyCardView(APIView):
    """The company's own card, for its own shop, hours or bookings. Only owners and admins make it, and only they reach it; it
    belongs to the company, not to a person. Asking again answers the card that exists."""

    def post(self, request, workspace_id):
        workspace, member = get_workspace_and_member(request.user, workspace_id)
        if workspace.kind != "company" or member.role not in MANAGER_ROLES:
            raise ApiError("forbidden", "You do not have permission to do that.", 403)
        existing = Card.objects.filter(workspace=workspace, is_company=True).first()
        if existing is not None:
            return _card_response(existing, request, 200)
        brand = workspace.brand or {}
        with transaction.atomic():
            card = new_card(workspace, request.user, None, is_company=True, is_default=False, sort_order=0, name=brand.get("company_name") or workspace.name)
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
        stats = stats_for([c.id for c in cards], set(commerce_cards(member).values_list("id", flat=True)))
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
        ensure_trial(card.workspace)
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
                address=card.address, bio=card.bio, save_contact=card.save_contact,
                label=(card.label + " (copy)")[:40] if card.label else "",
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


# ---------------------------------------------------------------- rich content (page styles)
def _rich_card(request, card_id):
    """The card for a write to its rich content: the usual card access, the page-styles switch and a paid plan."""
    from staff.flags import require_flag

    card, member = card_for_user(request.user, card_id)
    if card.status == "suspended" and member.role not in MANAGER_ROLES:
        raise ApiError("forbidden", "This card is suspended.", 403)
    require_flag("page_styles", card.workspace)
    require_rich_pages(card.workspace)
    return card, member


def _video_json(card, request):
    return {"video_url": file_url(request, card.video), "video_poster_url": file_url(request, card.video_poster)}


def _delete_file(field):
    name = field.name
    if name:
        field.delete(save=False)
        return True
    return False


class CardVideoView(APIView):
    """The card's video: an MP4 up to VIDEO_MAX_UPLOAD_BYTES, stored as uploaded (no conversion)."""

    def post(self, request, card_id):
        card, _ = _rich_card(request, card_id)
        extras.check_allowed(card, "video")
        upload = check_video_upload(request.FILES.get("file"))
        old_name = card.video.name
        card.video.save(f"{card.id.hex[:8]}-{uuid.uuid4().hex}.mp4", upload, save=False)
        card.save(update_fields=["video", "updated_at"])
        if old_name:
            card.video.storage.delete(old_name)
        return Response(_video_json(card, request))

    def delete(self, request, card_id):
        card, _ = _rich_card(request, card_id)
        _delete_file(card.video)
        _delete_file(card.video_poster)
        card.save(update_fields=["video", "video_poster", "updated_at"])
        return Response(status=204)


class CardVideoPosterView(APIView):
    """The still shown before the video plays: same rules as the cover picture."""

    def post(self, request, card_id):
        card, _ = _rich_card(request, card_id)
        content = process_cover(request.FILES.get("file"), f"{card.id.hex[:8]}-poster")
        old_name = card.video_poster.name
        card.video_poster.save(content.name, content, save=False)
        card.save(update_fields=["video_poster", "updated_at"])
        if old_name:
            card.video_poster.storage.delete(old_name)
        return Response(_video_json(card, request))


def _section_or_404(card, section_id):
    section = card.sections.filter(pk=section_id).first()
    if section is None:
        raise Http404
    return section


def _clean_section(kind, data, card, base=None):
    try:
        return sections.clean_section_data(kind, data, card, base=base)
    except DrfValidationError as exc:
        detail = exc.detail if isinstance(exc.detail, dict) else {"data": exc.detail}
        raise validation_error({f"data.{k}".rstrip("."): [str(m) for m in v] for k, v in detail.items()})


def _on_value(data):
    if "on" not in data:
        return None
    if not isinstance(data["on"], bool):
        raise validation_error({"on": ["Must be true or false."]})
    return data["on"]


class CardSectionsView(APIView):
    """The rich blocks under a card, in order."""

    def get(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        return Response([sections.section_json(s) for s in card.sections.all()])

    def post(self, request, card_id):
        card, _ = _rich_card(request, card_id)
        data = request.data if isinstance(request.data, dict) else {}
        kind = data.get("kind")
        sections.check_kind(kind)
        extras.check_allowed(card, kind)
        clean = _clean_section(kind, data.get("data"), card)
        on = _on_value(data)
        with transaction.atomic():
            sections.check_can_add(card, kind)
            order = (card.sections.aggregate(top=Max("order"))["top"] or 0) + 1 if card.sections.exists() else 0
            section = CardSection.objects.create(card=card, kind=kind, data=clean, on=True if on is None else on, order=order)
        return Response(sections.section_json(section), status=201)


class CardSectionDetailView(APIView):
    def patch(self, request, card_id, section_id):
        card, _ = _rich_card(request, card_id)
        section = _section_or_404(card, section_id)
        data = request.data if isinstance(request.data, dict) else {}
        if "kind" in data and data["kind"] != section.kind:
            raise validation_error({"kind": ["A section keeps its kind. Remove it and add another one instead."]})
        if "data" in data:
            section.data = _clean_section(section.kind, data["data"], card, base=section.data)
        on = _on_value(data)
        if on is not None:
            section.on = on
        section.save()
        return Response(sections.section_json(section))

    def delete(self, request, card_id, section_id):
        card, _ = _rich_card(request, card_id)
        _section_or_404(card, section_id).delete()
        return Response(status=204)


class ReorderSectionsView(APIView):
    """`ids` lists every section of the card, first to last."""

    def post(self, request, card_id):
        card, _ = _rich_card(request, card_id)
        data = request.data if isinstance(request.data, dict) else {}
        ids = data.get("ids")
        mine = {str(s.id): s for s in card.sections.all()}
        if not isinstance(ids, list) or len(ids) != len(set(map(str, ids))) or set(map(str, ids)) != set(mine):
            raise validation_error({"ids": ["List every section once, in the order you want."]})
        with transaction.atomic():
            for position, section_id in enumerate(ids):
                CardSection.objects.filter(pk=mine[str(section_id)].pk).update(order=position)
        return Response([sections.section_json(s) for s in card.sections.all()])


def _caption(data):
    raw = data.get("caption", "")
    if raw is None:
        return ""
    if not isinstance(raw, str):
        raise validation_error({"caption": ["Must be text."]})
    try:
        return clean_line(raw, 80)
    except DrfValidationError as exc:
        raise validation_error({"caption": [str(m) for m in exc.detail]})


class CardGalleryView(APIView):
    """Pictures of the gallery section: up to nine, each stored like a cover picture."""

    def get(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        return Response([sections.gallery_image_json(i, request) for i in card.gallery_images.all()])

    def post(self, request, card_id):
        card, _ = _rich_card(request, card_id)
        extras.check_allowed(card, "gallery")
        caption = _caption(request.data)
        content = process_cover(request.FILES.get("file"), f"{card.id.hex[:8]}-g")
        with transaction.atomic():
            count = card.gallery_images.count()
            if count >= sections.MAX_GALLERY_IMAGES:
                raise validation_error({"file": [f"A gallery holds up to {sections.MAX_GALLERY_IMAGES} pictures. Remove one first."]})
            image = CardGalleryImage.objects.create(card=card, image=content, caption=caption, order=count)
        return Response(sections.gallery_image_json(image, request), status=201)


class CardGalleryImageView(APIView):
    def patch(self, request, card_id, image_id):
        card, _ = _rich_card(request, card_id)
        image = card.gallery_images.filter(pk=image_id).first()
        if image is None:
            raise Http404
        data = request.data if isinstance(request.data, dict) else {}
        if "caption" in data:
            image.caption = _caption(data)
        if "order" in data:
            order = data["order"]
            if not (isinstance(order, int) and not isinstance(order, bool) and 0 <= order < sections.MAX_GALLERY_IMAGES):
                raise validation_error({"order": [f"Use a number from 0 to {sections.MAX_GALLERY_IMAGES - 1}."]})
            image.order = order
        image.save()
        return Response(sections.gallery_image_json(image, request))

    def delete(self, request, card_id, image_id):
        card, _ = _rich_card(request, card_id)
        image = card.gallery_images.filter(pk=image_id).first()
        if image is None:
            raise Http404
        name = image.image.name
        image.delete()
        if name:
            default_storage.delete(name)
        return Response(status=204)


class ReorderGalleryView(APIView):
    def post(self, request, card_id):
        card, _ = _rich_card(request, card_id)
        data = request.data if isinstance(request.data, dict) else {}
        ids = data.get("ids")
        mine = {str(i.id): i for i in card.gallery_images.all()}
        if not isinstance(ids, list) or len(ids) != len(set(map(str, ids))) or set(map(str, ids)) != set(mine):
            raise validation_error({"ids": ["List every picture once, in the order you want."]})
        with transaction.atomic():
            for position, image_id in enumerate(ids):
                CardGalleryImage.objects.filter(pk=mine[str(image_id)].pk).update(order=position)
        return Response([sections.gallery_image_json(i, request) for i in card.gallery_images.all()])


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
