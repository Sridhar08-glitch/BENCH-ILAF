"""The staff alert counters: what is waiting for a person in the support team right now (new requests, customer replies, live chats)."""
from django.db.models import OuterRef, Subquery
from rest_framework.response import Response

from ilaf.utils import iso

from . import services
from .models import ChatMessage, ChatSession, SupportTicket
from .staff_views import SupportView

LATEST = 6


def _live_tickets():
    return SupportTicket.objects.filter(merged_into__isnull=True, spam=False)


def new_tickets_qs():
    """Requests nobody has touched: new, no reply sent and nobody assigned."""
    return _live_tickets().filter(status="new", first_response_at__isnull=True, assigned_staff__isnull=True)


def customer_replies_qs():
    """Requests that were answered before and whose latest visible message is the customer's."""
    return _live_tickets().filter(
        status__in=("new", "open", "waiting_customer"), first_response_at__isnull=False, last_author_kind="customer",
    )


def chats_waiting_qs():
    """Running chats whose latest real message (not a system line) is the visitor's."""
    last = ChatMessage.objects.filter(session=OuterRef("pk")).exclude(author_kind="system").order_by("-id")
    return ChatSession.objects.filter(status__in=("waiting", "active")).annotate(
        last_kind=Subquery(last.values("author_kind")[:1]), last_body=Subquery(last.values("body")[:1]),
        last_at=Subquery(last.values("created_at")[:1]),
    ).filter(last_kind="customer")


def _ticket_item(t, kind):
    return {
        "id": str(t.id), "kind": kind, "label": t.label, "requester_name": t.requester_name or t.requester_email,
        "subject": t.subject, "created_at": iso(t.created_at if kind == "ticket" else (t.last_message_at or t.created_at)),
    }


def _chat_item(s):
    visitor = s.visitor_name or (s.user.full_name if s.user_id else "") or s.visitor_email or (s.user.email if s.user_id else "")
    return {
        "id": str(s.id), "kind": "chat", "label": "", "requester_name": visitor,
        "subject": services.snippet(s.last_body, 80), "created_at": iso(s.last_at or s.started_at),
    }


def build_alerts():
    new_q, reply_q, chat_q = new_tickets_qs(), customer_replies_qs(), chats_waiting_qs()
    new_rows = list(new_q.order_by("-created_at")[:LATEST])
    reply_rows = list(reply_q.order_by("-last_message_at")[:LATEST])
    chat_rows = list(chat_q.select_related("user").order_by("-last_at")[:LATEST])
    items = [_ticket_item(t, "ticket") for t in new_rows] + [_ticket_item(t, "reply") for t in reply_rows] + [_chat_item(s) for s in chat_rows]
    items.sort(key=lambda i: i["created_at"] or "", reverse=True)
    new_count, reply_count, chat_count = new_q.count(), reply_q.count(), chat_q.count()
    return {
        "new_tickets": new_count, "customer_replies": reply_count, "chats_waiting": chat_count,
        "total": new_count + reply_count + chat_count, "latest": items[:LATEST],
    }


class AlertsView(SupportView):
    """Counters for the bell in the staff top bar. Every staff role may read them (the lists are the ones the Support page shows)."""

    def get(self, request):
        return Response(build_alerts())
