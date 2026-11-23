"""Settings > Notifications: browser push opt-in, the alert preferences and the daily summary."""
from html import escape

from django.http import HttpResponse
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import direction, normalise_language, tr
from ilaf.throttles import PublicReadThrottle, UserApiThrottle
from security.devices import request_user_agent

from . import services


def _body(request):
    return request.data if isinstance(request.data, dict) else {}


class PrefsView(APIView):
    def get(self, request):
        return Response(services.prefs_json(request.user))

    def patch(self, request):
        data = _body(request)
        prefs = services.prefs_for(request.user)
        for key in ("push_leads", "push_support", "daily_summary"):
            if key in data:
                if not isinstance(data[key], bool):
                    raise validation_error({key: ["Choose yes or no."]})
                setattr(prefs, key, data[key])
        if "timezone" in data:
            name = str(data["timezone"] or "")
            if name and not services.valid_timezone(name):
                raise validation_error({"timezone": ["Choose a valid time zone."]})
            prefs.timezone = name
        prefs.save()
        return Response(services.prefs_json(request.user))


class PushSubscribeView(APIView):
    throttle_classes = [UserApiThrottle]

    def post(self, request):
        if not services.push_enabled():
            raise ApiError("push_not_configured", "Browser notifications are not set up on this server.", 503)
        services.subscribe(request.user, request.data, request_user_agent(request))
        return Response(services.prefs_json(request.user), status=201)


class PushUnsubscribeView(APIView):
    def post(self, request):
        services.unsubscribe(request.user, _body(request).get("endpoint"))
        return Response(services.prefs_json(request.user))


class PushTestView(APIView):
    """Send a test notification to the person's own browsers."""

    throttle_classes = [UserApiThrottle]

    def post(self, request):
        if not services.push_enabled():
            raise ApiError("push_not_configured", "Browser notifications are not set up on this server.", 503)
        lang = normalise_language(request.user.language) or "en"
        sent = services.notify_user(
            request.user, "lead", tr(lang, "Notifications are on"), tr(lang, "This is a test notification."),
            "/app/settings/notifications", "test",
        )
        return Response({"sent": sent})


def _page(lang, title, text):
    return HttpResponse(
        f'<!doctype html><html lang="{lang}" dir="{direction(lang)}"><head><meta charset="utf-8">'
        f'<meta name="viewport" content="width=device-width, initial-scale=1"><title>{escape(title)}</title></head>'
        f'<body style="font-family:Poppins,Arial,sans-serif;max-width:480px;margin:15vh auto;padding:0 24px;color:#101114">'
        f'<h1 style="font-size:22px">{escape(title)}</h1><p style="line-height:1.6">{escape(text)}</p></body></html>',
        content_type="text/html; charset=utf-8",
    )


class UnsubscribeView(APIView):
    """The link at the bottom of the daily summary: opening it (or a mail program's one-click POST) switches it off."""

    authentication_classes = []
    permission_classes = []
    throttle_classes = [PublicReadThrottle]

    def _apply(self, request):
        token = request.query_params.get("token") or _body(request).get("token") or ""
        user_id = services.read_unsubscribe_token(token)
        user = User.objects.filter(pk=user_id).first() if user_id else None
        if user is None:
            return None
        prefs = services.prefs_for(user)
        prefs.daily_summary = False
        prefs.save(update_fields=["daily_summary"])
        return user

    def get(self, request):
        user = self._apply(request)
        lang = normalise_language(user.language if user else "") or "en"
        if user is None:
            return _page(lang, tr(lang, "This link is not valid"), tr(lang, "It may be incomplete. You can change your notification settings after you sign in."))
        return _page(lang, tr(lang, "You are unsubscribed"), tr(lang, "You will not get the daily summary any more."))

    def post(self, request):
        user = self._apply(request)
        if user is None:
            return _page("en", tr("en", "This link is not valid"), tr("en", "It may be incomplete. You can change your notification settings after you sign in."))
        return HttpResponse("ok", content_type="text/plain")
