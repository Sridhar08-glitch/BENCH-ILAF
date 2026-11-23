// Small pure helpers of the company page and the applications table (kept out of the components so they can be tested).

export const SEAT_NEAR_PERCENT = 90;

export interface SeatsInfo {
  percent: number;
  state: "none" | "ok" | "near" | "full";
  note: string;
}

/** How full the seats are, and the sentence staff read next to the bar. A company without a plan has no seats to fill. */
export function seatsInfo(used: number, total: number): SeatsInfo {
  if (!total || total <= 0) return { percent: 0, state: "none", note: "No plan, so no seats." };
  const percent = Math.min(100, Math.round((100 * used) / total));
  if (used >= total) return { percent, state: "full", note: "All seats are used. The company cannot add anyone until it buys more." };
  if (percent >= SEAT_NEAR_PERCENT) return { percent, state: "near", note: `Near the limit: ${total - used} seat${total - used === 1 ? "" : "s"} left.` };
  return { percent, state: "ok", note: `${total - used} seats left.` };
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** A day written as "5 Nov" for a chart axis (the day is read as written, no time zone shift). */
export function shortDay(day: string): string {
  const [, m, d] = day.split("-");
  const month = Number(m);
  if (!month || !d) return day;
  return `${Number(d)} ${MONTHS[month - 1]}`;
}

/** The points of the 14-day chart: a label and a value per day. */
export function viewsPoints(days: { day: string; views: number }[]): { label: string; value: number }[] {
  return days.map((d) => ({ label: shortDay(d.day), value: d.views }));
}

const FONT_NAMES: Record<string, string> = {
  face: "Each card face's own fonts", poppins: "Poppins", outfit: "Outfit", manrope: "Manrope", "space-grotesk": "Space Grotesk", playfair: "Playfair Display",
  cormorant: "Cormorant", lora: "Lora", oswald: "Oswald", bebas: "Bebas Neue", jetbrains: "JetBrains Mono", caveat: "Caveat", dancing: "Dancing Script",
  "plex-arabic": "IBM Plex Sans Arabic", cairo: "Cairo", tajawal: "Tajawal",
};

/** The readable name of a card font key; an unknown key is shown as it is. */
export function fontName(key: string | null | undefined): string {
  if (!key) return FONT_NAMES.face;
  return FONT_NAMES[key] ?? key;
}

const HEX = /^#[0-9a-fA-F]{6}$/;

/** The brand colours worth drawing: only values that are real hex colours. */
export function brandSwatches(colours: { primary?: string; accent?: string } | null | undefined): { name: string; hex: string }[] {
  if (!colours) return [];
  const out: { name: string; hex: string }[] = [];
  if (colours.primary && HEX.test(colours.primary)) out.push({ name: "Main colour", hex: colours.primary });
  if (colours.accent && HEX.test(colours.accent)) out.push({ name: "Accent colour", hex: colours.accent });
  return out;
}

const CARD_STATE_WORDS: Record<string, string> = { published: "Live", suspended: "Suspended", draft: "Draft", none: "No card" };

export function cardStateWord(state: string): string {
  return CARD_STATE_WORDS[state] ?? state;
}

/** Who a sign-up request is given to, as shown in the table. */
export function assigneeLabel(a: { full_name: string; email: string }): string {
  return a.full_name ? `${a.full_name} (${a.email})` : a.email;
}
