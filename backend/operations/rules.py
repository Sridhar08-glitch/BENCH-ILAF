"""Field rules: which parts of a card employees may change, and what happens when they try.

Each field is `free` (employees edit it), `approval` (the change waits for an admin) or `locked`
(employees cannot change it). Owners and admins are never held back by these rules.
"""
import re
from urllib.parse import urlparse

from rest_framework.exceptions import ValidationError

from billing.services import enterprise_allowed
from ilaf.errors import ApiError, validation_error
from ilaf.items import KINDS, item_href, validate_value

PERMISSIONS = ("free", "approval", "locked")
# The bio has no rule of its own: the company's address rule guards it too.
SCALAR_FIELDS = ("name", "title", "company", "address", "bio")
RULE_OF = {"bio": "address"}
FIELD_KEYS = (
    "name", "title", "photo", "company", "address", "button_add", "button_edit", "button_remove",
    "slug", "features", "vcard",
)
# Rules for whole settings of a card (its web address, its feature switches, its vCard options). They cannot wait
# for an admin's approval, so "approval" on one of them behaves like "locked".
SETTING_RULES = {"slug": ("slug",), "features": ("features",), "vcard": ("vc", "save_contact")}
FIELD_LABELS = {
    "name": "the name", "title": "the job title", "photo": "the photo", "company": "the company line",
    "address": "the address", "bio": "the bio", "buttons": "the buttons",
}
# The extras under a card (video, shop, hours, booking, team, gallery, event, map). The same names as cards.sections.KINDS.
EXTRA_KINDS = ("video", "products", "hours", "booking", "team", "gallery", "event", "map")
EXTRAS_MODES = ("all", "some", "none")
MAX_BANNED = 100
MAX_MANDATORY = 10
_DOMAIN_RE = re.compile(r"^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")


def default_rules():
    data = {key: "free" for key in FIELD_KEYS}
    data.update(allowed_kinds=None, banned_domains=[], mandatory_buttons=[], extras="all", extra_kinds=list(EXTRA_KINDS))
    return data


def normalize_rules(raw):
    """The stored rules with every missing key filled from the defaults."""
    data = default_rules()
    if isinstance(raw, dict):
        for key in FIELD_KEYS:
            if raw.get(key) in PERMISSIONS:
                data[key] = raw[key]
        if isinstance(raw.get("allowed_kinds"), list):
            data["allowed_kinds"] = [k for k in raw["allowed_kinds"] if k in KINDS]
        if isinstance(raw.get("banned_domains"), list):
            data["banned_domains"] = [d for d in raw["banned_domains"] if isinstance(d, str)]
        if isinstance(raw.get("mandatory_buttons"), list):
            data["mandatory_buttons"] = [m for m in raw["mandatory_buttons"] if isinstance(m, dict)]
        if raw.get("extras") in EXTRAS_MODES:
            data["extras"] = raw["extras"]
        if isinstance(raw.get("extra_kinds"), list):
            data["extra_kinds"] = [k for k in EXTRA_KINDS if k in raw["extra_kinds"]]
    return data


def clean_domain(raw):
    """A bare domain from what the admin typed (a link, with www, with a path). None when it is not a domain."""
    value = (raw or "").strip().lower()
    value = re.sub(r"^[a-z][a-z0-9+.\-]*://", "", value)
    value = value.split("/")[0].split("?")[0].split("#")[0].split(":")[0]
    value = value.removeprefix("www.")
    return value if _DOMAIN_RE.match(value) else None


def clean_button(entry, where):
    """One mandatory or template button: {kind, value, label}. Raises a validation_error naming `where`."""
    if not isinstance(entry, dict):
        raise validation_error({where: ["Each button must have a kind and a value."]})
    kind = entry.get("kind")
    if kind not in KINDS:
        raise validation_error({where: ["Choose a button kind from the list."]})
    try:
        value = validate_value(kind, str(entry.get("value") or ""))
    except ValidationError as exc:
        raise validation_error({where: [str(m) for m in exc.detail]})
    if not value:
        raise validation_error({where: ["Enter the link or number for each button."]})
    label = str(entry.get("label") or "").strip()[:40]
    return {"kind": kind, "value": value, "label": label, "on": True, "icon": None}


def validate_rules(incoming, base):
    """Merge a partial rules object onto the stored one and check every value."""
    if not isinstance(incoming, dict):
        raise validation_error({"rules": ["Send the rules as an object."]})
    merged = normalize_rules(base)
    errors = {}
    unknown = [k for k in incoming if k not in merged]
    for key in unknown:
        errors[key] = ["This rule does not exist."]
    for key in FIELD_KEYS:
        if key in incoming:
            if incoming[key] in PERMISSIONS:
                merged[key] = incoming[key]
            else:
                errors[key] = ["Choose free, approval or locked."]
    if "extras" in incoming:
        if incoming["extras"] in EXTRAS_MODES:
            merged["extras"] = incoming["extras"]
        else:
            errors["extras"] = ["Choose all, some or none."]
    if "extra_kinds" in incoming:
        value = incoming["extra_kinds"]
        if isinstance(value, list) and all(isinstance(k, str) and k in EXTRA_KINDS for k in value):
            merged["extra_kinds"] = [k for k in EXTRA_KINDS if k in value]
        else:
            errors["extra_kinds"] = ["Choose extras from the list."]
    if "allowed_kinds" in incoming:
        value = incoming["allowed_kinds"]
        if value is None:
            merged["allowed_kinds"] = None
        elif isinstance(value, list) and all(isinstance(k, str) and k in KINDS for k in value):
            merged["allowed_kinds"] = sorted(set(value), key=KINDS.index)
        else:
            errors["allowed_kinds"] = ["Choose button kinds from the list, or leave empty to allow all."]
    if "banned_domains" in incoming:
        value = incoming["banned_domains"]
        if not isinstance(value, list) or len(value) > MAX_BANNED:
            errors["banned_domains"] = [f"Send a list of up to {MAX_BANNED} domains."]
        else:
            cleaned, bad = [], []
            for raw in value:
                domain = clean_domain(raw) if isinstance(raw, str) else None
                if domain is None:
                    bad.append(str(raw))
                elif domain not in cleaned:
                    cleaned.append(domain)
            if bad:
                errors["banned_domains"] = [f"These are not domains: {', '.join(bad[:5])}."]
            else:
                merged["banned_domains"] = cleaned
    if "mandatory_buttons" in incoming:
        value = incoming["mandatory_buttons"]
        if not isinstance(value, list) or len(value) > MAX_MANDATORY:
            errors["mandatory_buttons"] = [f"Send a list of up to {MAX_MANDATORY} buttons."]
        else:
            try:
                merged["mandatory_buttons"] = [clean_button(m, "mandatory_buttons") for m in value]
            except ApiError as exc:
                errors["mandatory_buttons"] = exc.fields["mandatory_buttons"]
    if errors:
        raise validation_error(errors)
    # A mandatory button must be allowed and not on a banned domain, or nobody could ever comply.
    for m in merged["mandatory_buttons"]:
        if merged["allowed_kinds"] is not None and m["kind"] not in merged["allowed_kinds"]:
            raise validation_error({"mandatory_buttons": [f"{m['kind']} is a mandatory button, so it must be an allowed kind."]})
        if banned_domain_of(m, merged["banned_domains"]):
            raise validation_error({"mandatory_buttons": ["A mandatory button points at a banned domain."]})
    return merged


# ---------------------------------------------------------------- links
def item_host(kind, value):
    """The domain a button leads to (a web host, or the domain of an email address), or ''."""
    href = item_href(kind, value)
    if not href:
        return ""
    if href.lower().startswith("mailto:"):
        address = href[7:].split("?")[0]
        return address.rsplit("@", 1)[-1].lower() if "@" in address else ""
    if href.lower().startswith(("http://", "https://")):
        return (urlparse(href).hostname or "").lower().removeprefix("www.")
    return ""


def banned_domain_of(item, banned):
    """The banned domain this button points at, or None. Subdomains of a banned domain count."""
    host = item_host(item.get("kind", ""), item.get("value", ""))
    if not host:
        return None
    for domain in banned:
        if host == domain or host.endswith("." + domain):
            return domain
    return None


def same_button(a, b):
    def key(x):
        return (x.get("kind"), (x.get("value") or "").strip().lower().rstrip("/"))

    return key(a) == key(b)


def is_shown(item):
    return bool(item.get("on", True)) and bool((item.get("value") or "").strip())


# ---------------------------------------------------------------- what applies to whom
def workspace_rules(workspace):
    """The company's rules as they apply now. Field rules are an Enterprise feature: a company that is not on that plan
    keeps what it saved, but nothing is enforced (everything is free) until it is on it again."""
    return normalize_rules(workspace.field_rules if enterprise_allowed(workspace) else {})


def mandatory_for(workspace, member):
    """Company mandatory buttons plus those of the member's department."""
    out = list(workspace_rules(workspace)["mandatory_buttons"])
    department = getattr(member, "department", None) if member is not None else None
    if department is not None and enterprise_allowed(workspace):
        for entry in department.mandatory_items or []:
            if not any(same_button(entry, m) for m in out):
                out.append(entry)
    return out


def effective_rules(workspace, member):
    rules = workspace_rules(workspace)
    rules["mandatory_buttons"] = mandatory_for(workspace, member)
    return rules


def extras_for(workspace, member):
    """The extras this person may add to their card, in the order of EXTRA_KINDS. Only an employee of a company is limited by the
    company's rule; owners, admins and personal accounts may add any."""
    if workspace.kind != "company" or member is None or member.role != "employee":
        return list(EXTRA_KINDS)
    rules = workspace_rules(workspace)
    if rules["extras"] == "none":
        return []
    if rules["extras"] == "some":
        return list(rules["extra_kinds"])
    return list(EXTRA_KINDS)


def access_for(workspace, member):
    """What the card editor needs to show per field: the permission of each, plus the button rules."""
    if workspace.kind != "company" or member is None or member.role != "employee":
        return {
            **{k: "free" for k in ("name", "title", "photo", "company", "address", "bio", "slug", "features", "vcard")},
            "buttons": {"add": "free", "edit": "free", "remove": "free"},
            "allowed_kinds": None, "banned_domains": [], "mandatory_buttons": [], "extras": list(EXTRA_KINDS),
        }
    rules = effective_rules(workspace, member)
    return {
        **{k: rules[RULE_OF.get(k, k)] for k in ("name", "title", "photo", "company", "address", "bio")},
        **{k: ("free" if rules[k] == "free" else "locked") for k in SETTING_RULES},
        "buttons": {"add": rules["button_add"], "edit": rules["button_edit"], "remove": rules["button_remove"]},
        "allowed_kinds": rules["allowed_kinds"],
        "banned_domains": rules["banned_domains"],
        "mandatory_buttons": rules["mandatory_buttons"],
        "extras": extras_for(workspace, member),
    }


# ---------------------------------------------------------------- enforcement
def _locked(field, message):
    return ApiError("field_locked", message, 403, {field: [message]})


def _plain(item):
    return {
        "kind": item.get("kind"), "value": item.get("value", ""), "label": item.get("label", ""),
        "on": bool(item.get("on", True)), "icon": item.get("icon"),
    }


def _same_content(a, b):
    return all((a.get(k) or "") == (b.get(k) or "") for k in ("kind", "value", "label")) and bool(a.get("on", True)) == bool(b.get("on", True)) and a.get("icon") == b.get("icon")


def diff_items(old_items, new_items):
    """(added, edited, removed) among the buttons that are visible on the card.

    Items are matched by id. Switched-off or empty buttons are not visible, so adding or removing
    those is not a change anyone would see."""
    old = {str(i["id"]): i for i in old_items if i.get("id")}
    new_ids = {str(n["id"]) for n in new_items if n.get("id")}
    added, edited, removed = [], [], []
    for n in new_items:
        o = old.get(str(n["id"])) if n.get("id") else None
        if o is None:
            if is_shown(n):
                added.append(n)
        elif not is_shown(o) and is_shown(n):
            added.append(n)
        elif is_shown(o) and not is_shown(n):
            removed.append(o)
        elif is_shown(o) and is_shown(n) and not _same_content(o, n):
            edited.append(n)
    for i, o in old.items():
        if i not in new_ids and is_shown(o):
            removed.append(o)
    return added, edited, removed


def enforce_card_write(card, data, member, creating=False):
    """Apply the field rules to an employee's card write.

    Returns (data to apply now, [(field, old, new)] waiting for approval). Raises 403 `field_locked`
    or 400 `validation_error` when a change is not allowed at all.

    `creating` is the employee's first card: creating it is never refused, but a field the company has locked
    or put under approval takes the company's value (the name and title from the seat, the rest as the card
    already is) instead of what was typed, buttons are limited to the mandatory ones when adding is not free,
    and locked settings are ignored. Button kinds and banned links are still checked."""
    data = dict(data)
    pending = []
    workspace = card.workspace
    rules = effective_rules(workspace, member)

    for field in SCALAR_FIELDS:
        if field not in data or data[field] == getattr(card, field):
            continue
        perm = rules[RULE_OF.get(field, field)]
        if creating and perm != "free":
            if field == "name":
                data[field] = member.full_name or ""
            elif field == "title":
                data[field] = member.title or ""
            else:
                data[field] = getattr(card, field)
            continue
        if perm == "locked":
            raise _locked(field, f"Your company has set {FIELD_LABELS[field]}. Ask an admin if it needs to change.")
        if perm == "approval":
            pending.append((field, getattr(card, field), data.pop(field)))

    _enforce_settings(card, data, rules, quiet=creating)

    if "items" in data:
        if creating and rules["button_add"] != "free":
            data["items"] = []
        old_items = [
            {"id": str(i.id), "kind": i.kind, "value": i.value, "label": i.label, "on": i.on, "icon": i.icon}
            for i in card.items.all()
        ]
        new_items = list(data["items"])
        added, edited, removed = diff_items(old_items, new_items)

        for item in added + edited:
            if is_shown(item):
                if rules["allowed_kinds"] is not None and item["kind"] not in rules["allowed_kinds"]:
                    raise validation_error({"items": [f"Your company does not allow {item['kind']} buttons."]})
                domain = banned_domain_of(item, rules["banned_domains"])
                if domain:
                    raise validation_error({"items": [f"Links to {domain} are not allowed on company cards."]})

        # Mandatory buttons stay on the card exactly as set. Missing ones are put back; taking one away is refused.
        for must in rules["mandatory_buttons"]:
            if any(is_shown(n) and same_button(n, must) for n in new_items):
                continue
            if any(is_shown(o) and same_button(o, must) for o in old_items):
                label = must.get("label") or must["kind"]
                raise _locked("items", f"The {label} button is required by your company and cannot be removed or changed.")
            new_items.append({**_plain(must), "label": must.get("label", "")})
        data["items"] = new_items
        added, edited, removed = diff_items(old_items, new_items)
        if creating:
            return data, pending

        perms = []
        if added:
            perms.append(rules["button_add"])
        if edited:
            perms.append(rules["button_edit"])
        if removed:
            perms.append(rules["button_remove"])
        if "locked" in perms:
            raise _locked("items", "Your company has set the buttons on cards. Ask an admin if they need to change.")
        if "approval" in perms:
            pending.append(("buttons", old_items, [_plain(n) | ({"id": str(n["id"])} if n.get("id") else {}) for n in new_items]))
            data.pop("items")
    return data, pending


def _enforce_settings(card, data, rules, quiet=False):
    """Slug, feature switches and vCard options: refused when the company has locked them and the value would change.
    A value that is sent back unchanged (the editor sends the whole card) is not a change."""
    from cards.features import validate_features
    from ilaf.design import validate_vc

    def changed(field):
        if field == "slug":
            return (data["slug"] or None) != (card.slug or None)
        if field == "features":
            return validate_features(data["features"], base=card.features) != validate_features(None, base=card.features)
        if field == "vc":
            return validate_vc(data["vc"], base=card.vc) != validate_vc(card.vc)
        return data[field] != getattr(card, field)

    labels = {"slug": "the web address", "features": "the card features", "vcard": "the contact-file options"}
    for rule, fields in SETTING_RULES.items():
        if rules[rule] == "free":
            continue
        for field in fields:
            if field not in data:
                continue
            try:
                differs = changed(field)
            except ValidationError:
                differs = True
            if differs and not quiet:
                raise _locked(rule, f"Your company has set {labels[rule]}. Ask an admin if it needs to change.")
            data.pop(field)


def photo_permission(workspace, member):
    """'free', 'approval' or 'locked' for an employee changing their photo."""
    if workspace.kind != "company" or member is None or member.role != "employee":
        return "free"
    return effective_rules(workspace, member)["photo"]
