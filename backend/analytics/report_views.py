"""Weekly report settings, the in-app preview and the no-login unsubscribe link."""
from html import escape

from django.conf import settings
from django.http import HttpResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from ilaf.errors import ApiError, validation_error
from ilaf.throttles import PublicReadThrottle
from workspaces.access import MANAGER_ROLES, get_workspace_and_member
from workspaces.models import Workspace

from . import weekly
from .models import ReportPreference


def get_pref(user, workspace):
    pref, _ = ReportPreference.objects.get_or_create(user=user, workspace=workspace)
    return pref


def prefs_json(pref, member):
    is_manager = member.role in MANAGER_ROLES and member.workspace.kind == "company"
    return {
        "personal_report": pref.personal_report,
        "company_report": pref.company_report if is_manager else None,
        "can_company_report": is_manager,
    }


class PreferencesView(APIView):
    def get(self, request, workspace_id):
        workspace, member = get_workspace_and_member(request.user, workspace_id)
        return Response(prefs_json(get_pref(request.user, workspace), member))

    def patch(self, request, workspace_id):
        workspace, member = get_workspace_and_member(request.user, workspace_id)
        data = request.data if isinstance(request.data, dict) else {}
        pref = get_pref(request.user, workspace)
        errors = {}
        for key in ("personal_report", "company_report"):
            if key in data:
                if not isinstance(data[key], bool):
                    errors[key] = ["Must be true or false."]
                elif key == "company_report" and not (member.role in MANAGER_ROLES and workspace.kind == "company"):
                    raise ApiError("forbidden", "Only an owner or admin can change the company report.", 403)
                else:
                    setattr(pref, key, data[key])
        if errors:
            raise validation_error(errors)
        pref.save()
        return Response(prefs_json(pref, member))


class PreviewView(APIView):
    """The report as it would be e-mailed. `kind=personal|company`, `week=last` (default) or `current` (week so far)."""

    def get(self, request, workspace_id):
        workspace, member = get_workspace_and_member(request.user, workspace_id)
        kind = request.query_params.get("kind", "personal")
        if kind not in ("personal", "company"):
            raise validation_error({"kind": ["Choose personal or company."]})
        if kind == "company" and not (member.role in MANAGER_ROLES and workspace.kind == "company"):
            raise ApiError("forbidden", "Only an owner or admin can see the company report.", 403)
        which = request.query_params.get("week", "last")
        if which not in ("last", "current"):
            raise validation_error({"week": ["Choose last or current."]})
        week = weekly.current_week() if which == "current" else weekly.last_full_week()
        subject, text, html, data = weekly.build(member, kind, week, with_unsubscribe=False)
        return Response({
            "kind": kind, "week": {"year": week.year, "week": week.week, "from": week.window.start_date.isoformat(),
                                    "to": week.window.end_date.isoformat(), "partial": week.partial},
            "subject": subject, "html": html, "text": text, "data": data,
        })


def _page(title, message, token=None, undo=False):
    form = ""
    if undo and token:
        form = (
            f'<form method="post"><input type="hidden" name="token" value="{escape(token, quote=True)}">'
            f'<input type="hidden" name="resubscribe" value="1"><button style="{_BTN}">Undo</button></form>'
        )
    html = (
        f'<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
        f"<title>{escape(title)}</title></head><body style=\"margin:0;background:#fff;font-family:{settings.BRAND_FONT};"
        f'color:{settings.BRAND_BLACK};"><div style="max-width:460px;margin:12vh auto;padding:0 24px;">'
        f'<h1 style="font-size:22px;letter-spacing:-.5px;">{escape(title)}</h1>'
        f'<p style="font-size:15px;line-height:1.6;color:{settings.BRAND_MUTED};">{escape(message)}</p>{form}'
        f'<p style="margin-top:32px;font-size:12px;color:{settings.BRAND_MUTED};">{escape(settings.PRODUCT_NAME)} by {escape(settings.COMPANY_NAME)}</p>'
        f"</div></body></html>"
    )
    return HttpResponse(html, content_type="text/html; charset=utf-8")


_BTN = (
    f"background:{settings.BRAND_ORANGE};color:{settings.BRAND_BLACK};border:0;border-radius:999px;font-weight:700;"
    "font-size:15px;padding:12px 26px;cursor:pointer;font-family:inherit;"
)


@method_decorator(csrf_exempt, name="dispatch")
class UnsubscribeView(APIView):
    """Opening the link switches that report off (no sign-in needed); the page offers an Undo. Mail programs that
    support one-click unsubscribe send a POST to the same address. A POST with `resubscribe=1` switches it back on."""

    authentication_classes = []
    permission_classes = []
    throttle_classes = [PublicReadThrottle]

    def _apply(self, token, on):
        found = weekly.read_token(token or "")
        if not found:
            return None
        user_id, workspace_id, kind = found
        user = User.objects.filter(pk=user_id).first()
        workspace = Workspace.objects.filter(pk=workspace_id).first()
        if user is None or workspace is None:
            return None
        pref = get_pref(user, workspace)
        setattr(pref, "company_report" if kind == "company" else "personal_report", on)
        pref.save()
        return workspace, kind

    def get(self, request):
        token = request.query_params.get("token", "")
        done = self._apply(token, False)
        if not done:
            return _page("This link is not valid", "It may be incomplete. You can change your report settings after you sign in.")
        workspace, kind = done
        what = "company report" if kind == "company" else "weekly report for your own cards"
        return _page("You are unsubscribed", f"You will not get the {what} for {workspace.name} any more.", token, undo=True)

    def post(self, request):
        token = request.data.get("token") or request.query_params.get("token", "")
        resubscribe = str(request.data.get("resubscribe", "")) == "1"
        done = self._apply(token, resubscribe)
        if not done:
            return _page("This link is not valid", "It may be incomplete. You can change your report settings after you sign in.")
        workspace, kind = done
        if resubscribe:
            return _page("Welcome back", f"The weekly report for {workspace.name} is on again.")
        return HttpResponse("ok", content_type="text/plain")
