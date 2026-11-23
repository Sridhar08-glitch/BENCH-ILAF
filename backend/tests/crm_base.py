"""Shared set-up for the CRM tests: a company with an owner, fake vendor servers and ready-made connections."""
from datetime import timedelta
from unittest import mock

from django.test import override_settings
from django.utils import timezone

from crm import crypto, http
from crm.models import CrmConnection
from leads import workflow
from leads.models import Lead
from workspaces.models import Workspace

from .ops_base import OpsTestCase

CRM_SETTINGS = dict(
    CRM_ENCRYPTION_KEY="test-crm-key-0123456789abcdef", HUBSPOT_CLIENT_ID="hs-id", HUBSPOT_CLIENT_SECRET="hs-secret",
    SALESFORCE_CLIENT_ID="sf-id", SALESFORCE_CLIENT_SECRET="sf-secret", SALESFORCE_LOGIN_URL="https://login.salesforce.com",
    ZOHO_CLIENT_ID="zo-id", ZOHO_CLIENT_SECRET="zo-secret", ZOHO_REGIONS=["com", "eu", "in"],
)


class FakeServer:
    """Stands in for `crm.http.call`. Routes are (method, url fragment, answer); an answer is a Result, a list of
    Results (used in turn) or a function(call) -> Result. Every call is recorded, and the host rule is really applied."""

    def __init__(self):
        self.routes = []
        self.calls = []

    def add(self, method, fragment, answer):
        self.routes.append([method, fragment, answer])
        return self

    def __call__(self, method, url, host_ok, headers=None, json_body=None, form=None, params=None):
        from urllib.parse import urlsplit

        host = urlsplit(url).hostname
        if not host_ok(host):
            raise http.BlockedHost("host " + host)
        call = {"method": method, "url": url, "headers": headers or {}, "json": json_body, "form": form, "params": params or {}}
        self.calls.append(call)
        for route in self.routes:
            if route[0] == method and route[1] in url:
                answer = route[2]
                if isinstance(answer, list):
                    return answer.pop(0) if len(answer) > 1 else answer[0]
                return answer(call) if callable(answer) else answer
        raise AssertionError(f"unexpected call {method} {url}")

    def find(self, method, fragment):
        return [c for c in self.calls if c["method"] == method and fragment in c["url"]]


def ok(data=None, status=200, headers=None):
    return http.Result(status, data, headers or {})


@override_settings(**CRM_SETTINGS)
class CrmTestCase(OpsTestCase):
    def setUp(self):
        super().setUp()
        self.server = FakeServer()
        patcher = mock.patch("crm.http.call", self.server)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.workspace = Workspace.objects.get(pk=self.ws)
        self.card = self.make_card(self.owner, self.ws)

    def connect_direct(self, vendor, **kw):
        values = dict(
            workspace=self.workspace, vendor=vendor, access_token=crypto.encrypt("access-" + vendor),
            refresh_token=crypto.encrypt("refresh-" + vendor), token_expires_at=timezone.now() + timedelta(hours=1),
            account_label="Acme account",
        )
        if vendor == "salesforce":
            values["instance_url"] = "https://acme.my.salesforce.com"
        if vendor == "zoho":
            values.update(instance_url="https://www.zohoapis.com", region="com")
        values.update(kw)
        return CrmConnection.objects.create(**values)

    def make_lead(self, **kw):
        values = {"name": "Lena Lead", "email": "lena@example.com", "phone": "+97455550000", "company": "Lena Ltd", "note": "Please call me"}
        values.update(kw)
        from cards.models import Card

        card = Card.objects.get(pk=self.card["id"])
        lead = Lead.objects.create(workspace=self.workspace, card=card, card_name=card.name, source="exchange", **values)
        workflow.note_created(lead)
        return lead
