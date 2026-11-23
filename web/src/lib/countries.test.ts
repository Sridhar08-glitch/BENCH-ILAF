import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryName, countryOptions, filterCountries, isCountryCode } from "./countries";

describe("country list", () => {
  it("has each code once, two capital letters", () => {
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const c of COUNTRY_CODES) expect(c).toMatch(/^[A-Z]{2}$/);
    expect(COUNTRY_CODES.length).toBeGreaterThanOrEqual(240);
  });

  it("is the same list as the backend's", () => {
    const file = path.resolve(process.cwd(), "..", "backend", "ilaf", "countries.py");
    if (!existsSync(file)) return;
    const codes = [...readFileSync(file, "utf8").matchAll(/^([A-Z]{2})\|/gm)].map((m) => m[1]);
    expect([...codes].sort()).toEqual([...COUNTRY_CODES].sort());
  });

  it("checks codes without caring about case", () => {
    expect(isCountryCode("qa")).toBe(true);
    expect(isCountryCode(" QA ")).toBe(true);
    expect(isCountryCode("ZZ")).toBe(false);
    expect(isCountryCode("")).toBe(false);
    expect(isCountryCode(null)).toBe(false);
  });

  it("names a country in the language of the screen", () => {
    expect(countryName("QA", "en")).toBe("Qatar");
    expect(countryName("QA", "ar")).toBe("قطر");
    expect(countryName("", "en")).toBe("");
    expect(countryName(null, "en")).toBe("");
  });

  it("lists every country sorted by its name in that language", () => {
    const en = countryOptions("en");
    expect(en).toHaveLength(COUNTRY_CODES.length);
    const names = en.map((o) => o.name);
    expect(names).toEqual([...names].sort((a, b) => a.localeCompare(b, "en")));
    expect(countryOptions("ar").find((o) => o.code === "EG")?.name).toBe("مصر");
  });

  it("filters by name or code, ignoring case and accents", () => {
    const en = countryOptions("en");
    expect(filterCountries(en, "")).toBe(en);
    expect(filterCountries(en, "qat").map((o) => o.code)).toContain("QA");
    expect(filterCountries(en, "QA").map((o) => o.code)).toContain("QA");
    expect(filterCountries(en, "reunion").map((o) => o.code)).toContain("RE");
    expect(filterCountries(en, "zzzz")).toEqual([]);
    expect(filterCountries(countryOptions("ar"), "قطر").map((o) => o.code)).toEqual(["QA"]);
  });
});
