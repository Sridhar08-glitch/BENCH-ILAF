import { describe, expect, it } from "vitest";
import { backStep, goTo, isDone, isFirst, isLast, nextLabel, nextStep, shouldWarnOnLeave, startFlow, stepsFor, summaryRows } from "./steps";
import { brandCardData, personById, PEOPLE } from "./sample";
import { fullBrand, withColours, withMode } from "./state";
import { COMPANY_COLOUR, defaultDesign } from "@/lib/library";
import type { Brand } from "@/lib/types";
import { createI18n } from "@/lib/i18n";
import { en } from "@/lib/i18n/messages";

const i18n = createI18n("en", "latn", en);

const base: Brand = {
  company_name: "Gulf Studio", logo_url: null, website: "gulf.example", design: defaultDesign(), lock_design: false, show_footer: true,
} as Brand;

describe("brand steps", () => {
  it("has six steps for a company and the three that apply to a personal workspace", () => {
    expect(stepsFor(true).map((s) => s.id)).toEqual(["company", "colours", "logo", "artwork", "style", "finish"]);
    expect(stepsFor(false).map((s) => s.id)).toEqual(["company", "style", "finish"]);
  });

  it("moves forward and back and never leaves the range", () => {
    const n = 6;
    let f = startFlow();
    expect(isFirst(f)).toBe(true);
    expect(backStep(f, n).index).toBe(0);
    f = nextStep(f, n);
    expect(f.index).toBe(1);
    for (let i = 0; i < 10; i++) f = nextStep(f, n);
    expect(f.index).toBe(5);
    expect(isLast(f, n)).toBe(true);
    expect(nextLabel(f, n, i18n.t)).toBe("Done");
    expect(nextLabel(startFlow(), n, i18n.t)).toBe("Next");
    expect(goTo(f, -4, n).index).toBe(0);
    expect(goTo(f, 99, n).index).toBe(5);
  });

  it("marks the steps that were left as done, and jumping back keeps them done", () => {
    const n = 6;
    let f = startFlow();
    f = nextStep(nextStep(f, n), n);
    expect([0, 1, 2].map((i) => isDone(f, i))).toEqual([true, true, false]);
    f = goTo(f, 0, n);
    expect([0, 1, 2, 3].map((i) => isDone(f, i))).toEqual([false, true, true, false]);
  });

  it("warns on leaving only while there is something unsaved or a save is running", () => {
    expect(shouldWarnOnLeave(false, false)).toBe(false);
    expect(shouldWarnOnLeave(true, false)).toBe(true);
    expect(shouldWarnOnLeave(false, true)).toBe(true);
  });
});

describe("brand summary", () => {
  it("lists every choice in plain words", () => {
    const b = withMode(withColours(fullBrand(base), { primary: "#0f2d5c", accent: "#ff6b35", mode: "brand" }), "background");
    const rows = Object.fromEntries(summaryRows(b, "Workspace", true, i18n).map((r) => [r.label, r.value]));
    expect(rows["Company name on cards"]).toBe("Gulf Studio");
    expect(rows["Brand colours"]).toContain("#0F2D5C and #FF6B35");
    expect(rows["Brand appears as"]).toBe("Background");
    expect(rows["Design locked for everyone"]).toMatch(/^No/);
    expect(rows["Powered by line on cards"]).toBe("Shown");
    expect(rows["Logo"]).toBe("None yet");
  });

  it("falls back to the workspace name, and names the company colours when the design uses them", () => {
    const b = fullBrand({ ...base, company_name: "", website: "", design: { ...defaultDesign(), colour: COMPANY_COLOUR } });
    const rows = Object.fromEntries(summaryRows(b, "My Co", true, i18n).map((r) => [r.label, r.value]));
    expect(rows["Company name on cards"]).toBe("My Co");
    expect(rows["Website"]).toBe("Not set");
    expect(rows["Card colours"]).toBe("Company colours");
    expect(rows["Brand colours"]).toBe("Not used");
  });

  it("shows the company country, or Not set", () => {
    const b = fullBrand(base);
    const rows = (country?: string) => Object.fromEntries(summaryRows(b, "Workspace", true, i18n, country).map((r) => [r.label, r.value]));
    expect(rows()["Country"]).toBe("Not set");
    expect(rows("Qatar")["Country"]).toBe("Qatar");
    expect(summaryRows(b, "Me", false, i18n, "Qatar").map((r) => r.label)).not.toContain("Country");
  });

  it("leaves the company-only rows out for a personal workspace", () => {
    const labels = summaryRows(fullBrand(base), "Me", false, i18n).map((r) => r.label);
    expect(labels).not.toContain("Brand colours");
    expect(labels).toContain("Card face");
  });
});

describe("sample employees", () => {
  it("draws the chosen person in the company design and falls back to the first", () => {
    const b = fullBrand(base);
    const d = brandCardData(b, "Gulf Studio", PEOPLE[1].id, null);
    expect(d.name).toBe(PEOPLE[1].name);
    expect(d.company).toBe("Gulf Studio");
    expect(d.footer).toBe(true);
    expect(personById("nobody").id).toBe(PEOPLE[0].id);
  });
});
