"""Owner endpoints for selling and booking on a card: the products (with pictures) and the booking hours.

Every write here is a rich-page feature, so it needs the page-styles switch and a paid plan; reads never ask.
"""
import uuid
from decimal import Decimal, InvalidOperation

from rest_framework.exceptions import ValidationError as DRFValidationError
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError, validation_error
from ilaf.images import process_jpeg
from ilaf.utils import clean_line, clean_multiline, file_url, iso
from staff.flags import require_flag
from workspaces.access import MANAGER_ROLES, card_for_user

from . import booking_slots, extras
from .models import BookingSettings, Product
from .models_commerce import MAX_PRODUCTS_PER_CARD, default_currency

MAX_PRICE = Decimal("99999999.99")
MAX_META_KEYS = 20
PRODUCT_IMAGE_PX = 1200


def _rich_pages_allowed(workspace):
    """Stand-in for the plan rule while cards.features does not provide it: any live subscription counts as paid."""
    from billing.services import is_live

    return is_live(workspace)


def rich_pages_allowed(workspace):
    try:
        from .features import rich_pages_allowed as rule
    except ImportError:
        rule = _rich_pages_allowed
    return rule(workspace)


def require_rich_pages(workspace):
    """Refuse a rich-page write when the switch is off or the plan does not include it."""
    require_flag("page_styles", workspace)
    try:
        from .features import require_rich_pages as rule
    except ImportError:
        if not _rich_pages_allowed(workspace):
            raise ApiError("plan_limit", "Page styles and rich content are part of the paid plans. Upgrade to use them.", 403)
        return
    rule(workspace)


def _card_for_write(request, card_id):
    card, member = card_for_user(request.user, card_id)
    if card.status == "suspended" and member.role not in MANAGER_ROLES:
        raise ApiError("forbidden", "This card is suspended.", 403)
    require_rich_pages(card.workspace)
    return card, member


# ---------------------------------------------------------------- products
def money(value):
    return f"{Decimal(value).quantize(Decimal('0.01'))}"


def product_json(product, request):
    return {
        "id": str(product.id),
        "section_id": str(product.section_id) if product.section_id else None,
        "title": product.title,
        "description": product.description,
        "price": money(product.price),
        "currency": product.currency,
        "image_url": file_url(request, product.image),
        "badge": product.badge,
        "meta": product.meta or {},
        "on": product.on,
        "order": product.order,
        "stock": product.stock,
        "created_at": iso(product.created_at),
        "updated_at": iso(product.updated_at),
    }


def _meta_ok(meta):
    """A small object of texts, numbers, switches or short tag lists."""
    if not isinstance(meta, dict) or len(meta) > MAX_META_KEYS:
        return False
    for key, value in meta.items():
        if not isinstance(key, str) or not key or len(key) > 40:
            return False
        if isinstance(value, bool) or value is None or isinstance(value, (int, float)):
            continue
        if isinstance(value, str):
            if len(value) > 120:
                return False
            continue
        if isinstance(value, list):
            if len(value) > 20 or not all(isinstance(v, str) and len(v) <= 40 for v in value):
                return False
            continue
        return False
    return True


def _section_ok(card, section_id):
    """The products section must be one of this card's own; until sections exist any id is kept as given."""
    try:
        from .models import CardSection
    except ImportError:
        return True
    return CardSection.objects.filter(pk=section_id, card=card, kind="products").exists()


def clean_product(data, card, creating):
    """Validate a product body. On create, missing fields take their defaults; on update only sent keys change."""
    if not isinstance(data, dict):
        raise validation_error({"non_field_errors": ["Send the product as an object."]})
    errors, out = {}, {}

    def text(name, limit, multiline=False):
        raw = data.get(name)
        if raw is None:
            return ""
        if not isinstance(raw, str):
            errors[name] = ["Must be text."]
            return ""
        try:
            return clean_multiline(raw, limit) if multiline else clean_line(raw, limit)
        except DRFValidationError as exc:
            errors[name] = [str(m) for m in exc.detail]
            return ""

    if creating or "title" in data:
        out["title"] = text("title", 80)
        if not out["title"] and "title" not in errors:
            errors["title"] = ["Give the item a name."]
    if creating or "description" in data:
        out["description"] = text("description", 300, multiline=True)
    if creating or "badge" in data:
        out["badge"] = text("badge", 20)
    if creating or "price" in data:
        raw = data.get("price", 0)
        price = None
        if not isinstance(raw, bool) and isinstance(raw, (int, float, str)):
            try:
                price = Decimal(str(raw).strip()).quantize(Decimal("0.01"))
            except (InvalidOperation, ValueError):
                price = None
        if price is None or price < 0 or price > MAX_PRICE:
            errors["price"] = ["Enter a price of zero or more."]
        else:
            out["price"] = price
    if creating or "currency" in data:
        raw = data.get("currency")
        if raw in (None, ""):
            out["currency"] = default_currency(card.workspace)
        elif isinstance(raw, str) and len(raw.strip()) == 3 and raw.strip().isalpha():
            out["currency"] = raw.strip().upper()
        else:
            errors["currency"] = ["Use a three-letter currency code such as QAR."]
    if "meta" in data:
        meta = data.get("meta")
        if meta is None:
            out["meta"] = {}
        elif _meta_ok(meta):
            out["meta"] = meta
        else:
            errors["meta"] = ["Details must be a small set of texts, numbers or tags."]
    if "on" in data:
        if isinstance(data["on"], bool):
            out["on"] = data["on"]
        else:
            errors["on"] = ["Must be true or false."]
    if "order" in data:
        raw = data["order"]
        if isinstance(raw, int) and not isinstance(raw, bool) and 0 <= raw <= 9999:
            out["order"] = raw
        else:
            errors["order"] = ["Must be a number."]
    if "stock" in data:
        raw = data["stock"]
        if raw is None:
            out["stock"] = None
        elif isinstance(raw, int) and not isinstance(raw, bool) and 0 <= raw <= 1_000_000:
            out["stock"] = raw
        else:
            errors["stock"] = ["Stock must be empty (unlimited) or a whole number."]
    if "section_id" in data:
        raw = data["section_id"]
        if raw is None:
            out["section_id"] = None
        else:
            try:
                section_id = uuid.UUID(str(raw))
            except ValueError:
                section_id = None
            if section_id is None or not _section_ok(card, section_id):
                errors["section_id"] = ["Choose one of this card's products sections."]
            else:
                out["section_id"] = section_id
    if "image" in data and data["image"] is None:
        out["image"] = None
    if errors:
        raise validation_error(errors)
    return out


def _product(card, product_id):
    product = Product.objects.filter(card=card, pk=product_id).first()
    if product is None:
        raise ApiError("not_found", "Not found.", 404)
    return product


class ProductsView(APIView):
    def get(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        return Response([product_json(p, request) for p in card.products.all()])

    def post(self, request, card_id):
        card, _ = _card_for_write(request, card_id)
        extras.check_allowed(card, "products")
        if card.products.count() >= MAX_PRODUCTS_PER_CARD:
            raise validation_error({"products": [f"A card can hold up to {MAX_PRODUCTS_PER_CARD} items. Remove one first."]})
        values = clean_product(request.data, card, creating=True)
        values.pop("image", None)
        if "order" not in values:
            last = card.products.order_by("-order").values_list("order", flat=True).first()
            values["order"] = (last + 1) if last is not None else 0
        product = Product.objects.create(card=card, **values)
        return Response(product_json(product, request), status=201)


class ProductDetailView(APIView):
    def patch(self, request, card_id, product_id):
        card, _ = _card_for_write(request, card_id)
        product = _product(card, product_id)
        values = clean_product(request.data, card, creating=False)
        remove_image = "image" in values and values.pop("image") is None
        for name, value in values.items():
            setattr(product, name, value)
        if remove_image and product.image:
            old = product.image.name
            product.image = None
            product.image.storage.delete(old)
        product.save()
        return Response(product_json(product, request))

    def delete(self, request, card_id, product_id):
        card, _ = _card_for_write(request, card_id)
        product = _product(card, product_id)
        if product.image:
            product.image.storage.delete(product.image.name)
        product.delete()
        return Response(status=204)


class ProductImageView(APIView):
    """A picture for one item: JPG, PNG or WebP, stored as a JPEG no wider or taller than 1200 px."""

    def post(self, request, card_id, product_id):
        card, _ = _card_for_write(request, card_id)
        product = _product(card, product_id)
        content = process_jpeg(request.FILES.get("file"), PRODUCT_IMAGE_PX, f"{card.id.hex[:8]}-p")
        old_name = product.image.name if product.image else ""
        product.image.save(content.name, content, save=True)
        if old_name:
            product.image.storage.delete(old_name)
        return Response({"image_url": file_url(request, product.image)})


# ---------------------------------------------------------------- booking settings
class BookingSettingsView(APIView):
    def get(self, request, card_id):
        card, _ = card_for_user(request.user, card_id)
        row = BookingSettings.objects.filter(card=card).first()
        return Response(booking_slots.settings_json(row))

    def put(self, request, card_id):
        card, _ = _card_for_write(request, card_id)
        extras.check_allowed(card, "booking")
        try:
            values = booking_slots.clean_settings(request.data)
        except DRFValidationError as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"non_field_errors": exc.detail}
            raise validation_error({k: [str(m) for m in v] for k, v in detail.items()})
        row, _ = BookingSettings.objects.update_or_create(card=card, defaults=values)
        return Response(booking_slots.settings_json(row))
