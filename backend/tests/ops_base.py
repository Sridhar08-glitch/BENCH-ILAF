"""Shared set-up for the company operations tests: an owner with a ten-seat company plan."""
from types import SimpleNamespace

from workspaces.models import Member

from .base import API, ApiTestCase


class OpsTestCase(ApiTestCase):
    def setUp(self):
        super().setUp()
        self.owner = self.signup("owner@example.com", "Olivia Owner")
        self.ws = self.company(self.owner, "Acme Ltd", seats=10)
        # The owner's own member row, so tests can compare ids.
        self.owner_member = Member.objects.get(workspace_id=self.ws, user__email="owner@example.com")

    def url(self, path):
        return f"{API}workspaces/{self.ws}/{path}"

    def add(self, email, name, role="employee", **extra):
        """Invite and let the person join. Returns a person with .client, .member_id and .card_id."""
        member = self.invite(self.owner, self.ws, email, full_name=name, role=role, **extra)
        person = self.join(member, full_name=name)
        return SimpleNamespace(
            client=person.client, member_id=member["id"], card_id=member["card_id"], email=email, name=name,
        )

    def invited(self, email, name="", **extra):
        member = self.invite(self.owner, self.ws, email, full_name=name, **extra)
        return SimpleNamespace(member_id=member["id"], card_id=member["card_id"], email=email, token=Member.objects.get(pk=member["id"]).invite_token)

    def audit(self, **params):
        res = self.owner.client.get(self.url("audit"), params)
        assert res.status_code == 200, res.content
        return res.data

    def audit_actions(self):
        return [e["action"] for e in self.audit(page_size=200)["results"]]

    def department(self, name="Sales", **body):
        res = self.owner.client.post(self.url("departments"), {"name": name, **body}, format="json")
        assert res.status_code == 201, res.content
        return res.data
