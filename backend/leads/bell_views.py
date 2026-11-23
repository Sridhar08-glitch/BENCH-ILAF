from datetime import timedelta

from django.utils import timezone
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.utils import iso

from . import workflow
from .models import LeadSeen
from .views import MANUAL_SOURCES, lead_access

BELL_WINDOW_DAYS = 30
BELL_LATEST = 5


def bell_kind(lead):
    return "meeting_request" if lead.source == "meeting_request" else "contact"


class LeadBellView(APIView):
    """New contacts this person has not looked at yet. Contacts the person saved by hand are not news to them."""

    def get(self, request, workspace_id):
        workspace, member = lead_access(request.user, workspace_id)
        since = timezone.now() - timedelta(days=BELL_WINDOW_DAYS)
        seen = LeadSeen.objects.filter(user=request.user, workspace=workspace).values_list("seen_at", flat=True).first()
        if seen is not None and seen > since:
            since = seen
        qs = workflow.visible_leads(member).filter(created_at__gt=since).exclude(source__in=MANUAL_SOURCES)
        latest = list(qs.select_related("card").order_by("-created_at", "-id")[:BELL_LATEST])
        # The list is short only when nothing else is waiting, so the count needs its own query only past the cap.
        unread = len(latest) if len(latest) < BELL_LATEST else qs.count()
        return Response({
            "unread": unread,
            "latest": [
                {
                    "id": str(l.id),
                    "name": l.name,
                    "card_name": l.card.name if l.card_id else l.card_name,
                    "source": l.source,
                    "created_at": iso(l.created_at),
                    "kind": bell_kind(l),
                }
                for l in latest
            ],
        })


class LeadBellSeenView(APIView):
    def post(self, request, workspace_id):
        workspace, _ = lead_access(request.user, workspace_id)
        LeadSeen.objects.update_or_create(user=request.user, workspace=workspace, defaults={"seen_at": timezone.now()})
        return Response(status=204)
