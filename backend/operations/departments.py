"""Departments: validation of a department's design and button templates, and applying them to a new card."""
from rest_framework.exceptions import ValidationError

from cards.models import CardItem
from designs.services import custom_face_checker
from ilaf.branding import has_palette
from ilaf.design import LOCKED_KEYS, validate_design
from ilaf.errors import validation_error
from ilaf.items import MAX_ITEMS

from .rules import clean_button, same_button

MAX_TEMPLATE_BUTTONS = 20


def clean_design(raw, workspace):
    """A partial design (face, colour, below, intro). Anything else is refused. Returns only the keys given."""
    if raw in (None, {}):
        return {}
    if not isinstance(raw, dict):
        raise validation_error({"design": ["Send the design as an object."]})
    extra = [k for k in raw if k not in LOCKED_KEYS]
    if extra:
        raise validation_error({"design": [f"A department can set only the face, colour, layout below, opening, font and text size, not {extra[0]}."]})
    try:
        validate_design(raw, company_colour_ok=has_palette(workspace), custom_face_ok=custom_face_checker(workspace))
    except ValidationError as exc:
        raise validation_error({f"design.{k}": [str(m) for m in v] for k, v in exc.detail.items()})
    return dict(raw)


def clean_buttons(raw, where):
    if raw in (None, []):
        return []
    if not isinstance(raw, list) or len(raw) > MAX_TEMPLATE_BUTTONS:
        raise validation_error({where: [f"Send a list of up to {MAX_TEMPLATE_BUTTONS} buttons."]})
    out = []
    for entry in raw:
        button = clean_button(entry, where)
        if not any(same_button(button, o) for o in out):
            out.append(button)
    return out


def department_design_for(workspace, department):
    """The company design with the department's own keys on top, or None when it has none."""
    if department is None or not department.design:
        return None
    base = validate_design((workspace.brand or {}).get("design"))
    base.update({k: v for k, v in department.design.items() if k in LOCKED_KEYS})
    # A department that picks a standard face stops the company's custom face from overriding it.
    if "face" in department.design and "custom_face" not in department.design:
        base["custom_face"] = None
    return base


def apply_template(card, workspace, member, rules_mandatory):
    """Start a new draft card from the company brand, the member's department and the mandatory buttons.

    The company website button comes first, then the department's template buttons, then any mandatory
    button not already there. Existing buttons on the card are kept."""
    from workspaces.services import brand_design

    department = member.department if member is not None else None
    design = brand_design(workspace)
    own = department_design_for(workspace, department)
    if own:
        design.update({k: own[k] for k in LOCKED_KEYS})
    card.design = design
    card.save(update_fields=["design"])
    existing = [{"kind": i.kind, "value": i.value} for i in card.items.all()]
    order = len(existing)
    wanted = list(department.items or []) if department is not None else []
    for entry in list(wanted) + list(rules_mandatory):
        if any(same_button(entry, e) for e in existing) or order >= MAX_ITEMS:
            continue
        CardItem.objects.create(
            card=card, kind=entry["kind"], value=entry["value"], label=entry.get("label", ""), on=True,
            order=order, icon=entry.get("icon"),
        )
        existing.append({"kind": entry["kind"], "value": entry["value"]})
        order += 1


def department_json(department, member_count=None):
    return {
        "id": str(department.id),
        "name": department.name,
        "design": department.design or {},
        "items": department.items or [],
        "mandatory_items": department.mandatory_items or [],
        "member_count": department.members.count() if member_count is None else member_count,
        "created_at": department.created_at.isoformat().replace("+00:00", "Z"),
    }
