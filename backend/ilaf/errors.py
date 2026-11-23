"""One error shape for the whole API: {"error": {"code", "message", "fields"?}}."""
from django.core.exceptions import PermissionDenied as DjangoPermissionDenied
from django.http import Http404, JsonResponse
from rest_framework import exceptions
from rest_framework.response import Response

from .i18n import DEFAULT_LANGUAGE, request_language, translate_message


class ApiError(exceptions.APIException):
    """An error with an explicit machine code, HTTP status and plain-English message."""

    def __init__(self, code, message, status_code=400, fields=None):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code
        self.fields = fields


def error_body(code, message, fields=None):
    body = {"code": code, "message": message}
    if fields:
        body["fields"] = fields
    return {"error": body}


def _flatten(detail, prefix, out):
    """Turn DRF's nested error details into {"items.2.value": ["msg"]}."""
    if isinstance(detail, dict):
        for key, value in detail.items():
            _flatten(value, f"{prefix}.{key}" if prefix else str(key), out)
    elif isinstance(detail, (list, tuple)):
        if all(not isinstance(v, (dict, list, tuple)) for v in detail):
            if detail:
                out.setdefault(prefix or "non_field_errors", []).extend(str(v) for v in detail)
        else:
            for index, value in enumerate(detail):
                if isinstance(value, (dict, list, tuple)):
                    _flatten(value, f"{prefix}.{index}" if prefix else str(index), out)
                else:
                    out.setdefault(prefix or "non_field_errors", []).append(str(value))
    else:
        out.setdefault(prefix or "non_field_errors", []).append(str(detail))


def validation_error(fields, message=None):
    """Build an ApiError for a failed validation from a {field: [messages]} dict."""
    if message is None:
        first = next(iter(fields.values()), ["Invalid input."])
        message = first[0] if len(fields) == 1 and first else "Please check the highlighted fields."
    return ApiError("validation_error", message, 400, fields)


def api_exception_handler(exc, context):
    if isinstance(exc, ApiError):
        response = Response(error_body(exc.code, exc.message, exc.fields), status=exc.status_code)
        if getattr(exc, "retry_after", None):
            response["Retry-After"] = str(exc.retry_after)
    elif isinstance(exc, exceptions.ValidationError):
        fields = {}
        _flatten(exc.detail, "", fields)
        err = validation_error(fields)
        response = Response(error_body(err.code, err.message, fields), status=400)
    elif isinstance(exc, (exceptions.NotAuthenticated, exceptions.AuthenticationFailed)):
        response = Response(
            error_body("unauthorized", "Please sign in to continue."), status=401
        )
        auth_header = getattr(exc, "auth_header", None)
        if auth_header:
            response["WWW-Authenticate"] = auth_header
    elif isinstance(exc, (exceptions.PermissionDenied, DjangoPermissionDenied)):
        response = Response(
            error_body("forbidden", "You do not have permission to do that."), status=403
        )
    elif isinstance(exc, (exceptions.NotFound, Http404)):
        response = Response(error_body("not_found", "Not found."), status=404)
    elif isinstance(exc, exceptions.Throttled):
        response = Response(
            error_body("throttled", "Too many requests. Please wait a moment and try again."),
            status=429,
        )
        if exc.wait:
            response["Retry-After"] = str(int(exc.wait) + 1)
    elif isinstance(exc, exceptions.ParseError):
        response = Response(error_body("validation_error", "The request body could not be read."), status=400)
    elif isinstance(exc, exceptions.UnsupportedMediaType):
        response = Response(error_body("validation_error", "Unsupported content type."), status=415)
    elif isinstance(exc, exceptions.MethodNotAllowed):
        response = Response(error_body("method_not_allowed", "Method not allowed."), status=405)
    else:
        return None  # Unexpected errors fall through to the JSON 500 handler.
    return _localise(response, context.get("request"))


def _localise(response, request):
    """Translate the message and the field messages into the request's language (English stays as written)."""
    try:
        lang = request_language(request)
    except Exception:  # a request whose user cannot be read is answered in English
        return response
    body = response.data.get("error") if isinstance(response.data, dict) else None
    if lang == DEFAULT_LANGUAGE or not body:
        return response
    body["message"] = translate_message(lang, body.get("message"))
    if body.get("fields"):
        body["fields"] = {key: [translate_message(lang, m) for m in msgs] for key, msgs in body["fields"].items()}
    return response


def json_404(request, exception=None):
    return JsonResponse(error_body("not_found", "Not found."), status=404)


def json_500(request):
    return JsonResponse(error_body("server_error", "Something went wrong on our side."), status=500)
