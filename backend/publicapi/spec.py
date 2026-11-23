"""The OpenAPI 3.1 document of the public API, built from the operation list below.

`tests/test_public_api_spec.py` checks that every route and its scope here match the real views, so the document
cannot drift away from the code."""
from django.conf import settings

from .base import API_VERSION, DEFAULT_LIMIT, MAX_LIMIT
from .models import SCOPES, SCOPE_HELP

CHANGELOG = [
    {"version": "v1", "date": "2026-11-22", "changes": [
        "First release: cards, team, contacts and analytics with API keys, cursor pagination, ETag and Idempotency-Key.",
    ]},
]

STATUS_ENUM = ["new", "contacted", "qualified", "won", "lost"]


def ref(name):
    return {"$ref": f"#/components/schemas/{name}"}


def _obj(properties, required=None, **extra):
    schema = {"type": "object", "properties": properties}
    if required:
        schema["required"] = required
    schema.update(extra)
    return schema


def _s(**kw):
    return {"type": "string", **kw}


def schemas():
    uuid_s = _s(format="uuid")
    nullable_s = {"type": ["string", "null"]}
    item = _obj({
        "id": uuid_s, "kind": _s(), "value": _s(), "label": _s(), "on": {"type": "boolean"},
        "order": {"type": "integer"}, "icon": {"type": ["object", "null"]},
    }, ["kind", "value"])
    item_in = _obj({"id": uuid_s, "kind": _s(), "value": _s(), "label": _s(), "on": {"type": "boolean"}}, ["kind"])
    card_fields = {
        "name": _s(maxLength=120), "title": _s(maxLength=120), "company": _s(maxLength=120), "address": _s(maxLength=300),
        "save_contact": {"type": "boolean"}, "language": _s(enum=["en", "ar", "auto"]),
        "hide_from_directory": {"type": "boolean"}, "seo_indexable": {"type": "boolean"}, "slug": nullable_s,
        "vc": _obj({}, description="vCard options"), "features": _obj({}, description="Feature switches of the card page"),
        "design": _obj({}, description="Design keys. A locked company design wins over these."),
        "items": {"type": "array", "items": item_in, "description": "The full list of buttons: it replaces the current list."},
    }
    return {
        "Error": _obj({
            "error": _obj({
                "code": _s(description="A stable machine-readable code"), "message": _s(),
                "fields": {"type": "object", "additionalProperties": {"type": "array", "items": _s()}},
                "request_id": _s(),
            }, ["code", "message"]),
        }, ["error"]),
        "Card": _obj({
            "id": uuid_s, "workspace_id": uuid_s, "public_code": _s(), "public_url": _s(format="uri"), "slug": nullable_s,
            "status": _s(enum=["draft", "published", "suspended"]),
            **{k: v for k, v in card_fields.items() if k not in ("items", "slug")},
            "photo_url": nullable_s, "cover_url": nullable_s, "items": {"type": "array", "items": item},
            "member": {"oneOf": [_obj({"id": uuid_s, "email": _s(format="email"), "full_name": _s()}), {"type": "null"}]},
            "created_at": _s(format="date-time"), "updated_at": _s(format="date-time"),
            "stats": _obj({k: {"type": "integer"} for k in ("views", "scans", "saves", "leads")}),
        }, ["id", "status", "name"]),
        "CardCreate": _obj({"member_email": _s(format="email"), **card_fields}, ["member_email"]),
        "CardUpdate": _obj(card_fields, description="Send only the fields to change."),
        "Member": _obj({
            "id": uuid_s, "email": _s(format="email"), "full_name": _s(), "title": _s(),
            "role": _s(enum=["owner", "admin", "employee"]), "status": _s(enum=["invited", "active", "suspended"]),
            "department": {"oneOf": [_obj({"id": uuid_s, "name": _s()}), {"type": "null"}]},
            "card_id": {"type": ["string", "null"], "format": "uuid"},
            "invited_at": _s(format="date-time"), "joined_at": {"type": ["string", "null"], "format": "date-time"},
        }, ["id", "email", "role", "status"]),
        "InviteRequest": _obj({
            "invites": {"type": "array", "minItems": 1, "maxItems": 50, "items": _obj({
                "email": _s(format="email"), "full_name": _s(), "title": _s(), "role": _s(enum=["employee"]),
                "language": _s(enum=["", "en", "ar"]), "department_id": {"type": ["string", "null"], "format": "uuid"},
            }, ["email"])},
        }, ["invites"]),
        "Lead": _obj({
            "id": uuid_s, "name": _s(), "email": _s(), "phone": _s(), "company": _s(), "message": _s(),
            "source": _s(), "channel": _s(), "status": _s(enum=STATUS_ENUM), "meeting_times": {"type": "array", "items": _s()},
            "card_id": {"type": ["string", "null"], "format": "uuid"}, "card_name": _s(),
            "assignee": {"oneOf": [_obj({"id": uuid_s, "name": _s(), "email": _s()}), {"type": "null"}]},
            "consent": _obj({"given": {"type": "boolean"}, "at": {"type": ["string", "null"], "format": "date-time"}}),
            "created_at": _s(format="date-time"),
        }, ["id", "name", "status"]),
        "LeadUpdate": _obj({
            "status": _s(enum=STATUS_ENUM), "assignee_id": {"type": ["string", "null"], "format": "uuid"},
            "assignee_email": {"type": ["string", "null"], "format": "email"},
        }),
        "Totals": _obj({k: {"type": "integer"} for k in (
            "views", "unique_visitors", "scans", "taps", "saves", "leads", "link_clicks")}),
        "Period": _obj({"from": _s(format="date"), "to": _s(format="date"), "days": {"type": "integer"}, "tz": _s()}),
        "AnalyticsSummary": _obj({"period": ref("Period"), "totals": ref("Totals"), "previous_totals": ref("Totals")}),
        "AnalyticsCardRow": _obj({
            "card_id": uuid_s, "name": _s(), "status": _s(), **{k: {"type": "integer"} for k in (
                "views", "scans", "saves", "link_clicks", "leads")},
        }),
        "AnalyticsCards": _obj({"period": ref("Period"), "data": {"type": "array", "items": ref("AnalyticsCardRow")}}),
        "AnalyticsCard": _obj({
            "period": ref("Period"), "card_id": uuid_s, "name": _s(), "totals": ref("Totals"), "previous_totals": ref("Totals"),
        }),
        "Me": _obj({
            "workspace": _obj({"id": uuid_s, "name": _s()}),
            "key": _obj({
                "id": uuid_s, "name": _s(), "prefix": _s(), "scopes": {"type": "array", "items": _s(enum=list(SCOPES))},
                "expires_at": {"type": ["string", "null"], "format": "date-time"},
                "rate_limit": _obj({"per_minute": {"type": "integer"}, "per_day": {"type": "integer"}}),
            }),
        }),
        **{f"{name}Page": _obj({
            "data": {"type": "array", "items": ref(name)}, "has_more": {"type": "boolean"},
            "next_cursor": {"type": ["string", "null"]},
        }, ["data", "has_more", "next_cursor"]) for name in ("Card", "Member", "Lead")},
    }


def _param(name, where, description, schema=None, required=False):
    return {"name": name, "in": where, "required": required, "description": description, "schema": schema or _s()}


PAGING = [
    _param("limit", "query", f"Items per page, 1 to {MAX_LIMIT} (default {DEFAULT_LIMIT}).", {"type": "integer", "minimum": 1, "maximum": MAX_LIMIT}),
    _param("cursor", "query", "The next_cursor of the previous page."),
]
WINDOW = [
    _param("days", "query", "The last N days including today (1 to 365).", {"type": "integer"}),
    _param("from", "query", "First day, YYYY-MM-DD.", _s(format="date")),
    _param("to", "query", "Last day, YYYY-MM-DD.", _s(format="date")),
    _param("tz", "query", "IANA time zone used to cut days, for example Asia/Qatar (default UTC)."),
]
ID = lambda name: _param(name, "path", "The id.", _s(format="uuid"), True)  # noqa: E731

# (method, path, operation id, tag, summary, scope, parameters, request schema, success status, response schema)
OPERATIONS = [
    ("get", "/me", "getMe", "Account", "Describe the key and its company", None, [], None, 200, "Me"),
    ("get", "/cards", "listCards", "Cards", "List cards", "cards:read",
     PAGING + [_param("status", "query", "draft, published or suspended", _s(enum=["draft", "published", "suspended"])),
               _param("member_email", "query", "Only the card of this team member.")], None, 200, "CardPage"),
    ("post", "/cards", "createCard", "Cards", "Create a card for a team member", "cards:write", [], "CardCreate", 201, "Card"),
    ("get", "/cards/{card_id}", "getCard", "Cards", "Get a card", "cards:read", [ID("card_id")], None, 200, "Card"),
    ("patch", "/cards/{card_id}", "updateCard", "Cards", "Change a card", "cards:write", [ID("card_id")], "CardUpdate", 200, "Card"),
    ("post", "/cards/{card_id}/publish", "publishCard", "Cards", "Publish a card", "cards:write", [ID("card_id")], None, 200, "Card"),
    ("post", "/cards/{card_id}/unpublish", "unpublishCard", "Cards", "Unpublish a card", "cards:write", [ID("card_id")], None, 200, "Card"),
    ("get", "/members", "listMembers", "Team", "List team members", "team:read",
     PAGING + [_param("status", "query", "invited, active or suspended"), _param("role", "query", "owner, admin or employee"),
               _param("email", "query", "Exact e-mail address")], None, 200, "MemberPage"),
    ("get", "/members/{member_id}", "getMember", "Team", "Get a team member", "team:read", [ID("member_id")], None, 200, "Member"),
    ("post", "/invites", "inviteMembers", "Team", "Invite employees", "team:write", [], "InviteRequest", 201, "MemberList"),
    ("post", "/members/{member_id}/suspend", "suspendMember", "Team", "Suspend an employee", "team:write", [ID("member_id")], None, 200, "Member"),
    ("post", "/members/{member_id}/restore", "restoreMember", "Team", "Restore a suspended employee", "team:write", [ID("member_id")], None, 200, "Member"),
    ("delete", "/members/{member_id}", "removeMember", "Team", "Remove an employee", "team:write",
     [ID("member_id"), _param("card", "query", "keep (default) or delete", _s(enum=["keep", "delete"]))], None, 204, None),
    ("get", "/leads", "listLeads", "Contacts", "List contacts", "leads:read",
     PAGING + [_param("status", "query", "One or more of " + ", ".join(STATUS_ENUM) + ", comma separated."),
               _param("card_id", "query", "Only contacts of this card.", _s(format="uuid")),
               _param("source", "query", "For example exchange or meeting_request."),
               _param("assignee_email", "query", "Only contacts given to this team member."),
               _param("email", "query", "Exact e-mail address of the contact."),
               _param("created_after", "query", "ISO 8601 time.", _s(format="date-time")),
               _param("created_before", "query", "ISO 8601 time.", _s(format="date-time"))], None, 200, "LeadPage"),
    ("get", "/leads/{lead_id}", "getLead", "Contacts", "Get a contact", "leads:read", [ID("lead_id")], None, 200, "Lead"),
    ("patch", "/leads/{lead_id}", "updateLead", "Contacts", "Change a contact's status or owner", "leads:write", [ID("lead_id")], "LeadUpdate", 200, "Lead"),
    ("get", "/analytics/summary", "analyticsSummary", "Analytics", "Totals for the whole company", "analytics:read", WINDOW, None, 200, "AnalyticsSummary"),
    ("get", "/analytics/cards", "analyticsCards", "Analytics", "Numbers for every card", "analytics:read", WINDOW, None, 200, "AnalyticsCards"),
    ("get", "/analytics/cards/{card_id}", "analyticsCard", "Analytics", "Numbers for one card", "analytics:read", WINDOW + [ID("card_id")], None, 200, "AnalyticsCard"),
]

ERROR_RESPONSES = {
    "400": "validation_error: the request was not valid; `fields` names the problems.",
    "401": "missing_api_key, invalid_api_key, key_revoked or key_expired.",
    "402": "subscription_required: the company has no active plan.",
    "403": "insufficient_scope, ip_not_allowed, field_locked, approval_required, plan_limit or forbidden.",
    "404": "not_found: no such item in this company.",
    "409": "A conflict, for example card_exists or idempotency_in_progress.",
    "422": "idempotency_key_reused: the key was used with a different request.",
    "429": "throttled: too many requests; see Retry-After.",
}


def build(server_url):
    paths = {}
    for method, path, op_id, tag, summary, scope, params, body, status, response in OPERATIONS:
        op = {
            "operationId": op_id, "tags": [tag], "summary": summary,
            "security": [{"bearerAuth": [scope]}] if scope else [{"bearerAuth": []}],
            "x-required-scope": scope,
            "parameters": list(params),
            "responses": {},
        }
        if scope:
            op["description"] = f"Needs the `{scope}` permission."
        if method == "get":
            op["parameters"] = op["parameters"] + [{"$ref": "#/components/parameters/IfNoneMatch"}]
        if method == "post":
            op["parameters"] = op["parameters"] + [{"$ref": "#/components/parameters/IdempotencyKey"}]
        if body:
            op["requestBody"] = {"required": True, "content": {"application/json": {"schema": ref(body)}}}
        if response == "MemberList":
            content = {"application/json": {"schema": _obj({"data": {"type": "array", "items": ref("Member")}}, ["data"])}}
        elif response:
            content = {"application/json": {"schema": ref(response)}}
        else:
            content = None
        success = {"description": "Success."}
        if content:
            success["content"] = content
            success["headers"] = {"ETag": {"schema": _s(), "description": "Send it back as If-None-Match to get 304 when nothing changed."}} if method == "get" else {}
        op["responses"][str(status)] = success
        if method == "get":
            op["responses"]["304"] = {"description": "Not modified (the If-None-Match value is still current)."}
        for code, text in ERROR_RESPONSES.items():
            if code == "422" and method != "post":
                continue
            op["responses"][code] = {"description": text, "content": {"application/json": {"schema": ref("Error")}}}
        paths.setdefault(path, {})[method] = op
    return {
        "openapi": "3.1.0",
        "info": {
            "title": f"{settings.PRODUCT_NAME} Public API", "version": API_VERSION,
            "summary": "Cards, team, contacts and analytics of one company.",
            "description": (
                "Every request needs `Authorization: Bearer <API key>`. A key belongs to one company and carries scopes; "
                "it can never see another company. Lists use cursor pagination; reads support ETag; POST supports "
                "Idempotency-Key (24 hours). Webhooks are separate: they are signed with `X-BENCH-Signature` (see the developer guide)."
            ),
            "x-changelog": CHANGELOG,
        },
        "servers": [{"url": server_url}],
        "tags": [{"name": n} for n in ("Account", "Cards", "Team", "Contacts", "Analytics")],
        "paths": paths,
        "components": {
            "securitySchemes": {"bearerAuth": {
                "type": "http", "scheme": "bearer", "description": "An API key made in Settings > Developers.",
            }},
            "parameters": {
                "IfNoneMatch": {"name": "If-None-Match", "in": "header", "required": False, "schema": _s(),
                                "description": "An ETag from an earlier answer."},
                "IdempotencyKey": {"name": "Idempotency-Key", "in": "header", "required": False, "schema": _s(maxLength=200),
                                   "description": "Any unique string. Repeating the request with the same key returns the first answer."},
            },
            "schemas": schemas(),
        },
        "x-scopes": {s: SCOPE_HELP[s] for s in SCOPES},
    }
