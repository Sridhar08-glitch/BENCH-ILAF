// "Share my new contacts with the company": small pure helpers for the employee's switch and the one-time hint on the Contacts page.
import type { Lead, Role } from "@/lib/types";

/** Only an employee of a company has the switch; owners, admins and personal workspaces do not. */
export function hasShareSwitch(role: Role, isCompany: boolean): boolean {
  return isCompany && role === "employee";
}

/** The "Shared with company" badge: shown to the employee on the contacts they shared. */
export function showSharedBadge(lead: Pick<Lead, "shared_with_company">, role: Role, isCompany: boolean): boolean {
  return hasShareSwitch(role, isCompany) && lead.shared_with_company === true;
}

const HINT_KEY = "bench.shareHintSeen";

/** The key under which the dismissal of the hint is kept: one per person and company. */
export function hintStorageKey(userId: string, workspaceId: string): string {
  return `${HINT_KEY}.${userId}.${workspaceId}`;
}

/** The hint is for an employee who has not dismissed it and whose switch is still off. */
export function shouldShowShareHint(o: { role: Role; isCompany: boolean; sharing: boolean | undefined; dismissed: boolean }): boolean {
  return hasShareSwitch(o.role, o.isCompany) && o.sharing === false && !o.dismissed;
}

function safeStorage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readHintDismissed(key: string, storage: Pick<Storage, "getItem"> | null = safeStorage()): boolean {
  try {
    return storage?.getItem(key) === "1";
  } catch {
    return false;
  }
}

export function writeHintDismissed(key: string, storage: Pick<Storage, "setItem"> | null = safeStorage()): void {
  try {
    storage?.setItem(key, "1");
  } catch {
    /* storage unavailable: the hint comes back next time, which is harmless */
  }
}
