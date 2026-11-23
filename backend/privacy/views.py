"""Export my data, delete my account, delete my company."""
from django.conf import settings
from django.http import FileResponse, Http404
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.services import confirm_identity, require_recent_auth
from ilaf.errors import ApiError, validation_error
from ilaf.throttles import DataDownloadThrottle
from ilaf.utils import iso
from workspaces.access import get_workspace_and_member

from . import services
from .models import DataRequest

ACCOUNT_CONFIRM_WORD = "DELETE"


def _data(request):
    return request.data if isinstance(request.data, dict) else {}


def _link_token(request, token):
    """The link token from the URL (older clients) or from the request body `{"token": ...}`."""
    return token or str(_data(request).get("token") or "")


class RequestsView(APIView):
    def get(self, request):
        rows = DataRequest.objects.filter(user=request.user).select_related("workspace")[:30]
        return Response([services.request_json(r) for r in rows])


class ExportView(APIView):
    def post(self, request):
        require_recent_auth(request, _data(request))
        workspace = None
        workspace_id = _data(request).get("workspace_id")
        if workspace_id:
            workspace, _ = get_workspace_and_member(request.user, workspace_id, ("owner",))
            if workspace.kind != "company":
                raise validation_error({"workspace_id": ["Only a company can be exported this way."]})
        dr, created = services.start_export(request.user, workspace)
        return Response(services.request_json(dr), status=201 if created else 200)


class DownloadLinkView(APIView):
    """A fresh copy of the signed link for a ready export (the same link that was e-mailed)."""

    def post(self, request, request_id):
        require_recent_auth(request, _data(request))
        dr = DataRequest.objects.filter(pk=request_id, user=request.user, kind="export").first()
        if dr is None:
            raise Http404
        payload = services.request_json(dr)
        if not payload["download_available"]:
            raise ApiError("download_unavailable", "This export is not ready to download.", 409)
        return Response({"url": services.download_page_url(dr), "expires_at": payload["expires_at"]})


class DownloadCheckView(APIView):
    """Says whether a link can still be used, without using it up. The web page calls this first."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DataDownloadThrottle]

    def post(self, request, token=None):
        return self.get(request, token)

    def get(self, request, token=None):
        dr = services.export_from_token(_link_token(request, token))
        return Response({"valid": True, "scope": dr.scope, "expires_at": iso(dr.expires_at), "file_size": dr.file_size})


class DownloadView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [DataDownloadThrottle]

    def post(self, request, token=None):
        """Same as GET, with the token in the body so it never appears in a URL (and so in an access log)."""
        return self.get(request, token)

    def get(self, request, token=None):
        dr = services.export_from_token(_link_token(request, token), claim=True)
        try:
            handle = services.export_storage().open(dr.file_name, "rb")
        except OSError:
            raise ApiError("download_invalid", "This export file is no longer available. Please ask for a new one.", 410)
        kind = "company" if dr.scope == "workspace" else "my"
        name = f"{settings.PRODUCT_NAME.lower()}-{kind}-data.zip"
        response = FileResponse(handle, as_attachment=True, filename=name, content_type="application/zip")
        response["Cache-Control"] = "no-store"
        return response


class DeleteAccountView(APIView):
    def post(self, request):
        data = _data(request)
        if str(data.get("confirm") or "").strip() != ACCOUNT_CONFIRM_WORD:
            raise validation_error({"confirm": [f"Type {ACCOUNT_CONFIRM_WORD} to confirm."]})
        confirm_identity(request.user, data)
        dr = services.request_account_deletion(request.user)
        return Response(services.request_json(dr), status=202)


class DeleteCompanyView(APIView):
    def post(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, ("owner",))
        if ws.kind != "company":
            raise validation_error({"workspace": ["Only a company can be deleted this way."]})
        if ws.deletion_due_at is not None:
            raise ApiError("already_scheduled", "This company is already scheduled for deletion.", 409)
        data = _data(request)
        if str(data.get("confirm_name") or "").strip() != ws.name:
            raise validation_error({"confirm_name": ["Type the company name exactly to confirm."]})
        confirm_identity(request.user, data)
        dr = services.request_company_deletion(ws, request.user, request)
        return Response(services.request_json(dr), status=202)


class RestoreCompanyView(APIView):
    def post(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, ("owner",))
        services.restore_company(ws, request.user, request)
        return Response({"workspace_id": str(ws.id), "restored": True})
