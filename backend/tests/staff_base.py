"""Shared set-up for the staff and custom design tests."""
import tempfile
from types import SimpleNamespace

from django.test import override_settings
from rest_framework.test import APIClient

from accounts.models import User
from staff import totp
from staff.models import StaffTotp

from .base import API, ApiTestCase

PRIVATE_DIR = tempfile.mkdtemp(prefix="ilaf-test-private-")


@override_settings(PRIVATE_FILES_ROOT=PRIVATE_DIR, STAFF_NOTIFY_EMAILS=[])
class StaffTestCase(ApiTestCase):
    def make_staff(self, email="admin@ilaf.test", role="admin", verified=True):
        """A staff account signed in through the API. With `verified` the second step is done too (enrolled and a session
        token is set on the client)."""
        user = User.objects.create_user(email, self.password, full_name=email.split("@")[0].title())
        user.staff_role = role
        user.save()
        res = APIClient().post(API + "auth/login", {"email": email, "password": self.password}, format="json")
        assert res.status_code == 200, res.content
        client = APIClient()
        client.credentials(HTTP_AUTHORIZATION=f"Bearer {res.data['access']}")
        person = SimpleNamespace(client=client, user=user, email=email, role=role, token=None, recovery=None, secret=None)
        if verified:
            self.verify_staff(person)
        return person

    def verify_staff(self, person):
        res = person.client.post(API + "staff/totp/enrol", {}, format="json")
        assert res.status_code == 201, res.content
        person.secret = res.data["secret"]
        res = person.client.post(API + "staff/totp/confirm", {"code": totp.code_at(person.secret)}, format="json")
        assert res.status_code == 200, res.content
        person.token = res.data["token"]
        person.recovery = res.data["recovery_codes"]
        person.client.credentials(
            HTTP_AUTHORIZATION=person.client._credentials["HTTP_AUTHORIZATION"], HTTP_X_STAFF_TOKEN=person.token,
        )
        return person

    def fresh_code(self, person):
        """The authenticator code of the next time step, so it is not the one already used."""
        import time

        return totp.code_at(person.secret, time.time() + totp.STEP_SECONDS)

    def company_with_owner(self, email="owner@acme.test", name="Acme Ltd"):
        owner = self.signup(email, "Olivia Owner")
        ws = self.company(owner, name)
        owner.company = ws
        return owner

    def new_request(self, owner, **extra):
        body = {"goals": "A calm dark card with our blue accent.", "languages": "both"}
        body.update(extra)
        res = owner.client.post(f"{API}workspaces/{owner.company}/design-requests", body, format="json")
        assert res.status_code == 201, res.content
        return res.data
