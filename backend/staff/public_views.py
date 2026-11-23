"""The parts of the back office that customers and visitors reach: the "Report this card" form, the "request access" form,
the customer app's feature switches and announcement banners, and the e-mail unsubscribe link.

Every message a visitor or customer can see here has an Arabic text (see ilaf/locale_ar_admin.py)."""
import re
from datetime import timedelta

from django.conf import settings
from django.http import Http404
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from cards.slugs import resolve_card
from ilaf.emails import send_brand_email
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import DEFAULT_LANGUAGE, normalise_language, request_language, tr
from ilaf.throttles import PublicCompanyLeadThrottle, PublicReadThrottle, PublicReportThrottle
from operations.audit import ip_hash
from public.views import card_state
from workspaces.models import Member

from . import announce, flags
from .models import AbuseReport, Announcement, AnnouncementDismissal, CompanyLead

EMAIL = re.compile(r"^[^@\s]{1,64}@[^@\s]{1,190}\.[^@\s]{2,}$")
SIZES = ("1-5", "6-20", "21-50", "51-200", "200+")


def _clean(value, limit):
    return re.sub(r"\s+", " ", str(value or "")).strip()[:limit]


class PublicBase(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]


class PublicReportView(PublicBase):
    """A visitor reports a card. A filled honeypot field and a repeat report from the same address within a day are
    answered with success and stored nowhere, so a bot learns nothing."""

    throttle_classes = [PublicReportThrottle]

    def post(self, request, key):
        data = request.data if isinstance(request.data, dict) else {}
        card = resolve_card(key)
        if card is None or card_state(card) == "hidden":
            raise Http404
        reason = data.get("reason")
        if reason not in ("spam", "fake", "offensive", "impersonation", "other"):
            raise validation_error({"reason": ["Choose a reason from the list."]})
        email = _clean(data.get("email"), 254)
        if email and not EMAIL.match(email):
            raise validation_error({"email": ["Enter a valid email address."]})
        if _clean(data.get("website"), 100):
            return Response({"ok": True}, status=201)
        who = ip_hash(request)
        since = timezone.now() - timedelta(days=1)
        if AbuseReport.objects.filter(card=card, reporter_hash=who, created_at__gte=since).exists():
            return Response({"ok": True}, status=201)
        now = timezone.now()
        AbuseReport.objects.create(
            card=card, workspace=card.workspace if card.workspace.kind == "company" else None, card_name=card.name[:120], reason=reason,
            note=_clean(data.get("note"), 500), reporter_email=email, reporter_hash=who, due_at=now + timedelta(hours=settings.ABUSE_SLA_HOURS),
        )
        return Response({"ok": True}, status=201)


class PublicCompanyLeadView(PublicBase):
    """"Request access / talk to us": a company asks the product team to get in touch."""

    throttle_classes = [PublicCompanyLeadThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        fields = {}
        company, name, email = _clean(data.get("company"), 120), _clean(data.get("name"), 120), _clean(data.get("email"), 254)
        if not company:
            fields["company"] = ["Enter your company name."]
        if not name:
            fields["name"] = ["Enter your name."]
        if not EMAIL.match(email):
            fields["email"] = ["Enter a valid email address."]
        size = _clean(data.get("size"), 20)
        if size and size not in SIZES:
            fields["size"] = ["Choose a size from the list."]
        if fields:
            raise validation_error(fields)
        if _clean(data.get("website"), 100):
            return Response({"ok": True}, status=201)
        who = ip_hash(request)
        since = timezone.now() - timedelta(days=1)
        if CompanyLead.objects.filter(email__iexact=email, created_at__gte=since).exists():
            return Response({"ok": True}, status=201)
        lang = normalise_language(request_language(request)) or DEFAULT_LANGUAGE
        lead = CompanyLead.objects.create(
            company=company, name=name, email=email, size=size, message=_clean(data.get("message"), 1000), source=_clean(data.get("source"), 30) or "website",
            language=lang, reporter_hash=who,
        )
        for address in [a for a in getattr(settings, "STAFF_NOTIFY_EMAILS", []) if a]:
            send_brand_email(
                address, tr(DEFAULT_LANGUAGE, "A company asked to talk to us"), tr(DEFAULT_LANGUAGE, "New application"),
                [tr(DEFAULT_LANGUAGE, "{name} from {company} ({email}) asked to talk to us.", company=lead.company, name=lead.name, email=lead.email)], tr(DEFAULT_LANGUAGE, "Open the board"), f"{settings.WEB_BASE_URL}/staff/applications",
                lang=DEFAULT_LANGUAGE, kind="staff",
            )
        return Response({"ok": True}, status=201)


class FlagsView(APIView):
    """The feature switches for the signed-in person's company (the customer app asks once a minute at most)."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        workspace = None
        workspace_id = request.query_params.get("workspace")
        if workspace_id:
            member = Member.objects.filter(workspace_id=workspace_id, user=request.user, status="active").select_related("workspace").first() if _is_uuid(workspace_id) else None
            if member is None:
                raise Http404
            workspace = member.workspace
        response = Response({"flags": flags.flags_for(workspace)})
        response["Cache-Control"] = "private, max-age=60"
        return response


def _is_uuid(value):
    import uuid

    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


class AnnouncementsView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request):
        return Response({"results": announce.active_for(request.user, request_language(request))})


class AnnouncementDismissView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, announcement_id):
        a = Announcement.objects.filter(pk=announcement_id).first() if _is_uuid(announcement_id) else None
        if a is None:
            raise Http404
        AnnouncementDismissal.objects.get_or_create(announcement=a, user=request.user)
        return Response(status=204)


class UnsubscribeView(PublicBase):
    """One click from the e-mail: product updates are switched off for the person the signed link belongs to."""

    throttle_classes = [PublicReadThrottle]

    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        user = announce.user_from_unsubscribe_token(str(data.get("token") or "")[:300])
        if user is None:
            raise ApiError("unsubscribe_invalid", "This unsubscribe link is not valid.", 400)
        if user.product_updates:
            user.product_updates = False
            user.save(update_fields=["product_updates"])
        return Response({"ok": True})
