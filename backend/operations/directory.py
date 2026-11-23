"""The public company directory: its address rules and the list of cards it shows."""
from django.db.models import Q

from billing.services import is_live
from cards.models import Card
from cards.slugs import RESERVED, SLUG_RE
from workspaces.models import Workspace

# The directory lives under /d/, so it only needs to avoid its own words and the usual reserved ones.
DIRECTORY_RESERVED = RESERVED | {"directory", "d", "search", "all", "company", "companies", "people"}
PAGE_SIZE = 24
MAX_PAGE_SIZE = 60


def directory_slug_problem(slug, workspace=None):
    """None when the slug can be used for a directory, else ('invalid'|'taken', message)."""
    if not SLUG_RE.match(slug):
        return "invalid", "Use 3 to 40 letters, numbers or dashes, starting and ending with a letter or number."
    if slug in DIRECTORY_RESERVED:
        return "taken", "This address is reserved."
    others = Workspace.objects.filter(directory_slug=slug)
    if workspace is not None:
        others = others.exclude(pk=workspace.pk)
    if others.exists():
        return "taken", "This address is already taken."
    return None


def listed_cards(workspace):
    """Cards the directory may show: published, held by an active member, not hidden, plan live."""
    if not workspace.directory_enabled or workspace.kind != "company" or not is_live(workspace):
        return Card.objects.none()
    return Card.objects.filter(
        workspace=workspace, status="published", hide_from_directory=False, member__status="active",
    ).select_related("member__department")


def search_cards(workspace, query="", department_id=None):
    qs = listed_cards(workspace)
    if department_id:
        qs = qs.filter(member__department_id=department_id)
    query = (query or "").strip()
    if query:
        qs = qs.filter(
            Q(name__icontains=query) | Q(title__icontains=query) | Q(member__department__name__icontains=query)
        )
    return qs.order_by("name", "id")
