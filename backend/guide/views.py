"""GET/PUT /api/v1/guide/progress: what the signed-in person has done with the guides."""
import re

from rest_framework.response import Response
from rest_framework.views import APIView

from ilaf.errors import ApiError, validation_error

from .models import STATES, GuideProgress

IDENT = re.compile(r"^[a-z0-9][a-z0-9_.:-]{0,63}$")
# A person cannot grow this table without bound.
MAX_ROWS = 600
VALID_STATES = {s for s, _ in STATES}


def row_json(row):
    return {"guide_id": row.guide_id, "step_id": row.step_id, "state": row.state, "updated": row.updated.isoformat()}


def clean(item):
    """Validate one {guide_id, step_id, state} item. State "reset" removes the row."""
    if not isinstance(item, dict):
        raise validation_error({"item": ["Each entry must be an object."]})
    errors = {}
    guide_id, step_id, state = item.get("guide_id"), item.get("step_id"), item.get("state")
    if not isinstance(guide_id, str) or not IDENT.match(guide_id):
        errors["guide_id"] = ["Use lower-case letters, digits, '_', '.', ':' or '-' (up to 64)."]
    if not isinstance(step_id, str) or not IDENT.match(step_id):
        errors["step_id"] = ["Use lower-case letters, digits, '_', '.', ':' or '-' (up to 64)."]
    if state != "reset" and state not in VALID_STATES:
        errors["state"] = ["Choose a valid state."]
    if errors:
        raise validation_error(errors)
    return guide_id, step_id, state


class ProgressView(APIView):
    def get(self, request):
        rows = GuideProgress.objects.filter(user=request.user)[:MAX_ROWS]
        return Response({"items": [row_json(r) for r in rows]})

    def put(self, request):
        data = request.data if isinstance(request.data, dict) else {}
        items = data.get("items") if "items" in data else [data]
        if not isinstance(items, list) or not 1 <= len(items) <= 20:
            raise validation_error({"items": ["Send between 1 and 20 entries."]})
        cleaned = [clean(i) for i in items]
        mine = GuideProgress.objects.filter(user=request.user)
        saved = []
        for guide_id, step_id, state in cleaned:
            if state == "reset":
                mine.filter(guide_id=guide_id, step_id=step_id).delete()
                continue
            row = mine.filter(guide_id=guide_id, step_id=step_id).first()
            if row is None:
                if mine.count() >= MAX_ROWS:
                    raise ApiError("guide_limit", "Too many saved guide entries.", 400)
                row = GuideProgress(user=request.user, guide_id=guide_id, step_id=step_id)
            row.state = state
            row.save()
            saved.append(row_json(row))
        return Response({"items": saved})
