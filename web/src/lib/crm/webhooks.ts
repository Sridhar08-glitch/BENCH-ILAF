// Plain-words help for webhooks: event names, a sample payload and how to check the signature.
import type { Delivery, WebhookEvent } from "./types";

export const EVENTS: { k: WebhookEvent; t: string; d: string }[] = [
  { k: "lead.created", t: "New lead", d: "Someone shared their details, asked for a meeting, or a card was scanned." },
  { k: "lead.updated", t: "Lead changed", d: "The status of a lead changed." },
  { k: "lead.assigned", t: "Lead assigned", d: "A lead was given to a colleague or taken back." },
];

export const SAMPLE_PAYLOAD = `{
  "id": "5b0f6c3e-2f1a-4c7e-9b5e-0d6c1c1f7a11",
  "type": "lead.created",
  "created_at": "2026-11-22T09:30:00Z",
  "workspace_id": "c1f0b6f2-6a62-4a0e-8d1f-2d6f9d2b7e10",
  "data": {
    "lead": {
      "id": "0a3c9d52-93a9-4bd6-8b1c-5b7d1d0f2c44",
      "name": "Sara Haddad",
      "email": "sara@example.com",
      "phone": "+974 5555 0100",
      "company": "Haddad Trading",
      "message": "Please call me about a quote.",
      "source": "exchange",
      "channel": "qr",
      "status": "new",
      "meeting_times": [],
      "card_id": "7e2d1c53-4f6a-4d0e-a6a1-3c9b8e5f1a20",
      "card_name": "Omar Ali",
      "assignee": null,
      "consent": { "given": true, "at": "2026-11-22T09:30:00Z" },
      "created_at": "2026-11-22T09:30:00Z"
    }
  }
}`;

export const HEADERS: { name: string; d: string }[] = [
  { name: "X-BENCH-Signature", d: "sha256= followed by the HMAC-SHA256 of the timestamp, a dot and the raw body, made with your secret." },
  { name: "X-BENCH-Timestamp", d: "When the message was signed (seconds since 1970). Ignore messages older than five minutes." },
  { name: "X-BENCH-Event-Id", d: "A unique id. A retry carries the same id, so you can skip events you already handled." },
  { name: "X-BENCH-Event", d: "The event type, for example lead.created." },
];

export const VERIFY_NODE = `import crypto from "node:crypto";

// rawBody is the request body exactly as received (a string or Buffer).
export function isValid(rawBody, headers, secret) {
  const signed = headers["x-bench-timestamp"] + "." + rawBody;
  const expected = "sha256=" + crypto.createHmac("sha256", secret).update(signed).digest("hex");
  const got = headers["x-bench-signature"] || "";
  return got.length === expected.length && crypto.timingSafeEqual(Buffer.from(got), Buffer.from(expected));
}`;

export const VERIFY_PYTHON = `import hashlib, hmac

def is_valid(raw_body: bytes, headers: dict, secret: str) -> bool:
    signed = headers["X-BENCH-Timestamp"].encode() + b"." + raw_body
    expected = "sha256=" + hmac.new(secret.encode(), signed, hashlib.sha256).hexdigest()
    return hmac.compare_digest(headers["X-BENCH-Signature"], expected)`;

/** A quick check before the address goes to the server. The server does the real one. */
export function urlProblem(url: string): string | null {
  const v = url.trim();
  if (!v) return "Enter the address that should receive the events.";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "Enter a full web address, for example https://hooks.zapier.com/hooks/catch/123/abc";
  }
  if (u.protocol !== "https:") return "The address must start with https://";
  if (u.username || u.password) return "Remove the user name and password from the address.";
  return null;
}

/** The result of a send in a few words. */
export function deliveryText(d: Delivery): string {
  if (d.status === "success") return `Delivered (${d.response_status})`;
  if (d.status === "pending") return d.attempts ? `Will retry: ${d.error || "failed"}` : "Waiting to be sent";
  return d.error || `Failed (${d.response_status ?? "no answer"})`;
}
