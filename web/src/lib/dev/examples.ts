// Code examples of the developer guide. They stay in English and left to right in every language.
import { API_PUBLIC_URL } from "../config";
import { tk, type MessageKey } from "../i18n";

/** The public API address: the same host as the app's API, under /api/public/v1. */
export const PUBLIC_API_URL = API_PUBLIC_URL.replace(/\/api\/v1$/, "") + "/api/public/v1";

export const QUICK_CURL = `curl ${PUBLIC_API_URL}/cards \\
  -H "Authorization: Bearer YOUR_API_KEY"`;

export const ERROR_EXAMPLE = `HTTP/1.1 403 Forbidden
{
  "error": {
    "code": "insufficient_scope",
    "message": "This API key does not have the 'cards:write' permission.",
    "request_id": "req_6f1c0a9d2b7e4f3a8c10"
  }
}`;

export const LIMIT_HEADERS = `X-RateLimit-Limit: 120
X-RateLimit-Remaining: 117
X-RateLimit-Reset: 41          (seconds until the minute window ends)
X-RateLimit-Daily-Limit: 5000
X-RateLimit-Daily-Remaining: 4890
Retry-After: 41                (only on 429)`;

export const PAGE_EXAMPLE = `GET /api/public/v1/leads?limit=2
{ "data": [ ... ], "has_more": true, "next_cursor": "eyJ0Ijoi..." }

GET /api/public/v1/leads?limit=2&cursor=eyJ0Ijoi...`;

export const IDEM_EXAMPLE = `curl -X POST ${PUBLIC_API_URL}/invites \\
  -H "Authorization: Bearer YOUR_API_KEY" \\
  -H "Idempotency-Key: 7d1c3a52-invite-sara" \\
  -H "Content-Type: application/json" \\
  -d '{"invites":[{"email":"sara@example.com","full_name":"Sara Haddad"}]}'`;

export const ETAG_EXAMPLE = `curl -i ${PUBLIC_API_URL}/members -H "Authorization: Bearer YOUR_API_KEY"
# ETag: "9a0364b9e99bb480dd25e1f0284c8555"
curl -i ${PUBLIC_API_URL}/members -H "Authorization: Bearer YOUR_API_KEY" \\
  -H 'If-None-Match: "9a0364b9e99bb480dd25e1f0284c8555"'
# HTTP/1.1 304 Not Modified`;

export type Endpoint = { method: string; path: string; scope: string | null; text: MessageKey; example: string };

const AUTH = `-H "Authorization: Bearer YOUR_API_KEY"`;
const JSON_H = `-H "Content-Type: application/json"`;

export const ENDPOINTS: Endpoint[] = [
  { method: "GET", path: "/me", scope: null, text: tk("dev.g.ep.me"), example: `curl ${PUBLIC_API_URL}/me ${AUTH}` },
  { method: "GET", path: "/cards", scope: "cards:read", text: tk("dev.g.ep.cardsList"), example: `curl "${PUBLIC_API_URL}/cards?status=published&limit=10" ${AUTH}` },
  { method: "POST", path: "/cards", scope: "cards:write", text: tk("dev.g.ep.cardsCreate"), example: `curl -X POST ${PUBLIC_API_URL}/cards ${AUTH} ${JSON_H} \\\n  -d '{"member_email":"sara@example.com","title":"Sales manager","items":[{"kind":"Mobile","value":"+97455550100"}]}'` },
  { method: "GET", path: "/cards/{id}", scope: "cards:read", text: tk("dev.g.ep.cardGet"), example: `curl ${PUBLIC_API_URL}/cards/CARD_ID ${AUTH}` },
  { method: "PATCH", path: "/cards/{id}", scope: "cards:write", text: tk("dev.g.ep.cardPatch"), example: `curl -X PATCH ${PUBLIC_API_URL}/cards/CARD_ID ${AUTH} ${JSON_H} \\\n  -d '{"title":"Head of sales"}'` },
  { method: "POST", path: "/cards/{id}/publish", scope: "cards:write", text: tk("dev.g.ep.publish"), example: `curl -X POST ${PUBLIC_API_URL}/cards/CARD_ID/publish ${AUTH}` },
  { method: "POST", path: "/cards/{id}/unpublish", scope: "cards:write", text: tk("dev.g.ep.unpublish"), example: `curl -X POST ${PUBLIC_API_URL}/cards/CARD_ID/unpublish ${AUTH}` },
  { method: "GET", path: "/members", scope: "team:read", text: tk("dev.g.ep.membersList"), example: `curl "${PUBLIC_API_URL}/members?status=active" ${AUTH}` },
  { method: "GET", path: "/members/{id}", scope: "team:read", text: tk("dev.g.ep.memberGet"), example: `curl ${PUBLIC_API_URL}/members/MEMBER_ID ${AUTH}` },
  { method: "POST", path: "/invites", scope: "team:write", text: tk("dev.g.ep.invites"), example: IDEM_EXAMPLE },
  { method: "POST", path: "/members/{id}/suspend", scope: "team:write", text: tk("dev.g.ep.suspend"), example: `curl -X POST ${PUBLIC_API_URL}/members/MEMBER_ID/suspend ${AUTH}` },
  { method: "POST", path: "/members/{id}/restore", scope: "team:write", text: tk("dev.g.ep.restore"), example: `curl -X POST ${PUBLIC_API_URL}/members/MEMBER_ID/restore ${AUTH}` },
  { method: "DELETE", path: "/members/{id}", scope: "team:write", text: tk("dev.g.ep.remove"), example: `curl -X DELETE "${PUBLIC_API_URL}/members/MEMBER_ID?card=keep" ${AUTH}` },
  { method: "GET", path: "/leads", scope: "leads:read", text: tk("dev.g.ep.leadsList"), example: `curl "${PUBLIC_API_URL}/leads?status=new&created_after=2026-11-01T00:00:00Z" ${AUTH}` },
  { method: "GET", path: "/leads/{id}", scope: "leads:read", text: tk("dev.g.ep.leadGet"), example: `curl ${PUBLIC_API_URL}/leads/LEAD_ID ${AUTH}` },
  { method: "PATCH", path: "/leads/{id}", scope: "leads:write", text: tk("dev.g.ep.leadPatch"), example: `curl -X PATCH ${PUBLIC_API_URL}/leads/LEAD_ID ${AUTH} ${JSON_H} \\\n  -d '{"status":"qualified","assignee_email":"sara@example.com"}'` },
  { method: "GET", path: "/analytics/summary", scope: "analytics:read", text: tk("dev.g.ep.anSummary"), example: `curl "${PUBLIC_API_URL}/analytics/summary?days=30&tz=Asia/Qatar" ${AUTH}` },
  { method: "GET", path: "/analytics/cards", scope: "analytics:read", text: tk("dev.g.ep.anCards"), example: `curl "${PUBLIC_API_URL}/analytics/cards?days=7" ${AUTH}` },
  { method: "GET", path: "/analytics/cards/{id}", scope: "analytics:read", text: tk("dev.g.ep.anCard"), example: `curl "${PUBLIC_API_URL}/analytics/cards/CARD_ID?days=7" ${AUTH}` },
];
