"""Staff side of custom designs: the request board, the thread, and the face studio.

Roles (see staff.permissions): every staff role can read; support and admin handle requests (messages, notes, status,
assignment, files); only admin creates, edits, publishes and disables faces."""
from django.conf import settings
from django.db.models import Q
from django.http import Http404
from django.utils import timezone
from rest_framework.parsers import MultiPartParser
from rest_framework.response import Response

from accounts.models import User
from billing.services import get_subscription, seats_used
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import request_language, translate_message
from ilaf.utils import clean_multiline, file_url, iso
from staff import services as staff_services
from staff.permissions import ALL_WRITERS, StaffView
from staff.views import company_status, paged

from . import sanitize, services
from .models import CustomFace, CustomFacePreview, DesignRequest, DesignRequestFile
from .starters import STARTERS
from .views import serve_file


def _req(request_id):
    try:
        return DesignRequest.objects.select_related("workspace", "requested_by", "assigned_staff").get(pk=request_id)
    except (DesignRequest.DoesNotExist, ValueError):
        raise Http404


def _face(face_id):
    try:
        return CustomFace.objects.select_related("workspace", "source_request").get(pk=face_id)
    except (CustomFace.DoesNotExist, ValueError, TypeError):
        raise Http404


def staff_user_json(user):
    return {"id": str(user.id), "email": user.email, "full_name": user.full_name} if user else None


def company_summary(ws, request=None):
    sub = get_subscription(ws)
    owner = ws.members.filter(role="owner").first()
    brand = ws.brand or {}
    return {
        "id": str(ws.id), "name": ws.name, "plan": sub.plan.name if sub else None, "seats_used": seats_used(ws),
        "seats_total": sub.seats_total if sub else 0, "status": company_status(ws), "owner_email": owner.email if owner else "",
        "logo_url": file_url(request, ws.logo), "palette": brand.get("palette"),
        "colours": brand.get("colours"), "website": brand.get("website", ""),
    }


def row_json(r):
    face = r.faces.exclude(status="disabled").order_by("-updated_at", "-id").first()
    return {
        "id": str(r.id), "status": r.status, "company": {"id": str(r.workspace_id), "name": r.workspace.name},
        "goals": r.goals[:160], "languages": r.languages, "deadline": r.deadline.isoformat() if r.deadline else None,
        "assigned": staff_user_json(r.assigned_staff), "created_at": iso(r.created_at), "updated_at": iso(r.updated_at),
        "waiting_for_staff": r.status in ("new", "contacted", "in_design", "changes_requested") and r.last_author_kind != "staff",
        "face": {"id": face.pk, "name": face.name, "status": face.status} if face else None,
    }


def message_json(m):
    return {
        "id": str(m.id), "kind": m.kind, "author_kind": m.author_kind, "author_name": m.author_name, "body": m.body,
        "internal": m.internal, "status_to": m.status_to, "created_at": iso(m.created_at),
        "files": [services.file_json(f) for f in m.files.all()],
    }


def face_row(f):
    return {
        "id": f.pk, "name": f.name, "status": f.status, "version": f.version, "updated_at": iso(f.updated_at),
        "workspace_id": str(f.workspace_id),
    }


def detail_json(r, request):
    return {
        **row_json(r),
        "goals": r.goals, "brand_assets_notes": r.brand_assets_notes, "style_examples": r.style_examples,
        "employees_count": r.employees_count, "notes": r.notes, "allow_team_names": r.allow_team_names,
        "requested_by": r.requested_by_email, "follows_face_id": r.follows_face_id,
        "company_detail": company_summary(r.workspace, request),
        "messages": [message_json(m) for m in r.messages.select_related("author").prefetch_related("files")],
        "files": [services.file_json(f) for f in r.files.all()],
        "faces": [face_row(f) for f in r.faces.all()],
        "moves": list(services.STAFF_MOVES.get(r.status, ())),
    }


# ================================================================ the board
class RequestsView(StaffView):
    def get(self, request):
        params = request.query_params
        qs = DesignRequest.objects.select_related("workspace", "assigned_staff")
        if params.get("status"):
            qs = qs.filter(status=params["status"])
        assignee = params.get("assignee")
        if assignee == "me":
            qs = qs.filter(assigned_staff=request.user)
        elif assignee == "none":
            qs = qs.filter(assigned_staff__isnull=True)
        elif assignee:
            qs = qs.filter(assigned_staff_id=assignee) if len(assignee) == 36 else qs.none()
        term = (params.get("q") or "").strip()[:100]
        if term:
            qs = qs.filter(Q(workspace__name__icontains=term) | Q(goals__icontains=term) | Q(requested_by_email__icontains=term))
        counts = {}
        for row in DesignRequest.objects.values_list("status", flat=True):
            counts[row] = counts.get(row, 0) + 1
        body = paged(request, qs.order_by("-updated_at", "-id"), row_json, 100)
        body["counts"] = counts
        body["staff"] = [staff_user_json(u) for u in User.objects.filter(staff_role__in=ALL_WRITERS, is_active=True).order_by("email")]
        return Response(body)


class RequestDetailView(StaffView):
    def get(self, request, request_id):
        r = _req(request_id)
        staff_services.log(request, "design_request.viewed", "design_request", r.id, r.workspace.name)
        return Response(detail_json(r, request))


class MessagesView(StaffView):
    write_roles = ALL_WRITERS

    def post(self, request, request_id):
        r = _req(request_id)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            body = clean_multiline(str(data.get("body") or ""), 5000)
        except Exception:
            raise validation_error({"body": ["Please keep this under 5000 characters."]})
        internal = data.get("internal", False)
        if not isinstance(internal, bool):
            raise validation_error({"internal": ["Must be true or false."]})
        file_ids = data.get("file_ids") or []
        files = []
        if file_ids:
            if not isinstance(file_ids, list):
                raise validation_error({"file_ids": ["Send a list of file ids."]})
            files = list(DesignRequestFile.objects.filter(request=r, pk__in=[str(f) for f in file_ids], message__isnull=True))
        if not body.strip() and not files:
            raise validation_error({"body": ["Write a message first."]})
        msg = services.add_message(r, "staff", request.user, body, internal=internal)
        for f in files:
            f.message = msg
            f.save(update_fields=["message"])
        staff_services.log(request, "design_request.note" if internal else "design_request.reply", "design_request", r.id, r.workspace.name)
        if not internal:
            services.company_log_staff(request, r.workspace, "design_request.message", "design_request", r.id, r.workspace.name)
            services.notify_customer(
                r, "Our team replied to your design request", "Our team replied to your design request",
                ["{author} from our design team wrote:"], "Open the request", raw=[body[:800]], author=request.user.full_name or "Our team",
            )
        return Response(message_json(msg), status=201)


class FilesView(StaffView):
    write_roles = ALL_WRITERS
    parser_classes = [MultiPartParser]

    def post(self, request, request_id):
        r = _req(request_id)
        row = services.store_file(r, request.FILES.get("file"), "staff")
        return Response(services.file_json(row), status=201)


class FileDownloadView(StaffView):
    def get(self, request, request_id, file_id):
        r = _req(request_id)
        try:
            f = r.files.get(pk=file_id)
        except (DesignRequestFile.DoesNotExist, ValueError):
            raise Http404
        staff_services.log(request, "design_request.file_downloaded", "design_request", r.id, r.workspace.name, {"file": f.original_name})
        return serve_file(f)


STATUS_MAIL = {
    "contacted": (
        "We received your custom design request", "We received your custom design request",
        ["Our design team has read your request and will be in touch shortly."], "Open the request",
    ),
    "in_design": (
        "Your custom card design is in progress", "Your custom card design is in progress",
        ["Our designers have started working on your card design."], "Open the request",
    ),
    "in_review": (
        "Your custom card design is ready to review", "Your custom card design is ready to review",
        ["Open your design requests to preview the design, approve it or ask for changes."], "Review the design",
    ),
    "closed": (
        "Your design request was closed", "Your design request was closed",
        ["We closed your custom design request. Start a new one any time from the design requests page."], "Open the request",
    ),
}


def move(request, r, status, note=""):
    """Change a request's status as staff, record it and tell the company."""
    msg, previous = services.change_status(r, status, "staff", request.user, note)
    staff_services.log(request, "design_request.status", "design_request", r.id, r.workspace.name, {"from": previous, "to": status})
    services.company_log_staff(request, r.workspace, "design_request.status_changed", "design_request", r.id, r.workspace.name, {"status": status})
    mail = STATUS_MAIL.get(status)
    if mail:
        subject, heading, lines, button = mail
        services.notify_customer(r, subject, heading, lines, button, raw=[note] if note else ())
    return msg


class StatusView(StaffView):
    write_roles = ALL_WRITERS

    def post(self, request, request_id):
        r = _req(request_id)
        data = request.data if isinstance(request.data, dict) else {}
        status = data.get("status")
        if status not in services.STAFF_MOVES.get(r.status, ()):
            raise ApiError("bad_transition", f"A request that is {r.status.replace('_', ' ')} cannot move to that status.", 409)
        if status == "in_review":
            face = r.faces.filter(status="in_review").first()
            if face is None:
                raise ApiError("no_face_in_review", "Send a face for review first.", 409)
        note = str(data.get("note") or "").strip()[:2000]
        move(request, r, status, note)
        return Response(detail_json(r, request))


class AssignView(StaffView):
    write_roles = ALL_WRITERS

    def post(self, request, request_id):
        r = _req(request_id)
        data = request.data if isinstance(request.data, dict) else {}
        staff_id = data.get("staff_id")
        user = None
        if staff_id:
            user = User.objects.filter(pk=str(staff_id), staff_role__in=ALL_WRITERS, is_active=True).first()
            if user is None:
                raise validation_error({"staff_id": ["Choose a person with the support or admin role."]})
        r.assigned_staff = user
        r.save(update_fields=["assigned_staff", "updated_at"])
        staff_services.log(request, "design_request.assigned", "design_request", r.id, r.workspace.name, {"to": user.email if user else None})
        return Response(detail_json(r, request))


# ================================================================ faces
class StartersView(StaffView):
    def get(self, request):
        return Response([
            {"key": k, "name": v["name"], "tags": v["tags"], "template": v["template"], "css": v["css"], "palettes": v["palettes"]}
            for k, v in STARTERS.items()
        ])


def studio_json(face, request):
    return {
        **services.face_json(face, staff=True),
        "warnings": services.localise_warnings(request, face.warnings),
        "company": company_summary(face.workspace, request),
        "request": row_json(face.source_request) if face.source_request else None,
        "versions": [
            {"number": v.number, "name": v.name, "note": v.note, "created_at": iso(v.created_at),
             "by": v.created_by.email if v.created_by else ""}
            for v in face.versions.select_related("created_by")
        ],
        "previews": [preview_json(p) for p in face.previews.order_by("-created_at")[:10]],
        "affected_cards": services.affected_cards(face),
        "allowed_properties": sorted(sanitize.PROPS),
    }


def preview_json(p):
    now = timezone.now()
    state = "revoked" if p.revoked_at else "expired" if p.expires_at <= now else "active"
    return {"id": str(p.id), "state": state, "expires_at": iso(p.expires_at), "views": p.view_count, "created_at": iso(p.created_at)}


class FacesView(StaffView):
    def get(self, request):
        qs = CustomFace.objects.select_related("workspace").order_by("-updated_at")
        if request.query_params.get("workspace"):
            qs = qs.filter(workspace_id=request.query_params["workspace"])
        return Response([{**face_row(f), "company": f.workspace.name} for f in qs[:200]])


class RequestFacesView(StaffView):
    """Create a face for a request, empty or from a starter template."""

    def post(self, request, request_id):
        r = _req(request_id)
        data = request.data if isinstance(request.data, dict) else {}
        starter = STARTERS.get(data.get("starter")) if data.get("starter") else None
        if data.get("starter") and starter is None:
            raise validation_error({"starter": ["Choose one of the starter templates."]})
        face = CustomFace(workspace=r.workspace, source_request=r, created_by=request.user, name=r.workspace.name[:60] + " card")
        payload = {
            "name": str(data.get("name") or (starter["name"] if starter else face.name)),
            "palettes": (starter or STARTERS["clean"])["palettes"],
        }
        if starter:
            payload.update(tags=starter["tags"])
        face.save()
        try:
            services.apply_face_fields(face, payload, request.user)
            if starter:
                services.apply_face_fields(face, {"template": starter["template"], "css": starter["css"]}, request.user)
            face.save()
        except Exception:
            face.delete()
            raise
        services.snapshot(face, request.user, "First version")
        if r.status in ("new", "contacted", "changes_requested"):
            move(request, r, "in_design")
        staff_services.log(request, "face.created", "face", face.pk, face.name, {"request": str(r.id), "starter": data.get("starter")})
        return Response(studio_json(face, request), status=201)


class FaceView(StaffView):
    def get(self, request, face_id):
        return Response(studio_json(_face(face_id), request))

    def patch(self, request, face_id):
        face = _face(face_id)
        data = request.data if isinstance(request.data, dict) else {}
        changed = any(k in data for k in ("template", "css", "palettes", "name", "font_locked", "tags"))
        services.apply_face_fields(face, data, request.user)
        reopened = False
        if changed and face.status == "approved":
            # a change after approval needs the company's approval again
            face.status = "in_review"
            reopened = True
        face.save()
        services.forget_face(face.pk)
        if reopened and face.source_request and face.source_request.status == "approved":
            services.change_status(face.source_request, "in_review", "system", None, "The design was changed after it was approved.")
        staff_services.log(request, "face.saved", "face", face.pk, face.name)
        return Response(studio_json(face, request))


class SanitizeView(StaffView):
    """A dry run for the studio: what the sanitiser would keep, and what it would remove."""

    write_roles = ("read_only", "support", "admin")

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        face = _face(data.get("face_id")) if data.get("face_id") else None
        media = services.own_media_paths(face.workspace) if face else []
        face_id = face.pk if face else 0
        template, css, warnings, errors = sanitize.sanitize_face(str(data.get("template") or ""), str(data.get("css") or ""), face_id, media)
        errors = [{**e, "message": translate_message(request_language(request), e["message"])} for e in errors]
        return Response({"template": template, "css": css, "warnings": services.localise_warnings(request, warnings), "errors": errors})


class VersionsView(StaffView):
    def get(self, request, face_id):
        return Response(studio_json(_face(face_id), request)["versions"])

    def post(self, request, face_id):
        face = _face(face_id)
        data = request.data if isinstance(request.data, dict) else {}
        number = services.snapshot(face, request.user, str(data.get("note") or "")[:200])
        staff_services.log(request, "face.saved", "face", face.pk, face.name, {"version": number})
        return Response(studio_json(face, request), status=201)


class VersionRestoreView(StaffView):
    def post(self, request, face_id, number):
        face = _face(face_id)
        version = face.versions.filter(number=number).first()
        if version is None:
            raise Http404
        services.restore_version(face, version, request.user)
        staff_services.log(request, "face.version_restored", "face", face.pk, face.name, {"from": number})
        return Response(studio_json(face, request))


def _ready(face):
    if not face.template.strip():
        raise ApiError("face_empty", "The template is empty.", 409)
    if len(face.palettes) != 4:
        raise ApiError("face_palettes", "The face needs four colourways.", 409)


class SendForReviewView(StaffView):
    def post(self, request, face_id):
        face = _face(face_id)
        if face.status not in ("draft", "in_review"):
            raise ApiError("bad_state", "Only a draft face can be sent for review.", 409)
        _ready(face)
        face.status = "in_review"
        face.save(update_fields=["status", "updated_at"])
        services.forget_face(face.pk)
        token, row = services.new_preview(face, request.user)
        r = face.source_request
        if r is not None and r.status in ("in_design", "changes_requested", "new", "contacted", "approved"):
            move(request, r, "in_review")
        staff_services.log(request, "face.sent_for_review", "face", face.pk, face.name)
        return Response({"preview_url": services.preview_url(token), "expires_at": iso(row.expires_at), "preview": preview_json(row)})


class PreviewsView(StaffView):
    def post(self, request, face_id):
        face = _face(face_id)
        token, row = services.new_preview(face, request.user)
        return Response({"preview_url": services.preview_url(token), "expires_at": iso(row.expires_at), "preview": preview_json(row)}, status=201)


class PreviewRevokeView(StaffView):
    def post(self, request, face_id, preview_id):
        face = _face(face_id)
        row = CustomFacePreview.objects.filter(face=face, pk=preview_id).first()
        if row is None:
            raise Http404
        row.revoked_at = row.revoked_at or timezone.now()
        row.save(update_fields=["revoked_at"])
        staff_services.log(request, "face.preview_revoked", "face", face.pk, face.name)
        return Response(preview_json(row))


class PublishView(StaffView):
    def post(self, request, face_id):
        face = _face(face_id)
        if face.status != "approved":
            raise ApiError("not_approved", "The company has not approved this design yet.", 409)
        face.status = "live"
        face.published_at = timezone.now()
        face.save(update_fields=["status", "published_at", "updated_at"])
        services.forget_face(face.pk)
        r = face.source_request
        if r is not None and r.status in DesignRequest.OPEN:
            services.change_status(r, "live", "staff", request.user, "")
            services.notify_customer(
                r, "Your custom card design is live", "Your custom card design is live",
                ["Your design \"{name}\" is now available for {company}.", "Choose it in the card design steps, under Your company's designs."],
                "Choose the design", f"{settings.WEB_BASE_URL}/app/brand", name=face.name,
            )
        services.company_log_staff(request, face.workspace, "design_face.live", "face", face.pk, face.name)
        staff_services.log(request, "face.published", "face", face.pk, face.name)
        return Response(studio_json(face, request))


class DisableView(StaffView):
    def post(self, request, face_id):
        face = _face(face_id)
        if face.status == "disabled":
            raise ApiError("bad_state", "This face is already disabled.", 409)
        affected = services.affected_cards(face)
        was_live = face.status in services.USABLE
        face.status = "disabled"
        face.disabled_at = timezone.now()
        face.save(update_fields=["status", "disabled_at", "updated_at"])
        services.forget_face(face.pk)
        if was_live:
            services.notify_face_disabled(face, affected)
            services.company_log_staff(request, face.workspace, "design_face.disabled", "face", face.pk, face.name, {"cards": affected})
        staff_services.log(request, "face.disabled", "face", face.pk, face.name, {"cards": affected})
        return Response(studio_json(face, request))


class EnableView(StaffView):
    def post(self, request, face_id):
        face = _face(face_id)
        if face.status != "disabled":
            raise ApiError("bad_state", "Only a disabled face can be enabled again.", 409)
        face.status = "live" if face.published_at else "draft"
        face.disabled_at = None
        face.save(update_fields=["status", "disabled_at", "updated_at"])
        services.forget_face(face.pk)
        staff_services.log(request, "face.enabled", "face", face.pk, face.name)
        return Response(studio_json(face, request))
