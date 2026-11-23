// Message formatting, plural rules and number and date formatting. Messages are plain strings:
//   "Hello {name}"                                         a value
//   "{n, plural, one {# card} other {# cards}}"            a count; # is the number
//   "{n, plural, =0 {No cards} one {# card} other {# cards}}"
// The plural categories are the CLDR ones (Arabic has zero, one, two, few, many and other).
import { intlTag, isRtl, type Digits, type Locale } from "./config";

export type Param = string | number | undefined | null;
export type Params = Record<string, Param>;

export interface FormatContext {
  locale: Locale;
  digits: Digits;
}

export type PluralCategory = "zero" | "one" | "two" | "few" | "many" | "other";

const ruleCache = new Map<string, Intl.PluralRules>();
const numberCache = new Map<string, Intl.NumberFormat>();

/** The plural category of a number in a language. */
export function pluralCategory(locale: Locale, n: number): PluralCategory {
  let rules = ruleCache.get(locale);
  if (!rules) {
    rules = new Intl.PluralRules(locale);
    ruleCache.set(locale, rules);
  }
  return rules.select(n) as PluralCategory;
}

function numberFormat(ctx: FormatContext, options?: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${ctx.locale}|${ctx.digits}|${JSON.stringify(options ?? {})}`;
  let f = numberCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(intlTag(ctx.locale, ctx.digits), options);
    numberCache.set(key, f);
  }
  return f;
}

export function formatNumber(n: number, ctx: FormatContext, options?: Intl.NumberFormatOptions): string {
  return numberFormat(ctx, options).format(n);
}

/** Index of the "}" that closes the "{" at `open`. */
function closing(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/** Bidi isolates: a Latin name or a number inside an Arabic sentence keeps its own order and cannot reorder the punctuation around it. */
export const FSI = "⁨";
export const PDI = "⁩";

function valueText(v: Param, ctx: FormatContext): string {
  if (v === undefined || v === null) return "";
  if (typeof v === "number") return formatNumber(v, ctx);
  const text = String(v);
  return isRtl(ctx.locale) && /\p{L}/u.test(text) ? FSI + text + PDI : text;
}

function plural(name: string, body: string, params: Params, ctx: FormatContext): string {
  const raw = params[name];
  const n = typeof raw === "number" ? raw : Number(raw ?? 0);
  const options = new Map<string, string>();
  const re = /\s*(=\d+|zero|one|two|few|many|other)\s*\{/y;
  let pos = 0;
  while (pos < body.length) {
    re.lastIndex = pos;
    const m = re.exec(body);
    if (!m) break;
    const open = m.index + m[0].length - 1;
    const end = closing(body, open);
    if (end < 0) break;
    options.set(m[1], body.slice(open + 1, end));
    pos = end + 1;
  }
  const chosen = options.get(`=${n}`) ?? options.get(pluralCategory(ctx.locale, n)) ?? options.get("other") ?? "";
  // "#" is the number; the chosen text may hold more values.
  return format(chosen.replace(/#/g, () => formatNumber(n, ctx)), params, ctx);
}

/** Fill a message with values and plural choices. */
export function format(template: string, params: Params | undefined, ctx: FormatContext): string {
  if (!template.includes("{")) return template;
  let out = "";
  let i = 0;
  while (i < template.length) {
    const open = template.indexOf("{", i);
    if (open < 0) {
      out += template.slice(i);
      break;
    }
    out += template.slice(i, open);
    const end = closing(template, open);
    if (end < 0) {
      out += template.slice(open);
      break;
    }
    const inner = template.slice(open + 1, end);
    const comma = inner.indexOf(",");
    if (comma < 0) {
      out += valueText(params?.[inner.trim()], ctx);
    } else {
      const name = inner.slice(0, comma).trim();
      const rest = inner.slice(comma + 1);
      const kind = rest.slice(0, rest.indexOf(",")).trim();
      out += kind === "plural" ? plural(name, rest.slice(rest.indexOf(",") + 1), params ?? {}, ctx) : "";
    }
    i = end + 1;
  }
  return out;
}

/** The names of the values a message uses ({name}, and the count of a plural), for the parity test. */
export function placeholdersOf(template: string): string[] {
  const names = new Set<string>();
  const walk = (text: string) => {
    let i = 0;
    while (i < text.length) {
      const open = text.indexOf("{", i);
      if (open < 0) return;
      const end = closing(text, open);
      if (end < 0) return;
      const inner = text.slice(open + 1, end);
      const comma = inner.indexOf(",");
      if (comma < 0) names.add(inner.trim());
      else {
        names.add(inner.slice(0, comma).trim());
        const body = inner.slice(inner.indexOf(",", comma + 1) + 1);
        // Values used inside the plural choices.
        const re = /(?:=\d+|zero|one|two|few|many|other)\s*\{/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(body))) {
          const o = m.index + m[0].length - 1;
          const e = closing(body, o);
          if (e < 0) break;
          walk(body.slice(o + 1, e));
          re.lastIndex = e + 1;
        }
      }
      i = end + 1;
    }
  };
  walk(template);
  return [...names].sort();
}

/** The plural categories a message spells out, or null when it is not a plural. */
export function pluralCategoriesOf(template: string): string[] | null {
  const m = /\{\s*\w+\s*,\s*plural\s*,/.exec(template);
  if (!m) return null;
  const found = new Set<string>();
  const re = /(=\d+|zero|one|two|few|many|other)\s*\{/g;
  let x: RegExpExecArray | null;
  while ((x = re.exec(template))) found.add(x[1]);
  return [...found];
}

// ---------------------------------------------------------------- dates, money, relative time
type DateInput = Date | string | number;
const toDate = (d: DateInput): Date => (d instanceof Date ? d : new Date(d));

export function formatDate(d: DateInput, ctx: FormatContext, options: Intl.DateTimeFormatOptions = { day: "numeric", month: "short", year: "numeric" }): string {
  try {
    return new Intl.DateTimeFormat(intlTag(ctx.locale, ctx.digits), options).format(toDate(d));
  } catch {
    return String(d);
  }
}

export function formatDateTime(d: DateInput, ctx: FormatContext): string {
  return formatDate(d, ctx, { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
}

export function formatTime(d: DateInput, ctx: FormatContext): string {
  return formatDate(d, ctx, { hour: "numeric", minute: "2-digit" });
}

/** "3 days ago", "in 2 hours" in the language (numeric: auto gives "yesterday"). */
export function formatRelative(d: DateInput, ctx: FormatContext, now: number = Date.now()): string {
  const seconds = Math.round((toDate(d).getTime() - now) / 1000);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [["year", 31536000], ["month", 2592000], ["week", 604800], ["day", 86400], ["hour", 3600], ["minute", 60]];
  const rtf = new Intl.RelativeTimeFormat(intlTag(ctx.locale, ctx.digits), { numeric: "auto" });
  for (const [unit, size] of units) {
    if (Math.abs(seconds) >= size) return rtf.format(Math.round(seconds / size), unit);
  }
  return rtf.format(seconds, "second");
}

/** Money from minor units (cents, fils): "QAR 49" in the language's digits. */
export function formatMoney(minor: number, currency: string, ctx: FormatContext): string {
  const major = minor / 100;
  try {
    return formatNumber(major, ctx, { style: "currency", currency, minimumFractionDigits: major % 1 === 0 ? 0 : 2, maximumFractionDigits: 2 });
  } catch {
    return `${major} ${currency}`;
  }
}

/** A list in the language: "A, B and C" / "أ وب وج". */
export function formatList(items: string[], ctx: FormatContext): string {
  try {
    return new Intl.ListFormat(ctx.locale, { style: "long", type: "conjunction" }).format(items);
  } catch {
    return items.join(", ");
  }
}

/** Compact numbers: 1.2K. */
export function formatCompact(n: number, ctx: FormatContext): string {
  return formatNumber(n, ctx, { notation: "compact", maximumFractionDigits: 1 });
}
