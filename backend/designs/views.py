"""Customer side of custom designs: requests, messages, files, approval, the company's own faces and the preview links.

Every route is for the owner or an admin of one company workspace (members may read the company's faces so a card
editor can draw them). A person who is not a member gets 404, so another company's requests and files never show."""
from django.http import FileResponse, Http404
from django.utils import timezone
from rest_framework.parsers import MultiPartParser
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError, validation_error
from staff.flags import require_flag
from ilaf.throttles import PublicReadThrottle
from ilaf.utils import clean_multiline, iso
from operations import audit
from workspaces.access import ALL_ROLES, MANAGER_ROLES, get_workspace_and_member

from . import services
from .models import CustomFace, DesignRequest, DesignRequestFile, DesignRequestMessage


def _company(request, workspace_id, roles=MANAGER_ROLES):
    ws, member = get_workspace_and_member(request.user, workspace_id, roles)
    if ws.kind != "company":
        raise Http404
    return ws, member


def _request_or_404(ws, request_id):
    try:
        return DesignRequest.objects.select_related("workspace", "requested_by", "assigned_staff").get(pk=request_id, workspace=ws)
    except (DesignRequest.DoesNotExist, ValueError):
        raise Http404


def summary_json(r):
    return {
        "id": str(r.id), "status": r.status, "goals": r.goals[:200], "languages": r.languages,
        "deadline": r.deadline.isoformat() if r.deadline else None, "created_at": iso(r.created_at),
        "updated_at": iso(r.updated_at), "unread": services.unread_for_customer(r),
        "follows_face_id": r.follows_face_id,
        "face": _current_face_json(r),
    }


def _current_face(r):
    """The face that belongs to this request now: the newest one that is not disabled."""
    return r.faces.exclude(status="disabled").order_by("-updated_at", "-id").first()


def _current_face_json(r):
    face = _current_face(r)
    if face is None:
        return None
    return {"id": face.pk, "name": face.name, "status": face.status}


def detail_json(r):
    messages = r.messages.filter(internal=False).select_related("author").prefetch_related("files")
    face = _current_face(r)
    return {
        **summary_json(r),
        "goals": r.goals, "brand_assets_notes": r.brand_assets_notes, "style_examples": r.style_examples,
        "employees_count": r.employees_count, "notes": r.notes, "allow_team_names": r.allow_team_names,
        "requested_by": r.requested_by_email,
        "messages": [
            {
                "id": str(m.id), "kind": m.kind, "author_kind": m.author_kind, "author_name": m.author_name, "body": m.body,
                "status_to": m.status_to, "created_at": iso(m.created_at), "files": [services.file_json(f) for f in m.files.all()],
            }
            for m in messages
        ],
        "files": [services.file_json(f) for f in r.files.all()],
        "can_review": r.status == "in_review" and face is not None and face.status == "in_review",
        "can_withdraw": r.status in ("new", "contacted", "in_design", "in_review", "changes_requested", "approved"),
    }


# ================================================================ requests
class RequestsView(APIView):
    def get(self, request, workspace_id):
        ws, _ = _company(request, workspace_id)
        rows = DesignRequest.objects.filter(workspace=ws).select_related("requested_by")
        return Response([summary_json(r) for r in rows])

    def post(self, request, workspace_id):
        ws, member = _company(request, workspace_id)
        require_flag("custom_designs", ws)
        data = request.data if isinstance(request.data, dict) else {}
        if services.customer_open_request(ws) is not None:
            raise ApiError("request_open", "Your company already has a design request in progress.", 409)
        fields = services.clean_brief(data, ws)
        r = DesignRequest.objects.create(
            workspace=ws, requested_by=request.user, requested_by_email=request.user.email, **fields,
        )
        services.add_message(r, "system", None, "", kind="status", status_to="new")
        audit.log(request, ws, "design_request.created", "design_request", r.id, ws.name)
        from staff import services as staff_services

        staff_services.log(request, "design_request.created", "design_request", r.id, ws.name, actor=None)
        services.notify_staff(
            r, "New custom design request from {company}", "New custom design request",
            ["{company} asked for a custom card design.", "Goals: {goals}"], goals=r.goals[:300],
        )
        return Response(detail_json(r), status=201)


class RequestDetailView(APIView):
    def get(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        return Response(detail_json(_request_or_404(ws, request_id)))


class SummaryView(APIView):
    """The numbers for the navigation badge."""

    def get(self, request, workspace_id):
        ws, _ = _company(request, workspace_id)
        rows = list(DesignRequest.objects.filter(workspace=ws))
        return Response({
            "unread": sum(services.unread_for_customer(r) for r in rows),
            "open": sum(1 for r in rows if r.status in DesignRequest.OPEN),
            "in_review": sum(1 for r in rows if r.status == "in_review"),
        })


class SeenView(APIView):
    def post(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        r.customer_seen_at = timezone.now()
        r.save(update_fields=["customer_seen_at"])
        return Response(status=204)


class MessagesView(APIView):
    def post(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        if r.status in ("closed", "withdrawn"):
            raise ApiError("request_finished", "This request is finished. Start a new one to continue.", 409)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            body = clean_multiline(str(data.get("body") or ""), 5000)
        except Exception:
            raise validation_error({"body": ["Please keep this under 5000 characters."]})
        file_ids = data.get("file_ids") or []
        files = []
        if file_ids:
            if not isinstance(file_ids, list) or len(file_ids) > services.MAX_FILES:
                raise validation_error({"file_ids": ["Attach up to 10 files."]})
            files = list(DesignRequestFile.objects.filter(request=r, pk__in=[str(f) for f in file_ids], message__isnull=True))
        if not body.strip() and not files:
            raise validation_error({"body": ["Write a message first."]})
        msg = services.add_message(r, "customer", request.user, body)
        for f in files:
            f.message = msg
            f.save(update_fields=["message"])
        r.customer_seen_at = timezone.now()
        r.save(update_fields=["customer_seen_at"])
        audit.log(request, ws, "design_request.message", "design_request", r.id, ws.name)
        services.notify_staff(
            r, "New message from {company} on their design request", "New message on a design request",
            ["{company} wrote:"], raw=[body[:600]],
        )
        return Response(detail_json(r), status=201)


class FilesView(APIView):
    parser_classes = [MultiPartParser]

    def post(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        if r.status in ("closed", "withdrawn"):
            raise ApiError("request_finished", "This request is finished. Start a new one to continue.", 409)
        row = services.store_file(r, request.FILES.get("file"), "customer")
        return Response(services.file_json(row), status=201)


def serve_file(f):
    """Send a stored file as a download-safe response: the type comes from the file's own bytes, never from its name."""
    try:
        handle = f.file.open("rb")
    except FileNotFoundError:
        raise Http404
    inline = f.content_type.startswith("image/")
    response = FileResponse(handle, content_type=f.content_type)
    safe = f.original_name.replace('"', "").replace("\\", "")
    response["Content-Disposition"] = f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{_quote(safe)}"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cache-Control"] = "private, no-store"
    return response


def _quote(name):
    from urllib.parse import quote

    return quote(name, safe="")


class FileDownloadView(APIView):
    def get(self, request, workspace_id, request_id, file_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        try:
            f = r.files.get(pk=file_id)
        except (DesignRequestFile.DoesNotExist, ValueError):
            raise Http404
        # a file attached to an internal staff note is never given to the company
        if f.message_id and f.message.internal:
            raise Http404
        return serve_file(f)


class WithdrawView(APIView):
    def post(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        if r.status not in DesignRequest.OPEN:
            raise ApiError("request_finished", "This request is already finished.", 409)
        services.change_status(r, "withdrawn", "customer", request.user)
        CustomFace.objects.filter(source_request=r, status="in_review").update(status="draft")
        audit.log(request, ws, "design_request.withdrawn", "design_request", r.id, ws.name)
        services.notify_staff(r, "{company} withdrew their design request", "Design request withdrawn", ["{company} withdrew the request."])
        return Response(detail_json(r))


class ApproveView(APIView):
    def post(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        face = _current_face(r)
        if r.status != "in_review" or face is None or face.status != "in_review":
            raise ApiError("not_in_review", "There is no design waiting for your approval.", 409)
        face.status = "approved"
        face.save(update_fields=["status", "updated_at"])
        services.forget_face(face.pk)
        services.change_status(r, "approved", "customer", request.user)
        audit.log(request, ws, "design_request.approved", "design_request", r.id, face.name)
        services.notify_staff(
            r, "{company} approved the design", "Design approved", ["{company} approved \"{name}\". It can be published now."],
            name=face.name,
        )
        return Response(detail_json(r))


class RequestChangesView(APIView):
    def post(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        face = _current_face(r)
        if r.status != "in_review" or face is None:
            raise ApiError("not_in_review", "There is no design waiting for your review.", 409)
        data = request.data if isinstance(request.data, dict) else {}
        try:
            comment = clean_multiline(str(data.get("comment") or ""), 5000)
        except Exception:
            raise validation_error({"comment": ["Please keep this under 5000 characters."]})
        if not comment.strip():
            raise validation_error({"comment": ["Tell us what should change."]})
        face.status = "draft"
        face.save(update_fields=["status", "updated_at"])
        services.forget_face(face.pk)
        services.change_status(r, "changes_requested", "customer", request.user, comment)
        audit.log(request, ws, "design_request.changes_requested", "design_request", r.id, face.name)
        services.notify_staff(
            r, "{company} asked for changes", "Changes requested on a design", ["{company} asked for changes to \"{name}\":"],
            raw=[comment[:600]], name=face.name,
        )
        return Response(detail_json(r))


class RequestPreviewView(APIView):
    """The face that is waiting for review, drawn in the dashboard on sample or team people."""

    def get(self, request, workspace_id, request_id):
        ws, _ = _company(request, workspace_id)
        r = _request_or_404(ws, request_id)
        face = _current_face(r)
        if face is None:
            raise Http404
        return Response(services.preview_payload(face, request, r))


# ================================================================ the company's own faces
class CustomFacesView(APIView):
    """Faces the company may use now (approved or live). Any member can read them: a card editor draws them."""

    def get(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, ALL_ROLES)
        if ws.kind != "company":
            return Response([])
        faces = CustomFace.objects.filter(workspace=ws, status__in=services.USABLE, kind="face").order_by("-published_at", "-id")
        response = Response([services.company_face_json(f) for f in faces])
        response["Cache-Control"] = "private, max-age=30"
        return response


# ================================================================ the public preview link
class PublicPreviewView(APIView):
    """A private link to a face shown on sample people. No sign-in; the long random token is the key."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicReadThrottle]

    def get(self, request, token):
        row = services.preview_by_token(token)
        if row is None:
            raise Http404
        type(row).objects.filter(pk=row.pk).update(view_count=row.view_count + 1)
        body = services.preview_payload(row.face, request)
        body["expires_at"] = iso(row.expires_at)
        response = Response(body)
        response["Cache-Control"] = "no-store"
        response["X-Robots-Tag"] = "noindex, nofollow"
        return response
