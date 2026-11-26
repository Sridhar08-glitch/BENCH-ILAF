import csv
import io
import re

from django.db import IntegrityError, transaction
from django.utils import timezone
from rest_framework import serializers
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from accounts.models import User
from accounts.services import check_login_password, domain_allowed, tokens_for
from billing.services import enterprise_allowed, is_live, require_enterprise
from cards.models import Card
from ilaf.branding import merge_branding, normalize_branding
from designs.services import custom_face_checker
from ilaf.design import require_pack2_face, require_page_styles, validate_design
from ilaf.countries import country_or_none
from ilaf.errors import ApiError, validation_error
from ilaf.i18n import localise_message
from ilaf.images import process_brand_picture, process_brand_symbol, process_logo_png
from ilaf.items import has_unsafe_scheme, scheme_of
from ilaf.throttles import InviteAcceptThrottle, PublicReadThrottle
from ilaf.utils import clean_line, file_url, iso

from operations import actions, audit
from security import services as security_services
from operations.directory import directory_slug_problem
from operations.models import Department

from . import domains
from .access import MANAGER_ROLES, get_workspace_and_member
from .models import Member, Workspace, default_brand
from .services import (
    RESEND_GAP, invite_is_valid, invite_member, member_json, resend_available_at, seats_left,
    send_invite_email, subscription_for_member, subscription_json, workspace_json, accept_member,
)

DOMAIN_RE = re.compile(r"^(?=.{4,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$")
EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class MyWorkspacesView(APIView):
    def get(self, request):
        members = (
            Member.objects.filter(user=request.user, status="active")
            .select_related("workspace").order_by("workspace__created_at")
        )
        data = []
        for member in members:
            ws = member.workspace
            # Only the subscription is needed here; building the whole workspace (brand, domain, security) ran several queries per workspace.
            cards = Card.objects.filter(workspace=ws)
            if member.role == "employee":
                cards = cards.filter(member=member)
            data.append({
                "id": str(ws.id), "kind": ws.kind, "name": ws.name, "role": member.role,
                "card_count": cards.count(), "subscription": subscription_for_member(ws, member),
            })
        return Response(data)


def check_country(value):
    """A submitted country code, upper-cased; "" or null clears it."""
    code = country_or_none(value)
    if code is None:
        raise ValidationError("Choose a country from the list.")
    return code


class WorkspaceCreateSerializer(serializers.Serializer):
    name = serializers.CharField(max_length=120)
    country = serializers.CharField(required=False, allow_null=True, allow_blank=True)

    def validate_country(self, value):
        return check_country(value)

    def validate_name(self, value):
        value = clean_line(value, 120)
        if not value:
            raise ValidationError("Enter a company name.")
        return value


class BrandSerializer(serializers.Serializer):
    company_name = serializers.CharField(required=False, allow_blank=True)
    website = serializers.CharField(required=False, allow_blank=True)
    design = serializers.JSONField(required=False)
    lock_design = serializers.BooleanField(required=False)
    show_footer = serializers.BooleanField(required=False)
    lock_allows_departments = serializers.BooleanField(required=False)
    directory_enabled = serializers.BooleanField(required=False)
    directory_slug = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    # Company branding: checked and merged in ilaf.branding.merge_branding.
    colours = serializers.JSONField(required=False, allow_null=True)
    palette = serializers.JSONField(required=False, allow_null=True)
    logo_display = serializers.JSONField(required=False)
    logo_placement = serializers.JSONField(required=False)
    logo_corner = serializers.JSONField(required=False)
    logo_chip = serializers.JSONField(required=False)
    show_company_name = serializers.JSONField(required=False)
    artwork = serializers.JSONField(required=False)
    logo_size = serializers.JSONField(required=False)
    logo_free = serializers.JSONField(required=False, allow_null=True)

    def validate_company_name(self, value):
        return clean_line(value, 120)

    def validate_website(self, value):
        value = clean_line(value, 200)
        if value and (has_unsafe_scheme(value) or scheme_of(value) not in (None, "http", "https")):
            raise ValidationError("Enter a web address starting with http or https.")
        return value

    def validate_design(self, value):
        validate_design(value)
        return value


MAX_ALLOWED_DOMAINS = 20


class SecuritySerializer(serializers.Serializer):
    allowed_email_domains = serializers.ListField(
        child=serializers.CharField(max_length=253), required=False, max_length=MAX_ALLOWED_DOMAINS
    )
    require_google_signin = serializers.BooleanField(required=False)
    require_2fa = serializers.BooleanField(required=False)

    def validate_allowed_email_domains(self, value):
        domains = []
        for raw in value:
            domain = raw.strip().lower().lstrip("@")
            if not DOMAIN_RE.match(domain):
                raise ValidationError(f"{raw} is not a valid domain. Use a form such as northgate.com.")
            if domain not in domains:
                domains.append(domain)
        return domains


class WorkspacePatchSerializer(serializers.Serializer):
    name = serializers.CharField(required=False)
    security = SecuritySerializer(required=False)
    brand = BrandSerializer(required=False)
    custom_domain = serializers.CharField(required=False, allow_null=True, allow_blank=True)
    country = serializers.CharField(required=False, allow_null=True, allow_blank=True)

    def validate_country(self, value):
        return check_country(value)

    def validate_name(self, value):
        value = clean_line(value, 120)
        if not value:
            raise ValidationError("Enter a name.")
        return value


class WorkspacesView(APIView):
    def post(self, request):
        ser = WorkspaceCreateSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        name = ser.validated_data["name"]
        with transaction.atomic():
            brand = default_brand()
            brand["company_name"] = name
            ws = Workspace.objects.create(
                kind="company", name=name, brand=brand, created_by=request.user,
                country=ser.validated_data.get("country") or None,
            )
            member = Member.objects.create(
                workspace=ws, user=request.user, email=request.user.email, full_name=request.user.full_name,
                role="owner", status="active", joined_at=timezone.now(),
            )
        return Response(workspace_json(ws, member, request), status=201)


class WorkspaceDetailView(APIView):
    def get(self, request, workspace_id):
        ws, member = get_workspace_and_member(request.user, workspace_id)
        return Response(workspace_json(ws, member, request))

    def patch(self, request, workspace_id):
        ws, member = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        ser = WorkspacePatchSerializer(data=request.data, partial=True)
        ser.is_valid(raise_exception=True)
        data = ser.validated_data
        security_before = (list(ws.allowed_email_domains or []), ws.require_google_signin)
        before = {"name": ws.name, "country": ws.country, "brand": dict(ws.brand or {}),
                  "directory_enabled": ws.directory_enabled, "directory_slug": ws.directory_slug}
        if "name" in data:
            ws.name = data["name"]
        if "country" in data:
            if ws.kind != "company":
                raise validation_error({"country": ["The country is only available on company workspaces."]})
            ws.country = data["country"] or None
        if "brand" in data:
            brand = dict(ws.brand or default_brand())
            incoming = data["brand"]
            self._apply_directory(ws, member, incoming)
            for key in ("company_name", "website", "lock_design", "show_footer", "lock_allows_departments"):
                if key in incoming:
                    brand[key] = incoming[key]
            brand = merge_branding(ws, brand, incoming, {
                "background": bool(ws.background), "template_front": bool(ws.template_front),
            })
            if "design" in incoming:
                allowed = bool(brand.get("palette")) and ws.kind == "company"
                require_pack2_face(incoming["design"], ws)
                require_page_styles(incoming["design"], ws)
                try:
                    brand["design"] = validate_design(
                        incoming["design"], base=brand.get("design"), company_colour_ok=allowed,
                        custom_face_ok=custom_face_checker(ws),
                    )
                except ValidationError as exc:
                    raise validation_error({f"brand.design.{k}": [str(m) for m in v] for k, v in exc.detail.items()})
            ws.brand = brand
        if "security" in data:
            if ws.kind != "company":
                raise validation_error({"security": ["Sign-in rules are only available on company workspaces."]})
            if member.role != "owner":
                raise ApiError("forbidden", "Only the owner can change the company sign-in rules.", 403)
            security = data["security"]
            # Sign-in rules (allowed e-mail domains, Google sign-in) are an Enterprise feature; switching them off stays possible.
            tightens = (
                bool(security.get("allowed_email_domains"))
                and security["allowed_email_domains"] != list(ws.allowed_email_domains or [])
            ) or (security.get("require_google_signin") is True and not ws.require_google_signin)
            if tightens:
                require_enterprise(ws)
            if "allowed_email_domains" in security:
                ws.allowed_email_domains = security["allowed_email_domains"]
            if "require_google_signin" in security:
                ws.require_google_signin = security["require_google_signin"]
            if "require_2fa" in security:
                security_services.set_require_2fa(request, ws, security["require_2fa"])
        with transaction.atomic():
            ws.save()
        if "custom_domain" in data:
            # The old free-text field now goes through the same rules as PUT/DELETE workspaces/{id}/domain: Enterprise only to set
            # (clearing stays possible), a claim that starts as pending until DNS proves it, nobody else's verified name.
            if (data["custom_domain"] or "").strip():
                domains.set_domain(request, ws, data["custom_domain"])
            else:
                domains.remove_domain(request, ws)
        self._audit_changes(request, ws, before)
        if security_before != (list(ws.allowed_email_domains or []), ws.require_google_signin):
            audit.log(
                request, ws, "company.security_changed", "workspace", ws.id, ws.name,
                {"allowed_email_domains": ws.allowed_email_domains, "require_google_signin": ws.require_google_signin},
            )
        return Response(workspace_json(ws, member, request))

    @staticmethod
    def _apply_directory(ws, member, incoming):
        """The directory switch and address belong to the owner. Unchanged values are ignored."""
        wants_enabled = incoming.get("directory_enabled", ws.directory_enabled)
        slug = incoming.get("directory_slug", ws.directory_slug)
        slug = (slug or "").strip().lower() or None
        if wants_enabled == ws.directory_enabled and slug == ws.directory_slug:
            return
        if ws.kind != "company":
            raise validation_error({"directory_enabled": ["The directory is only available on company workspaces."]})
        if member.role != "owner":
            raise ApiError("forbidden", "Only the owner can change the company directory.", 403)
        if wants_enabled or (slug != ws.directory_slug and slug is not None):
            require_enterprise(ws)  # the directory is an Enterprise feature; switching it off stays possible
        if slug != ws.directory_slug and slug is not None:
            problem = directory_slug_problem(slug, ws)
            if problem:
                code, message = problem
                if code == "taken":
                    raise ApiError("slug_taken", message, 409)
                raise validation_error({"brand.directory_slug": [message]})
        if wants_enabled and not slug:
            raise validation_error({"brand.directory_slug": ["Choose an address for the directory before switching it on."]})
        ws.directory_enabled = bool(wants_enabled)
        ws.directory_slug = slug

    @staticmethod
    def _audit_changes(request, ws, before):
        old, new = before["brand"], ws.brand or {}
        changed = [k for k in set(old) | set(new) if old.get(k) != new.get(k)]
        if "lock_design" in changed or "lock_allows_departments" in changed:
            audit.log(request, ws, "brand.lock_changed", "workspace", ws.id, ws.name, {
                "lock_design": bool(new.get("lock_design")),
                "lock_allows_departments": bool(new.get("lock_allows_departments")),
            })
        if "design" in changed:
            audit.log(request, ws, "brand.design_changed", "workspace", ws.id, ws.name, {"design": new.get("design")})
        others = sorted(k for k in changed if k not in ("lock_design", "lock_allows_departments", "design"))
        if before["name"] != ws.name:
            others.append("name")
        if before["country"] != ws.country:
            others.append("country")
        if others:
            audit.log(request, ws, "brand.updated", "workspace", ws.id, ws.name, {"keys": others})
        if before["directory_enabled"] != ws.directory_enabled or before["directory_slug"] != ws.directory_slug:
            audit.log(request, ws, "directory.updated", "workspace", ws.id, ws.name, {
                "enabled": ws.directory_enabled, "slug": ws.directory_slug,
            })


class LogoView(APIView):
    def delete(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        _remove_file(ws, "logo")
        audit.log(request, ws, "brand.logo_changed", "workspace", ws.id, ws.name, {"picture": "logo", "removed": True})
        return Response(status=204)

    def post(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        content = process_logo_png(request.FILES.get("file"), 600, f"{ws.id.hex[:8]}")
        old_name = ws.logo.name
        ws.logo.save(content.name, content, save=True)
        if old_name:
            ws.logo.storage.delete(old_name)
        audit.log(request, ws, "brand.logo_changed", "workspace", ws.id, ws.name, {"picture": "logo"})
        return Response({"logo_url": file_url(request, ws.logo)})


def _require_company(ws):
    if ws.kind != "company":
        raise validation_error({"workspace": ["Company branding is only available on company workspaces."]})


def _replace_file(ws, field, content):
    """Store a processed file on the workspace and remove the file it replaces."""
    current = getattr(ws, field)
    old_name = current.name
    current.save(content.name, content, save=True)
    if old_name:
        current.storage.delete(old_name)


def _remove_file(ws, field):
    current = getattr(ws, field)
    if current:
        old_name = current.name
        setattr(ws, field, None)
        ws.save(update_fields=[field])
        current.storage.delete(old_name)


class BrandFileView(APIView):
    """Company-only picture slots: symbol, background and the template front and back."""

    field = ""
    url_key = ""
    max_px = 1600
    symbol = False
    # Which brand artwork kind falls back to "none" when its uploaded picture is removed.
    artwork_part = None

    def post(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        _require_company(ws)
        process = process_brand_symbol if self.symbol else process_brand_picture
        content = process(request.FILES.get("file"), self.max_px, f"{ws.id.hex[:8]}-{self.field}")
        _replace_file(ws, self.field, content)
        audit.log(request, ws, "brand.logo_changed", "workspace", ws.id, ws.name, {"picture": self.field})
        return Response({self.url_key: file_url(request, getattr(ws, self.field))})

    def delete(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        _require_company(ws)
        _remove_file(ws, self.field)
        audit.log(request, ws, "brand.logo_changed", "workspace", ws.id, ws.name, {"picture": self.field, "removed": True})
        if self.artwork_part and self.field != "template_back":
            brand = dict(ws.brand or {})
            art = normalize_branding(brand)["artwork"]
            if art[self.artwork_part]["kind"] == "upload":
                art[self.artwork_part]["kind"] = "none"
                brand["artwork"] = art
                ws.brand = brand
                ws.save(update_fields=["brand"])
        return Response(status=204)


class SymbolView(BrandFileView):
    field, url_key, max_px, symbol = "symbol", "symbol_url", 1024, True


class BackgroundView(BrandFileView):
    field, url_key, artwork_part = "background", "background_url", "background"


class TemplateFrontView(BrandFileView):
    field, url_key, artwork_part = "template_front", "template_front_url", "template"


class TemplateBackView(BrandFileView):
    field, url_key = "template_back", "template_back_url"


# ---------------------------------------------------------------- team
def my_membership_json(workspace, member):
    return {
        "member_id": str(member.id), "role": member.role,
        # Only an employee of a company has the switch; everyone else gets can_share_contacts false and share_contacts false.
        "can_share_contacts": workspace.kind == "company" and member.role == "employee",
        "share_contacts": bool(member.share_contacts) and member.role == "employee",
        "share_contacts_changed_at": iso(member.share_contacts_changed_at),
    }


class MyMembershipView(APIView):
    """The caller's own place in the company: read it, and (employees only) switch "share my new contacts with the company".

    Nobody can switch it for somebody else: there is no member id in the route and an owner or admin gets 403."""

    def get(self, request, workspace_id):
        ws, member = get_workspace_and_member(request.user, workspace_id)
        return Response(my_membership_json(ws, member))

    def patch(self, request, workspace_id):
        ws, member = get_workspace_and_member(request.user, workspace_id)
        if ws.kind != "company" or member.role != "employee":
            raise ApiError("forbidden", "Only an employee of a company can share contacts with the company.", 403)
        data = request.data if isinstance(request.data, dict) else {}
        value = data.get("share_contacts")
        if not isinstance(value, bool):
            raise validation_error({"share_contacts": ["Choose on or off."]})
        if value != member.share_contacts:
            member.share_contacts = value
            member.share_contacts_changed_at = timezone.now()
            member.save(update_fields=["share_contacts", "share_contacts_changed_at"])
            # The log shows the switch and who flipped it; it never carries a contact's name.
            audit.log(
                request, ws, "member.share_contacts_changed", "member", member.id, member.full_name or member.email,
                {"share_contacts": value},
            )
        return Response(my_membership_json(ws, member))


class MembersView(APIView):
    def get(self, request, workspace_id):
        ws, _ = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        members = ws.members.select_related("user", "department").prefetch_related("cards")
        return Response([member_json(m, request) for m in members])


class InviteItemSerializer(serializers.Serializer):
    email = serializers.EmailField()
    full_name = serializers.CharField(required=False, allow_blank=True, default="")
    title = serializers.CharField(required=False, allow_blank=True, default="")
    role = serializers.ChoiceField(choices=["admin", "employee"], required=False, default="employee")
    language = serializers.ChoiceField(choices=["", "en", "ar"], required=False, default="")
    department_id = serializers.UUIDField(required=False, allow_null=True, default=None)

    def validate_full_name(self, value):
        return clean_line(value, 120)

    def validate_title(self, value):
        return clean_line(value, 120)


class InvitesSerializer(serializers.Serializer):
    invites = InviteItemSerializer(many=True, allow_empty=False, max_length=200)


def _require_team_workspace(workspace, member):
    if workspace.kind != "company":
        raise validation_error({"workspace": ["Teams are only available on company workspaces."]})
    if not is_live(workspace):
        raise ApiError("subscription_required", "An active plan is required to invite people.", 402)


class InvitesView(APIView):
    def post(self, request, workspace_id):
        ws, member = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        ser = InvitesSerializer(data=request.data)
        ser.is_valid(raise_exception=True)
        entries = ser.validated_data["invites"]
        _require_team_workspace(ws, member)
        if any(e["department_id"] for e in entries):
            require_enterprise(ws)  # departments are an Enterprise feature
        if member.role != "owner" and any(e["role"] == "admin" for e in entries):
            raise ApiError("forbidden", "Only the owner can invite admins.", 403)
        emails = [e["email"].strip().lower() for e in entries]
        errors = {}
        existing = set(ws.members.values_list("email", flat=True))
        for index, email in enumerate(emails):
            if not domain_allowed(ws, email):
                errors[f"invites.{index}.email"] = [
                    "This email domain is not allowed. Allowed: " + ", ".join(ws.allowed_email_domains) + "."
                ]
            elif email in existing:
                errors[f"invites.{index}.email"] = ["This person is already in the team."]
            elif emails.index(email) != index:
                errors[f"invites.{index}.email"] = ["This email appears twice."]
        if errors:
            raise validation_error(errors)
        if len(entries) > seats_left(ws):
            raise ApiError("plan_limit", "Not enough seats. Add seats to your plan to invite more people.", 403)
        departments = {str(d.id): d for d in ws.departments.all()}
        for index, e in enumerate(entries):
            if e["department_id"] and str(e["department_id"]) not in departments:
                errors[f"invites.{index}.department_id"] = ["Department not found."]
        if errors:
            raise validation_error(errors)
        with transaction.atomic():
            created = [
                invite_member(
                    ws, e["email"], e["full_name"], e["title"], e["role"],
                    department=departments.get(str(e["department_id"])) if e["department_id"] else None,
                    language=e["language"],
                    request=request,
                )
                for e in entries
            ]
        return Response([member_json(m, request) for m in created], status=201)


class MemberDetailView(APIView):
    def _target(self, ws, member_id):
        from django.http import Http404

        try:
            return ws.members.select_related("user", "department").get(pk=member_id)
        except (Member.DoesNotExist, ValueError):
            raise Http404

    def patch(self, request, workspace_id, member_id):
        ws, actor = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        target = self._target(ws, member_id)
        actions.check_can_manage(actor, target)
        data = request.data if isinstance(request.data, dict) else {}
        role = data.get("role")
        status = data.get("status")
        if role is not None:
            if role not in ("admin", "employee"):
                raise validation_error({"role": ["Choose admin or employee."]})
            if actor.role != "owner":
                raise ApiError("forbidden", "Only the owner can change roles.", 403)
        if status is not None and status not in ("active", "suspended"):
            raise validation_error({"status": ["Choose active or suspended."]})
        if target.id == actor.id and status == "suspended":
            raise ApiError("forbidden", "You cannot suspend yourself.", 403)
        department = None
        if "department_id" in data:
            if data["department_id"]:
                department = ws.departments.filter(pk=data["department_id"]).first() if _is_uuid(data["department_id"]) else None
                if department is None:
                    raise validation_error({"department_id": ["Department not found."]})
        with transaction.atomic():
            if role is not None and role != target.role:
                actions.member_set_role(request, ws, actor, target, role)
            if status == "suspended" and target.status != "suspended":
                actions.member_suspend(request, ws, actor, target)
            elif status == "active" and target.status == "suspended":
                actions.member_restore(request, ws, actor, target)
            if "department_id" in data and (department.id if department else None) != target.department_id:
                actions.member_set_department(request, ws, actor, target, department)
        target = ws.members.select_related("user", "department").prefetch_related("cards").get(pk=target.pk)
        return Response(member_json(target, request))

    def delete(self, request, workspace_id, member_id):
        """Remove a member. Body or query: `card` = keep (default, suspended), reassign or delete, and
        `reassign_to` = a member id (empty means nobody). Leads always stay with the company."""
        ws, actor = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        target = self._target(ws, member_id)
        body = request.data if isinstance(request.data, dict) else {}
        policy = body.get("card") or request.query_params.get("card") or "keep"
        reassign_to = body.get("reassign_to") or request.query_params.get("reassign_to") or None
        if reassign_to and not _is_uuid(reassign_to):
            raise validation_error({"reassign_to": ["Choose a person from the list."]})
        actions.member_remove(request, ws, actor, target, policy, reassign_to)
        return Response(status=204)


def _is_uuid(value):
    import uuid

    try:
        uuid.UUID(str(value))
        return True
    except ValueError:
        return False


class ResendInviteView(APIView):
    """Send an invite email again with a fresh link and a new expiry. One resend per 10 minutes per person."""

    def post(self, request, workspace_id, member_id):
        from django.http import Http404

        ws, actor = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        try:
            target = ws.members.get(pk=member_id)
        except (Member.DoesNotExist, ValueError):
            raise Http404
        if target.status != "invited":
            raise validation_error({"member": ["Only people who have not joined yet can be sent the invite again."]})
        now = timezone.now()
        next_at = resend_available_at(target)
        if now < next_at:
            wait = int((next_at - now).total_seconds()) + 1
            minutes = max(1, -(-wait // 60))
            err = ApiError(
                "throttled",
                f"This invite was sent a moment ago. You can send it again in {minutes} minute{'s' if minutes != 1 else ''}.",
                429,
            )
            err.retry_after = wait
            raise err
        import secrets

        target.invite_token = secrets.token_urlsafe(32)
        target.invite_sent_at = now
        target.save(update_fields=["invite_token", "invite_sent_at"])
        send_invite_email(ws, target)
        audit.log(request, ws, "invite.resent", "member", target.id, target.full_name or target.email, {"email": target.email})
        target = ws.members.select_related("user", "department").prefetch_related("cards").get(pk=target.pk)
        return Response(member_json(target, request))


class MembersImportView(APIView):
    MAX_ROWS = 500

    def post(self, request, workspace_id):
        ws, member = get_workspace_and_member(request.user, workspace_id, MANAGER_ROLES)
        _require_team_workspace(ws, member)
        upload = request.FILES.get("file")
        if upload is None:
            raise validation_error({"file": ["Choose a CSV file."]})
        if upload.size > 1024 * 1024:
            raise validation_error({"file": ["The file must be under 1 MB."]})
        try:
            text = upload.read().decode("utf-8-sig")
        except UnicodeDecodeError:
            raise validation_error({"file": ["Save the file as UTF-8 CSV."]})
        reader = csv.DictReader(io.StringIO(text))
        if reader.fieldnames is None:
            raise validation_error({"file": ["The file is empty."]})
        reader.fieldnames = [(name or "").strip().lower() for name in reader.fieldnames]
        if "email" not in reader.fieldnames:
            raise validation_error({"file": ["The first row must have the columns email, full_name, title."]})
        existing = set(ws.members.values_list("email", flat=True))
        dept_by_name = {d.name.lower(): d for d in ws.departments.all()}
        seen = set()
        created, skipped = 0, []
        for index, row in enumerate(reader):
            number = index + 2  # the header is row 1
            if index >= self.MAX_ROWS:
                skipped.append({"row": number, "reason": localise_message(request, f"Only the first {self.MAX_ROWS} rows are imported.")})
                break
            email = (row.get("email") or "").strip().lower()
            full_name = (row.get("full_name") or "").strip()
            title = (row.get("title") or "").strip()
            dept_name = (row.get("department") or "").strip()
            department = None
            reason = None
            if not email:
                reason = "Missing email."
            elif not EMAIL_RE.match(email) or len(email) > 254:
                reason = "Invalid email address."
            elif email in seen:
                reason = "Duplicate email in this file."
            elif email in existing:
                reason = "Already in the team."
            elif dept_name and not enterprise_allowed(ws):
                reason = "Departments are part of the Enterprise plan. Ask us for a quote."
            elif dept_name and (department := dept_by_name.get(dept_name.lower())) is None:
                reason = f"Unknown department {dept_name}. Create it first under Departments."
            else:
                try:
                    full_name = clean_line(full_name, 120)
                    title = clean_line(title, 120)
                except ValidationError:
                    reason = "Name or title is too long or has invalid characters."
            if reason is None and not domain_allowed(ws, email):
                reason = "This email domain is not allowed in your company settings."
            if reason is None and seats_left(ws) < 1:
                reason = "No seats left."
            if reason:
                skipped.append({"row": number, "reason": localise_message(request, reason)})
                continue
            seen.add(email)
            invite_member(ws, email, full_name, title, "employee", department=department, request=request)
            created += 1
        return Response({"created": created, "skipped": skipped})


# ---------------------------------------------------------------- public invite links
def _body_token(request):
    """An invite token sent in the request body, which keeps it out of URLs and access logs."""
    return str(request.data.get("token") or "") if isinstance(request.data, dict) else ""


class InviteLookupView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [PublicReadThrottle]

    @staticmethod
    def get_member(token):
        member = Member.objects.select_related("workspace").filter(invite_token=token).first() if token else None
        if member is None or not invite_is_valid(member) or member.workspace.deletion_due_at is not None:
            raise ApiError("invite_invalid", "This invite link is no longer valid.", 410)
        return member

    def post(self, request, token=None):
        return self.get(request, token)

    def get(self, request, token=None):
        member = self.get_member(token or _body_token(request))
        return Response({
            "workspace_name": member.workspace.name, "email": member.email, "full_name": member.full_name,
            "language": member.language or None,
        })


class InviteAcceptView(APIView):
    authentication_classes = []
    permission_classes = [AllowAny]
    throttle_classes = [InviteAcceptThrottle]

    def post(self, request, token=None):
        from django.contrib.auth.password_validation import validate_password
        from django.core.exceptions import ValidationError as DjangoValidationError

        member = InviteLookupView.get_member(token or _body_token(request))
        if member.workspace.require_google_signin and enterprise_allowed(member.workspace):
            raise ApiError(
                "google_signin_required",
                "This company requires Google sign-in. Use the Continue with Google button.", 403,
            )
        if not domain_allowed(member.workspace, member.email):
            raise ApiError("domain_not_allowed", "Your email domain is not allowed to join this company.", 403)
        data = request.data if isinstance(request.data, dict) else {}
        password = data.get("password") or ""
        full_name = clean_line(str(data.get("full_name") or ""), 120) if data.get("full_name") else ""
        user = User.objects.filter(email__iexact=member.email).first()
        if user is not None:
            # An existing account must prove it owns the address, otherwise anyone holding the link
            # could sign in as that person.
            if not check_login_password(user, password):
                raise ApiError("invalid_credentials", "Enter the password of your existing account.", 401)
        else:
            if not password:
                raise validation_error({"password": ["Choose a password."]})
            try:
                validate_password(password)
            except DjangoValidationError as exc:
                raise validation_error({"password": list(exc.messages)})
            user = User.objects.create_user(
                member.email, password, full_name=full_name or member.full_name
            )
        # The password (or the new account) is proven, so the seat is taken; the tokens still wait for the second step.
        accept_member(member, user, full_name)
        gate = security_services.sign_in_gate(request, user, "password", data)
        if gate is not None:
            return Response({**gate, "workspace_id": str(member.workspace_id)})
        return Response({**tokens_for(user, request), "workspace_id": str(member.workspace_id)})
