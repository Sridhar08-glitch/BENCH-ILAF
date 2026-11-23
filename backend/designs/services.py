"""Custom design logic: which faces a company may use, saving and checking faces, requests, files, previews, e-mails."""
import hashlib
import re
import secrets
from datetime import timedelta
from urllib.parse import urlsplit

from django.conf import settings
from django.core.cache import cache
from django.core.files.base import ContentFile
from django.db import transaction
from django.utils import timezone

from ilaf.branding import PALETTE_CHECKS, PALETTE_KEYS, contrast_ratio, normalize_branding
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import DEFAULT_LANGUAGE, member_language, request_language, tr, translate_message, user_language
from ilaf.utils import clean_line, file_url, iso

from . import sanitize
from .models import CustomFace, CustomFacePreview, CustomFaceVersion, DesignRequest, DesignRequestFile, DesignRequestMessage

USABLE = ("approved", "live")
PREVIEW_DAYS = 30
MAX_FILES = 10
MAX_FILE_BYTES = 10 * 1024 * 1024
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")


# ================================================================ which faces a company may use
def _state_key(face_id):
    return f"custom-face-state:{face_id}"


def _face_state(face_id):
    """(workspace_id, status) of a face, kept in the cache for a short while so card lists do not ask the database again."""
    key = _state_key(face_id)
    hit = cache.get(key)
    if hit is not None:
        return hit or None
    row = CustomFace.objects.filter(pk=face_id).values_list("workspace_id", "status", "kind").first()
    cache.set(key, row if row else (), 30)
    return row


def forget_face(face_id):
    cache.delete(_state_key(face_id))


def usable_face_id(workspace, face_id):
    """True when `face_id` is an approved or live face made for exactly this company workspace."""
    if workspace is None or workspace.kind != "company" or not isinstance(face_id, int) or isinstance(face_id, bool):
        return False
    state = _face_state(face_id)
    return bool(state) and state[0] == workspace.id and state[1] in USABLE and state[2] == "face"


def custom_face_checker(workspace):
    """The `custom_face_ok` argument of ilaf.design.validate_design for a workspace."""
    if workspace is None or workspace.kind != "company":
        return False
    return lambda face_id: usable_face_id(workspace, face_id)


def resolve_design(workspace, design):
    """A copy of a design whose custom_face is dropped when the face cannot be used (disabled, deleted, not this company's)."""
    out = dict(design)
    if out.get("custom_face") is not None and not usable_face_id(workspace, out["custom_face"]):
        out["custom_face"] = None
    return out


def own_media_paths(workspace):
    """Addresses of the company's own uploaded pictures: the only files a face's CSS or template may point at."""
    paths = []
    for field in (workspace.logo, workspace.symbol, workspace.background, workspace.template_front, workspace.template_back):
        url = file_url(None, field)
        if url:
            paths.append(url)
    return paths


def face_hash(face):
    raw = "|".join([face.template, face.css, repr(face.palettes), str(face.version), str(face.font_locked), str(face.pk)])
    return hashlib.sha1(raw.encode("utf-8")).hexdigest()[:10]


def face_json(face, staff=False):
    """The face as the renderer needs it. Staff also get the warnings and bookkeeping fields."""
    body = {
        "id": face.pk, "name": face.name, "tags": face.tags, "palettes": face.palettes, "template": face.template,
        "css": face.css, "font_locked": face.font_locked, "version": face.version, "hash": face_hash(face),
    }
    if staff:
        body.update({
            "status": face.status, "workspace_id": str(face.workspace_id), "warnings": face.warnings,
            "source_request_id": str(face.source_request_id) if face.source_request_id else None,
            "created_at": iso(face.created_at), "updated_at": iso(face.updated_at),
            "published_at": iso(face.published_at), "disabled_at": iso(face.disabled_at),
        })
    return body


def company_face_json(face):
    """What a company sees about its own face in lists: the renderer fields plus status."""
    return {**face_json(face), "status": face.status, "published_at": iso(face.published_at)}


def public_custom_face(workspace, design):
    """The resolved face for a card's design, or None. Only ever a face of the card's own company."""
    face_id = design.get("custom_face")
    if face_id is None or not usable_face_id(workspace, face_id):
        return None
    face = CustomFace.objects.filter(pk=face_id, workspace=workspace).first()
    return face_json(face) if face else None


# ================================================================ palettes and saving a face
def clean_palettes(value):
    """Four colourways {name, bg, bg2, fg, acc, on}, each with the contrast rules of the company palette."""
    if not isinstance(value, list) or len(value) != 4:
        raise validation_error({"palettes": ["A face needs exactly four colourways."]})
    out = []
    problems = []
    for index, item in enumerate(value):
        number = index + 1
        if not isinstance(item, dict):
            problems.append(f"Colourway {number} must be an object.")
            continue
        clean = {}
        try:
            clean["name"] = clean_line(str(item.get("name") or f"Colourway {index + 1}"), 30) or f"Colourway {index + 1}"
        except Exception:
            clean["name"] = f"Colourway {index + 1}"
        ok = True
        for key in PALETTE_KEYS:
            colour = item.get(key)
            if isinstance(colour, str) and HEX_RE.match(colour):
                clean[key] = colour.lower()
            else:
                problems.append(f"Colourway {number}: {key} must be a colour like #1a2b3c.")
                ok = False
        if ok:
            for text, ground, needed, message in PALETTE_CHECKS:
                ratio = contrast_ratio(clean[text], clean[ground])
                if ratio < needed:
                    problems.append(f"Colourway {number}: {message} (contrast {ratio:.1f} to 1, needs {needed:g} to 1).")
        out.append(clean)
    if problems:
        raise validation_error({"palettes": problems})
    return out


def clean_tags(value):
    if value is None:
        return []
    if not isinstance(value, list) or len(value) > 8:
        raise validation_error({"tags": ["Give at most 8 tags."]})
    tags = []
    for tag in value:
        if not isinstance(tag, str) or not re.fullmatch(r"[a-z][a-z0-9 -]{0,19}", tag.strip().lower()):
            raise validation_error({"tags": ["A tag is one or two short lowercase words."]})
        tags.append(tag.strip().lower())
    return tags


def check_face_text(face, template, css):
    """Run the sanitiser over a template and a stylesheet for this face. Raises on a fatal problem, else returns
    (template, css, warnings)."""
    media = own_media_paths(face.workspace)
    t, c, warnings, errors = sanitize.sanitize_face(template, css, face.pk, media)
    if errors:
        raise validation_error({e["where"]: [e["message"]] for e in errors})
    return t, c, warnings


def apply_face_fields(face, data, user):
    """Write staff-supplied fields onto a face (not yet saved) and clean them. Used by create, save and restore."""
    if "name" in data:
        name = clean_line(str(data["name"] or ""), 80)
        if not name:
            raise validation_error({"name": ["Give the face a name."]})
        face.name = name
    if "tags" in data:
        face.tags = clean_tags(data["tags"])
    if "palettes" in data:
        face.palettes = clean_palettes(data["palettes"])
    if "font_locked" in data:
        if not isinstance(data["font_locked"], bool):
            raise validation_error({"font_locked": ["Must be true or false."]})
        face.font_locked = data["font_locked"]
    if "template" in data or "css" in data:
        template = data["template"] if "template" in data else face.template
        css = data["css"] if "css" in data else face.css
        face.template, face.css, face.warnings = check_face_text(face, template, css)


def snapshot(face, user, note=""):
    """Record the current state of a face as its next version."""
    last = face.versions.order_by("-number").first()
    number = (last.number + 1) if last else 1
    CustomFaceVersion.objects.create(
        face=face, number=number, name=face.name, note=note[:200], template=face.template, css=face.css,
        palettes=face.palettes, tags=face.tags, font_locked=face.font_locked, created_by=user,
    )
    face.version = number
    face.save(update_fields=["version", "updated_at"])
    return number


def restore_version(face, version, user):
    face.name, face.template, face.css = version.name, version.template, version.css
    face.palettes, face.tags, face.font_locked = version.palettes, version.tags, version.font_locked
    # Cleaned again: the rules may have changed since the version was saved.
    face.template, face.css, face.warnings = check_face_text(face, face.template, face.css)
    face.save()
    forget_face(face.pk)
    return snapshot(face, user, f"Restored from version {version.number}")


# ================================================================ previews
def new_preview(face, user):
    token = secrets.token_urlsafe(32)
    row = CustomFacePreview.objects.create(
        face=face, token_hash=_hash_token(token), created_by=user, expires_at=timezone.now() + timedelta(days=PREVIEW_DAYS),
    )
    return token, row


def _hash_token(token):
    return hashlib.sha256(f"face-preview|{token}|{settings.SECRET_KEY}".encode("utf-8")).hexdigest()


def preview_by_token(token):
    if not isinstance(token, str) or not 20 <= len(token) <= 100:
        return None
    row = CustomFacePreview.objects.select_related("face", "face__workspace").filter(token_hash=_hash_token(token)).first()
    if row is None or row.revoked_at is not None or row.expires_at <= timezone.now():
        return None
    if row.face.status == "disabled":
        return None
    return row


def preview_url(token):
    return f"{settings.WEB_BASE_URL}/preview/custom/{token}"


SAMPLE_ITEMS = [
    {"kind": "Mobile", "value": "+971 50 123 4567"},
    {"kind": "Email", "value": "name@company.com"},
    {"kind": "Website", "value": "company.com"},
]


def preview_people(design_request):
    """Names and titles of up to four team members, only when the owner allowed it. None means "use sample people"."""
    if design_request is None or not design_request.allow_team_names:
        return None
    members = design_request.workspace.members.filter(status="active").order_by("joined_at", "invited_at")[:4]
    people = [{"name": m.full_name or (m.user.full_name if m.user else ""), "title": m.title or ""} for m in members]
    people = [p for p in people if p["name"]]
    return people or None


def preview_payload(face, request, design_request=None):
    from workspaces.services import brand_public_json

    ws = face.workspace
    return {
        "face": face_json(face),
        "status": face.status,
        "company": {"name": (ws.brand or {}).get("company_name") or ws.name, "brand": brand_public_json(ws, request)},
        "people": preview_people(design_request or face.source_request),
        "sample_items": SAMPLE_ITEMS,
    }


# ================================================================ requests
def customer_open_request(workspace):
    return DesignRequest.objects.filter(workspace=workspace, status__in=DesignRequest.OPEN).first()


def author_name(user):
    return (user.full_name or user.email) if user else ""


def add_message(design_request, author_kind, user, body, internal=False, kind="message", status_to=""):
    msg = DesignRequestMessage.objects.create(
        request=design_request, author=user, author_kind=author_kind,
        author_name=author_name(user) if author_kind != "system" else "", kind=kind, body=body,
        internal=internal, status_to=status_to,
    )
    if kind == "message" and not internal:
        design_request.last_message_at = msg.created_at
        design_request.last_author_kind = author_kind
        design_request.save(update_fields=["last_message_at", "last_author_kind", "updated_at"])
    return msg


def unread_for_customer(design_request):
    seen = design_request.customer_seen_at
    qs = design_request.messages.filter(internal=False).exclude(author_kind__in=("customer", "system"))
    if seen:
        qs = qs.filter(created_at__gt=seen)
    return qs.count()


def change_status(design_request, status, actor_kind, user=None, note=""):
    """Set the status, add the line to the thread and return the message (e-mails are sent by the callers)."""
    previous = design_request.status
    design_request.status = status
    if status in ("closed", "withdrawn", "live") and design_request.closed_at is None:
        design_request.closed_at = timezone.now()
    design_request.save(update_fields=["status", "closed_at", "updated_at"])
    return add_message(
        design_request, actor_kind if actor_kind in ("customer", "staff") else "system", user, note, kind="status", status_to=status,
    ), previous


# staff may move a request from a status to these
STAFF_MOVES = {
    "new": ("contacted", "in_design", "closed"),
    "contacted": ("new", "in_design", "closed"),
    "in_design": ("contacted", "in_review", "closed"),
    "in_review": ("in_design", "closed"),
    "changes_requested": ("in_design", "closed"),
    "approved": ("in_design", "closed"),
    "live": ("closed",),
    "closed": (),
    "withdrawn": (),
}


# ================================================================ files
MAGIC = (
    (b"\x89PNG\r\n\x1a\n", "image/png", ".png"),
    (b"\xff\xd8\xff", "image/jpeg", ".jpg"),
    (b"%PDF-", "application/pdf", ".pdf"),
)


def sniff(head):
    """(content type, extension) from the first bytes of a file, or None. Names and declared types are never trusted."""
    for prefix, ctype, ext in MAGIC:
        if head.startswith(prefix):
            return ctype, ext
    if len(head) >= 12 and head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return "image/webp", ".webp"
    return None


def clean_filename(name):
    name = re.sub(r"[\x00-\x1f\x7f\\/:*?\"<>|]+", "_", str(name or "file")).strip(" .")
    return (name or "file")[:120]


def store_file(design_request, upload, kind, message=None):
    """Check and store one uploaded file. Raises a validation error for a wrong type, a big file or a full request."""
    if upload is None:
        raise validation_error({"file": ["Choose a file to upload."]})
    if design_request.files.count() >= MAX_FILES:
        raise validation_error({"file": [f"A request can have at most {MAX_FILES} files."]})
    if upload.size > MAX_FILE_BYTES:
        raise validation_error({"file": ["That file is larger than 10 MB."]})
    head = upload.read(16)
    upload.seek(0)
    found = sniff(head)
    if found is None:
        raise validation_error({"file": ["Use a PNG, JPG, WebP or PDF file."]})
    content_type, _ = found
    data = upload.read()
    row = DesignRequestFile(
        request=design_request, message=message, uploaded_by_kind=kind, original_name=clean_filename(upload.name),
        content_type=content_type, size=len(data),
    )
    row.file.save("f", ContentFile(data), save=False)
    row.save()
    return row


def file_json(f):
    return {
        "id": str(f.id), "name": f.original_name, "content_type": f.content_type, "size": f.size,
        "by": f.uploaded_by_kind, "message_id": str(f.message_id) if f.message_id else None, "created_at": iso(f.created_at),
    }


def clean_brief(data, workspace):
    """Validate the fields of a new request. Returns a dict of model fields."""
    from datetime import date

    errors = {}
    out = {}
    goals = str(data.get("goals") or "").strip()
    if not goals:
        errors["goals"] = ["Tell us what you want the card to say about your company."]
    elif len(goals) > 4000:
        errors["goals"] = ["Please keep this under 4000 characters."]
    out["goals"] = goals
    for key in ("brand_assets_notes", "notes"):
        value = str(data.get(key) or "").strip()
        if len(value) > 3000:
            errors[key] = ["Please keep this under 3000 characters."]
        out[key] = value
    examples = data.get("style_examples") or []
    if not isinstance(examples, list) or len(examples) > 5:
        errors["style_examples"] = ["Give up to 5 links."]
    else:
        links = []
        for link in examples:
            link = str(link or "").strip()
            parts = urlsplit(link)
            if not link:
                continue
            if parts.scheme not in ("http", "https") or not parts.netloc or len(link) > 300 or re.search(r"\s", link):
                errors["style_examples"] = ["Each link must start with http:// or https://."]
                break
            links.append(link)
        out["style_examples"] = links
    languages = data.get("languages", "en")
    if languages not in ("en", "ar", "both"):
        errors["languages"] = ["Choose English, Arabic or both."]
    out["languages"] = languages
    deadline = data.get("deadline")
    if deadline in (None, ""):
        out["deadline"] = None
    else:
        try:
            parsed = date.fromisoformat(str(deadline))
            if parsed < timezone.now().date():
                errors["deadline"] = ["Choose a date that has not passed."]
            out["deadline"] = parsed
        except ValueError:
            errors["deadline"] = ["Use a date like 2026-12-31."]
    count = data.get("employees_count")
    if count in (None, ""):
        out["employees_count"] = None
    elif isinstance(count, int) and not isinstance(count, bool) and 1 <= count <= 1_000_000:
        out["employees_count"] = count
    else:
        errors["employees_count"] = ["Give a whole number of people."]
    allow = data.get("allow_team_names", False)
    if not isinstance(allow, bool):
        errors["allow_team_names"] = ["Must be true or false."]
    out["allow_team_names"] = bool(allow) if isinstance(allow, bool) else False
    follows = data.get("follows_face")
    out["follows_face"] = None
    if follows not in (None, ""):
        face = CustomFace.objects.filter(pk=follows, workspace=workspace).first() if isinstance(follows, int) else None
        if face is None or face.status not in ("live", "approved", "disabled"):
            errors["follows_face"] = ["Choose one of your company's designs."]
        else:
            out["follows_face"] = face
    if errors:
        raise validation_error(errors)
    return out


# ================================================================ e-mail
def staff_recipients(design_request=None):
    """Who is told about new requests and customer messages: the assigned person, else every support and admin person
    plus the addresses in the STAFF_NOTIFY_EMAILS setting."""
    from accounts.models import User

    if design_request is not None and design_request.assigned_staff and design_request.assigned_staff.is_active:
        return [design_request.assigned_staff.email]
    addresses = list(User.objects.filter(
        staff_role__in=("support", "admin"), is_active=True, deleted_at__isnull=True,
    ).values_list("email", flat=True))
    addresses += [a for a in getattr(settings, "STAFF_NOTIFY_EMAILS", []) if a]
    seen, out = set(), []
    for a in addresses:
        if a.lower() not in seen:
            seen.add(a.lower())
            out.append(a)
    return out


def staff_link(design_request):
    return f"{settings.WEB_BASE_URL}/staff/requests/{design_request.id}"


def customer_link(design_request):
    return f"{settings.WEB_BASE_URL}/app/requests/{design_request.id}"


def notify_staff(design_request, subject, heading, lines, raw=(), **params):
    """Tell the staff about a request. The wording is English text with {placeholders} (filled from `params`) and is
    sent in each person's own language; `raw` lines were written by people and are added as they are."""
    from ilaf.i18n import language_for_email

    params.setdefault("company", design_request.workspace.name)
    for address in staff_recipients(design_request):
        lang = language_for_email(address)
        send_brand_email(
            address, tr(lang, subject, **params), tr(lang, heading, **params),
            [tr(lang, line, **params) for line in lines] + list(raw),
            tr(lang, "Open the staff request"), staff_link(design_request), lang=lang,
        )


def localise_warnings(request, warnings):
    """The sanitiser's warnings with their sentences in the language of the request."""
    lang = request_language(request)
    return [{**w, "message": translate_message(lang, w["message"])} for w in warnings]


def customer_recipients(design_request):
    """The person who asked, else the company owner: (email, language) pairs."""
    users = []
    if design_request.requested_by and design_request.requested_by.is_active:
        users.append(design_request.requested_by)
    else:
        owner = design_request.workspace.members.filter(role="owner", user__isnull=False).select_related("user").first()
        if owner:
            users.append(owner.user)
    return [(u.email, user_language(u)) for u in users]


def notify_customer(design_request, subject, heading, lines, button=None, url=None, raw=(), **params):
    """Send one e-mail to the company contact in their language. `subject`, `heading`, `lines` and `button` are English
    wording passed through ilaf.i18n.tr for each recipient (with `params` filled in); `raw` lines are written by people
    and added as they are."""
    params.setdefault("company", design_request.workspace.name)
    for address, lang in customer_recipients(design_request):
        send_brand_email(
            address, tr(lang, subject, **params), tr(lang, heading, **params),
            [tr(lang, line, **params) for line in lines] + list(raw),
            tr(lang, button or "Open the request"), url or customer_link(design_request), lang=lang,
        )


def notify_face_disabled(face, affected):
    """Tell the owners and admins that a face was switched off and its cards use the normal design again."""
    members = face.workspace.members.filter(role__in=("owner", "admin"), status="active", user__isnull=False).select_related("user")
    for m in members:
        lang = member_language(m)
        send_brand_email(
            m.user.email,
            tr(lang, "Your custom card design was switched off"),
            tr(lang, "Your custom card design was switched off"),
            [
                tr(lang, "The design \"{name}\" is no longer available. {n} cards that used it now show the standard design again.",
                   name=face.name, n=affected),
                tr(lang, "Nothing else changed on your cards. Contact us if you would like the design back."),
            ],
            tr(lang, "Open the design requests"), f"{settings.WEB_BASE_URL}/app/requests", lang=lang,
        )


def affected_cards(face):
    """How many cards of the company have this face chosen in their own design."""
    from cards.models import Card

    return Card.objects.filter(workspace=face.workspace, design__custom_face=face.pk).count()


STAFF_ACTOR_NAME = "Design team"


def company_log_staff(request, workspace, action, target_type="", target_id="", target_label="", details=None):
    """A company audit row for something the product team did: shown as "Design team", never with a personal name."""
    from operations.models import AuditEvent

    if workspace is None or workspace.kind != "company":
        return None
    return AuditEvent.objects.create(
        workspace=workspace, actor=None, actor_email="", actor_name=STAFF_ACTOR_NAME, action=action,
        target_type=target_type, target_id=str(target_id or "")[:64], target_label=(target_label or "")[:200],
        details=details or {}, ip_hash="",
    )
