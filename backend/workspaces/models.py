import uuid

from django.conf import settings
from django.db import models
from django.db.models import Q
from django.utils import timezone

from cards.features import default_lead_settings
from ilaf.design import default_design


def default_brand():
    return {
        "company_name": "",
        "website": "",
        "design": default_design(),
        "lock_design": False,
        "show_footer": True,
    }


class Workspace(models.Model):
    """A personal space (one person) or a company space (owner, admins and employees)."""

    KIND_CHOICES = [("personal", "personal"), ("company", "company")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    kind = models.CharField(max_length=10, choices=KIND_CHOICES)
    name = models.CharField(max_length=120)
    # The country the company is based in (ISO 3166-1 alpha-2, see ilaf.countries). Empty until the company chooses it.
    country = models.CharField(max_length=2, null=True, blank=True)
    brand = models.JSONField(default=default_brand)
    logo = models.ImageField(upload_to="logos/", blank=True, null=True)
    symbol = models.ImageField(upload_to="brand/", blank=True, null=True)
    background = models.ImageField(upload_to="brand/", blank=True, null=True)
    template_front = models.ImageField(upload_to="brand/", blank=True, null=True)
    template_back = models.ImageField(upload_to="brand/", blank=True, null=True)
    legacy_brand_design = models.JSONField(null=True, blank=True, editable=False)
    # Which parts of a card employees may change (see operations.rules). Empty means everything is free.
    field_rules = models.JSONField(default=dict, blank=True)
    # The public company directory at /d/<directory_slug>. Off until the owner switches it on.
    directory_enabled = models.BooleanField(default=False)
    # Lead handling: the privacy page linked from the exchange form and who is e-mailed about leads.
    lead_settings = models.JSONField(default=default_lead_settings, blank=True)
    directory_slug = models.SlugField(max_length=40, unique=True, null=True, blank=True)
    # Sign-in rules set by the owner: people may only join with these e-mail domains (empty = any),
    # and members other than the owner may be required to sign in with Google.
    allowed_email_domains = models.JSONField(default=list, blank=True)
    require_google_signin = models.BooleanField(default=False)
    # Company deletion: set when the owner asks, the company is erased when the grace period ends.
    deletion_due_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # Set by the product team (never by the customer): the company is closed to its people and its cards show as unavailable.
    suspended_at = models.DateTimeField(null=True, blank=True)
    suspended_reason = models.CharField(max_length=300, blank=True, default="")
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, on_delete=models.SET_NULL, related_name="+"
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def __str__(self):
        return f"{self.name} ({self.kind})"


class Member(models.Model):
    """A person's place in a workspace. Invited people have no user until they accept."""

    ROLES = [("owner", "owner"), ("admin", "admin"), ("employee", "employee")]
    STATUSES = [("invited", "invited"), ("active", "active"), ("suspended", "suspended")]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.ForeignKey(Workspace, on_delete=models.CASCADE, related_name="members")
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="memberships"
    )
    email = models.EmailField()
    full_name = models.CharField(max_length=120, blank=True)
    title = models.CharField(max_length=120, blank=True)
    role = models.CharField(max_length=10, choices=ROLES, default="employee")
    # The language of the invite e-mail ("en", "ar"); empty means English.
    language = models.CharField(max_length=5, blank=True, default="")
    status = models.CharField(max_length=10, choices=STATUSES, default="invited")
    invite_token = models.CharField(max_length=64, unique=True, null=True, blank=True)
    # When the invite email last went out: a resend needs a gap, and the link expires from here.
    invite_sent_at = models.DateTimeField(null=True, blank=True)
    department = models.ForeignKey(
        "operations.Department", null=True, blank=True, on_delete=models.SET_NULL, related_name="members"
    )
    # An employee's own switch: "share my new contacts with the company". Off by default; see workspaces/sharing.py.
    share_contacts = models.BooleanField(default=False)
    share_contacts_changed_at = models.DateTimeField(null=True, blank=True)
    invited_at = models.DateTimeField(auto_now_add=True)
    joined_at = models.DateTimeField(null=True, blank=True)

    class Meta:
        constraints = [models.UniqueConstraint(fields=["workspace", "email"], name="one_member_per_email")]
        ordering = ["invited_at"]

    def __str__(self):
        return f"{self.email} in {self.workspace_id}"


class CustomDomain(models.Model):
    """A company's claim on its own web address (Enterprise). One per company for now.

    A claim starts `pending` with a random token the owner publishes in DNS (TXT at _bench-verify.<domain>) next to a CNAME to
    the card host. Many companies may hold a pending claim on the same name; the first whose DNS checks out becomes `verified`
    and from then on nobody else can claim it (the partial unique constraint). `dns_broken` still serves, for a grace period,
    after the records went missing; `failed` (last check failed, still being retried) and `expired` (7 days without success)
    never serve. See workspaces/domains.py."""

    PENDING, VERIFIED, FAILED, EXPIRED, DNS_BROKEN = "pending", "verified", "failed", "expired", "dns_broken"
    STATUSES = [(x, x) for x in (PENDING, VERIFIED, FAILED, EXPIRED, DNS_BROKEN)]
    HOLDING = (VERIFIED, DNS_BROKEN)  # the statuses that own the name

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    workspace = models.OneToOneField(Workspace, on_delete=models.CASCADE, related_name="custom_domain_record")
    domain = models.CharField(max_length=253, db_index=True)  # normalised: lower case, ASCII (punycode), no trailing dot
    token = models.CharField(max_length=64)
    status = models.CharField(max_length=12, choices=STATUSES, default=PENDING)
    requested_at = models.DateTimeField(default=timezone.now)  # the 7-day window of a pending claim starts here
    verified_at = models.DateTimeField(null=True, blank=True)
    last_checked_at = models.DateTimeField(null=True, blank=True)
    # A short code of the last failed check (txt_missing, txt_mismatch, cname_missing, cname_wrong, dns_error, domain_taken, ...).
    last_error = models.CharField(max_length=40, blank=True, default="")
    failing_since = models.DateTimeField(null=True, blank=True)  # a verified domain whose records are missing: since when
    broken_at = models.DateTimeField(null=True, blank=True)       # when it was marked dns_broken (the grace period runs from here)
    created_by = models.ForeignKey(settings.AUTH_USER_MODEL, null=True, blank=True, on_delete=models.SET_NULL, related_name="+")
    created_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["domain"], condition=Q(status__in=["verified", "dns_broken"]), name="custom_domain_unique_when_verified",
            ),
        ]

    def __str__(self):
        return f"{self.domain} ({self.status})"
