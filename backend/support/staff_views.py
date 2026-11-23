"""The staff side of support: the inbox, ticket work, canned replies, the chat console, metrics and the settings."""
import csv
import re
from datetime import date, timedelta
from zoneinfo import ZoneInfo

from django.conf import settings
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db import transaction
from django.db.models import Avg, Count, DurationField, ExpressionWrapper, F, Q
from django.db.models.functions import TruncDate
from django.http import Http404, HttpResponse
from django.utils import timezone
from rest_framework.response import Response

from accounts.models import User
from billing.services import get_subscription
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import tr
from ilaf.utils import iso, run_after_response, sane_date
from staff import services as staff_services
from staff.permissions import ADMIN_ONLY, StaffView
from staff.views import paged
from workspaces.models import Workspace

from . import chat, hours, services
from .models import (
    CATEGORIES, PRIORITIES, STATUSES, BannedVisitor, CannedReply, ChatSession, StaffPresence, SupportAttachment, SupportTicket,
)
from .views import _flag, serve_attachment

WRITERS = ("support", "admin")


class SupportView(StaffView):
    """Support and admin people may write; read-only people may look."""

    write_roles = WRITERS


def _ticket(ticket_id):
    try:
        return SupportTicket.objects.select_related("requester", "assigned_staff", "workspace", "merged_into").get(pk=ticket_id)
    except (SupportTicket.DoesNotExist, ValueError, DjangoValidationError):
        raise Http404


def _session(chat_id):
    try:
        return ChatSession.objects.select_related("user", "assigned_staff", "ticket").get(pk=chat_id)
    except (ChatSession.DoesNotExist, ValueError, DjangoValidationError):
        raise Http404


def _staff_user(value):
    if not value:
        return None
    try:
        user = User.objects.get(pk=value, is_active=True, staff_role__in=WRITERS)
    except (User.DoesNotExist, ValueError, DjangoValidationError):
        raise validation_error({"assigned_to": ["Choose a support person."]})
    return user


def audit(request, action, ticket=None, details=None, label=""):
    staff_services.log(
        request, action, "support_ticket" if ticket is not None else "support", ticket.id if ticket is not None else "",
        ticket.label if ticket is not None else label, details or {},
    )


# ================================================================ inbox
def _sla_q(state, now):
    live = Q(status__in=("new", "open"))
    first_late = Q(first_response_at__isnull=True, first_due_at__lt=now)
    res_late = Q(first_response_at__isnull=False, resolve_due_at__lt=now)
    soon = now + timedelta(hours=2)
    first_soon = Q(first_response_at__isnull=True, first_due_at__gte=now, first_due_at__lt=soon)
    res_soon = Q(first_response_at__isnull=False, resolve_due_at__gte=now, resolve_due_at__lt=soon)
    if state == "breached":
        return live & (first_late | res_late)
    if state == "at_risk":
        return live & (first_soon | res_soon)
    if state == "ok":
        return live & ~(first_late | res_late | first_soon | res_soon)
    if state == "paused":
        return Q(status="waiting_customer")
    if state == "done":
        return Q(status__in=("solved", "closed"))
    return Q()


def filtered(request):
    p = request.query_params
    now = timezone.now()
    qs = SupportTicket.objects.select_related("assigned_staff", "workspace", "merged_into", "requester").filter(merged_into__isnull=True)
    tab = p.get("tab", "")
    if tab == "mine":
        qs = qs.filter(assigned_staff=request.user, status__in=("new", "open", "waiting_customer"))
    elif tab == "unassigned":
        qs = qs.filter(assigned_staff__isnull=True, status__in=("new", "open", "waiting_customer"))
    elif tab == "open":
        qs = qs.filter(status__in=("new", "open", "waiting_customer"))
    elif tab == "solved":
        qs = qs.filter(status__in=("solved", "closed"))
    for field, allowed in (("status", STATUSES), ("priority", PRIORITIES), ("category", CATEGORIES), ("channel", ("form", "chat", "email"))):
        value = p.get(field)
        if value in allowed:
            qs = qs.filter(**{field: value})
    if p.get("workspace"):
        try:
            qs = qs.filter(workspace_id=p["workspace"])
        except (ValueError, DjangoValidationError):
            qs = qs.none()
    assignee = p.get("assignee")
    if assignee == "none":
        qs = qs.filter(assigned_staff__isnull=True)
    elif assignee:
        try:
            qs = qs.filter(assigned_staff_id=assignee)
        except (ValueError, DjangoValidationError):
            qs = qs.none()
    if p.get("sla"):
        qs = qs.filter(_sla_q(p["sla"], now))
    for key, lookup in (("from", "created_at__date__gte"), ("to", "created_at__date__lte")):
        if p.get(key):
            try:
                qs = qs.filter(**{lookup: sane_date(date.fromisoformat(p[key][:10]))})
            except ValueError:
                pass
    q = (p.get("q") or "").strip()[:100]
    if q:
        match = re.search(r"(\d{1,8})$", q)
        cond = Q(subject__icontains=q) | Q(requester_email__icontains=q) | Q(requester_name__icontains=q) | Q(workspace__name__icontains=q)
        if match and re.fullmatch(r"(?i)(%s[-\s]?)?\d{1,8}" % re.escape(settings.SUPPORT_TICKET_PREFIX), q):
            cond |= Q(number=int(match.group(1)))
        qs = qs.filter(cond)
    return qs


class TicketsView(SupportView):
    def get(self, request):
        qs = filtered(request).order_by("-last_message_at", "-created_at")
        body = paged(request, qs, lambda t: services.ticket_json(t, staff=True), 25)
        mine = SupportTicket.objects.filter(merged_into__isnull=True, status__in=("new", "open", "waiting_customer"))
        body["counts"] = {
            "mine": mine.filter(assigned_staff=request.user).count(), "unassigned": mine.filter(assigned_staff__isnull=True).count(),
            "open": mine.count(),
        }
        body["agents"] = _agents_json()
        return Response(body)


def _agents_json():
    out = []
    for u in User.objects.filter(staff_role__in=WRITERS, is_active=True, deleted_at__isnull=True).order_by("full_name", "email"):
        out.append({"id": str(u.id), "user_id": u.id, "name": u.full_name or u.email, "email": u.email, "role": u.staff_role})
    return out


class AgentsView(SupportView):
    def get(self, request):
        chat.refresh_presence()
        presence = {p.user_id: p for p in StaffPresence.objects.all()}
        out = []
        for a in _agents_json():
            row = presence.get(a["user_id"])
            out.append({**a, "presence": row.status if row else "offline", "capacity": row.capacity if row else 3})
        return Response(out)


class TicketsCsvView(SupportView):
    def get(self, request):
        if request.staff_role not in WRITERS:
            raise ApiError("forbidden", "Your staff role does not allow this action.", 403)
        rows = filtered(request).order_by("-created_at")[:5000]
        response = HttpResponse(content_type="text/csv; charset=utf-8")
        response["Content-Disposition"] = 'attachment; filename="support-tickets.csv"'
        writer = csv.writer(response)
        writer.writerow(["number", "subject", "status", "priority", "category", "channel", "requester", "created_at", "first_response_at", "solved_at", "rating"])

        def safe(value):
            text = "" if value is None else str(value)
            return "'" + text if text[:1] in ("=", "+", "-", "@", "\t", "\r") else text

        for t in rows:
            writer.writerow([safe(x) for x in (t.label, t.subject, t.status, t.priority, t.category, t.channel, t.requester_email,
                                               iso(t.created_at), iso(t.first_response_at), iso(t.solved_at), t.rating)])
        audit(request, "support.export", details={"rows": min(len(rows), 5000)}, label="tickets")
        return response


# ================================================================ one ticket
def customer_panel(t):
    panel = {"email": t.requester_email, "name": t.requester_name, "signed_in": t.requester_id is not None, "ticket_count": SupportTicket.objects.filter(requester_email=t.requester_email).count()}
    u = t.requester
    if u is not None:
        panel.update({
            "user_id": str(u.id), "full_name": u.full_name, "email_verified": u.email_verified, "language": u.language,
            "created_at": iso(u.created_at), "last_sign_in": iso(u.last_login),
        })
    ws = t.workspace
    if ws is not None:
        sub = get_subscription(ws)
        panel["workspace"] = {"id": str(ws.id), "name": ws.name, "plan": sub.plan.name if sub else "", "plan_status": sub.status if sub else "none"}
    # The support view (looking at the customer's account as they see it) does not exist yet: the button is shown disabled.
    panel["support_view"] = {"available": False}
    panel["recent_errors"] = []
    return panel


class TicketDetailView(SupportView):
    def get(self, request, ticket_id):
        t = _ticket(ticket_id)
        out = services.ticket_detail_json(t, staff=True)
        out["customer"] = customer_panel(t)
        out["agents"] = _agents_json()
        return Response(out)

    def patch(self, request, ticket_id):
        t = _ticket(ticket_id)
        data = request.data if isinstance(request.data, dict) else {}
        changes = {}
        if "priority" in data:
            if data["priority"] not in PRIORITIES:
                raise validation_error({"priority": ["Choose a priority."]})
            if data["priority"] != t.priority:
                changes["priority"] = (t.priority, data["priority"])
                t.priority = data["priority"]
                services.set_due_times(t)
                t.save(update_fields=["priority", "first_due_at", "resolve_due_at", "updated_at"])
        if "category" in data:
            if data["category"] not in CATEGORIES:
                raise validation_error({"category": ["Choose a category."]})
            if data["category"] != t.category:
                changes["category"] = (t.category, data["category"])
                t.category = data["category"]
                t.save(update_fields=["category", "updated_at"])
        if "assigned_to" in data:
            user = _staff_user(data["assigned_to"])
            if (user.id if user else None) != t.assigned_staff_id:
                changes["assigned_to"] = (str(t.assigned_staff_id or ""), str(user.id) if user else "")
                t.assigned_staff = user
                t.save(update_fields=["assigned_staff", "updated_at"])
        if "spam" in data:
            t.spam = _flag(data["spam"], False)
            t.save(update_fields=["spam", "updated_at"])
            changes["spam"] = ("", str(t.spam))
        if "status" in data:
            if data["status"] not in STATUSES:
                raise validation_error({"status": ["Choose a status."]})
            if data["status"] != t.status:
                changes["status"] = (t.status, data["status"])
                services.set_status(t, data["status"], "staff", request.user)
                run_after_response(services.notify_status, t.pk, data["status"])
        for key, (old, new) in changes.items():
            audit(request, f"support.ticket.{key}", t, {"from": old, "to": new})
        t.refresh_from_db()
        return Response(services.ticket_detail_json(t, staff=True))


class ReplyView(SupportView):
    def post(self, request, ticket_id):
        t = _ticket(ticket_id)
        data = request.data
        internal = _flag(data.get("internal"), False)
        body = services.clean_text(data.get("body"), "body", services.MAX_BODY, required=False)
        canned_id = data.get("canned_id")
        if canned_id and not body:
            reply = CannedReply.objects.filter(pk=canned_id, active=True).first() if str(canned_id).isdigit() else None
            if reply is None:
                raise validation_error({"canned_id": ["That saved reply does not exist."]})
            body = services.render_canned(reply, t, request.user)
        uploads = services.check_uploads(request.FILES.getlist("files"))
        if not body and not uploads:
            raise validation_error({"body": ["Write a message or attach a file."]})
        if t.status == "closed" and not internal:
            raise ApiError("support_ticket_closed", "This request is closed. Please start a new request.", 409)
        msg = services.add_message(t, "staff", request.user, body, internal=internal, uploads=uploads)
        if internal:
            audit(request, "support.ticket.note", t, {"message": str(msg.id)})
        else:
            if t.assigned_staff_id is None:
                t.assigned_staff = request.user
                t.save(update_fields=["assigned_staff", "updated_at"])
            new_status = data.get("status")
            if new_status not in STATUSES:
                new_status = "waiting_customer" if t.status in ("new", "open") else t.status
            if new_status != t.status:
                services.set_status(t, new_status, "staff", request.user)
            audit(request, "support.ticket.reply", t, {"message": str(msg.id)})
            run_after_response(services.notify_staff_replied, t.pk, msg.pk)
            if new_status in ("solved", "closed"):
                run_after_response(services.notify_status, t.pk, new_status)
        t.refresh_from_db()
        return Response(services.ticket_detail_json(t, staff=True), status=201)


class AttachmentDownloadView(SupportView):
    def get(self, request, ticket_id, file_id):
        t = _ticket(ticket_id)
        try:
            a = SupportAttachment.objects.get(pk=file_id, ticket=t)
        except (SupportAttachment.DoesNotExist, ValueError, DjangoValidationError):
            raise Http404
        return serve_attachment(a)


def merge_tickets(request, source, target):
    if source.id == target.id:
        raise validation_error({"into": ["Choose a different request."]})
    if source.requester_email.lower() != target.requester_email.lower():
        raise ApiError("support_merge_mismatch", "Only requests from the same person can be merged.", 409)
    with transaction.atomic():
        source.messages.update(ticket=target)
        SupportAttachment.objects.filter(ticket=source).update(ticket=target)
        source.chats.update(ticket=target)
        source.status = "closed"
        source.closed_at = timezone.now()
        source.merged_into = target
        source.save(update_fields=["status", "closed_at", "merged_into", "updated_at"])
        last = target.messages.filter(internal=False, kind="message").order_by("-created_at").first()
        if last:
            target.last_message_at, target.last_author_kind = last.created_at, last.author_kind
        if source.created_at < target.created_at:
            target.created_at = source.created_at
        target.save(update_fields=["last_message_at", "last_author_kind", "created_at", "updated_at"])
        services.add_message(target, "system", None, source.label, kind="status", status_to="merged")
    audit(request, "support.ticket.merge", target, {"merged": source.label})


class MergeView(SupportView):
    def post(self, request, ticket_id):
        t = _ticket(ticket_id)
        into = request.data.get("into")
        target = SupportTicket.objects.filter(Q(pk=into) | Q(number=int(into) if str(into).isdigit() else -1)).first() if into else None
        if target is None:
            raise validation_error({"into": ["Request not found."]})
        merge_tickets(request, t, target)
        return Response(services.ticket_detail_json(target, staff=True))


class BulkView(SupportView):
    def post(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        ids = data.get("ids")
        action = data.get("action")
        if not isinstance(ids, list) or not ids or len(ids) > 200:
            raise validation_error({"ids": ["Choose between 1 and 200 requests."]})
        tickets = list(SupportTicket.objects.select_related("assigned_staff").filter(pk__in=[i for i in ids if isinstance(i, str)]))
        value = data.get("value")
        if action == "assign":
            user = _staff_user(value)
            for t in tickets:
                t.assigned_staff = user
                t.save(update_fields=["assigned_staff", "updated_at"])
            audit(request, "support.bulk.assign", details={"count": len(tickets), "to": str(user.id) if user else ""}, label="bulk")
        elif action == "status":
            if value not in STATUSES:
                raise validation_error({"value": ["Choose a status."]})
            for t in tickets:
                if t.status != value:
                    services.set_status(t, value, "staff", request.user)
                    run_after_response(services.notify_status, t.pk, value)
            audit(request, "support.bulk.status", details={"count": len(tickets), "to": value}, label="bulk")
        elif action == "priority":
            if value not in PRIORITIES:
                raise validation_error({"value": ["Choose a priority."]})
            for t in tickets:
                t.priority = value
                services.set_due_times(t)
                t.save(update_fields=["priority", "first_due_at", "resolve_due_at", "updated_at"])
            audit(request, "support.bulk.priority", details={"count": len(tickets), "to": value}, label="bulk")
        elif action == "merge":
            if len(tickets) < 2:
                raise validation_error({"ids": ["Choose at least two requests to merge."]})
            tickets.sort(key=lambda t: t.created_at)
            target = tickets[0]
            for t in tickets[1:]:
                merge_tickets(request, t, target)
        else:
            raise validation_error({"action": ["Choose an action."]})
        return Response({"changed": len(tickets)})


class StartChatView(SupportView):
    """A ticket starts a chat: the customer is e-mailed a link and the chat opens already accepted by this person."""

    def post(self, request, ticket_id):
        t = _ticket(ticket_id)
        if not services.cfg().chat_enabled:
            raise ApiError("support_chat_disabled", "Live chat is not available right now. Please send us a message instead.", 409)
        if t.requester_id is None:
            raise ApiError("support_chat_needs_account", "Only people with an account can be invited to a chat.", 409)
        now = timezone.now()
        session = ChatSession.objects.create(
            user=t.requester, visitor_name=t.requester_name, visitor_email=t.requester_email, language=t.language, ticket=t,
            workspace=t.workspace, status="active", assigned_staff=request.user, accepted_at=now, context=t.context, ip_hash="",
        )
        chat.system_message(session, "started")
        audit(request, "support.chat.start", t, {"chat": str(session.id)})
        lang = services.ticket_lang(t)
        run_after_response(
            services._mail, t.requester_email, lang, tr(lang, "Our team would like to chat"), tr(lang, "Our team would like to chat"),
            [tr(lang, "{agent} is online now and would like to chat about {ticket}.", agent=services.staff_name(request.user), ticket=t.label)], t,
            tr(lang, "Open the chat"), services.customer_url(t) + f"?chat={session.id}",
        )
        return Response(chat.session_json(session, staff=True), status=201)


# ================================================================ canned replies
def _canned_json(c):
    return {"id": c.id, "title": c.title, "body_en": c.body_en, "body_ar": c.body_ar, "active": c.active}


def _canned_data(data):
    title = services.clean_text(data.get("title"), "title", 80)
    body_en = services.clean_text(data.get("body_en"), "body_en", 4000)
    body_ar = services.clean_text(data.get("body_ar"), "body_ar", 4000, required=False)
    return {"title": title, "body_en": body_en, "body_ar": body_ar, "active": _flag(data.get("active"), True)}


class CannedView(StaffView):
    def get(self, request):
        return Response([_canned_json(c) for c in CannedReply.objects.all()])

    def post(self, request):
        c = CannedReply.objects.create(**_canned_data(request.data))
        audit(request, "support.canned.create", label=c.title)
        return Response(_canned_json(c), status=201)


def _canned(canned_id):
    c = CannedReply.objects.filter(pk=canned_id).first()
    if c is None:
        raise Http404
    return c


class CannedOneView(StaffView):
    def put(self, request, canned_id):
        c = _canned(canned_id)
        for k, v in _canned_data(request.data).items():
            setattr(c, k, v)
        c.save()
        audit(request, "support.canned.update", label=c.title)
        return Response(_canned_json(c))

    def delete(self, request, canned_id):
        c = _canned(canned_id)
        audit(request, "support.canned.delete", label=c.title)
        c.delete()
        return Response(status=204)


# ================================================================ live chat console
class ChatsView(SupportView):
    def get(self, request):
        chat.throttle_sweep()
        chat.refresh_presence()
        active = ChatSession.objects.filter(status__in=("waiting", "active")).select_related("user", "assigned_staff", "ticket").order_by("started_at")
        recent = ChatSession.objects.filter(status__in=("ended", "offline_converted")).select_related("user", "assigned_staff", "ticket").order_by("-ended_at")[:20]
        me = StaffPresence.objects.filter(user=request.user).first()
        return Response({
            "chats": [chat.session_json(s, staff=True) for s in active], "recent": [chat.session_json(s, staff=True) for s in recent],
            "presence": {"status": me.status if me else "offline", "capacity": me.capacity if me else 3},
            "availability": chat.availability(),
        })


class ChatDetailView(SupportView):
    def get(self, request, chat_id):
        s = _session(chat_id)
        try:
            since = max(0, int(request.query_params.get("since", 0)))
        except ValueError:
            since = 0
        out = chat.session_json(s, staff=True)
        if request.staff_role == "read_only":
            out["messages"] = [chat.message_json(m) for m in s.messages.filter(id__gt=since)[:200]]
        else:
            out.update(chat.poll(s, since, "staff"))
        return Response(out)


class ChatAcceptView(SupportView):
    def post(self, request, chat_id):
        s = chat.accept(_session(chat_id), request.user)
        chat.system_message(s, "accepted")
        staff_services.log(request, "support.chat.accept", "support_chat", s.id, chat.visitor_label(s))
        return Response(chat.session_json(s, staff=True))


class ChatMessagesView(SupportView):
    def post(self, request, chat_id):
        s = _session(chat_id)
        if s.status != "active":
            raise ApiError("support_chat_ended", "This chat has ended.", 409)
        if s.assigned_staff_id != request.user.id and request.staff_role != "admin":
            raise ApiError("support_chat_not_yours", "This chat is with another person.", 403)
        body = services.clean_text(request.data.get("body"), "body", chat.MAX_CHAT_BODY, required=False)
        uploads = services.check_uploads(request.FILES.getlist("files"))
        if not body and not uploads:
            raise validation_error({"body": ["Write a message or attach a file."]})
        msg = chat.add_message(s, "staff", request.user, body or "📎")
        for upload, checked in uploads:
            services.store_attachment(upload, "staff", chat_session=s, chat_message=msg, checked=checked)
        return Response(chat.message_json(msg), status=201)


class ChatTypingView(SupportView):
    def post(self, request, chat_id):
        chat.mark_typing(_session(chat_id), "staff")
        return Response({"ok": True})


class ChatTransferView(SupportView):
    def post(self, request, chat_id):
        s = _session(chat_id)
        user = _staff_user(request.data.get("to"))
        if user is None:
            raise validation_error({"to": ["Choose a support person."]})
        chat.transfer(s, user)
        staff_services.log(request, "support.chat.transfer", "support_chat", s.id, chat.visitor_label(s), {"to": str(user.id)})
        return Response(chat.session_json(s, staff=True))


class ChatEndView(SupportView):
    def post(self, request, chat_id):
        s = _session(chat_id)
        chat.end(s, "staff")
        s.refresh_from_db()
        staff_services.log(request, "support.chat.end", "support_chat", s.id, chat.visitor_label(s))
        return Response(chat.session_json(s, staff=True))


class ChatConvertView(SupportView):
    def post(self, request, chat_id):
        s = _session(chat_id)
        if s.status in ("ended", "offline_converted") and s.ticket_id:
            return Response(chat.session_json(s, staff=True))
        ticket = chat.convert_to_ticket(s, offline=False, by_staff=request.user)
        s.refresh_from_db()
        staff_services.log(request, "support.chat.convert", "support_chat", s.id, chat.visitor_label(s), {"ticket": ticket.label if ticket else ""})
        return Response(chat.session_json(s, staff=True))


class ChatAttachmentView(SupportView):
    def get(self, request, chat_id, file_id):
        s = _session(chat_id)
        try:
            a = SupportAttachment.objects.get(pk=file_id, chat_session=s)
        except (SupportAttachment.DoesNotExist, ValueError, DjangoValidationError):
            raise Http404
        return serve_attachment(a)


class PresenceView(SupportView):
    def get(self, request):
        chat.refresh_presence()
        me = StaffPresence.objects.filter(user=request.user).first()
        return Response({"status": me.status if me else "offline", "capacity": me.capacity if me else 3, "availability": chat.availability()})

    def post(self, request):
        status = request.data.get("status")
        if status not in ("online", "away", "offline"):
            raise validation_error({"status": ["Choose online, away or offline."]})
        row = chat.set_presence(request.user, status)
        if "capacity" in request.data:
            try:
                row.capacity = max(1, min(10, int(request.data["capacity"])))
                row.save(update_fields=["capacity"])
            except (TypeError, ValueError):
                raise validation_error({"capacity": ["Choose a number from 1 to 10."]})
        return Response({"status": row.status, "capacity": row.capacity})


class HeartbeatView(SupportView):
    def post(self, request):
        row = chat.heartbeat(request.user)
        return Response({"status": row.status})


# ================================================================ bans
class BansView(StaffView):
    def get(self, request):
        now = timezone.now()
        rows = BannedVisitor.objects.filter(expires_at__gt=now).order_by("-created_at")[:200]
        return Response([{"id": b.id, "ip_hash": b.ip_hash, "reason": b.reason, "expires_at": iso(b.expires_at)} for b in rows])

    def post(self, request):
        data = request.data
        digest = str(data.get("ip_hash") or "")
        if not digest and data.get("chat_id"):
            digest = _session(data["chat_id"]).ip_hash
        if not digest and data.get("ticket_id"):
            digest = _ticket(data["ticket_id"]).ip_hash
        if not re.fullmatch(r"[0-9a-f]{32}", digest):
            raise validation_error({"ip_hash": ["There is no visitor address to ban."]})
        try:
            days = max(1, min(365, int(data.get("days", 7))))
        except (TypeError, ValueError):
            raise validation_error({"days": ["Choose a number of days from 1 to 365."]})
        b = BannedVisitor.objects.create(
            ip_hash=digest, reason=services.clean_text(data.get("reason"), "reason", 200, required=False),
            expires_at=timezone.now() + timedelta(days=days), created_by=request.user,
        )
        ChatSession.objects.filter(ip_hash=digest, status__in=("waiting", "active")).update(status="ended", ended_at=timezone.now(), ended_by="system")
        staff_services.log(request, "support.ban", "support", b.id, digest[:8], {"days": days})
        return Response({"id": b.id, "ip_hash": b.ip_hash, "expires_at": iso(b.expires_at)}, status=201)


class BanOneView(StaffView):
    def delete(self, request, ban_id):
        b = BannedVisitor.objects.filter(pk=ban_id).first()
        if b is None:
            raise Http404
        staff_services.log(request, "support.unban", "support", b.id, b.ip_hash[:8])
        b.delete()
        return Response(status=204)


# ================================================================ metrics
def _secs(value):
    return round(value.total_seconds()) if value is not None else None


class MetricsView(SupportView):
    def get(self, request):
        try:
            days = max(1, min(365, int(request.query_params.get("days", 30))))
        except ValueError:
            days = 30
        now = timezone.now()
        since = now - timedelta(days=days)
        tickets = SupportTicket.objects.filter(created_at__gte=since, merged_into__isnull=True)
        dur = lambda a, b: ExpressionWrapper(F(a) - F(b), output_field=DurationField())  # noqa: E731
        first = tickets.filter(first_response_at__isnull=False).aggregate(v=Avg(dur("first_response_at", "created_at")))["v"]
        resolved = tickets.filter(solved_at__isnull=False).aggregate(v=Avg(dur("solved_at", "created_at")))["v"]
        per_day = {row["d"].isoformat(): row["n"] for row in tickets.annotate(d=TruncDate("created_at")).values("d").annotate(n=Count("id"))}
        day_list = []
        for i in range(days - 1, -1, -1):
            d = (now - timedelta(days=i)).date().isoformat()
            day_list.append({"date": d, "count": per_day.get(d, 0)})
        rated = tickets.filter(rating__isnull=False)
        dist = {str(i): 0 for i in range(1, 6)}
        for row in rated.values("rating").annotate(n=Count("id")):
            dist[str(row["rating"])] = row["n"]
        chats = ChatSession.objects.filter(started_at__gte=since)
        wait = chats.filter(accepted_at__isnull=False).aggregate(v=Avg(dur("accepted_at", "started_at")))["v"]
        return Response({
            "days": days, "created": tickets.count(), "solved": tickets.filter(status__in=("solved", "closed")).count(),
            "open_now": SupportTicket.objects.filter(status__in=("new", "open", "waiting_customer"), merged_into__isnull=True).count(),
            "breached_now": SupportTicket.objects.filter(_sla_q("breached", now)).count(),
            "first_response_seconds": _secs(first), "resolution_seconds": _secs(resolved),
            "by_category": [{"category": r["category"], "count": r["n"]} for r in tickets.values("category").annotate(n=Count("id")).order_by("-n")],
            "by_channel": [{"channel": r["channel"], "count": r["n"]} for r in tickets.values("channel").annotate(n=Count("id")).order_by("-n")],
            "by_day": day_list,
            "satisfaction": {"average": rated.aggregate(v=Avg("rating"))["v"], "count": rated.count(), "distribution": dist},
            "chats": {
                "total": chats.count(), "answered": chats.filter(accepted_at__isnull=False).count(),
                "converted": chats.filter(status="offline_converted").count(), "wait_seconds": _secs(wait),
            },
        })


# ================================================================ settings
def settings_json(c):
    return {
        "timezone": c.timezone, "business_hours": c.business_hours, "holidays": c.holidays, "chat_enabled": c.chat_enabled,
        "chat_accept_seconds": c.chat_accept_seconds, "auto_reply_en": c.auto_reply_en, "auto_reply_ar": c.auto_reply_ar,
        "offline_reply_en": c.offline_reply_en, "offline_reply_ar": c.offline_reply_ar, "sla": c.sla, "blocked_words": c.blocked_words,
        "inbound_address": c.inbound_address, "updated_at": iso(c.updated_at),
        "mail": {
            "reply_to": settings.SUPPORT_REPLY_TO, "imap_configured": bool(settings.SUPPORT_IMAP_HOST and settings.SUPPORT_IMAP_USER),
            "imap_folder": settings.SUPPORT_IMAP_FOLDER, "webhook_path": "/api/v1/support/inbound-email/",
            "webhook_secret_set": bool(settings.SUPPORT_INBOUND_SECRET), "ticket_prefix": settings.SUPPORT_TICKET_PREFIX,
        },
    }


class SettingsView(StaffView):
    write_roles = ADMIN_ONLY

    def get(self, request):
        return Response(settings_json(services.cfg()))

    def put(self, request):
        c = services.cfg()
        data = request.data if isinstance(request.data, dict) else {}
        errors = {}
        if "timezone" in data:
            try:
                ZoneInfo(str(data["timezone"]))
                c.timezone = str(data["timezone"])
            except Exception:
                errors["timezone"] = ["Choose a valid time zone, for example Asia/Qatar."]
        if "business_hours" in data:
            if hours.valid_hours(data["business_hours"]):
                c.business_hours = data["business_hours"]
            else:
                errors["business_hours"] = ["Use times like 09:00 and 17:00, with the start before the end."]
        if "holidays" in data:
            try:
                days = [date.fromisoformat(str(x)[:10]).isoformat() for x in data["holidays"]]
                if len(days) > 200:
                    raise ValueError
                c.holidays = sorted(set(days))
            except (ValueError, TypeError):
                errors["holidays"] = ["Use dates like 2026-12-18, up to 200 of them."]
        if "chat_enabled" in data:
            c.chat_enabled = _flag(data["chat_enabled"], True)
        if "chat_accept_seconds" in data:
            try:
                value = int(data["chat_accept_seconds"])
                if not 30 <= value <= 600:
                    raise ValueError
                c.chat_accept_seconds = value
            except (TypeError, ValueError):
                errors["chat_accept_seconds"] = ["Choose a number of seconds from 30 to 600."]
        for key in ("auto_reply_en", "auto_reply_ar", "offline_reply_en", "offline_reply_ar"):
            if key in data:
                try:
                    setattr(c, key, services.clean_text(data[key], key, 2000, required=False))
                except Exception as exc:
                    errors[key] = ["Keep this under 2000 characters."]
        if "sla" in data:
            sla = data["sla"]
            try:
                clean = {p: {"first": int(sla[p]["first"]), "resolve": int(sla[p]["resolve"])} for p in PRIORITIES}
                if any(not (1 <= v["first"] <= 100000 and 1 <= v["resolve"] <= 100000) for v in clean.values()):
                    raise ValueError
                c.sla = clean
            except (KeyError, TypeError, ValueError):
                errors["sla"] = ["Give every priority a first reply and a resolution time in minutes."]
        if "blocked_words" in data:
            words = data["blocked_words"]
            if isinstance(words, list) and len(words) <= 200 and all(isinstance(w, str) and 0 < len(w.strip()) <= 40 for w in words):
                c.blocked_words = sorted({w.strip().lower() for w in words})
            else:
                errors["blocked_words"] = ["Give up to 200 words or phrases, each up to 40 characters."]
        if "inbound_address" in data:
            value = str(data["inbound_address"] or "").strip()
            try:
                if value:
                    validate_email(value)
                c.inbound_address = value
            except DjangoValidationError:
                errors["inbound_address"] = ["Enter a valid email address."]
        if errors:
            raise validation_error(errors)
        c.save()
        audit(request, "support.settings", details={"fields": sorted(data.keys())[:20]}, label="settings")
        return Response(settings_json(c))
