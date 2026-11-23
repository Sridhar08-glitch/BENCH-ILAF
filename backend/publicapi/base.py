"""The shared behaviour of every public API route: key authentication, scopes, per-key rate limits, the stable error
shape with a request id, ETag on reads, Idempotency-Key on POST and cursor pagination."""
import base64
import hashlib
import json
import uuid
from datetime import timedelta

from django.db import IntegrityError, transaction
from django.db.models import Q
from django.http import HttpResponse
from django.utils import timezone
from rest_framework.parsers import JSONParser
from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError, api_exception_handler, error_body, validation_error

from .auth import ApiKeyAuthentication, KeyRateThrottle, ScopePermission
from .models import IdempotencyRecord

IDEMPOTENCY_HOURS = 24
API_VERSION = "v1"
DEFAULT_LIMIT, MAX_LIMIT = 25, 100


class IdempotentReplay(Exception):
    def __init__(self, record):
        self.record = record


def public_exception_handler(exc, context):
    if isinstance(exc, IdempotentReplay):
        response = Response(exc.record.response_body, status=exc.record.status_code)
        response["Idempotent-Replayed"] = "true"
        return response
    response = api_exception_handler(exc, context)
    if response is not None and response.status_code == 401:
        response["WWW-Authenticate"] = "Bearer"
    if response is not None and isinstance(response.data, dict) and "error" in response.data:
        request = context.get("request")
        response.data["error"]["request_id"] = getattr(request, "request_id", "")
    return response


class PublicApiView(APIView):
    authentication_classes = [ApiKeyAuthentication]
    permission_classes = [ScopePermission]
    throttle_classes = [KeyRateThrottle]
    parser_classes = [JSONParser]
    required_scopes = {}

    def get_exception_handler(self):
        return public_exception_handler

    # ---------------------------------------------------------------- request life cycle
    def initial(self, request, *args, **kwargs):
        request.request_id = "req_" + uuid.uuid4().hex[:20]
        request._idem = None
        super().initial(request, *args, **kwargs)
        if request.method == "POST":
            self._begin_idempotency(request)

    @property
    def workspace(self):
        return self.request.user.workspace

    # ---------------------------------------------------------------- idempotency
    def _begin_idempotency(self, request):
        raw = request.META.get("HTTP_IDEMPOTENCY_KEY", "").strip()
        if not raw:
            return
        if len(raw) > 200 or not raw.isprintable():
            raise validation_error({"Idempotency-Key": ["Use at most 200 printable characters."]})
        body = request._request.body
        digest = hashlib.sha256(
            request.method.encode() + b"\n" + request.path.encode() + b"\n" + body
        ).hexdigest()
        key = request.user.key
        cutoff = timezone.now() - timedelta(hours=IDEMPOTENCY_HOURS)
        IdempotencyRecord.objects.filter(api_key=key, created_at__lt=cutoff).delete()
        try:
            with transaction.atomic():
                request._idem = IdempotencyRecord.objects.create(api_key=key, idem_key=raw, request_hash=digest)
            return
        except IntegrityError:
            pass
        record = IdempotencyRecord.objects.filter(api_key=key, idem_key=raw).first()
        if record is None:  # deleted between the two calls: let the client retry
            raise ApiError("idempotency_in_progress", "Please retry the request.", 409)
        if record.request_hash != digest:
            raise ApiError(
                "idempotency_key_reused", "This Idempotency-Key was already used with a different request.", 422
            )
        if record.status_code == 0:
            raise ApiError("idempotency_in_progress", "The first request with this key is still running.", 409)
        raise IdempotentReplay(record)

    def _finish_idempotency(self, request, response):
        record = getattr(request, "_idem", None)
        if record is None:
            return
        if 200 <= response.status_code < 300:
            IdempotencyRecord.objects.filter(pk=record.pk).update(status_code=response.status_code, response_body=response.data)
        else:
            IdempotencyRecord.objects.filter(pk=record.pk).delete()  # only successes are remembered

    # ---------------------------------------------------------------- answers
    def finalize_response(self, request, response, *args, **kwargs):
        response = super().finalize_response(request, response, *args, **kwargs)
        if getattr(request, "_idem", None) is not None and isinstance(response, Response):
            try:
                self._finish_idempotency(request, response)
            except Exception:  # remembering the answer must never break the answer itself
                pass
        response["X-Request-Id"] = getattr(request, "request_id", "")
        response["Vary"] = "Authorization"
        response["X-Api-Version"] = API_VERSION
        info = getattr(request, "_rate_info", None)
        if info:
            response["X-RateLimit-Limit"] = str(info["limit"])
            response["X-RateLimit-Remaining"] = str(info.get("remaining", 0))
            response["X-RateLimit-Reset"] = str(info["reset"])
            response["X-RateLimit-Daily-Limit"] = str(info["daily_limit"])
            response["X-RateLimit-Daily-Remaining"] = str(info.get("daily_remaining", 0))
            if info.get("retry_after"):
                response["Retry-After"] = str(info["retry_after"])
        if request.method in ("GET", "HEAD") and response.status_code == 200 and isinstance(response, Response):
            response = self._etag(request, response)
        else:
            response["Cache-Control"] = "no-store"
        return response

    def _etag(self, request, response):
        response.render()
        tag = '"' + hashlib.sha256(response.content).hexdigest()[:32] + '"'
        response["ETag"] = tag
        response["Cache-Control"] = "private, no-cache"
        sent = request.META.get("HTTP_IF_NONE_MATCH", "")
        wanted = [part.strip().removeprefix("W/") for part in sent.split(",") if part.strip()]
        if "*" in wanted or tag in wanted:
            fresh = HttpResponse(status=304)
            for name in ("ETag", "Cache-Control", "Vary", "X-Request-Id", "X-RateLimit-Limit", "X-RateLimit-Remaining",
                         "X-RateLimit-Reset", "X-RateLimit-Daily-Limit", "X-RateLimit-Daily-Remaining"):
                if name in response:
                    fresh[name] = response[name]
            return fresh
        return response


# ---------------------------------------------------------------- pagination
def page_limit(request):
    raw = request.query_params.get("limit")
    if raw in (None, ""):
        return DEFAULT_LIMIT
    try:
        value = int(raw)
    except ValueError:
        raise validation_error({"limit": ["Must be a whole number."]})
    if not 1 <= value <= MAX_LIMIT:
        raise validation_error({"limit": [f"Use a number from 1 to {MAX_LIMIT}."]})
    return value


def _encode(created_at, pk):
    raw = json.dumps({"t": created_at.isoformat(), "i": str(pk)}, separators=(",", ":")).encode()
    return base64.urlsafe_b64encode(raw).decode().rstrip("=")


def _decode(cursor):
    from django.utils.dateparse import parse_datetime

    try:
        raw = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4))
        data = json.loads(raw)
        when = parse_datetime(data["t"])
        if when is None:
            raise ValueError
        return when, uuid.UUID(data["i"])
    except Exception:
        raise validation_error({"cursor": ["This cursor is not valid. Start again without it."]})


def paginate(request, queryset, render_rows, field="created_at"):
    """Newest first, keyset cursor on (`field`, id). `queryset` must already be limited to the caller's company.

    `render_rows` turns a list of rows into the list of JSON items.
    Returns {"data": [...], "has_more": bool, "next_cursor": str|None}."""
    limit = page_limit(request)
    qs = queryset.order_by(f"-{field}", "-id")
    cursor = request.query_params.get("cursor")
    if cursor:
        when, pk = _decode(cursor)
        qs = qs.filter(Q(**{f"{field}__lt": when}) | Q(**{field: when, "id__lt": pk}))
    rows = list(qs[: limit + 1])
    more = len(rows) > limit
    rows = rows[:limit]
    return {
        "data": render_rows(rows),
        "has_more": more,
        "next_cursor": _encode(getattr(rows[-1], field), rows[-1].pk) if more and rows else None,
    }


def json_body(request):
    data = request.data
    if not isinstance(data, dict):
        raise validation_error({"body": ["Send a JSON object."]})
    return data
