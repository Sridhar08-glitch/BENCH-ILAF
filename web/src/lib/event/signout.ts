// Signing out wipes the event notes of this device (they are other people's contact details). Notes that were never sent would be lost,
// so the person is asked first. Pure helpers: the dialog is in components/app/SignOutGuard.tsx.
import { loadNotes, toCsv, type EventNote, type EventTag } from "./notes";

/** The notes that never reached the server: still waiting for a connection, or refused and not retried. */
export function unsentNotes(list: EventNote[]): EventNote[] {
  return list.filter((n) => n.state !== "synced");
}

/** How many unsent notes this device holds (0 when storage is not available). */
export function unsentCount(storage: Pick<Storage, "getItem"> | null): number {
  return unsentNotes(loadNotes(storage)).length;
}

export type SignOutStep = "now" | "ask";

/** Sign out at once when nothing would be lost; otherwise ask first. */
export function signOutStep(unsent: number): SignOutStep {
  return unsent > 0 ? "ask" : "now";
}

/** The CSV of every unsent note (all events in one file, oldest first), written like the event page's export. */
export function unsentCsv(list: EventNote[], tagName: (tag: EventTag) => string, header: string[], labels: { yes: string; no: string }): string {
  return toCsv(unsentNotes(list), null, tagName, header, labels);
}

/** The name of the file the export is saved as. */
export function unsentFileName(base: string, now: Date): string {
  return `${base}-${now.toISOString().slice(0, 10)}.csv`;
}
