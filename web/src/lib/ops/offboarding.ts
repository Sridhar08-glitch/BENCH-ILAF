// What happens to a card when its person leaves or changes role, and who can receive it.
import type { CardPolicy } from "../api";
import type { Member } from "../types";
import { runtimeT, tk, type MessageKey, type TFunction } from "../i18n";

export const POLICIES: { id: CardPolicy; title: MessageKey; text: MessageKey }[] = [
  { id: "keep", title: tk("company.polKeepTitle"), text: tk("company.polKeepText") },
  { id: "reassign", title: tk("company.polReassignTitle"), text: tk("company.polReassignText") },
  { id: "delete", title: tk("company.polDeleteTitle"), text: tk("company.polDeleteText") },
];

/** Colleagues who can take a card: nobody who already has one (one card per seat), and not the person leaving. */
export function reassignTargets(members: Member[], leavingId?: string | null): Member[] {
  return members.filter((m) => m.id !== leavingId && !m.card_id);
}

/** Everyone, with a note when they cannot take a card. Used to explain an empty picker. */
export function targetProblem(members: Member[], leavingId?: string | null, t: TFunction = runtimeT): string | null {
  const free = reassignTargets(members, leavingId);
  if (free.length > 0) return null;
  return t("company.targetProblem");
}

export function displayName(m: Pick<Member, "full_name" | "email" | "user">): string {
  return m.full_name || m.user?.full_name || m.email;
}

/** Whether the confirm button of the removal dialog may be pressed. */
export function canConfirmRemoval(policy: CardPolicy, target: string | null | "nobody", hasCard: boolean): boolean {
  if (!hasCard || policy !== "reassign") return true;
  return target !== null;
}

/** The body for the API call, from the dialog's choices. "nobody" means a shared card with no holder. */
export function removalOptions(policy: CardPolicy, target: string | null | "nobody"): { card: CardPolicy; reassign_to: string | null } {
  if (policy === "reassign") return { card: "reassign", reassign_to: target === "nobody" || target === null ? null : target };
  return { card: policy, reassign_to: null };
}
