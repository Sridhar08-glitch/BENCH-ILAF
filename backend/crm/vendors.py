"""The three CRMs: HubSpot, Salesforce and Zoho CRM.

Each vendor class knows its OAuth 2.0 addresses, which hosts it may talk to, how to find an owner, create or update
a contact (found by e-mail, so nobody is created twice), add a note and change a status. The queue and the retries
are in `sync.py`; the HTTP itself is in `http.py`.

Nothing here has been run against a real vendor account: every call follows the vendor's public API reference and is
tested against recorded-shape fakes. See the README section "CRM connectors" for what the owner has to check first.
"""
import re
import secrets
from urllib.parse import urlencode, urlsplit

from django.conf import settings

from . import http
from .errors import OAuthFailed

LEAD_FIELDS = ("first_name", "last_name", "email", "phone", "company", "message", "source", "card_name")
LEAD_STATUSES = ("new", "contacted", "qualified", "won", "lost")
CRM_FIELD_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{0,79}$")
MAX_VALUE = {"message": 4000}
DEFAULT_MAX = 255


def split_name(name):
    parts = (name or "").strip().split(None, 1)
    if len(parts) == 2:
        return parts[0], parts[1]
    return "", parts[0] if parts else ""


def lead_values(lead):
    """The values a lead can give to a CRM field, from the webhook-shaped snapshot of the lead."""
    first, last = split_name(lead.get("name", ""))
    return {
        "first_name": first, "last_name": last, "email": (lead.get("email") or "").strip().lower(),
        "phone": lead.get("phone", ""), "company": lead.get("company", ""), "message": lead.get("message", ""),
        "source": lead.get("source", ""), "card_name": lead.get("card_name", ""),
    }


def build_fields(mapping, values):
    out = {}
    for lead_field, crm_field in (mapping or {}).items():
        value = values.get(lead_field)
        if crm_field and value:
            out[crm_field] = str(value)[: MAX_VALUE.get(lead_field, DEFAULT_MAX)]
    return out


def soql_quote(value):
    return "'" + str(value).replace("\\", "\\\\").replace("'", "\\'") + "'"


class Vendor:
    key = ""
    label = ""
    default_mapping = {}
    default_status_map = {}
    status_field = ""

    # ---------------------------------------------------------------- set-up
    def client_id(self):
        return getattr(settings, f"{self.key.upper()}_CLIENT_ID", "")

    def client_secret(self):
        return getattr(settings, f"{self.key.upper()}_CLIENT_SECRET", "")

    def configured(self):
        return bool(self.client_id() and self.client_secret())

    def regions(self):
        return None

    def new_state_nonce(self):
        return secrets.token_urlsafe(16)

    def host_ok(self, conn=None):
        raise NotImplementedError

    def authorize_url(self, redirect_uri, state, region=""):
        raise NotImplementedError

    def token_url(self, region=""):
        raise NotImplementedError

    def token_form(self, grant, value, redirect_uri=""):
        form = {"grant_type": grant, "client_id": self.client_id(), "client_secret": self.client_secret()}
        if grant == "authorization_code":
            form.update(code=value, redirect_uri=redirect_uri)
        else:
            form.update(refresh_token=value)
        return form

    # ---------------------------------------------------------------- tokens
    def exchange(self, code, redirect_uri, region=""):
        """Trade the one-time code for tokens. Returns a dict with access_token, refresh_token, expires_in, instance_url, label."""
        res = http.call("POST", self.token_url(region), self.host_ok(), form=self.token_form("authorization_code", code, redirect_uri))
        data = res.data if isinstance(res.data, dict) else {}
        if res.status >= 400 or data.get("error") or not data.get("access_token"):
            raise OAuthFailed(str(data.get("error_description") or data.get("message") or data.get("error") or res.status)[:200])
        return self.after_exchange(data, region)

    def after_exchange(self, data, region):
        return {
            "access_token": data["access_token"], "refresh_token": data.get("refresh_token", ""),
            "expires_in": int(data.get("expires_in") or 1800), "instance_url": "", "label": self.label,
        }

    def refresh(self, conn, refresh_token):
        """New tokens from the refresh token. Raises AuthRevoked when the vendor says the grant is gone."""
        from .errors import AuthRevoked, Unavailable

        try:
            res = http.call("POST", self.token_url(conn.region), self.host_ok(conn), form=self.token_form("refresh_token", refresh_token))
        except http.NetworkError as exc:
            raise Unavailable(str(exc))
        data = res.data if isinstance(res.data, dict) else {}
        if res.status >= 500:
            raise Unavailable(f"The CRM answered {res.status}.")
        if res.status == 429:
            from .errors import RateLimited

            raise RateLimited("Too many token requests.", retry_after=60)
        if res.status >= 400 or data.get("error") or not data.get("access_token"):
            raise AuthRevoked(str(data.get("error_description") or data.get("error") or res.status)[:200])
        return {
            "access_token": data["access_token"], "refresh_token": data.get("refresh_token") or refresh_token,
            "expires_in": int(data.get("expires_in") or 1800),
        }

    def revoke(self, conn, refresh_token, access_token):
        """Tell the vendor to forget the grant. The caller ignores any failure: the local copy is deleted anyway."""
        raise NotImplementedError

    def auth_header(self, token):
        return {"Authorization": f"Bearer {token}"}

    # ---------------------------------------------------------------- the work (implemented per vendor)
    def find_owner(self, s, email):
        return None

    def upsert(self, s, fields, email, owner_id, status_value, values):
        """Create or update the contact. Returns (remote id, remote type, "created" or "updated")."""
        raise NotImplementedError

    def add_note(self, s, remote_id, remote_type, text):
        raise NotImplementedError

    def set_status(self, s, remote_id, remote_type, value):
        raise NotImplementedError

    def find_by_email(self, s, email):
        """(remote id, remote type) of the record with this e-mail, or None."""
        raise NotImplementedError


# ---------------------------------------------------------------- HubSpot
class HubSpot(Vendor):
    key, label = "hubspot", "HubSpot"
    API = "https://api.hubapi.com"
    default_mapping = {
        "first_name": "firstname", "last_name": "lastname", "email": "email", "phone": "phone", "company": "company",
    }
    default_status_map = {
        "new": "NEW", "contacted": "ATTEMPTED_TO_CONTACT", "qualified": "OPEN", "won": "OPEN_DEAL", "lost": "UNQUALIFIED",
    }
    status_field = "hs_lead_status"
    SCOPES = "oauth crm.objects.contacts.read crm.objects.contacts.write crm.objects.owners.read"

    def host_ok(self, conn=None):
        return lambda host: host == "api.hubapi.com"

    def authorize_url(self, redirect_uri, state, region=""):
        query = urlencode({
            "client_id": self.client_id(), "redirect_uri": redirect_uri, "scope": self.SCOPES, "state": state,
        })
        return f"https://app.hubspot.com/oauth/authorize?{query}"

    def token_url(self, region=""):
        return f"{self.API}/oauth/v1/token"

    def after_exchange(self, data, region):
        out = super().after_exchange(data, region)
        try:
            info = http.call("GET", f"{self.API}/oauth/v1/access-tokens/{data['access_token']}", self.host_ok())
            if isinstance(info.data, dict):
                out["label"] = str(info.data.get("hub_domain") or info.data.get("hub_id") or "HubSpot")[:200]
        except http.NetworkError:
            pass
        return out

    def revoke(self, conn, refresh_token, access_token):
        if refresh_token:
            http.call("DELETE", f"{self.API}/oauth/v1/refresh-tokens/{refresh_token}", self.host_ok(conn))

    def find_owner(self, s, email):
        res = s.request("GET", f"{self.API}/crm/v3/owners", params={"email": email, "limit": 1})
        rows = (res.data or {}).get("results") or []
        return str(rows[0]["id"]) if rows else None

    def find_by_email(self, s, email):
        res = s.request("POST", f"{self.API}/crm/v3/objects/contacts/search", json={
            "filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": email}]}],
            "properties": ["email"], "limit": 1,
        })
        rows = (res.data or {}).get("results") or []
        return (str(rows[0]["id"]), "contact") if rows else None

    def upsert(self, s, fields, email, owner_id, status_value, values):
        props = dict(fields)
        if owner_id:
            props["hubspot_owner_id"] = owner_id
        if status_value:
            props[self.status_field] = status_value
        found = self.find_by_email(s, email) if email else None
        if found:
            s.request("PATCH", f"{self.API}/crm/v3/objects/contacts/{found[0]}", json={"properties": props})
            return found[0], "contact", "updated"
        res = s.request("POST", f"{self.API}/crm/v3/objects/contacts", json={"properties": props}, conflict_retry=True)
        return str((res.data or {})["id"]), "contact", "created"

    def add_note(self, s, remote_id, remote_type, text):
        from django.utils import timezone

        s.request("POST", f"{self.API}/crm/v3/objects/notes", json={
            "properties": {"hs_note_body": text, "hs_timestamp": int(timezone.now().timestamp() * 1000)},
            "associations": [{
                "to": {"id": remote_id},
                "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 202}],
            }],
        })

    def set_status(self, s, remote_id, remote_type, value):
        s.request("PATCH", f"{self.API}/crm/v3/objects/contacts/{remote_id}", json={"properties": {self.status_field: value}})


# ---------------------------------------------------------------- Salesforce
SALESFORCE_HOST = re.compile(r"^[a-z0-9][a-z0-9.-]*\.(salesforce\.com|force\.com|cloudforce\.com)$")


class Salesforce(Vendor):
    key, label = "salesforce", "Salesforce"
    VERSION = "v60.0"
    default_mapping = {
        "first_name": "FirstName", "last_name": "LastName", "email": "Email", "phone": "Phone", "company": "Company",
        "message": "Description",
    }
    default_status_map = {
        "new": "Open - Not Contacted", "contacted": "Working - Contacted", "qualified": "Qualified",
        "won": "Qualified", "lost": "Closed - Not Converted",
    }
    status_field = "Status"

    def login_url(self):
        return getattr(settings, "SALESFORCE_LOGIN_URL", "https://login.salesforce.com").rstrip("/")

    def host_ok(self, conn=None):
        login_host = (urlsplit(self.login_url()).hostname or "").lower()
        instance_host = (urlsplit(conn.instance_url).hostname or "").lower() if conn is not None and conn.instance_url else ""

        def ok(host):
            return bool(SALESFORCE_HOST.match(host)) and (host == login_host or (instance_host and host == instance_host))

        return ok

    def valid_instance(self, url):
        parts = urlsplit(url or "")
        return parts.scheme == "https" and bool(SALESFORCE_HOST.match((parts.hostname or "").lower())) and not parts.path.strip("/")

    def authorize_url(self, redirect_uri, state, region=""):
        query = urlencode({
            "response_type": "code", "client_id": self.client_id(), "redirect_uri": redirect_uri,
            "scope": "api refresh_token", "state": state,
        })
        return f"{self.login_url()}/services/oauth2/authorize?{query}"

    def token_url(self, region=""):
        return f"{self.login_url()}/services/oauth2/token"

    def after_exchange(self, data, region):
        out = super().after_exchange(data, region)
        instance = str(data.get("instance_url") or "").rstrip("/")
        if not self.valid_instance(instance):
            raise OAuthFailed("The answer named an address that is not a Salesforce address.")
        out.update(instance_url=instance, label=urlsplit(instance).hostname, expires_in=int(data.get("expires_in") or 1800))
        return out

    def revoke(self, conn, refresh_token, access_token):
        token = refresh_token or access_token
        if token:
            http.call("POST", f"{self.login_url()}/services/oauth2/revoke", self.host_ok(conn), form={"token": token})

    def base(self, s):
        return f"{s.conn.instance_url}/services/data/{self.VERSION}"

    def soql(self, s, query):
        res = s.request("GET", f"{self.base(s)}/query", params={"q": query})
        return (res.data or {}).get("records") or []

    def find_owner(self, s, email):
        rows = self.soql(s, f"SELECT Id FROM User WHERE Email = {soql_quote(email)} AND IsActive = true LIMIT 1")
        return rows[0]["Id"] if rows else None

    def find_by_email(self, s, email):
        rows = self.soql(s, f"SELECT Id FROM Lead WHERE Email = {soql_quote(email)} AND IsConverted = false ORDER BY CreatedDate DESC LIMIT 1")
        if rows:
            return rows[0]["Id"], "Lead"
        rows = self.soql(s, f"SELECT Id FROM Contact WHERE Email = {soql_quote(email)} LIMIT 1")
        return (rows[0]["Id"], "Contact") if rows else None

    def upsert(self, s, fields, email, owner_id, status_value, values):
        found = self.find_by_email(s, email) if email else None
        if found and found[1] == "Contact":
            return found[0], "Contact", "updated"  # an existing contact is never overwritten or duplicated
        props = dict(fields)
        if owner_id:
            props["OwnerId"] = owner_id
        if status_value:
            props[self.status_field] = status_value
        if found:
            s.request("PATCH", f"{self.base(s)}/sobjects/Lead/{found[0]}", json=props)
            return found[0], "Lead", "updated"
        props.setdefault("LastName", values.get("last_name") or values.get("first_name") or email or "Unknown")
        props.setdefault("Company", values.get("company") or "[not provided]")
        res = s.request("POST", f"{self.base(s)}/sobjects/Lead", json=props)
        return str((res.data or {})["id"]), "Lead", "created"

    def add_note(self, s, remote_id, remote_type, text):
        s.request("POST", f"{self.base(s)}/sobjects/Task", json={
            "Subject": text.split("\n", 1)[0][:250], "Description": text, "Status": "Completed", "WhoId": remote_id,
        })

    def set_status(self, s, remote_id, remote_type, value):
        if remote_type != "Lead":
            return
        s.request("PATCH", f"{self.base(s)}/sobjects/Lead/{remote_id}", json={self.status_field: value})


# ---------------------------------------------------------------- Zoho CRM
class Zoho(Vendor):
    key, label = "zoho", "Zoho CRM"
    default_mapping = {
        "first_name": "First_Name", "last_name": "Last_Name", "email": "Email", "phone": "Phone", "company": "Company",
        "message": "Description",
    }
    default_status_map = {
        "new": "Not Contacted", "contacted": "Contacted", "qualified": "Pre-Qualified", "won": "Pre-Qualified",
        "lost": "Lost Lead",
    }
    status_field = "Lead_Status"
    SCOPES = "ZohoCRM.modules.leads.ALL,ZohoCRM.modules.notes.CREATE,ZohoCRM.users.READ"

    def regions(self):
        return list(getattr(settings, "ZOHO_REGIONS", ["com", "eu", "in"]))

    def host_ok(self, conn=None):
        regions = self.regions()
        allowed = {f"accounts.zoho.{r}" for r in regions} | {f"www.zohoapis.{r}" for r in regions}
        return lambda host: host in allowed

    def valid_region(self, region):
        return region in self.regions()

    def valid_api(self, url):
        parts = urlsplit(url or "")
        return parts.scheme == "https" and (parts.hostname or "").lower() in {f"www.zohoapis.{r}" for r in self.regions()} and not parts.path.strip("/")

    def authorize_url(self, redirect_uri, state, region=""):
        query = urlencode({
            "scope": self.SCOPES, "client_id": self.client_id(), "response_type": "code", "access_type": "offline",
            "redirect_uri": redirect_uri, "state": state, "prompt": "consent",
        })
        return f"https://accounts.zoho.{region}/oauth/v2/auth?{query}"

    def token_url(self, region=""):
        return f"https://accounts.zoho.{region}/oauth/v2/token"

    def after_exchange(self, data, region):
        out = super().after_exchange(data, region)
        api = str(data.get("api_domain") or f"https://www.zohoapis.{region}").rstrip("/")
        if not self.valid_api(api):
            raise OAuthFailed("The answer named an address that is not a Zoho address.")
        out.update(instance_url=api, label=f"Zoho CRM ({region})")
        return out

    def revoke(self, conn, refresh_token, access_token):
        token = refresh_token or access_token
        if token:
            http.call("POST", f"https://accounts.zoho.{conn.region}/oauth/v2/token/revoke", self.host_ok(conn), params={"token": token})

    def auth_header(self, token):
        return {"Authorization": f"Zoho-oauthtoken {token}"}

    def base(self, s):
        return f"{s.conn.instance_url}/crm/v6"

    def find_owner(self, s, email):
        res = s.request("GET", f"{self.base(s)}/users/search", params={"email": email})
        rows = (res.data or {}).get("users") or []
        return str(rows[0]["id"]) if rows else None

    def find_by_email(self, s, email):
        res = s.request("GET", f"{self.base(s)}/Leads/search", params={"email": email})
        rows = (res.data or {}).get("data") or []
        return (str(rows[0]["id"]), "Leads") if rows else None

    def _check_row(self, res):
        from .errors import Rejected

        rows = (res.data or {}).get("data") or []
        row = rows[0] if rows else {}
        if str(row.get("status", "success")).lower() == "error" or str(row.get("code", "SUCCESS")).upper() not in ("SUCCESS",):
            raise Rejected(str(row.get("message") or row.get("code") or "The CRM refused the data.")[:250])
        return row

    def upsert(self, s, fields, email, owner_id, status_value, values):
        props = dict(fields)
        if owner_id:
            props["Owner"] = {"id": owner_id}
        if status_value:
            props[self.status_field] = status_value
        props.setdefault("Last_Name", values.get("last_name") or values.get("first_name") or email or "Unknown")
        if email:
            res = s.request("POST", f"{self.base(s)}/Leads/upsert", json={"data": [props], "duplicate_check_fields": ["Email"]})
            row = self._check_row(res)
            action = "updated" if str(row.get("action", "")).lower() == "update" else "created"
        else:
            res = s.request("POST", f"{self.base(s)}/Leads", json={"data": [props]})
            row, action = self._check_row(res), "created"
        return str((row.get("details") or {}).get("id")), "Leads", action

    def add_note(self, s, remote_id, remote_type, text):
        res = s.request("POST", f"{self.base(s)}/Notes", json={"data": [{
            "Note_Title": text.split("\n", 1)[0][:120], "Note_Content": text,
            "Parent_Id": {"module": {"api_name": "Leads"}, "id": remote_id},
        }]})
        self._check_row(res)

    def set_status(self, s, remote_id, remote_type, value):
        res = s.request("PUT", f"{self.base(s)}/Leads/{remote_id}", json={"data": [{self.status_field: value}]})
        self._check_row(res)


VENDOR_CLASSES = {"hubspot": HubSpot, "salesforce": Salesforce, "zoho": Zoho}


def get_vendor(key):
    cls = VENDOR_CLASSES.get(key)
    return cls() if cls else None
