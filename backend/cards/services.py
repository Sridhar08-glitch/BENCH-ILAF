"""Card logic: output shape, effective design, limits, writes."""
import uuid
from urllib.parse import urlsplit

from django.conf import settings
from django.core.files.storage import default_storage
from django.db import IntegrityError, transaction
from django.db.models import Count, Max, Q
from rest_framework.exceptions import ValidationError

from billing.services import get_subscription, is_live
from designs.services import custom_face_checker, resolve_design
from ilaf.branding import has_palette
from ilaf.design import COMPANY_COLOUR, LOCKED_KEYS, default_design, default_vc, validate_design, validate_vc
from ilaf.errors import ApiError, validation_error
from ilaf.items import DOWNLOAD_KIND, item_href
from ilaf.utils import file_url, iso

from .models import Card, CardItem, SlugHistory
from .features import validate_features
from .slugs import generate_public_code, slug_problem


def is_design_locked(workspace):
    return workspace.kind == "company" and bool(workspace.brand.get("lock_design"))


def effective_design(card):
    """The design a card renders with. When the company locks its design, the brand design wins,
    except the card keeps its own photo switch."""
    own = validate_design(card.design)
    if is_design_locked(card.workspace):
        locked = validate_design(card.workspace.brand.get("design"))
        if card.workspace.brand.get("lock_allows_departments") and card.member_id:
            department = card.member.department
            if department is not None and department.design:
                locked.update({k: v for k, v in department.design.items() if k in LOCKED_KEYS})
                if "face" in department.design and "custom_face" not in department.design:
                    locked["custom_face"] = None
        locked["photo"] = own["photo"]
        own = locked
    if own["colour"] == COMPANY_COLOUR and not has_palette(card.workspace):
        own["colour"] = 0
    # A custom face that was switched off, deleted or never belonged to this company is simply not used.
    return resolve_design(card.workspace, own)


def public_url(card):
    return f"{settings.WEB_BASE_URL}/c/{card.slug or card.public_code}"


def stats_for(card_ids):
    """All-time {card_id: {views, scans, saves, leads}} for the given cards in two queries."""
    from analytics.models import Event, event_count
    from leads.models import Lead

    stats = {cid: {"views": 0, "scans": 0, "saves": 0, "leads": 0} for cid in card_ids}
    rows = (
        Event.objects.filter(card_id__in=card_ids)
        .values("card_id")
        .annotate(
            views=event_count(Q(type="view")),
            scans=event_count(Q(type="view", source="qr")),
            saves=event_count(Q(type="save")),
        )
    )
    for row in rows:
        stats[row["card_id"]].update(views=row["views"], scans=row["scans"], saves=row["saves"])
    for row in Lead.objects.filter(card_id__in=card_ids).values("card_id").annotate(n=Count("id")):
        stats[row["card_id"]]["leads"] = row["n"]
    return stats


def item_json(item):
    return {
        "id": str(item.id), "kind": item.kind, "value": item.value, "label": item.label,
        "on": item.on, "order": item.order, "icon": item.icon,
    }


def card_json(card, request, stats=None):
    if stats is None:
        stats = stats_for([card.id])[card.id]
    owner = card.owner
    return {
        "id": str(card.id),
        "workspace_id": str(card.workspace_id),
        "owner": {"id": str(owner.id), "full_name": owner.full_name, "email": owner.email} if owner else None,
        "public_code": card.public_code,
        "public_url": public_url(card),
        "slug": card.slug,
        "status": card.status,
        "label": card.label,
        "sort_order": card.sort_order,
        "is_default": card.is_default,
        "name": card.name,
        "title": card.title,
        "company": card.company,
        "address": card.address,
        "photo_url": file_url(request, card.photo),
        "cover_url": file_url(request, card.cover),
        "save_contact": card.save_contact,
        "language": card.language,
        "hide_from_directory": card.hide_from_directory,
        "seo_indexable": card.seo_indexable,
        "vc": validate_vc(card.vc),
        "features": validate_features(None, base=card.features),
        "design": effective_design(card),
        "items": [item_json(i) for i in card.items.all()],
        "created_at": iso(card.created_at),
        "updated_at": iso(card.updated_at),
        "stats": stats,
    }


def public_item_json(item):
    out = {
        "kind": item.kind, "value": item.value, "label": item.label,
        "icon": item.icon, "href": item_href(item.kind, item.value),
    }
    if item.kind == DOWNLOAD_KIND:
        out["download"] = True  # the public page adds the download attribute to the link
    return out


# ---------------------------------------------------------------- limits
def check_can_create(workspace, member):
    """Raise 402 without a live subscription, 403 plan_limit when the plan's card limit is reached."""
    if not is_live(workspace):
        raise ApiError("subscription_required", "An active plan is required to create cards.", 402)
    sub = get_subscription(workspace)
    if workspace.kind == "company":
        # One card per seat: a member who already has a card cannot make another.
        if member.cards.exists():
            raise ApiError("plan_limit", "Each team member can have one card.", 403)
    else:
        if workspace.cards.count() >= sub.plan.max_cards:
            raise ApiError(
                "plan_limit",
                f"Your plan allows {sub.plan.max_cards} card(s). Upgrade to add more.",
                403,
            )


def new_card(workspace, user, member, **fields):
    """Create a draft card with a fresh permanent code and sensible defaults."""
    design = default_design()
    if workspace.kind == "company":
        design = validate_design(workspace.brand.get("design"))
        if design["colour"] == COMPANY_COLOUR and not has_palette(workspace):
            design["colour"] = 0
    fields.setdefault("company", workspace.brand.get("company_name", "") if workspace.kind == "company" else "")
    # A person's cards stay in the order they were made; the first one is their default card.
    mine = Card.objects.filter(workspace=workspace, owner=user) if user is not None else Card.objects.none()
    fields.setdefault("sort_order", (mine.aggregate(top=Max("sort_order"))["top"] or 0) + 1 if mine.exists() else 0)
    fields.setdefault("is_default", not mine.exists())
    return Card.objects.create(
        workspace=workspace, owner=user, member=member, public_code=generate_public_code(),
        vc=default_vc(), design=design, **fields,
    )


# ---------------------------------------------------------------- writes
def set_slug(card, new_slug):
    """Change a card's slug, keeping the old one working through the slug history."""
    if new_slug == card.slug:
        return
    if new_slug:
        problem = slug_problem(new_slug, card)
        if problem:
            code, message = problem
            if code == "taken":
                raise ApiError("slug_taken", message, 409)
            raise validation_error({"slug": [message]})
        SlugHistory.objects.filter(slug=new_slug, card=card).delete()
    if card.slug:
        SlugHistory.objects.get_or_create(slug=card.slug, defaults={"card": card})
    card.slug = new_slug


def replace_items(card, items, ):
    """Full replacement: order follows the array. Items keeping an existing id keep that id."""
    existing = {str(i.id): i for i in card.items.all()}
    keep = []
    for index, data in enumerate(items):
        fields = {
            "kind": data["kind"], "value": data.get("value", ""), "label": data.get("label", ""),
            "on": data.get("on", True), "order": index, "icon": data.get("icon"),
        }
        item = existing.get(str(data.get("id")))
        if item is not None:
            for key, value in fields.items():
                setattr(item, key, value)
            item.save()
        else:
            item = CardItem.objects.create(card=card, **fields)
        keep.append(item.id)
    card.items.exclude(id__in=keep).delete()


@transaction.atomic
def apply_card_data(card, data, role="owner", member=None, enforce=False, creating=False):
    """Apply validated write data to a card (create or update).

    When the company design is locked, only the owner's writes to the locked settings are kept
    (and they stay invisible while the lock is on); everyone else's are ignored without an error.

    With `enforce`, an employee's write goes through the company field rules: locked fields raise,
    approval fields are left unchanged and recorded on `card.waiting_changes` as (field, old, new)."""
    card.waiting_changes = []
    if enforce and role == "employee" and card.workspace.kind == "company":
        from operations.rules import enforce_card_write

        data, card.waiting_changes = enforce_card_write(card, data, member, creating=creating)
    if "hide_from_directory" in data:
        card.hide_from_directory = bool(data["hide_from_directory"])
    if "seo_indexable" in data:
        card.seo_indexable = bool(data["seo_indexable"])
    for field in ("name", "title", "company", "address", "save_contact", "language", "label"):
        if field in data:
            setattr(card, field, data[field])
    if data.get("is_default"):
        make_default(card)
    if "vc" in data:
        card.vc = validate_vc(data["vc"], base=card.vc)
    if "features" in data:
        try:
            card.features = validate_features(data["features"], base=card.features)
        except ValidationError as exc:
            detail = exc.detail if isinstance(exc.detail, dict) else {"": exc.detail}
            raise validation_error({f"features.{k}".rstrip("."): [str(m) for m in v] for k, v in detail.items()})
    # A locked company design wins everywhere, so design writes are ignored (never an error).
    if "design" in data:
        incoming = data["design"]
        if is_design_locked(card.workspace) and role != "owner":
            incoming = {k: v for k, v in incoming.items() if k not in LOCKED_KEYS}
        try:
            card.design = validate_design(
                incoming, base=card.design, company_colour_ok=has_palette(card.workspace),
                custom_face_ok=custom_face_checker(card.workspace),
            )
        except ValidationError as exc:
            raise validation_error({f"design.{k}": [str(m) for m in v] for k, v in exc.detail.items()})
    if "slug" in data:
        set_slug(card, data["slug"])
    try:
        with transaction.atomic():
            card.save()
    except IntegrityError:
        raise ApiError("slug_taken", "This address is already taken.", 409)
    if "items" in data:
        check_download_items(card, data["items"])
        replace_items(card, data["items"])
    return card


def make_default(card):
    """This card becomes its owner's default card (the one "My QR" and event mode open first); the others stop being it."""
    Card.objects.filter(workspace_id=card.workspace_id, owner_id=card.owner_id, is_default=True).exclude(pk=card.pk).update(is_default=False)
    card.is_default = True


def card_file_prefix(card):
    """The storage folder of a card's uploaded PDFs, as a URL path."""
    return urlsplit(default_storage.url(f"files/{card.id.hex}/x")).path[:-1]


def check_download_items(card, items):
    """A "Download file" button may only point at a PDF uploaded to this very card, so one company can never link to
    (or make a card serve) another company's file."""
    prefix = card_file_prefix(card)
    for item in items:
        if item.get("kind") == DOWNLOAD_KIND and item.get("value") and not urlsplit(item["value"]).path.startswith(prefix):
            raise validation_error({"items": ["Upload the PDF first and use the address we returned."]})


def remove_card_files(card):
    """Delete the PDFs uploaded for a card. A storage problem never stops the card from being deleted."""
    try:
        folder = f"files/{card.id.hex}"
        if default_storage.exists(folder):
            for name in default_storage.listdir(folder)[1]:
                default_storage.delete(f"{folder}/{name}")
    except Exception:
        pass


def copy_card_files(source, copy):
    """A duplicated card gets its own copy of every uploaded PDF, and its Download file buttons are pointed at the copies."""
    old, new = card_file_prefix(source), card_file_prefix(copy)
    for item in copy.items.filter(kind=DOWNLOAD_KIND):
        path = urlsplit(item.value).path
        if not path.startswith(old):
            continue
        try:
            storage_name = f"files/{source.id.hex}/{path[len(old):]}"
            fresh = f"files/{copy.id.hex}/doc-{uuid.uuid4().hex}.pdf"
            with default_storage.open(storage_name) as handle:
                saved = default_storage.save(fresh, handle)
            item.value = item.value[: item.value.index(old)] + new + saved.rsplit("/", 1)[-1]
            item.save(update_fields=["value"])
        except Exception:
            item.delete()  # a missing file is not copied; the button would only be dead


def delete_card(card):
    """Delete a card but keep its leads with the company (each keeps the card's name as text).
    When it was its owner's default card, the next one takes over."""
    from leads.models import Lead

    Lead.objects.filter(card=card).update(workspace_id=card.workspace_id, card_name=card.name[:120])
    was_default, workspace_id, owner_id = card.is_default, card.workspace_id, card.owner_id
    remove_card_files(card)
    card.delete()
    if was_default and owner_id:
        nxt = Card.objects.filter(workspace_id=workspace_id, owner_id=owner_id).first()
        if nxt is not None:
            Card.objects.filter(pk=nxt.pk).update(is_default=True)
