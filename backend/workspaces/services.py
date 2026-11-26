"""Workspace output shapes and team operations (invites, suspension, removal)."""
import re
import secrets
from datetime import timedelta

from django.conf import settings
from django.db import transaction
from django.utils import timezone

from billing.services import is_live, seats_used, subscription_json
from cards.models import CardItem
from cards.services import new_card
from designs.services import resolve_design
from ilaf.branding import has_palette, normalize_branding
from ilaf.design import COMPANY_COLOUR, validate_design
from ilaf.emails import send_brand_email
from ilaf.i18n import member_language, tr
from ilaf.utils import file_url, iso

from . import domains
from .models import Member


def brand_design(workspace):
    """The company design, with company colours turned back into colourway 0 when no palette exists."""
    design = validate_design((workspace.brand or {}).get("design"))
    if design["colour"] == COMPANY_COLOUR and not has_palette(workspace):
        design["colour"] = 0
    return resolve_design(workspace, design)


def brand_json(workspace, request):
    brand = workspace.brand or {}
    return {
        "company_name": brand.get("company_name", ""),
        "logo_url": file_url(request, workspace.logo),
        "website": brand.get("website", ""),
        "design": brand_design(workspace),
        "lock_design": bool(brand.get("lock_design", False)),
        "show_footer": bool(brand.get("show_footer", True)),
        "lock_allows_departments": bool(brand.get("lock_allows_departments", False)),
        "directory_enabled": bool(workspace.directory_enabled),
        "directory_slug": workspace.directory_slug,
        **normalize_branding(brand),
        "symbol_url": file_url(request, workspace.symbol),
        "background_url": file_url(request, workspace.background),
        "template_front_url": file_url(request, workspace.template_front),
        "template_back_url": file_url(request, workspace.template_back),
    }


def brand_public_json(workspace, request, company_name=None):
    """The company side of a public card or a design preview: colours, logo options and pictures."""
    branding = normalize_branding(workspace.brand)
    return {
        "company_name": company_name or (workspace.brand or {}).get("company_name") or workspace.name,
        "logo_url": file_url(request, workspace.logo),
        "symbol_url": file_url(request, workspace.symbol),
        "palette": branding["palette"],
        "logo_display": branding["logo_display"],
        "logo_placement": branding["logo_placement"],
        "logo_corner": branding["logo_corner"],
        "logo_chip": branding["logo_chip"],
        "show_company_name": branding["show_company_name"],
        "logo_size": branding["logo_size"],
        "logo_free": branding["logo_free"],
        "artwork": branding["artwork"],
        "background_url": file_url(request, workspace.background),
        "template_front_url": file_url(request, workspace.template_front),
        "template_back_url": file_url(request, workspace.template_back),
        "verified_domain": verified_domain(workspace),
    }


def verified_domain(workspace):
    """The company's proven e-mail domain (shown as the "Verified company" badge), or None."""
    from security import company

    return company.verified_domain_of(workspace.id) if workspace.kind == "company" else None


def security_extras(workspace):
    """The company-security fields kept by the security app: the two-step rule, the reply-to address, verified domains."""
    from security import company

    return company.workspace_security_fields(workspace)


def security_json(workspace):
    return {
        "allowed_email_domains": list(workspace.allowed_email_domains or []),
        "require_google_signin": bool(workspace.require_google_signin),
        **security_extras(workspace),
    }


def subscription_for_member(workspace, member):
    """The plan as this person may see it. An employee needs to know whether the plan is live and which plan it is (what their card may
    use), not the company's seat count or billing dates."""
    sub = subscription_json(workspace)
    if workspace.kind == "company" and member.role == "employee":
        return {
            **sub, "seats_total": 0, "seats_used": 0, "starts_at": None, "ends_at": None, "grace_ends_at": None,
            "renews_at": None, "payment_failed": False, "can_manage_billing": False,
        }
    return sub


def workspace_json(workspace, member, request):
    return {
        "id": str(workspace.id),
        "kind": workspace.kind,
        "name": workspace.name,
        "country": workspace.country or None,
        "role": member.role,
        "brand": brand_json(workspace, request),
        # The verified domain (or null). `custom_domain_info` is the claim with what to add to DNS (owner and admin only).
        "custom_domain": domains.verified_domain_name(workspace),
        "custom_domain_info": domains.info_json(workspace) if workspace.kind == "company" and member.role in ("owner", "admin") else None,
        "verified_domain": verified_domain(workspace),
        "subscription": subscription_for_member(workspace, member),
        "security": security_json(workspace) if workspace.kind == "company" and member.role in ("owner", "admin") else None,
        "deletion_due_at": iso(workspace.deletion_due_at),
    }


def member_json(member, request):
    user = member.user
    card = next(iter(member.cards.all()), None)
    return {
        "id": str(member.id),
        "user": {
            "id": str(user.id), "full_name": user.full_name, "email": user.email,
            "photo_url": file_url(request, user.photo),
        } if user else None,
        "email": member.email,
        "full_name": member.full_name or (user.full_name if user else ""),
        "role": member.role,
        "status": member.status,
        "card_id": str(card.id) if card else None,
        "title": member.title,
        "department_id": str(member.department_id) if member.department_id else None,
        "department_name": member.department.name if member.department_id else None,
        "invited_at": iso(member.invited_at),
        "invite_sent_at": iso(member.invite_sent_at or member.invited_at) if member.status == "invited" else None,
        "can_resend_at": iso(resend_available_at(member)) if member.status == "invited" else None,
        "joined_at": iso(member.joined_at),
        # Whether this employee shares the contacts that arrive from now on with the company (null for owners and admins). Only the
        # employee can change it, on `workspaces/{id}/me`.
        "share_contacts": bool(member.share_contacts) if member.role == "employee" else None,
    }


RESEND_GAP = timedelta(minutes=10)


def resend_available_at(member):
    """When an invite may be sent again (10 minutes after the last email)."""
    return (member.invite_sent_at or member.invited_at) + RESEND_GAP


def seats_left(workspace):
    from billing.services import get_subscription

    sub = get_subscription(workspace)
    total = sub.seats_total if sub else 0
    return max(total - seats_used(workspace), 0)


def invite_url(token):
    return f"{settings.WEB_BASE_URL}/join/{token}"


def invite_email_content(workspace, lang, url):
    """(subject, heading, paragraphs, button text, button url) of the invite e-mail; the preview in company settings uses it too."""
    return (
        tr(lang, "You are invited to join {workspace} on {product}", workspace=workspace.name, product=settings.PRODUCT_NAME),
        tr(lang, "Join {workspace}", workspace=workspace.name),
        [
            tr(lang, "{workspace} has invited you to create your digital business card on {product}.",
               workspace=workspace.name, product=settings.PRODUCT_NAME),
            tr(lang, "Your card is already started with your company's details. Accept the invite to finish it."),
        ],
        tr(lang, "Accept invite"),
        url,
    )


def send_invite_email(workspace, member):
    lang = member_language(member)
    subject, heading, paragraphs, button, url = invite_email_content(workspace, lang, invite_url(member.invite_token))
    send_brand_email(member.email, subject, heading, paragraphs, button, url, lang=lang, workspace=workspace)


def invite_member(workspace, email, full_name="", title="", role="employee", department=None, request=None, language=""):
    """Create a pending member, a draft card from the company template and the member's department,
    and send the invite email."""
    from operations import audit
    from operations.departments import apply_template
    from operations.rules import mandatory_for

    email = email.strip().lower()
    with transaction.atomic():
        member = Member.objects.create(
            workspace=workspace, email=email, full_name=full_name, title=title, role=role,
            status="invited", invite_token=secrets.token_urlsafe(32), invite_sent_at=timezone.now(), language=language or "",
            department=department,
        )
        brand = workspace.brand or {}
        card = new_card(
            workspace, None, member,
            name=full_name or re.split(r"[._+-]", email.split("@")[0])[0].title(),
            title=title, company=brand.get("company_name", ""),
        )
        if brand.get("website"):
            CardItem.objects.create(card=card, kind="Website", value=brand["website"], label="", order=0)
        apply_template(card, workspace, member, mandatory_for(workspace, member))
        audit.log(
            request, workspace, "invite.sent", "member", member.id, full_name or email,
            {"email": email, "role": role, "department": department.name if department else None},
        )
    send_invite_email(workspace, member)
    return member


def suspend_member_card(member):
    for card in member.cards.all():
        if card.status != "suspended":
            card.status_before_suspend = card.status
            card.status = "suspended"
            card.save(update_fields=["status", "status_before_suspend", "updated_at"])


def restore_member_card(member):
    for card in member.cards.filter(status="suspended"):
        card.status = card.status_before_suspend or "draft"
        card.save(update_fields=["status", "updated_at"])


def accept_member(member, user, full_name=""):
    """Turn an invited seat into an active one for `user`. The invite link went to the invited
    address, so using it also proves that address."""
    with transaction.atomic():
        member.user = user
        member.status = "active"
        member.joined_at = timezone.now()
        member.invite_token = None
        if full_name:
            member.full_name = full_name
        member.save()
        member.cards.filter(owner__isnull=True).update(owner=user)
        if not user.email_verified and user.email.lower() == member.email.lower():
            user.email_verified = True
            user.save(update_fields=["email_verified"])
        if member.language and not user.language:
            user.language = member.language  # the invite's language becomes the account's until they choose
            user.save(update_fields=["language"])


def invite_is_valid(member):
    if member.status != "invited" or not member.invite_token:
        return False
    age = timezone.now() - (member.invite_sent_at or member.invited_at)
    return age.days < settings.INVITE_LIFETIME_DAYS
