// Decides whether the customer workspace offers a way into the staff area. Only an answer that carries a staff role counts;
// a refusal, a missing session, a network failure or a half-loaded answer all mean "show nothing" and are never reported.
import type { StaffMe } from "@/lib/designs/api";
import { tk, type MessageKey } from "@/lib/i18n";

const ROLE_LABELS: Record<StaffMe["staff_role"], MessageKey> = {
  read_only: tk("staff.roleReadOnly"),
  support: tk("staff.roleSupport"),
  admin: tk("staff.roleAdmin"),
};

export interface StaffShortcut {
  href: "/staff";
  /** The message key of the person's role name, shown beside the link. */
  roleKey: MessageKey;
}

export function staffShortcut(result: { data?: Pick<StaffMe, "staff_role"> | null; error?: unknown } | null | undefined): StaffShortcut | null {
  if (!result || result.error) return null;
  const role = result.data?.staff_role;
  if (!role || !(role in ROLE_LABELS)) return null;
  return { href: "/staff", roleKey: ROLE_LABELS[role] };
}
