// The countries a company can choose (ISO 3166-1 alpha-2). The codes are the same list as backend/ilaf/countries.py; the names are
// written by the browser in the language of the screen (Intl.DisplayNames), so there is no name table to keep in two places.
export const COUNTRY_CODES = [
  "AD", "AE", "AF", "AG", "AI", "AL", "AM", "AO", "AQ", "AR", "AS", "AT", "AU", "AW", "AX", "AZ",
  "BA", "BB", "BD", "BE", "BF", "BG", "BH", "BI", "BJ", "BL", "BM", "BN", "BO", "BQ", "BR", "BS", "BT", "BV", "BW", "BY", "BZ",
  "CA", "CC", "CD", "CF", "CG", "CH", "CI", "CK", "CL", "CM", "CN", "CO", "CR", "CU", "CV", "CW", "CX", "CY", "CZ",
  "DE", "DJ", "DK", "DM", "DO", "DZ", "EC", "EE", "EG", "EH", "ER", "ES", "ET", "FI", "FJ", "FK", "FM", "FO", "FR",
  "GA", "GB", "GD", "GE", "GF", "GG", "GH", "GI", "GL", "GM", "GN", "GP", "GQ", "GR", "GS", "GT", "GU", "GW", "GY",
  "HK", "HM", "HN", "HR", "HT", "HU", "ID", "IE", "IL", "IM", "IN", "IO", "IQ", "IR", "IS", "IT", "JE", "JM", "JO", "JP",
  "KE", "KG", "KH", "KI", "KM", "KN", "KP", "KR", "KW", "KY", "KZ", "LA", "LB", "LC", "LI", "LK", "LR", "LS", "LT", "LU", "LV", "LY",
  "MA", "MC", "MD", "ME", "MF", "MG", "MH", "MK", "ML", "MM", "MN", "MO", "MP", "MQ", "MR", "MS", "MT", "MU", "MV", "MW", "MX", "MY", "MZ",
  "NA", "NC", "NE", "NF", "NG", "NI", "NL", "NO", "NP", "NR", "NU", "NZ", "OM",
  "PA", "PE", "PF", "PG", "PH", "PK", "PL", "PM", "PN", "PR", "PS", "PT", "PW", "PY", "QA",
  "RE", "RO", "RS", "RU", "RW", "SA", "SB", "SC", "SD", "SE", "SG", "SH", "SI", "SJ", "SK", "SL", "SM", "SN", "SO", "SR", "SS", "ST", "SV", "SX", "SY", "SZ",
  "TC", "TD", "TF", "TG", "TH", "TJ", "TK", "TL", "TM", "TN", "TO", "TR", "TT", "TV", "TW", "TZ",
  "UA", "UG", "UM", "US", "UY", "UZ", "VA", "VC", "VE", "VG", "VI", "VN", "VU", "WF", "WS", "XK", "YE", "YT", "ZA", "ZM", "ZW",
] as const;

export type CountryCode = (typeof COUNTRY_CODES)[number];

const CODE_SET: ReadonlySet<string> = new Set(COUNTRY_CODES);

export interface CountryOption {
  code: string;
  name: string;
}

/** True for a code in the list (any letter case). */
export function isCountryCode(value: unknown): boolean {
  return typeof value === "string" && CODE_SET.has(value.trim().toUpperCase());
}

/** The name of a country in a language; the code itself when the browser cannot name it. Empty input gives "". */
export function countryName(code: string | null | undefined, locale: string): string {
  const c = (code ?? "").trim().toUpperCase();
  if (!c) return "";
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(c) ?? c;
  } catch {
    return c;
  }
}

/** Every country with its name in the language, sorted by name in that language. */
export function countryOptions(locale: string): CountryOption[] {
  let display: Intl.DisplayNames | null = null;
  try {
    display = new Intl.DisplayNames([locale], { type: "region" });
  } catch {
    display = null;
  }
  const rows = COUNTRY_CODES.map((code) => ({ code: code as string, name: display?.of(code) ?? code }));
  return rows.sort((a, b) => a.name.localeCompare(b.name, locale));
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** The options that match what was typed (name or code, ignoring case and accents). Nothing typed keeps them all. */
export function filterCountries(options: CountryOption[], query: string): CountryOption[] {
  const q = fold(query);
  if (!q) return options;
  return options.filter((o) => fold(o.name).includes(q) || o.code.toLowerCase() === q);
}
