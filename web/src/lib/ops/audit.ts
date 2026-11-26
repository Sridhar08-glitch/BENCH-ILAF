// Pure logic for the Activity page: plain sentences for log entries, filters and the query they make.
import type { AuditEvent } from "../types";
import type { AuditQuery } from "../api";
import { fieldWordIn } from "./fields";
import { tk, type I18n, type MessageKey, type TFunction } from "../i18n";
import { APP_NAME } from "../config";

/** The groups offered in the action filter. A trailing dot matches the whole group. */
export const ACTION_GROUPS: { key: string; label: MessageKey }[] = [
  { key: "", label: tk("company.groupAll") },
  { key: "invite.", label: tk("company.groupInvites") },
  { key: "member.", label: tk("company.groupMembers") },
  { key: "card.", label: tk("company.groupCards") },
  { key: "brand.", label: tk("company.groupBrand") },
  { key: "department.", label: tk("company.groupDepartments") },
  { key: "fields.", label: tk("company.groupFields") },
  { key: "change.", label: tk("company.groupApprovals") },
  { key: "directory.", label: tk("company.groupDirectory") },
  { key: "bulk.", label: tk("company.groupBulk") },
  { key: "lead.", label: tk("company.groupContacts") },
  { key: "webhook.", label: tk("company.groupWebhooks") },
  { key: "apikey.", label: tk("dev.evGroupKeys") },
  { key: "crm.", label: tk("dev.evGroupCrm") },
  { key: "company.", label: tk("company.groupCompany") },
  { key: "support.", label: tk("company.groupSupport") },
];

export interface AuditFilters {
  actor: string;
  action: string;
  from: string;
  to: string;
  q: string;
}

export const EMPTY_FILTERS: AuditFilters = { actor: "", action: "", from: "", to: "", q: "" };

export function hasFilters(f: AuditFilters): boolean {
  return Object.values(f).some((v) => v !== "");
}

export function queryOf(f: AuditFilters, page = 1, size = 50): AuditQuery {
  return {
    actor: f.actor || undefined, action: f.action || undefined, from: f.from || undefined, to: f.to || undefined,
    q: f.q.trim() || undefined, page, page_size: size,
  };
}

/** `from` must not be after `to`. Returns the message, or null. */
export function rangeProblem(f: Pick<AuditFilters, "from" | "to">, t: TFunction): string | null {
  if (f.from && f.to && f.from > f.to) return t("company.rangeProblem");
  return null;
}

/** Date input values for "last N days" shortcuts (UTC days, as the API filters). */
export function lastDays(n: number, now = new Date()): { from: string; to: string } {
  const to = now.toISOString().slice(0, 10);
  const from = new Date(now.getTime() - (n - 1) * 86_400_000).toISOString().slice(0, 10);
  return { from, to };
}

const str = (v: unknown): string => (typeof v === "string" ? v : "");

const ROLE: Record<string, MessageKey> = { owner: tk("company.roleOwner"), admin: tk("company.roleAdmin"), employee: tk("company.roleEmployee") };
const POLICY: Record<string, MessageKey> = { keep: tk("company.polKeep"), reassign: tk("company.polReassign"), delete: tk("company.polDelete") };
const LEAD_STATUS: Record<string, MessageKey> = {
  new: tk("contacts.statusNew"), contacted: tk("contacts.statusContacted"), qualified: tk("contacts.statusQualified"),
  won: tk("contacts.statusWon"), lost: tk("contacts.statusLost"),
};
const PICTURE: Record<string, MessageKey> = { logo: tk("company.picLogo"), symbol: tk("company.picSymbol") };

/** What happened, as one sentence a founder can read. */
export function describeEvent(e: Pick<AuditEvent, "action" | "target_label" | "details" | "label">, i18n: Pick<I18n, "t" | "list">): string {
  const { t, list } = i18n;
  const who = e.target_label || t("company.somePerson");
  const d = e.details ?? {};
  const word = (map: Record<string, MessageKey>, key: string) => (map[key] ? t(map[key]) : key);
  const keys = Array.isArray(d.keys) ? list(d.keys as string[]) : "";
  switch (e.action) {
    case "invite.sent":
      return d.department ? t("company.evInvitedDept", { who: str(d.email) || who, department: str(d.department) }) : t("company.evInvited", { who: str(d.email) || who });
    case "invite.resent": return t("company.evInviteResent", { who: str(d.email) || who });
    case "member.role_changed": return t("company.evRoleChanged", { who, from: word(ROLE, str(d.from)), to: word(ROLE, str(d.to)) });
    case "member.removed":
      return d.card_policy ? t("company.evRemovedPolicy", { who, policy: word(POLICY, str(d.card_policy)) }) : t("company.evRemoved", { who });
    case "member.suspended": return t("company.evMemberSuspended", { who });
    case "member.restored": return t("company.evMemberRestored", { who });
    case "member.share_contacts_changed": return t(d.share_contacts ? "company.evShareOn" : "company.evShareOff", { who });
    case "member.department_changed": return t("company.evMoved", { who, department: str(d.to) || t("company.noDepartment") });
    case "card.created": return t("dev.evCardCreated", { who });
    case "card.updated": return t("dev.evCardUpdated", { who });
    case "apikey.created": return t("dev.evKeyCreated", { who });
    case "apikey.revoked": return t("dev.evKeyRevoked", { who });
    case "apikey.rotated": return t("dev.evKeyRotated", { who });
    case "crm.connected": return t("dev.evCrmConnected", { who });
    case "crm.disconnected": return t("dev.evCrmDisconnected", { who });
    case "crm.settings_changed": return t("dev.evCrmSettings", { who });
    case "crm.disabled": return t("dev.evCrmDisabled", { who });
    case "enterprise.requested": return t("billing.evEntRequested");
    case "enterprise.cancelled": return t("billing.evEntCancelled");
    case "enterprise.accepted": return t("billing.evEntAccepted");
    case "subscription.renewed": return t("billing.evRenewed");
    case "subscription.payment_failed": return t("billing.evPaymentFailed");
    case "subscription.auto_renew_off": return t("billing.evAutoRenewOff");
    case "subscription.auto_renew_on": return t("billing.evAutoRenewOn");
    case "plan.granted": return t("billing.evPlanGranted");
    case "card.published": return t("company.evCardPublished", { who });
    case "card.unpublished": return t("company.evCardUnpublished", { who });
    case "card.suspended": return d.by === "support" ? t("company.evCardSuspendedSupport", { app: APP_NAME, who }) : t("company.evCardSuspended", { who });
    case "card.restored": return d.by === "support" ? t("company.evCardRestoredSupport", { app: APP_NAME, who }) : t("company.evCardRestored", { who });
    case "support.viewed": return t("company.evSupportViewed", { app: APP_NAME, reason: str(d.reason) });
    case "support.ended": return t("company.evSupportEnded", { app: APP_NAME, minutes: Number(d.minutes ?? 1) });
    case "company.suspended": return t("company.evCompanySuspended", { app: APP_NAME });
    case "company.restored": return t("company.evCompanyRestored", { app: APP_NAME });
    case "card.deleted": return t("company.evCardDeleted", { who });
    case "card.reassigned": {
      const to = d.to && typeof d.to === "object" ? str((d.to as Record<string, unknown>).email) : "";
      return t("company.evCardReassigned", { who, to: to || t("company.evNobody") });
    }
    case "brand.updated": return keys ? t("company.evBrandUpdatedKeys", { keys }) : t("company.evBrandUpdated");
    case "brand.design_changed": return t("company.evDesignChanged");
    case "brand.lock_changed":
      return d.lock_design ? (d.lock_allows_departments ? t("company.evLockedDepts") : t("company.evLocked")) : t("company.evUnlocked");
    case "brand.logo_changed": {
      const picture = word(PICTURE, str(d.picture) || "logo");
      return d.removed ? t("company.evLogoRemoved", { picture }) : t("company.evLogoChanged", { picture });
    }
    case "department.created": return t("company.evDeptCreated", { who });
    case "department.updated": return t("company.evDeptUpdated", { who });
    case "department.deleted": return t("company.evDeptDeleted", { who });
    case "fields.rules_changed": return keys ? t("company.evFieldsChangedKeys", { keys }) : t("company.evFieldsChanged");
    case "change.requested": return t("company.evChangeAsked", { who, field: fieldWordIn(str(d.field), t) });
    case "change.approved": return t("company.evChangeApproved", { who, field: fieldWordIn(str(d.field), t) });
    case "change.rejected":
      return d.reason ? t("company.evChangeRejectedReason", { who, field: fieldWordIn(str(d.field), t), reason: str(d.reason) }) : t("company.evChangeRejected", { who, field: fieldWordIn(str(d.field), t) });
    case "directory.updated": return d.enabled ? t("company.evDirOn", { slug: str(d.slug) }) : t("company.evDirOff");
    case "bulk.run": return t("company.evBulk", { action: str(d.action), ok: Number(d.ok ?? 0), failed: Number(d.failed ?? 0) });
    case "lead.assigned":
      return d.to ? t("company.evLeadAssigned", { who, to: str(d.to) }) : t("company.evLeadUnassigned", { who });
    case "lead.status_changed": return t("company.evLeadStatus", { who, from: word(LEAD_STATUS, str(d.old)), to: word(LEAD_STATUS, str(d.new)) });
    case "lead.bulk_updated":
      return d.action === "assign"
        ? t("company.evLeadsAssigned", { n: Number(d.count ?? 0), to: str(d.assignee) || t("company.evNobody") })
        : t("company.evLeadsStatus", { n: Number(d.count ?? 0), to: word(LEAD_STATUS, str(d.status)) });
    case "lead.exported":
      return d.notes ? t("company.evLeadsExportedNotes", { n: Number(d.rows ?? 0) }) : t("company.evLeadsExported", { n: Number(d.rows ?? 0) });
    case "webhook.created": return t("company.evWebhookCreated", { who });
    case "webhook.updated": return t("company.evWebhookUpdated", { who });
    case "webhook.deleted": return t("company.evWebhookDeleted", { who });
    case "webhook.secret_rotated": return t("company.evWebhookSecret", { who });
    case "company.security_changed":
      return d.require_google_signin ? t("company.evSecurityGoogle") : t("company.evSecurity");
    case "company.require_2fa_changed": return d.require_2fa ? t("security.evRequireOn") : t("security.evRequireOff");
    case "company.reply_to_changed": return t("security.evReplyTo");
    case "domain.verified": return t("security.evDomainVerified", { domain: who });
    case "domain.removed": return t("security.evDomainRemoved", { domain: who });
    case "custom_domain.added": return t("security.evCustomDomainAdded", { domain: who });
    case "custom_domain.verified": return t("security.evCustomDomainVerified", { domain: who });
    case "custom_domain.broken": return t("security.evCustomDomainBroken", { domain: who });
    case "custom_domain.removed": return t("security.evCustomDomainRemoved", { domain: who });
    case "company.deletion_requested": return t("company.evDeletionRequested");
    case "company.deletion_cancelled": return t("company.evDeletionCancelled");
    case "design_request.created": return t("company.evDesignCreated");
    case "design_request.message": return t("company.evDesignMessage");
    case "design_request.status_changed": return t("company.evDesignStatus");
    case "design_request.approved": return t("company.evDesignApproved");
    case "design_request.changes_requested": return t("company.evDesignChanges");
    case "design_request.withdrawn": return t("company.evDesignWithdrawn");
    case "design_face.live": return t("company.evDesignLive");
    case "design_face.disabled": return t("company.evDesignDisabled");
    default: return e.label;
  }
}

/** Name to show for the person who did it. */
export function actorName(e: Pick<AuditEvent, "actor">, t: TFunction): string {
  if (!e.actor) return t("company.actorSystem");
  return e.actor.full_name || e.actor.email || t("company.actorSomeone");
}

/** Short timestamp, in UTC so every admin sees the same thing. */
export function whenText(iso: string, i18n: Pick<I18n, "t" | "date">): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  const day = i18n.date(d, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const time = i18n.date(d, { hour: "2-digit", minute: "2-digit", timeZone: "UTC" });
  return i18n.t("company.whenUtc", { day, time });
}
