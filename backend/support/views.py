"""The customer side of support: my tickets, the public contact form, live chat for visitors and the inbound e-mail webhook."""
import hashlib
import hmac
import json
import secrets
import time
from urllib.parse import quote

from django.conf import settings
from django.core.cache import cache
from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_email
from django.db.models import Count, Q
from django.http import FileResponse, Http404, HttpResponse
from django.utils import timezone
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework_simplejwt.authentication import JWTAuthentication

from ilaf.errors import ApiError, validation_error
from ilaf.i18n import request_language
from ilaf.throttles import SupportChatStartThrottle, SupportChatThrottle, SupportInboundThrottle, SupportPublicThrottle, UserApiThrottle
from ilaf.utils import run_after_response
from operations.audit import ip_hash

from . import chat, mailparse, services
from .models import CATEGORIES, ChatSession, SupportAttachment, SupportTicket


def _is_signed_in(request):
    user = getattr(request, "user", None)
    return user is not None and getattr(user, "is_authenticated", False)


def _lang(request):
    return request_language(request)


def _uploads(request):
    files = request.FILES.getlist("files") if hasattr(request, "FILES") else []
    return services.check_uploads(files)


def _flag(value, default=True):
    if value is None or value == "":
        return default
    if isinstance(value, bool):
        return value
    return str(value).strip().lower() in ("1", "true", "yes", "on")


def _context_from(request, user, include=True):
    raw = request.data.get("context")
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except ValueError:
            raw = {}
    if not include:
        return {}
    ctx = services.clean_context(raw, request, user)
    if user is not None and "workspace_id" not in ctx:
        # the workspace named by the form (if any) is kept only when the person belongs to it
        ws = services.member_workspace(user, request.data.get("workspace_id"))
        if ws is not None:
            ctx = services.clean_context({**(raw if isinstance(raw, dict) else {}), "workspace_id": str(ws.id)}, request, user)
    return ctx


def serve_attachment(a):
    try:
        handle = a.file.open("rb")
    except FileNotFoundError:
        raise Http404
    inline = a.content_type.startswith("image/")
    response = FileResponse(handle, content_type=a.content_type)
    safe = a.original_name.replace('"', "").replace("\\", "")
    response["Content-Disposition"] = f"{'inline' if inline else 'attachment'}; filename*=UTF-8''{quote(safe)}"
    response["X-Content-Type-Options"] = "nosniff"
    response["Content-Security-Policy"] = "default-src 'none'; sandbox"
    response["Cache-Control"] = "private, no-store"
    return response


# ================================================================ my tickets
def _own_ticket(request, ticket_id):
    try:
        return SupportTicket.objects.select_related("requester", "assigned_staff").get(pk=ticket_id, requester=request.user)
    except (SupportTicket.DoesNotExist, ValueError, DjangoValidationError):
        raise Http404


class TicketsView(APIView):
    def get(self, request):
        qs = SupportTicket.objects.filter(requester=request.user, merged_into__isnull=True).annotate(
            unread_n=Count(
                "messages",
                filter=Q(messages__internal=False, messages__kind="message", messages__author_kind="staff")
                & (Q(customer_seen_at__isnull=True) | Q(messages__created_at__gt=_seen_ref())),
            )
        ).order_by("-last_message_at", "-created_at")
        status = request.query_params.get("status")
        if status == "open":
            qs = qs.filter(status__in=("new", "open", "waiting_customer"))
        elif status in ("solved", "closed"):
            qs = qs.filter(status=status)
        return Response([services.ticket_json(t, unread=t.unread_n) for t in qs[:200]])

    def post(self, request):
        user = request.user
        data = request.data
        category = str(data.get("category") or "other")
        if category not in CATEGORIES:
            raise validation_error({"category": ["Choose a category."]})
        subject = services.clean_subject(data.get("subject"))
        body = services.clean_text(data.get("body"), "body", services.MAX_BODY)
        services.check_blocked(subject + " " + body)
        uploads = _uploads(request)
        ctx = _context_from(request, user, _flag(data.get("include_context")))
        workspace = services.member_workspace(user, ctx.get("workspace_id") or data.get("workspace_id"))
        ticket = services.create_ticket(
            user=user, email=user.email, name=user.full_name, subject=subject, body=body, category=category, channel="form",
            workspace=workspace, context=ctx, language=_lang(request), ip_hash=ip_hash(request), uploads=uploads,
        )
        return Response(services.ticket_detail_json(ticket), status=201)


def _seen_ref():
    from django.db.models import F

    return F("customer_seen_at")


class SummaryView(APIView):
    def get(self, request):
        mine = SupportTicket.objects.filter(requester=request.user, merged_into__isnull=True)
        unread = mine.filter(
            Q(messages__internal=False, messages__kind="message", messages__author_kind="staff")
            & (Q(customer_seen_at__isnull=True) | Q(messages__created_at__gt=_seen_ref()))
        ).distinct().count()
        return Response({"unread": unread, "open": mine.filter(status__in=("new", "open", "waiting_customer")).count()})


class TicketDetailView(APIView):
    def get(self, request, ticket_id):
        return Response(services.ticket_detail_json(_own_ticket(request, ticket_id)))


class SeenView(APIView):
    def post(self, request, ticket_id):
        t = _own_ticket(request, ticket_id)
        t.customer_seen_at = timezone.now()
        t.save(update_fields=["customer_seen_at"])
        return Response({"ok": True})


class MessagesView(APIView):
    def post(self, request, ticket_id):
        t = _own_ticket(request, ticket_id)
        body = services.clean_text(request.data.get("body"), "body", services.MAX_BODY, required=False)
        uploads = _uploads(request)
        if not body and not uploads:
            raise validation_error({"body": ["Write a message or attach a file."]})
        services.check_blocked(body)
        if t.status == "closed" or (t.status == "solved" and not services.can_reopen(t)):
            raise ApiError("support_ticket_closed", "This request is closed. Please start a new request.", 409)
        msg = services.add_message(t, "customer", request.user, body, uploads=uploads)
        if t.status in ("waiting_customer", "solved"):
            services.set_status(t, "open", "customer", request.user)
        t.customer_seen_at = timezone.now()
        t.save(update_fields=["customer_seen_at"])
        run_after_response(services.notify_customer_replied, t.pk, msg.pk)
        return Response(services.ticket_detail_json(t), status=201)


class AttachmentDownloadView(APIView):
    def get(self, request, ticket_id, file_id):
        t = _own_ticket(request, ticket_id)
        try:
            a = SupportAttachment.objects.select_related("message").get(pk=file_id, ticket=t)
        except (SupportAttachment.DoesNotExist, ValueError, DjangoValidationError):
            raise Http404
        if a.message_id and a.message.internal:
            raise Http404
        return serve_attachment(a)


class SolveView(APIView):
    def post(self, request, ticket_id):
        t = _own_ticket(request, ticket_id)
        if t.status in ("solved", "closed"):
            raise ApiError("support_ticket_closed", "This request is closed. Please start a new request.", 409)
        services.set_status(t, "solved", "customer", request.user)
        return Response(services.ticket_detail_json(t))


class ReopenView(APIView):
    def post(self, request, ticket_id):
        t = _own_ticket(request, ticket_id)
        if t.status != "solved":
            raise ApiError("support_ticket_closed", "This request is closed. Please start a new request.", 409)
        if not services.can_reopen(t):
            raise ApiError("support_reopen_expired", "This request was solved more than 14 days ago. Please start a new request.", 409)
        services.set_status(t, "open", "customer", request.user)
        return Response(services.ticket_detail_json(t))


class RatingView(APIView):
    def post(self, request, ticket_id):
        t = _own_ticket(request, ticket_id)
        if t.status not in ("solved", "closed"):
            raise ApiError("support_not_solved", "You can rate a request once it is solved.", 409)
        try:
            rating = int(request.data.get("rating"))
        except (TypeError, ValueError):
            rating = 0
        if not 1 <= rating <= 5:
            raise validation_error({"rating": ["Choose a rating from 1 to 5."]})
        t.rating = rating
        t.rating_comment = services.clean_text(request.data.get("comment"), "comment", 500, required=False)
        t.rated_at = timezone.now()
        t.save(update_fields=["rating", "rating_comment", "rated_at"])
        return Response(services.ticket_detail_json(t))


# ================================================================ public contact form
POW_DIFFICULTY = lambda: int(getattr(settings, "SUPPORT_POW_DIFFICULTY", 3))  # noqa: E731
MIN_FILL = lambda: int(getattr(settings, "SUPPORT_MIN_FILL_SECONDS", 3))  # noqa: E731


def _sign(value):
    return hmac.new(settings.SECRET_KEY.encode(), f"support-pow|{value}".encode(), hashlib.sha256).hexdigest()[:32]


def make_challenge():
    stamp = f"{int(time.time())}.{secrets.token_hex(8)}"
    return f"{stamp}.{_sign(stamp)}"


def check_proof(challenge, counter, honeypot):
    """A signed-out visitor proves a little work (a hash with leading zeros), waited a few seconds and left the trap field empty."""
    bad = ApiError("support_proof_failed", "We could not check that you are a person. Please reload the page and try again.", 400)
    if honeypot:
        raise bad
    parts = str(challenge or "").split(".")
    if len(parts) != 3 or not hmac.compare_digest(parts[2], _sign(f"{parts[0]}.{parts[1]}")):
        raise bad
    try:
        age = time.time() - int(parts[0])
    except ValueError:
        raise bad
    if age < MIN_FILL() or age > 7200:
        raise bad
    digest = hashlib.sha256(f"{challenge}:{counter}".encode()).hexdigest()
    if not digest.startswith("0" * POW_DIFFICULTY()):
        raise bad
    if not cache.add("support:pow:" + parts[1], 1, 7200):
        raise bad


class OptionalAuthView(APIView):
    """Signed-in people are recognised; anybody else is a visitor."""

    authentication_classes = [JWTAuthentication]
    permission_classes = [AllowAny]


class ChallengeView(OptionalAuthView):
    throttle_classes = [SupportChatThrottle]

    def get(self, request):
        return Response({"challenge": make_challenge(), "difficulty": POW_DIFFICULTY(), "min_wait": MIN_FILL()})


def _visitor_identity(request, data):
    """(user, name, email) of the person writing: the account when signed in, else the validated name and e-mail."""
    if _is_signed_in(request):
        return request.user, request.user.full_name, request.user.email
    name = services.clean_text(data.get("name"), "name", 120)
    email = str(data.get("email") or "").strip()
    try:
        validate_email(email)
    except DjangoValidationError:
        raise validation_error({"email": ["Enter a valid email address."]})
    if len(email) > 254:
        raise validation_error({"email": ["Enter a valid email address."]})
    return None, name, email


class ContactView(OptionalAuthView):
    throttle_classes = [SupportPublicThrottle]

    def post(self, request):
        data = request.data
        digest = ip_hash(request)
        services.refuse_if_banned(digest)
        user, name, email = _visitor_identity(request, data)
        if user is None:
            check_proof(data.get("challenge"), str(data.get("counter") or ""), str(data.get("website") or ""))
        category = str(data.get("category") or "other")
        if category not in CATEGORIES:
            raise validation_error({"category": ["Choose a category."]})
        subject = services.clean_subject(data.get("subject"))
        body = services.clean_text(data.get("body"), "body", services.MAX_BODY)
        services.check_blocked(subject + " " + body)
        ctx = _context_from(request, user, _flag(data.get("include_context")))
        ticket = services.create_ticket(
            user=user, email=email, name=name, subject=subject, body=body, category=category, channel="form",
            context=ctx, language=_lang(request), ip_hash=digest,
        )
        return Response({"number": ticket.number, "label": ticket.label}, status=201)


class InboundEmailView(APIView):
    """Mail arrives here from a mail provider's webhook. The shared secret goes in the X-Support-Secret header."""

    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [SupportInboundThrottle]

    def post(self, request):
        expected = settings.SUPPORT_INBOUND_SECRET
        given = request.META.get("HTTP_X_SUPPORT_SECRET", "")
        if not expected:
            raise Http404
        if not hmac.compare_digest(expected.encode(), given.encode()):
            raise ApiError("support_secret_invalid", "The shared secret is wrong.", 403)
        data = request.data if isinstance(request.data, dict) else {}
        mapped = {
            "from": data.get("from"), "to": data.get("to"), "subject": data.get("subject"), "text": data.get("text"),
            "html": data.get("html"), "message_id": data.get("message-id") or data.get("message_id"),
            "in_reply_to": data.get("in-reply-to") or data.get("in_reply_to"), "references": data.get("references"),
            "headers": data.get("headers") if isinstance(data.get("headers"), dict) else {},
            "attachments": [a for a in (data.get("attachments") or []) if isinstance(a, dict)][:20],
        }
        return Response(mailparse.process_inbound(mapped), status=200)


# ================================================================ live chat for visitors
class ChatStatusView(OptionalAuthView):
    throttle_classes = [UserApiThrottle, SupportChatThrottle]

    def get(self, request):
        chat.throttle_sweep()
        # The company the person is working in decides whether its `support_chat` switch is on (only members' companies count).
        workspace = services.member_workspace(request.user if _is_signed_in(request) else None, request.query_params.get("workspace"))
        out = chat.availability(workspace=workspace)
        out["signed_in"] = _is_signed_in(request)
        mine = services.open_chat_for(request.user if _is_signed_in(request) else None, ip_hash(request))
        if _is_signed_in(request) and mine is not None:
            out["open_chat_id"] = str(mine.id)
        return Response(out)


class ChatStartView(OptionalAuthView):
    throttle_classes = [UserApiThrottle, SupportChatStartThrottle]

    def post(self, request):
        data = request.data
        user, name, email = _visitor_identity(request, data)
        first = services.clean_text(data.get("message"), "message", chat.MAX_CHAT_BODY, required=False)
        if first:
            services.check_blocked(first)
        ctx = _context_from(request, user, True)
        workspace = services.member_workspace(user, ctx.get("workspace_id"))
        session, token = chat.start(
            user=user, name=name, email=email, language=_lang(request), context=ctx, ip_hash=ip_hash(request),
            workspace=workspace, first_message=first,
        )
        out = chat.session_json(session)
        out["token"] = token
        out["converted_to_ticket"] = session.status == "offline_converted"
        out["reason"] = getattr(session, "start_reason", "online")
        if session.ticket_id:
            out["ticket"] = session.ticket.label
            c = services.cfg()
            out["auto_reply"] = c.offline_reply_ar if _lang(request) == "ar" else c.offline_reply_en
        return Response(out, status=201)


class ChatBase(OptionalAuthView):
    throttle_classes = [UserApiThrottle, SupportChatThrottle]

    def session(self, request, chat_id):
        return chat.authorize(request, chat_id)


class ChatMessagesView(ChatBase):
    def get(self, request, chat_id):
        session = self.session(request, chat_id)
        chat.throttle_sweep()
        session.refresh_from_db()
        try:
            since = max(0, int(request.query_params.get("since", 0)))
        except ValueError:
            since = 0
        data = chat.poll(session, since, "customer")
        last = data["messages"][-1]["id"] if data["messages"] else since
        etag = '"' + hashlib.sha1(f"{last}|{data['status']}|{data['typing']}|{data['read_id']}|{data['staff_name']}".encode()).hexdigest()[:20] + '"'
        if request.META.get("HTTP_IF_NONE_MATCH") == etag:
            response = HttpResponse(status=304)
            response["ETag"] = etag
            return response
        response = Response(data)
        response["ETag"] = etag
        return response

    def post(self, request, chat_id):
        session = self.session(request, chat_id)
        if session.status in ("ended", "offline_converted"):
            raise ApiError("support_chat_ended", "This chat has ended.", 409)
        body = services.clean_text(request.data.get("body"), "body", chat.MAX_CHAT_BODY, required=False)
        uploads = services.check_uploads(request.FILES.getlist("files")) if request.content_type and "multipart" in request.content_type else []
        if not body and not uploads:
            raise validation_error({"body": ["Write a message or attach a file."]})
        try:
            services.check_blocked(body)
        except ApiError:
            session.spam_hits += 1
            session.save(update_fields=["spam_hits"])
            raise
        user = request.user if _is_signed_in(request) else None
        msg = chat.add_message(session, "customer", user, body or "📎")
        for upload, checked in uploads:
            services.store_attachment(upload, "customer", chat_session=session, chat_message=msg, checked=checked)
        return Response(chat.message_json(msg), status=201)


class ChatTypingView(ChatBase):
    def post(self, request, chat_id):
        chat.mark_typing(self.session(request, chat_id), "customer")
        return Response({"ok": True})


class ChatEndView(ChatBase):
    def post(self, request, chat_id):
        session = self.session(request, chat_id)
        chat.end(session, "customer")
        session.refresh_from_db()
        return Response(chat.session_json(session))


class ChatAttachmentView(ChatBase):
    def get(self, request, chat_id, file_id):
        session = self.session(request, chat_id)
        try:
            a = SupportAttachment.objects.get(pk=file_id, chat_session=session)
        except (SupportAttachment.DoesNotExist, ValueError, DjangoValidationError):
            raise Http404
        return serve_attachment(a)
