// Pure team logic: filtering and searching members, reading pasted invite lists, seat checks.
import type { TFunction } from "../i18n";
import type { Card, Member, Role } from "../types";

export type StatusFilter = "all" | Member["status"];
export type CardState = "published" | "draft" | "suspended" | "none";

export interface InviteEntry {
  email: string;
  full_name?: string;
  title?: string;
  role: Role;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Turn the pasted list into invites. Each line: email, or "email, Full Name, Title". */
export function parseInvites(text: string, role: Role): { invites: InviteEntry[]; bad: string[] } {
  const invites: InviteEntry[] = [];
  const bad: string[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\n|;/)) {
    const line = raw.trim();
    if (!line) continue;
    const parts = line.split(",").map((s) => s.trim());
    // A line holding only emails separated by commas is a list of emails.
    const allEmails = parts.length > 1 && parts.every((p) => EMAIL_RE.test(p));
    const groups = allEmails ? parts.map((p) => [p]) : [parts];
    for (const g of groups) {
      const email = g[0].toLowerCase();
      if (!EMAIL_RE.test(email)) {
        bad.push(g[0]);
        continue;
      }
      if (seen.has(email)) continue;
      seen.add(email);
      invites.push({ email, full_name: g[1] || undefined, title: g[2] || undefined, role });
    }
  }
  return { invites, bad };
}

/** Emails that are already in the team (compared without case). */
export function alreadyInTeam(invites: InviteEntry[], members: Pick<Member, "email">[]): string[] {
  const have = new Set(members.map((m) => m.email.toLowerCase()));
  return invites.filter((i) => have.has(i.email)).map((i) => i.email);
}

export function freeSeats(sub: { seats_total: number; seats_used: number }): number {
  return Math.max(0, sub.seats_total - sub.seats_used);
}

/** Plain-words problem with inviting `count` people, or null when it is fine. */
export function seatProblem(sub: { live: boolean; seats_total: number; seats_used: number }, count: number, t: TFunction): string | null {
  if (!sub.live) return t("team.needPlan");
  const free = freeSeats(sub);
  if (count > free) return t("team.seatProblem", { seats: t("team.freeSeatsShort", { n: free }), people: t("team.peopleCount", { n: count }) });
  return null;
}

/** Which card state to show for a member, from the company card list. */
export function cardState(m: Pick<Member, "card_id">, cards: Pick<Card, "id" | "status">[] | undefined): CardState {
  if (!m.card_id || !cards) return "none";
  const c = cards.find((x) => x.id === m.card_id);
  return c ? c.status : "none";
}

/** Members matching the search text (name or email) and the status filter. */
export function filterMembers(members: Member[], query: string, status: StatusFilter): Member[] {
  const q = query.trim().toLowerCase();
  return members.filter((m) => {
    if (status !== "all" && m.status !== status) return false;
    if (!q) return true;
    const name = (m.full_name || m.user?.full_name || "").toLowerCase();
    return name.includes(q) || m.email.toLowerCase().includes(q);
  });
}

export function statusCounts(members: Member[]): Record<StatusFilter, number> {
  const out: Record<StatusFilter, number> = { all: members.length, invited: 0, active: 0, suspended: 0 };
  for (const m of members) out[m.status] += 1;
  return out;
}
