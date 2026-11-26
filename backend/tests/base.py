"""Shared helpers for the API tests."""
import io
import shutil
import tempfile
from types import SimpleNamespace

from django.core.cache import cache
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.core.signals import request_finished
from django.test import TestCase, override_settings
from django.db import close_old_connections
from PIL import Image
from rest_framework.test import APIClient

API = "/api/v1/"
MEDIA_DIR = tempfile.mkdtemp(prefix="ilaf-test-media-")
BIG_RATES = {
    key: "100000/min"
    for key in (
        "auth_login", "auth_register", "auth_forgot", "auth_reset", "invite_accept", "public_read",
        "public_event", "public_lead", "slug_check", "resolve_link", "public_directory", "auth_google",
        "data_download",
    )
}


def body(response):
    """The bytes of a response, whether it was sent in one piece or streamed (spreadsheet downloads are streamed)."""
    if getattr(response, "streaming", False):
        return b"".join(response.streaming_content)
    return response.content


def tearDownModule():  # pragma: no cover - cleanup only
    shutil.rmtree(MEDIA_DIR, ignore_errors=True)


def png_upload(size=(1200, 900), color=(200, 60, 20), name="photo.png", fmt="PNG", mode="RGB"):
    buffer = io.BytesIO()
    Image.new(mode, size, color).save(buffer, format=fmt)
    content_type = {"PNG": "image/png", "JPEG": "image/jpeg", "WEBP": "image/webp"}.get(fmt, "image/png")
    return SimpleUploadedFile(name, buffer.getvalue(), content_type=content_type)


def close_response(response):
    """Close a streamed response the way the test client does for normal ones.

    Closing sends request_finished, and close_old_connections then shuts the connection when it
    sits inside the test's transaction, which breaks every later test in the class on PostgreSQL.
    """
    request_finished.disconnect(close_old_connections)
    try:
        response.close()
    finally:
        request_finished.connect(close_old_connections)


@override_settings(
    WEB_BASE_URL="https://web.test",
    API_BASE_URL="https://api.test",
    CARDS_DEV_ACTIVATE=True,
    STRIPE_SECRET_KEY="",
    STRIPE_WEBHOOK_SECRET="whsec_test_secret",
    CARDS_GRACE_DAYS=7,
    TRUST_PROXY_HEADERS=True,
    EMAIL_AFTER_RESPONSE=False,
    TRUST_CLOUDFLARE_HEADER=True,
    TRUSTED_PROXY_IPS=["127.0.0.1", "::1"],
    NUM_PROXIES=0,
    CLIENT_IP_HEADER_SECRET="",
    ILAF_THROTTLE_RATES=BIG_RATES,
    MEDIA_ROOT=MEDIA_DIR,
    PASSWORD_HASHERS=["django.contrib.auth.hashers.MD5PasswordHasher"],
    EMAIL_BACKEND="django.core.mail.backends.locmem.EmailBackend",
    LEAD_MIN_FILL_SECONDS=0,
    LEAD_MAX_PER_CARD_PER_HOUR=0,
)
class ApiTestCase(TestCase):
    password = "correct-horse-1"

    def setUp(self):
        cache.clear()
        call_command("seed_plans", verbosity=0)

    # ---------------------------------------------------------------- people
    def client_for(self, access=None):
        client = APIClient()
        if access:
            client.credentials(HTTP_AUTHORIZATION=f"Bearer {access}")
        return client

    def signup(self, email="alice@example.com", name="Alice Anderson"):
        """Register through the API. Returns a SimpleNamespace(client, user, ws, access, refresh)."""
        res = APIClient().post(
            API + "auth/register", {"email": email, "password": self.password, "full_name": name}, format="json"
        )
        assert res.status_code == 201, res.content
        client = self.client_for(res.data["access"])
        ws = next(w for w in client.get(API + "me/workspaces").data if w["kind"] == "personal")
        return SimpleNamespace(
            client=client, user=res.data["user"], ws=ws["id"], access=res.data["access"],
            refresh=res.data["refresh"], email=email,
        )

    def buy(self, person, plan_code="personal", ws=None, seats=None):
        body = {"plan_code": plan_code}
        if seats:
            body["seats"] = seats
        res = person.client.post(f"{API}workspaces/{ws or person.ws}/checkout", body, format="json")
        assert res.status_code == 200, res.content
        return res

    def company(self, owner, name="Acme Ltd", seats=5, plan="enterprise"):
        """Create a company workspace for `owner` and activate a plan: Enterprise by default (most company features need
        it; the seats are what staff quoted), or plan="company" for the plain Company plan (at least 5 seats)."""
        res = owner.client.post(API + "workspaces", {"name": name}, format="json")
        assert res.status_code == 201, res.content
        ws = res.data["id"]
        if plan == "enterprise":
            self.enterprise(ws, seats)
        else:
            self.buy(owner, plan, ws=ws, seats=seats)
        return ws

    def enterprise(self, ws, seats=5, price_per_seat=2500):
        """Put a company on the Enterprise plan the way a paid quote does (a payment of the quoted amount, no Stripe)."""
        from billing.models import Plan
        from billing.services import activate
        from workspaces.models import Workspace

        return activate(
            Workspace.objects.get(pk=ws), Plan.objects.get(code="enterprise"), seats,
            amount_minor=seats * price_per_seat, source="dev",
        )[0]

    def age_company_plan(self, ws, before="2026-11-01"):
        """Make a company's current period look as if it was bought before the Enterprise plan existed: its start and its
        payments are moved back (what the data of a customer who paid earlier looks like)."""
        from datetime import datetime, timedelta, timezone as tz

        from billing.models import Payment, Subscription

        when = datetime.fromisoformat(before).replace(tzinfo=tz.utc)
        Subscription.objects.filter(workspace_id=ws).update(starts_at=when)
        Payment.objects.filter(workspace_id=ws).update(paid_at=when, period_start=when)

    # ---------------------------------------------------------------- cards
    def make_card(self, person, ws=None, **fields):
        body = {"name": "Alice Anderson", "title": "Designer", "company": "Studio"}
        body.update(fields)
        res = person.client.post(f"{API}workspaces/{ws or person.ws}/cards", body, format="json")
        assert res.status_code == 201, res.content
        return res.data

    def published_card(self, person, ws=None, **fields):
        card = self.make_card(person, ws, **fields)
        res = person.client.post(f"{API}cards/{card['id']}/publish")
        assert res.status_code == 200, res.content
        return res.data

    def invite(self, owner, ws, email, **extra):
        res = owner.client.post(
            f"{API}workspaces/{ws}/invites", {"invites": [{"email": email, **extra}]}, format="json"
        )
        assert res.status_code == 201, res.content
        return res.data[0]

    def join(self, member, password="employee-pass-1", full_name="Eve Employee"):
        """Accept an invite from the email that was sent. Returns SimpleNamespace(client, ...)."""
        from workspaces.models import Member

        token = Member.objects.get(pk=member["id"]).invite_token
        res = APIClient().post(
            f"{API}invites/{token}/accept", {"password": password, "full_name": full_name}, format="json"
        )
        assert res.status_code == 200, res.content
        return SimpleNamespace(
            client=self.client_for(res.data["access"]), ws=res.data["workspace_id"], access=res.data["access"],
            email=member["email"], token=token,
        )
