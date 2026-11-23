"""Company settings routes of the security app: verified domains, reply-to address, e-mail preview."""
from django.conf import settings
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.company_mail import company_style
from ilaf.emails import build_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import SUPPORTED_LANGUAGES, normalise_language
from ilaf.throttles import InviteAcceptThrottle, UserApiThrottle
from workspaces.access import MANAGER_ROLES, get_workspace_and_member
from workspaces.services import invite_email_content

from . import company


def _company(request, workspace_id, roles=MANAGER_ROLES):
    ws, member = get_workspace_and_member(request.user, workspace_id, roles)
    if ws.kind != "company":
        raise ApiError("company_only", "This is only available for company workspaces.", 400)
    return ws, member


class DomainsView(APIView):
    throttle_classes = [UserApiThrottle]

    def get(self, request, workspace_id):
        ws, _member = _company(request, workspace_id)
        return Response({"domains": company.list_domains(ws), "free_mail_note": True})

    def post(self, request, workspace_id):
        ws, _member = _company(request, workspace_id, ("owner",))
        data = request.data if isinstance(request.data, dict) else {}
        row, sent = company.claim_domain(request, ws, data.get("domain"), data.get("mailbox"))
        return Response({**company.domain_json(row), "mail_sent": sent}, status=201 if sent or row.status == "verified" else 200)


class DomainDetailView(APIView):
    def delete(self, request, workspace_id, domain_id):
        ws, _member = _company(request, workspace_id, ("owner",))
        company.remove_domain(request, ws, domain_id)
        return Response(status=204)


class DomainVerifyView(APIView):
    """Finish with the six-digit code from the e-mail."""

    def post(self, request, workspace_id, domain_id):
        ws, _member = _company(request, workspace_id, ("owner",))
        data = request.data if isinstance(request.data, dict) else {}
        row = company.verify_with_code(request, ws, domain_id, data.get("code"))
        return Response(company.domain_json(row))


class DomainConfirmView(APIView):
    """The link in the e-mail (opened by whoever reads that mailbox, signed in or not)."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [InviteAcceptThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        row = company.verify_with_link(request, data.get("token"))
        return Response({"domain": row.domain, "company": row.workspace.name, "status": row.status})


class EmailSettingsView(APIView):
    """The optional reply-to address of the company's e-mails."""

    def get(self, request, workspace_id):
        ws, _member = _company(request, workspace_id)
        return Response({"reply_to_email": company.workspace_security_fields(ws)["reply_to_email"]})

    def patch(self, request, workspace_id):
        ws, _member = _company(request, workspace_id, ("owner",))
        data = request.data if isinstance(request.data, dict) else {}
        if "reply_to_email" not in data:
            raise validation_error({"reply_to_email": ["Enter one valid e-mail address."]})
        policy = company.set_reply_to(request, ws, data["reply_to_email"])
        return Response({"reply_to_email": policy.reply_to_email})


class EmailPreviewView(APIView):
    """The invite e-mail as the company's people will see it, as HTML for a sandboxed frame."""

    def get(self, request, workspace_id):
        ws, _member = _company(request, workspace_id)
        lang = normalise_language(request.query_params.get("lang")) or "en"
        if lang not in SUPPORTED_LANGUAGES:
            lang = "en"
        subject, heading, paragraphs, button, url = invite_email_content(ws, lang, f"{settings.WEB_BASE_URL}/join/preview")
        text, html, style = build_brand_email(heading, paragraphs, button, url, lang, ws)
        style = style or company_style(ws) or {}
        return Response({
            "subject": subject, "html": html, "text": text, "lang": lang,
            "from": style.get("from"), "reply_to": (style.get("reply_to") or [None])[0],
            "has_logo": bool(style.get("logo")),
        })
