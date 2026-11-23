import { describe, expect, it } from "vitest";
import { PALETTES } from "./generated/meta";
import { derivePalette, cr, rl, toHsl } from "./company/colour";
import { pageBackground, pageColours, pageVarsOf, MIN_STAND_OUT } from "./page";
import { COMPANY_COLOUR, resolveColours } from "./index";
import { buildInput } from "./render";
import { defaultDesign } from "./index";
import type { CardPageData } from "./types";

const HEX = /^#[0-9a-f]{6}$/i;

const company = (p: string, a: string, m: "brand" | "light" | "dark") => derivePalette(p, a, m).pal;
const COMPANY_PALETTES = [
  company("#0F2D5C", "#D2A63B", "brand"), company("#12A38A", "#0B3C5D", "light"), company("#F2B705", "#222222", "brand"),
  company("#1F6FEB", "#22D3EE", "dark"), company("#FFEB3B", "#FFFDE7", "brand"), company("#FFFFFF", "#CCCCCC", "light"),
  company("#000000", "#111111", "dark"), company("#6B1F3A", "#9C7A3C", "light"), company("#D9381E", "#FFFFFF", "brand"), company("#7F7F7F", "#FFFFFF", "brand"),
];

const everyColourway = [...PALETTES, ...COMPANY_PALETTES.map((p, i) => ({ name: `company ${i}`, ...p, bg2: p.bg2 }))];

describe("page colour: the card stands out", () => {
  it("is clearly different from the card colour in every colourway", () => {
    for (const p of everyColourway) {
      const bg = pageBackground(p.bg);
      expect(bg, p.name).toMatch(HEX);
      const ratio = cr(bg, p.bg);
      // a light card cannot be told apart by luminance alone as much as a dark one, so it gets a lower floor; its edge carries the rest
      const light = rl(p.bg) >= 0.5 && toHsl(p.bg)[1] * (1 - Math.abs(2 * toHsl(p.bg)[2] - 1)) < 0.45;
      expect(ratio, `${p.name} ${p.bg} on ${bg}`).toBeGreaterThanOrEqual(light ? 1.2 : MIN_STAND_OUT);
    }
  });

  it("lifts a dark card, darkens a light card, and uses a neutral for a vivid one", () => {
    const dark = pageBackground("#0F1424");
    expect(rl(dark)).toBeGreaterThan(rl("#0F1424"));
    expect(toHsl(dark)[0]).toBeCloseTo(toHsl("#0F1424")[0], -1);
    // about 14 to 18 points of lightness
    expect(toHsl(dark)[2] - toHsl("#0F1424")[2]).toBeGreaterThan(0.13);
    expect(toHsl(dark)[2] - toHsl("#0F1424")[2]).toBeLessThan(0.2);
    const light = pageBackground("#FAF7F0");
    expect(rl(light)).toBeLessThan(rl("#FAF7F0"));
    expect(toHsl("#FAF7F0")[2] - toHsl(light)[2]).toBeGreaterThan(0.07);
    expect(toHsl("#FAF7F0")[2] - toHsl(light)[2]).toBeLessThan(0.13);
    // yellow and orange get a deep or pale neutral (low colour), not a tint of themselves
    for (const vivid of ["#FFE14D", "#FF6B35"]) {
      const bg = pageBackground(vivid);
      const [, s] = toHsl(bg);
      expect(s * (1 - Math.abs(2 * toHsl(bg)[2] - 1)), vivid).toBeLessThan(0.15);
      expect(cr(bg, vivid), vivid).toBeGreaterThanOrEqual(MIN_STAND_OUT);
    }
  });

  it("keeps text 4.5 : 1 and buttons 3 : 1 on the new page", () => {
    for (const p of everyColourway) {
      const c = pageColours(p);
      for (const v of Object.values({ bg: c.bg, fg: c.fg, acc: c.acc, on: c.on, line: c.line })) expect(v, p.name).toMatch(HEX);
      expect(cr(c.fg, c.bg), `${p.name} text`).toBeGreaterThanOrEqual(4.5);
      expect(cr(c.acc, c.bg), `${p.name} accent`).toBeGreaterThanOrEqual(3);
      expect(cr(c.on, c.acc), `${p.name} on accent`).toBeGreaterThanOrEqual(3);
    }
  });

  it("derives the card edge from the page", () => {
    const v = pageVarsOf({ bg: "#0F1424", fg: "#F2F5FF", acc: "#7FA2FF", on: "#0B1020" });
    expect(Object.keys(v).sort()).toEqual(["--pacc", "--pgbg", "--pgfg", "--pgline", "--pgsh", "--pon"]);
    expect(v["--pgline"]).toMatch(HEX);
    expect(v["--pgsh"]).toMatch(/^rgba\(/);
    expect(cr(v["--pgline"], v["--pgbg"])).toBeGreaterThan(1.1);
  });

  it("is what resolveColours and the card page use, also for the company palette", () => {
    const pal = COMPANY_PALETTES[0];
    const r = resolveColours({ face: 3, colour: COMPANY_COLOUR }, pal);
    expect(r.pageVars["--pgbg"]).toBe(pageBackground(pal.bg));
    const data: CardPageData = {
      name: "A B", title: "", company: "", address: "", photoUrl: null, saveContact: true, publicUrl: "https://x.y/c/1", items: [{ kind: "Mobile", value: "1234567" }],
      design: { ...defaultDesign(), face: 3, colour: COMPANY_COLOUR }, brand: { companyName: "X", logoUrl: null, palette: pal },
    };
    expect(buildInput(data).page).toEqual(r.pageVars);
  });
});
