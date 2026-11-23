"""Announcements: who an announcement is for, what a person sees, and the e-mail broadcast.

The banner is read by the customer app (`active_for`). The e-mail is sent by the `send_announcements` command in
batches; the unique (announcement, person) delivery row makes a repeated or overlapping run send nothing twice."""
from django.conf import settings
from django.core import signing
from django.db import IntegrityError
from django.db.models import Q
from django.utils import timezone

from accounts.models import User
from billing.services import get_subscription
from ilaf.emails import build_brand_email, send_brand_email
from ilaf.i18n import normalise_language, tr
from workspaces.models import Member, Workspace

from .models import Announcement, AnnouncementDelivery, AnnouncementDismissal
from .ops_services import company_country

BATCH = 200
UNSUBSCRIBE_SALT = "staff.announcement.unsubscribe"


def audience_label(a):
    if a.audience_kind == "all":
        return "All companies"
    values = ", ".join(str(v) for v in a.audience_values)
    return {"plan": f"Plan: {values}", "country": f"Country: {values}", "companies": f"{len(a.audience_values)} chosen companies"}.get(a.audience_kind, a.audience_kind)


def _matches(a, workspace):
    if a.audience_kind == "all":
        return True
    if a.audience_kind == "companies":
        return str(workspace.id) in {str(v) for v in a.audience_values}
    if a.audience_kind == "plan":
        sub = get_subscription(workspace)
        wanted = {str(v).lower() for v in a.audience_values}
        return sub is not None and (sub.plan.code.lower() in wanted or sub.plan.name.lower() in wanted)
    if a.audience_kind == "country":
        return company_country(workspace).upper() in {str(v).upper() for v in a.audience_values}
    return False


def audience_workspaces(a):
    qs = Workspace.objects.filter(kind="company", deleted_at__isnull=True)
    if a.audience_kind == "companies":
        qs = qs.filter(id__in=[v for v in a.audience_values if v])
    return [w for w in qs if _matches(a, w)]


def audience_users(a):
    """The people who would get the e-mail: owners and admins of the audience; for marketing only those who agreed."""
    if a.audience_kind == "all":
        qs = User.objects.filter(is_active=True, deleted_at__isnull=True)
        if a.email_kind == "marketing":
            qs = qs.filter(product_updates=True)
        else:
            qs = qs.filter(Q(memberships__role__in=("owner", "admin"), memberships__status="active")).distinct()
        return list(qs.order_by("email"))
    ids = [w.id for w in audience_workspaces(a)]
    members = Member.objects.filter(workspace_id__in=ids, status="active", role__in=("owner", "admin"), user__is_active=True, user__deleted_at__isnull=True)
    if a.email_kind == "marketing":
        members = members.filter(user__product_updates=True)
    seen, users = set(), []
    for m in members.select_related("user").order_by("user__email"):
        if m.user_id not in seen:
            seen.add(m.user_id)
            users.append(m.user)
    return users


def audience_countries():
    """The countries companies chose, with how many companies each has (most first)."""
    from django.db.models import Count

    rows = (
        Workspace.objects.filter(kind="company", deleted_at__isnull=True).exclude(country__isnull=True).exclude(country="")
        .values("country").annotate(n=Count("id")).order_by("-n", "country")
    )
    return [{"code": r["country"], "companies": r["n"]} for r in rows]


def is_live(a, now=None):
    now = now or timezone.now()
    return a.cancelled_at is None and a.starts_at <= now and (a.ends_at is None or a.ends_at > now)


def active_for(user, lang="en"):
    """The banners this person sees now: live, for their audience, not dismissed. Texts are in `lang` (Arabic or English)."""
    now = timezone.now()
    dismissed = set(AnnouncementDismissal.objects.filter(user=user).values_list("announcement_id", flat=True))
    spaces = [m.workspace for m in Member.objects.filter(user=user, status="active", workspace__kind="company", workspace__deleted_at__isnull=True).select_related("workspace")]
    out = []
    for a in Announcement.objects.filter(banner=True, cancelled_at__isnull=True, starts_at__lte=now).filter(Q(ends_at__isnull=True) | Q(ends_at__gt=now)).order_by("-created_at"):
        if a.id in dismissed:
            continue
        if a.audience_kind != "all" and not any(_matches(a, w) for w in spaces):
            continue
        ar = normalise_language(lang) == "ar"
        out.append({
            "id": str(a.id), "severity": a.severity,
            "title": a.title_ar if ar else a.title_en, "body": a.body_ar if ar else a.body_en,
        })
    return out


# ---------------------------------------------------------------- unsubscribe
def unsubscribe_token(user):
    return signing.dumps(str(user.id), salt=UNSUBSCRIBE_SALT)


def user_from_unsubscribe_token(token):
    try:
        user_id = signing.loads(token, salt=UNSUBSCRIBE_SALT)
    except signing.BadSignature:
        return None
    return User.objects.filter(pk=user_id).first()


# ---------------------------------------------------------------- the e-mail broadcast
def email_paragraphs(body, email_kind, lang, link):
    """The paragraphs of the announcement e-mail: the text, and for a product update the unsubscribe line."""
    paragraphs = [body]
    if email_kind == "marketing":
        paragraphs.append(tr(lang, "You get this because you chose product updates. Unsubscribe: {link}", link=link))
    return paragraphs


def preview_email(title, body, email_kind, lang):
    """The e-mail as a person would get it (same brand frame as the broadcast), with a placeholder unsubscribe link."""
    lang = normalise_language(lang) or "en"
    link = f"{settings.WEB_BASE_URL}/unsubscribe?t=preview"
    text, html, _style = build_brand_email(title, email_paragraphs(body, email_kind, lang, link), lang=lang)
    return {"subject": title, "html": html, "text": text, "lang": lang}


def send_one(a, user):
    """E-mail the announcement to one person in their language. Returns True when the server took it."""
    lang = normalise_language(user.language) or "en"
    ar = lang == "ar"
    title, body = (a.title_ar, a.body_ar) if ar else (a.title_en, a.body_en)
    headers, link = {}, ""
    if a.email_kind == "marketing":
        token = unsubscribe_token(user)
        link = f"{settings.WEB_BASE_URL}/unsubscribe?t={token}"
        headers = {"List-Unsubscribe": f"<{settings.WEB_BASE_URL}/unsubscribe/send?t={token}>", "List-Unsubscribe-Post": "List-Unsubscribe=One-Click"}
    paragraphs = email_paragraphs(body, a.email_kind, lang, link)
    before = _failed_count()
    send_brand_email(user.email, title, title, paragraphs, lang=lang, kind=a.email_kind, headers=headers)
    return _failed_count() == before


def _failed_count():
    from .models import EmailLog

    return EmailLog.objects.filter(status="failed").count()


def run_broadcasts(now=None, limit=BATCH):
    """Send what is due: for each announcement whose e-mail time has come, up to `limit` people. Returns the number sent."""
    now = now or timezone.now()
    sent = 0
    due = Announcement.objects.filter(send_email=True, cancelled_at__isnull=True, email_status__in=("scheduled", "sending")).filter(
        Q(email_send_at__isnull=True) | Q(email_send_at__lte=now)
    ).order_by("created_at")
    for a in due:
        if sent >= limit:
            break
        if a.email_status == "scheduled":
            Announcement.objects.filter(pk=a.pk, email_status="scheduled").update(email_status="sending")
        done = set(AnnouncementDelivery.objects.filter(announcement=a).values_list("user_id", flat=True))
        for user in audience_users(a):
            if user.id in done:
                continue
            if sent >= limit:
                break
            try:
                AnnouncementDelivery.objects.create(announcement=a, user=user, ok=True)
            except IntegrityError:
                continue  # another run took this person
            ok = send_one(a, user)
            if not ok:
                AnnouncementDelivery.objects.filter(announcement=a, user=user).update(ok=False)
            sent += 1
        remaining = [u for u in audience_users(a) if u.id not in set(AnnouncementDelivery.objects.filter(announcement=a).values_list("user_id", flat=True))]
        if not remaining:
            total = AnnouncementDelivery.objects.filter(announcement=a, ok=True).count()
            Announcement.objects.filter(pk=a.pk).update(email_status="sent", email_sent_count=total, email_finished_at=now)
    return sent
