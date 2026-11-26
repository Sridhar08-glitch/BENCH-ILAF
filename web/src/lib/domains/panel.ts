// The logic of the custom-domain panel on the Brand page: what the status means, what to show, what to tell the owner.
// Plain functions (no React) so they are tested; the screen only draws what they return.
import { tk, type MessageKey } from "@/lib/i18n";
import type { CustomDomainInfo, CustomDomainStatus, DnsRecord } from "@/lib/types";

export type Tone = "ok" | "warn" | "bad" | "muted";

const STATUS: Record<CustomDomainStatus, { label: MessageKey; tone: Tone }> = {
  pending: { label: tk("brand.domStatusPending"), tone: "warn" },
  failed: { label: tk("brand.domStatusFailed"), tone: "bad" },
  verified: { label: tk("brand.domStatusVerified"), tone: "ok" },
  expired: { label: tk("brand.domStatusExpired"), tone: "muted" },
  dns_broken: { label: tk("brand.domStatusBroken"), tone: "bad" },
};

export function statusInfo(status: CustomDomainStatus): { label: MessageKey; tone: Tone } {
  return STATUS[status] ?? STATUS.pending;
}

const REASONS: Record<string, MessageKey> = {
  txt_missing: tk("brand.domErrTxtMissing"),
  txt_mismatch: tk("brand.domErrTxtMismatch"),
  cname_missing: tk("brand.domErrCnameMissing"),
  cname_wrong: tk("brand.domErrCnameWrong"),
  dns_error: tk("brand.domErrDns"),
  domain_taken: tk("brand.domErrTaken"),
  dns_released: tk("brand.domErrReleased"),
};

/** The plain-language reason for the last failed check, or null when there is none. */
export function reasonKey(code: string | null | undefined): MessageKey | null {
  if (!code) return null;
  return REASONS[code] ?? tk("brand.domErrDns");
}

/** The DNS records to add, in the order to do them. A-records replace the CNAME for a bare domain (and only when the server offers addresses). */
export interface RecordRow {
  id: "txt" | "cname" | "a";
  record: DnsRecord;
  what: MessageKey;
}

export function recordRows(info: CustomDomainInfo): RecordRow[] {
  const { txt, cname, a, apex } = info.records;
  const rows: RecordRow[] = [{ id: "txt", record: txt, what: tk("brand.domRecTxt") }];
  if (apex && a.length > 0) a.forEach((record) => rows.push({ id: "a", record, what: tk("brand.domRecA") }));
  else rows.push({ id: "cname", record: cname, what: tk("brand.domRecCname") });
  return rows;
}

/** True when the name is a bare domain (example.com), where DNS does not allow a CNAME. */
export function needsApexHelp(info: CustomDomainInfo): boolean {
  return info.records.apex;
}

/** What the owner should do next. */
export type Step = "add_records" | "wait" | "fix" | "retry" | "done" | "repair";

export function nextStep(info: CustomDomainInfo): Step {
  switch (info.status) {
    case "verified": return "done";
    case "dns_broken": return "repair";
    case "expired": return "retry";
    case "failed": return info.last_error === "dns_error" ? "wait" : "fix";
    default: return "add_records";
  }
}

/** Whole days from `now` to an ISO date (0 when it has passed or is missing). */
export function daysLeft(iso: string | null | undefined, now: number = Date.now()): number {
  if (!iso) return 0;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.max(0, Math.ceil((t - now) / 86_400_000));
}

/** A quick check before the server's own: the server decides, this only saves a round trip for the obvious mistakes. */
export function domainProblem(raw: string): MessageKey | null {
  const v = raw.trim().toLowerCase();
  if (!v) return tk("brand.domProbEmpty");
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(v) || /[/?#@\s\\]/.test(v)) return tk("brand.domProbUrl");
  if (v.includes("*")) return tk("brand.domProbWildcard");
  if (/^[0-9.]+$/.test(v)) return tk("brand.domProbIp");
  if (v.includes(":")) return tk("brand.domProbPort");
  if (!v.replace(/\.$/, "").includes(".")) return tk("brand.domProbDot");
  return null;
}

/** What to put in the text field when an address was pasted with a scheme or path: "https://Cards.Acme.com/x" -> "cards.acme.com". */
export function tidyDomain(raw: string): string {
  let v = raw.trim().toLowerCase();
  v = v.replace(/^[a-z][a-z0-9+.-]*:\/\//, "");
  v = v.split(/[/?#]/)[0] ?? v;
  return v.replace(/\.$/, "");
}
