// Pure helpers of the companies list in the staff area: the seat warning, the hand-over to the announcements page, the export query.

/** Share of the seats in use, as a whole percent (0 when the company has no plan). */
export function seatPercent(used: number, total: number): number {
  return total > 0 ? Math.round((used / total) * 100) : 0;
}

/** True when 90 % or more of the seats are taken. */
export function seatsNearlyFull(used: number, total: number): boolean {
  return total > 0 && used * 10 >= total * 9;
}

/** The session-storage key the announcements page reads the picked companies from. */
export const ANNOUNCE_KEY = "staff-announce-companies";

/** The address of the announcements page with the picked companies filled in. */
export function announceHref(ids: readonly string[]): string {
  return `/staff/announcements?companies=${ids.map(encodeURIComponent).join(",")}`;
}

/** Remember the picked companies for the announcements page (silently nothing where the browser blocks storage). */
export function storeAnnounceSelection(ids: readonly string[], storage?: Pick<Storage, "setItem">): void {
  try {
    (storage ?? window.sessionStorage).setItem(ANNOUNCE_KEY, JSON.stringify(ids));
  } catch { /* storage blocked: the link still carries the ids */ }
}

/** The query of the CSV download: the picked companies, or the filters of the list when none are picked. */
export function exportQuery(picked: readonly string[], filters: { q: string; plan: string; status: string; sort: string }): Record<string, string> {
  if (picked.length > 0) return { ids: picked.join(",") };
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(filters)) if (value) out[key] = value;
  return out;
}

/** Selecting all on the page: every id when something is missing, none when all are already picked. */
export function togglePage(picked: readonly string[], pageIds: readonly string[]): string[] {
  const all = pageIds.length > 0 && pageIds.every((id) => picked.includes(id));
  if (all) return picked.filter((id) => !pageIds.includes(id));
  return [...picked, ...pageIds.filter((id) => !picked.includes(id))];
}
