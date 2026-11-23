import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import {
  DEFAULT_LOCALE, LOCALES, cardLocale, dirOf, fromAcceptLanguage, intlTag, isRtl, normaliseCardLanguage, normaliseDigits,
  normaliseLocale, pickLocale,
} from "./config";
import { format, formatDate, formatMoney, formatNumber, formatRelative, placeholdersOf, pluralCategoriesOf, pluralCategory } from "./format";
import { createI18n } from "./index";
import { AREAS, CATALOGUES, en } from "./messages";

const ar = { locale: "ar" as const, digits: "latn" as const };
const arEast = { locale: "ar" as const, digits: "arab" as const };
const enCtx = { locale: "en" as const, digits: "latn" as const };

describe("locale choice", () => {
  it("accepts codes and region tags, rejects the rest", () => {
    expect(normaliseLocale("ar")).toBe("ar");
    expect(normaliseLocale("AR-QA")).toBe("ar");
    expect(normaliseLocale("en_GB")).toBe("en");
    expect(normaliseLocale("fr")).toBeNull();
    expect(normaliseLocale(undefined)).toBeNull();
    expect(normaliseLocale(5)).toBeNull();
  });

  it("reads the best language from Accept-Language", () => {
    expect(fromAcceptLanguage("ar-QA,ar;q=0.9,en;q=0.8")).toBe("ar");
    expect(fromAcceptLanguage("fr-FR,fr;q=0.9,en;q=0.5")).toBe("en");
    expect(fromAcceptLanguage("en;q=0.3,ar;q=0.9")).toBe("ar");
    expect(fromAcceptLanguage("ar;q=0")).toBeNull();
    expect(fromAcceptLanguage("de,fr")).toBeNull();
    expect(fromAcceptLanguage(null)).toBeNull();
  });

  it("chooses account, then cookie, then browser, then English", () => {
    expect(pickLocale({ account: "ar", cookie: "en", acceptLanguage: "en" })).toBe("ar");
    expect(pickLocale({ account: null, cookie: "ar", acceptLanguage: "en" })).toBe("ar");
    expect(pickLocale({ cookie: "xx", acceptLanguage: "ar-SA" })).toBe("ar");
    expect(pickLocale({})).toBe(DEFAULT_LOCALE);
    expect(pickLocale({ acceptLanguage: "ja" })).toBe("en");
  });

  it("knows which languages run right to left", () => {
    expect(dirOf("ar")).toBe("rtl");
    expect(dirOf("en")).toBe("ltr");
    expect(isRtl("ar")).toBe(true);
    expect(isRtl("en")).toBe(false);
    for (const l of LOCALES) expect(["rtl", "ltr"]).toContain(dirOf(l));
  });

  it("lets a card choose its own language or follow the visitor", () => {
    expect(normaliseCardLanguage("ar")).toBe("ar");
    expect(normaliseCardLanguage("auto")).toBe("auto");
    expect(normaliseCardLanguage("zz")).toBe("auto");
    expect(cardLocale("auto", "ar")).toBe("ar");
    expect(cardLocale("en", "ar")).toBe("en");
    expect(cardLocale("ar", "en")).toBe("ar");
  });

  it("digits default to Western", () => {
    expect(normaliseDigits(undefined)).toBe("latn");
    expect(normaliseDigits("arab")).toBe("arab");
    expect(normaliseDigits("hanidec")).toBe("latn");
    expect(intlTag("ar", "arab")).toContain("nu-arab");
    expect(intlTag("en", "arab")).toContain("nu-latn");
  });
});

describe("messages", () => {
  it("fills values and leaves plain text alone", () => {
    expect(format("Hello {name}", { name: "Layla" }, enCtx)).toBe("Hello Layla");
    expect(format("No braces", undefined, enCtx)).toBe("No braces");
    expect(format("Missing {x}.", {}, enCtx)).toBe("Missing .");
  });

  it("English plurals", () => {
    const m = "{n, plural, =0 {No cards} one {# card} other {# cards}}";
    expect(format(m, { n: 0 }, enCtx)).toBe("No cards");
    expect(format(m, { n: 1 }, enCtx)).toBe("1 card");
    expect(format(m, { n: 1234 }, enCtx)).toBe("1,234 cards");
  });

  it("Arabic has six plural categories", () => {
    const cases: [number, string][] = [[0, "zero"], [1, "one"], [2, "two"], [3, "few"], [10, "few"], [11, "many"], [99, "many"], [100, "other"], [103, "few"], [111, "many"], [1.5, "other"]];
    for (const [n, cat] of cases) expect(pluralCategory("ar", n)).toBe(cat);
    expect(pluralCategory("en", 1)).toBe("one");
    expect(pluralCategory("en", 2)).toBe("other");
  });

  it("picks the Arabic form and fills the number", () => {
    const m = "{n, plural, zero {لا بطاقات} one {بطاقة واحدة} two {بطاقتان} few {# بطاقات} many {# بطاقة} other {# بطاقة}}";
    expect(format(m, { n: 0 }, ar)).toBe("لا بطاقات");
    expect(format(m, { n: 1 }, ar)).toBe("بطاقة واحدة");
    expect(format(m, { n: 2 }, ar)).toBe("بطاقتان");
    expect(format(m, { n: 7 }, ar)).toBe("7 بطاقات");
    expect(format(m, { n: 25 }, ar)).toBe("25 بطاقة");
    expect(format(m, { n: 7 }, arEast)).toBe("٧ بطاقات");
  });

  it("plural choices can use other values", () => {
    expect(format("{n, plural, one {{who} has # card} other {{who} has # cards}}", { n: 3, who: "Sam" }, enCtx)).toBe("Sam has 3 cards");
  });

  it("formats numbers with Western or Eastern Arabic digits", () => {
    expect(formatNumber(1234567, ar)).toBe("1,234,567");
    expect(formatNumber(1234, arEast)).toBe("١٬٢٣٤");
    expect(format("{n} views", { n: 12 }, arEast)).toBe("١٢ views");
  });

  it("formats dates in the Gregorian calendar with Arabic month names", () => {
    const d = new Date(Date.UTC(2026, 10, 22, 12));
    expect(formatDate(d, ar, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })).toBe("22 نوفمبر 2026");
    expect(formatDate(d, enCtx, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })).toBe("22 November 2026");
    expect(formatDate(d, arEast, { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" })).toContain("٢٢");
  });

  it("formats money and relative time", () => {
    expect(formatMoney(4900, "QAR", enCtx)).toContain("49");
    expect(formatMoney(4900, "QAR", arEast)).toContain("٤٩");
    const now = Date.UTC(2026, 10, 22);
    expect(formatRelative(now - 3 * 86400_000, enCtx, now)).toBe("3 days ago");
    expect(formatRelative(now - 3 * 86400_000, ar, now)).toMatch(/[؀-ۿ]/);
  });

  it("reads the values a message uses", () => {
    expect(placeholdersOf("Hi {name}, you have {n, plural, one {# card} other {# cards}} in {place}")).toEqual(["n", "name", "place"]);
    expect(pluralCategoriesOf("{n, plural, one {a} other {b}}")).toEqual(["one", "other"]);
    expect(pluralCategoriesOf("plain")).toBeNull();
  });

  it("a translator returns the key itself when a text is missing", () => {
    const i = createI18n("ar", "latn", { "common.save": "حفظ" });
    expect(i.t("common.save")).toBe("حفظ");
    expect(i.t("common.cancel")).toBe("common.cancel");
    expect(i.dir).toBe("rtl");
  });
});

// ---------------------------------------------------------------- the catalogues
const SRC = path.resolve(__dirname, "..", "..");
const catalogues = CATALOGUES as Record<string, Record<string, string>>;
const englishKeys = Object.keys(en).sort();

describe("every language has exactly the English keys", () => {
  for (const locale of LOCALES) {
    it(`${locale}: no missing and no extra keys`, () => {
      const keys = Object.keys(catalogues[locale]).sort();
      expect(englishKeys.filter((k) => !keys.includes(k)), "missing in " + locale).toEqual([]);
      expect(keys.filter((k) => !englishKeys.includes(k)), "extra in " + locale).toEqual([]);
    });

    it(`${locale}: values are filled and use the same placeholders as English`, () => {
      const bad: string[] = [];
      for (const key of englishKeys) {
        const text = catalogues[locale][key];
        if (typeof text !== "string" || text.trim() === "") bad.push(`${key}: empty`);
        else if (placeholdersOf(text).join() !== placeholdersOf(en[key as keyof typeof en]).join()) bad.push(`${key}: placeholders differ`);
      }
      expect(bad).toEqual([]);
    });
  }

  it("keys start with the area of their file", () => {
    const bad = englishKeys.filter((k) => !(AREAS as readonly string[]).includes(k.slice(0, k.indexOf("."))));
    expect(bad).toEqual([]);
  });

  it("Arabic plurals spell out the categories Arabic needs", () => {
    const bad: string[] = [];
    for (const key of englishKeys) {
      const text = catalogues.ar[key];
      const cats = pluralCategoriesOf(text);
      if (cats === null) continue;
      if (!cats.includes("other")) bad.push(`${key}: no "other"`);
      for (const need of ["one", "two", "few", "many"]) if (!cats.includes(need)) bad.push(`${key}: no "${need}"`);
    }
    expect(bad).toEqual([]);
  });

  it("Arabic texts are written in Arabic (Latin-only is allowed for names, codes and symbols)", () => {
    const latinOk = /^[\s\w.,:;!?'"()/+#%&@·|<>{}\-–—⁦⁩\d]*$/;
    const untranslated: string[] = [];
    for (const key of englishKeys) {
      const text = catalogues.ar[key];
      if (!/[؀-ۿ]/.test(text) && latinOk.test(text) && text === en[key as keyof typeof en] && /[a-z]{4,}/i.test(text)) untranslated.push(key);
    }
    expect(untranslated).toEqual([]);
  });
});

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "generated") continue;
      if (full.endsWith(path.join("lib", "i18n", "en")) || full.endsWith(path.join("lib", "i18n", "ar"))) continue;
      sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\./.test(entry.name)) out.push(full);
  }
  return out;
}

describe("keys are used", () => {
  it("every English key appears in the source, and every key used in the source exists", () => {
    const files = sourceFiles(SRC);
    const text = files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
    // apiError.<code> texts are looked up from the code of the error (api-error.ts), so they are not spelled out in the source.
    const byCode = (k: string) => /^apiError\.[a-z0-9_]+$/.test(k);
    const unused = englishKeys.filter((k) => !byCode(k) && !text.includes(`"${k}"`) && !text.includes(`'${k}'`) && !text.includes(`\`${k}\``));
    expect(unused, "keys nobody uses: delete them").toEqual([]);
    const used = new Set<string>();
    const re = /\b(?:t|tk|runtimeT)\(\s*["'`]([a-z]+\.[A-Za-z0-9_.]+)["'`]/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text))) used.add(m[1]);
    const unknown = [...used].filter((k) => !englishKeys.includes(k));
    expect(unknown, "keys used in code but missing from en/").toEqual([]);
  });
});
