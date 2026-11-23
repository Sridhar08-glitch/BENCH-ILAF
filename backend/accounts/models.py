import hashlib
import uuid

from django.contrib.auth.base_user import AbstractBaseUser, BaseUserManager
from django.contrib.auth.models import PermissionsMixin
from django.db import models


class UserManager(BaseUserManager):
    use_in_migrations = True

    def create_user(self, email, password=None, **extra):
        if not email:
            raise ValueError("An email address is required.")
        user = self.model(email=email.strip().lower(), **extra)
        user.set_password(password)
        user.save(using=self._db)
        return user

    def create_superuser(self, email, password=None, **extra):
        extra.setdefault("is_staff", True)
        extra.setdefault("is_superuser", True)
        return self.create_user(email, password, **extra)


STAFF_ROLES = [("none", "none"), ("read_only", "read_only"), ("support", "support"), ("admin", "admin")]


class User(AbstractBaseUser, PermissionsMixin):
    """An account that signs in with an email address (no username)."""

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True)
    full_name = models.CharField(max_length=120, blank=True)
    photo = models.ImageField(upload_to="users/", blank=True, null=True)
    # The person's chosen language ("en", "ar"); empty until they choose one. Drives their e-mails and the web app.
    language = models.CharField(max_length=5, blank=True, default="")
    is_active = models.BooleanField(default=True)
    is_staff = models.BooleanField(default=False)
    created_at = models.DateTimeField(auto_now_add=True)
    # True once the address is proven (a Google sign-in, an e-mailed reset or invite link).
    # A password sign-up is not proven, so Google never links itself to such an account.
    email_verified = models.BooleanField(default=False)
    # The Google account linked to this user (the stable "sub" id, never the address).
    google_sub = models.CharField(max_length=64, unique=True, null=True, blank=True)
    google_email = models.EmailField(blank=True)
    # Account deletion: the account is disabled at once and erased when the grace period ends.
    deletion_due_at = models.DateTimeField(null=True, blank=True)
    deleted_at = models.DateTimeField(null=True, blank=True)
    # The person's place in the product team's own back office (see the staff app). Customers have "none".
    staff_role = models.CharField(max_length=10, choices=STAFF_ROLES, default="none")
    # Consent to product-update e-mails (announcements). Transactional e-mails never depend on it.
    product_updates = models.BooleanField(default=False)

    objects = UserManager()
    USERNAME_FIELD = "email"
    REQUIRED_FIELDS = []

    def __str__(self):
        return self.email


class PasswordResetToken(models.Model):
    """A single-use reset token. Only the hash is stored, so a database leak cannot reset passwords."""

    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name="reset_tokens")
    token_hash = models.CharField(max_length=64, unique=True)
    created_at = models.DateTimeField(auto_now_add=True)
    used_at = models.DateTimeField(null=True, blank=True)

    @staticmethod
    def hash_token(token):
        return hashlib.sha256(token.encode("utf-8")).hexdigest()
