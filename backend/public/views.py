"""Public card endpoints: no login, throttled, open CORS (see ilaf.middleware)."""
import io

import segno
from django.conf import settings
from django.http import Http404, HttpResponse
from rest_framework import serializers
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from analytics.models import Event
from designs.services import public_custom_face
from workspaces.services import brand_public_json
from billing.services import is_live
from ilaf.branding import normalize_branding
from cards.features import exchange_settings, public_features
from cards.sections import public_sections
from cards.services import effective_design, public_item_json, public_url
from cards.slugs import resolve_card
from cards.vcard import build_vcard
from ilaf.errors import ApiError, validation_error
from ilaf.items import KINDS
from ilaf.throttles import PublicEventThrottle, PublicLeadThrottle, PublicReadThrottle
from ilaf.utils import (
    absolute_url, client_country, device_from_ua, file_url, visitor_hash,
)
from leads import services as lead_services

SOURCES = ("nfc", "qr", "link", "email")


class PublicBase(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicReadThrottle]


def card_state(card):
    """'live', 'paused' (plan not live), 'suspended', or 'hidden' for drafts (shown as not found)."""
    if card.status == "draft":
        return "hidden"
    if card.status == "suspended":
        return "suspended"
    if card.workspace.suspended_at is not None:
        return "paused"
    if not is_live(card.workspace):
        return "paused"
    return "live"


def _brand_names(card):
    """(company name, website) shown on paused or suspended pages. Personal cards show neither."""
    ws = card.workspace
    if ws.kind != "company":
        return None, None
    brand = ws.brand or {}
    return (brand.get("company_name") or ws.name or None), (brand.get("website") or None)


def scope_to_host(request, card):
    """A page served on a company's own domain asks with ?host=<that domain>: the card must belong to that company, and the
    domain must be verified and Enterprise-live. Anything else is "not found", so one company's card is never shown under
    another company's name. Without ?host= (the normal Bench address) nothing changes."""
    host = request.query_params.get("host")
    if not host:
        return
    from workspaces import domains

    row, state = domains.host_state(host)
    if state != "active" or row.workspace_id != card.workspace_id:
        raise Http404


def _live_card_or_404(key, request=None):
    card = resolve_card(key)
    if card is None or card_state(card) != "live":
        raise Http404
    if request is not None:
        scope_to_host(request, card)
    return card


class PublicCardView(PublicBase):
    def get(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        scope_to_host(request, card)
        state = card_state(card)
        if state == "hidden":
            raise Http404
        company_name, website = _brand_names(card)
        if state == "paused":
            return Response({
                "state": "paused", "company_name": company_name,
                "message": "This card is temporarily unavailable.",
            })
        if state == "suspended":
            return Response({
                "state": "suspended", "company_name": company_name, "website": website,
                "message": "This card is no longer active.",
            })

        ws = card.workspace
        canonical = card.slug or card.public_code
        design = effective_design(card)
        is_company = ws.kind == "company"
        brand = None
        if is_company:
            brand = brand_public_json(ws, request, company_name)
        footer = bool(design.get("foot")) and (bool(ws.brand.get("show_footer", True)) if is_company else True)
        photo = file_url(request, card.photo)
        description = " at ".join(p for p in (card.title, card.company) if p) or settings.PRODUCT_NAME
        items = [
            public_item_json(i) for i in card.items.all() if i.on and (i.value or "").strip()
        ]
        api_base = f"/api/v1/public/cards/{canonical}"
        return Response({
            "state": "live",
            "canonical": canonical,
            "card": {
                "name": card.name, "title": card.title, "company": card.company, "address": card.address,
                "bio": card.bio,
                "photo_url": photo, "cover_url": file_url(request, card.cover), "items": items, "save_contact": card.save_contact,
                "video_url": file_url(request, card.video), "video_poster_url": file_url(request, card.video_poster),
                "sections": public_sections(card, request),
                "language": card.language,
                "seo_indexable": card.seo_indexable,
                "features": public_features(card),
                "design": design, "footer": footer, "brand": brand,
                "custom_face": public_custom_face(ws, design),
                "public_url": public_url(card),
                "vcard_url": absolute_url(request, f"{api_base}/vcard"),
                "qr_url": absolute_url(request, f"{api_base}/qr.svg"),
            },
            "og": {
                "title": f"{card.name} - {card.title}" if card.title else card.name,
                "description": description,
                "image_url": photo or (file_url(request, ws.logo) if is_company else None),
            },
        })


class EventSerializer(serializers.Serializer):
    type = serializers.ChoiceField(choices=["view", "tap", "save", "link_click"])
    source = serializers.CharField(required=False, allow_blank=True, default="link")
    kind = serializers.CharField(required=False, allow_blank=True, default="")


class PublicEventView(PublicBase):
    throttle_classes = [PublicEventThrottle]

    def post(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        ser = EventSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        # Only live cards record activity, so previews of drafts never skew the numbers.
        if card_state(card) == "live":
            source = data["source"] if data["source"] in SOURCES else ("link" if not data["source"] else "other")
            Event.objects.create(
                card=card,
                type=data["type"],
                source=source,
                kind=data["kind"] if data["kind"] in KINDS else "",  # only real button kinds, never a stranger's text
                country=client_country(request),
                device=device_from_ua(request.META.get("HTTP_USER_AGENT")),
                visitor_hash=visitor_hash(request),
            )
        return Response(status=204)


class PublicLeadView(PublicBase):
    """A visitor shares their details with the card owner (the exchange-contact form)."""

    throttle_classes = [PublicLeadThrottle]

    def post(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        data = request.data if isinstance(request.data, dict) else {}
        # Honeypot: a filled field means a bot, so we pretend success.
        if lead_services.is_honeypot(data):
            return Response({"ok": True}, status=201)
        if card_state(card) != "live":
            raise Http404
        if not exchange_settings(card)["enabled"]:
            raise ApiError("feature_off", "This card is not taking contact details.", 403)
        lead_services.check_not_too_fast(data)
        lead_services.check_card_cap(card, request)
        fields = lead_services.clean_exchange(card, data)
        lead_services.check_consent(data)
        lead_services.save_lead(card, "exchange", fields, data)
        lead_services.count_for_cap(card, request)
        return Response({"ok": True, "vcard_url": absolute_url(request, f"/api/v1/public/cards/{card.slug or card.public_code}/vcard")}, status=201)


class PublicMeetingRequestView(PublicBase):
    """A visitor asks for a meeting through the built-in form (a Meeting button set to `form`)."""

    throttle_classes = [PublicLeadThrottle]

    def post(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        data = request.data if isinstance(request.data, dict) else {}
        if lead_services.is_honeypot(data):
            return Response({"ok": True}, status=201)
        if card_state(card) != "live":
            raise Http404
        if not public_features(card)["meeting_form"]:
            raise ApiError("feature_off", "This card does not take meeting requests.", 403)
        lead_services.check_not_too_fast(data)
        lead_services.check_card_cap(card, request)
        fields = lead_services.clean_meeting(data)
        lead_services.check_consent(data)
        lead_services.save_lead(card, "meeting_request", fields, data)
        lead_services.count_for_cap(card, request)
        return Response({"ok": True}, status=201)


class PublicVcardView(PublicBase):
    def get(self, request, key):
        card = _live_card_or_404(key, request)
        response = HttpResponse(build_vcard(card), content_type="text/vcard; charset=utf-8")
        filename = "".join(c for c in (card.slug or card.public_code) if c.isalnum() or c in "-_") or "card"
        response["Content-Disposition"] = f'attachment; filename="{filename}.vcf"'
        return response


class PublicQrPngView(PublicBase):
    """The card's QR code as a PNG, for places that cannot show an SVG (e-mail signatures, documents)."""

    def get(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        scope_to_host(request, card)
        try:
            size = max(128, min(int(request.query_params.get("size", 512)), 1024))
        except ValueError:
            raise validation_error({"size": ["Must be a number."]})
        qr = segno.make(f"{public_url(card)}?s=qr", error="m")
        modules = qr.symbol_size(scale=1, border=2)[0]
        buffer = io.BytesIO()
        qr.save(buffer, kind="png", scale=max(1, size // modules), border=2)
        response = HttpResponse(buffer.getvalue(), content_type="image/png")
        response["Cache-Control"] = "public, max-age=86400"
        return response


class PublicQrView(PublicBase):
    def get(self, request, key):
        card = resolve_card(key)
        if card is None:
            raise Http404
        scope_to_host(request, card)
        try:
            size = max(128, min(int(request.query_params.get("size", 512)), 2048))
        except ValueError:
            raise validation_error({"size": ["Must be a number."]})
        qr = segno.make(f"{public_url(card)}?s=qr", error="m")
        modules = qr.symbol_size(scale=1, border=2)[0]
        buffer = io.BytesIO()
        qr.save(buffer, kind="svg", scale=size / modules, border=2, xmldecl=False, svgns=True)
        response = HttpResponse(buffer.getvalue(), content_type="image/svg+xml")
        response["Cache-Control"] = "public, max-age=3600"
        return response
