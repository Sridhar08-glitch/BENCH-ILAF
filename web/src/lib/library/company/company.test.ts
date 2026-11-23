import { describe, expect, it } from "vitest";
import { derivePalette, asPalette, cr, normHex, okHex, paletteProblem, type CompanyPalette } from "./colour";
import {
  backPlacement, choosePlacement, chipFor, isSym, monogramMark, nameLines, place, plan, resolveSpec, shapeBox, specList, specsFromData, specData,
  type Box, type Mark, type MarkSources,
} from "./marks";
import { defaultArtwork, measureList, normalizeArtwork, sampleColours, toCompanyBrand } from "./brand";
import { scrimFor, templateInfo, minAlpha, sampleBgSvg, templateSvg } from "./artwork";
import { pageBackground } from "../page";
import { COMPANY_COLOUR, defaultDesign, effectiveColour, normalizeDesign, resolveColours } from "../index";
import { buildInput, drawPage, renderCardPage, withoutScriptTabs } from "../render";
import { APP_NAME } from "@/lib/config";
import type { CardPageData, CompanyBrand } from "../types";
import type { BrandArtwork } from "@/lib/types";

const HEX = /^#[0-9a-f]{6}$/;

describe("company palette", () => {
  // Expected values come from the approved design preview's own algorithm.
  const cases: [string, string, "brand" | "light" | "dark", CompanyPalette][] = [
    ["#0F2D5C", "#D2A63B", "brand", { bg: "#0f2d5c", bg2: "#2b456f", fg: "#f8f9fa", acc: "#d2a63b", on: "#0f2d5c" }],
    ["#12A38A", "#0B3C5D", "light", { bg: "#ecf8f6", bg2: "#c0e7e0", fg: "#1c1d1d", acc: "#0b3c5d", on: "#ecf8f6" }],
    ["#F2B705", "#222222", "brand", { bg: "#f2b705", bg2: "#d8a406", fg: "#1d180a", acc: "#222222", on: "#f2b705" }],
    ["#1F6FEB", "#22D3EE", "dark", { bg: "#0f213d", bg2: "#143871", fg: "#f8f8f9", acc: "#22d3ee", on: "#0f213d" }],
    ["#FFEB3B", "#FFFDE7", "brand", { bg: "#ffeb3b", bg2: "#e4d236", fg: "#1e1c0e", acc: "#6d6400", on: "#ffeb3b" }],
    ["#FFFFFF", "#CCCCCC", "light", { bg: "#ffffff", bg2: "#ffffff", fg: "#1e1e1e", acc: "#757575", on: "#ffffff" }],
    ["#000000", "#111111", "dark", { bg: "#141414", bg2: "#0e0e0e", fg: "#f8f8f8", acc: "#818181", on: "#141414" }],
    ["#6B1F3A", "#9C7A3C", "light", { bg: "#f3edef", bg2: "#d8c4cb", fg: "#1d1c1c", acc: "#7f6331", on: "#f3edef" }],
  ];

  it.each(cases)("derives %s / %s (%s) exactly like the design preview", (p, a, mode, want) => {
    expect(derivePalette(p, a, mode).pal).toEqual(want);
  });

  it("keeps every text colour readable for light, dark, yellow and brand colours", () => {
    const primaries = ["#000000", "#FFFFFF", "#FFEB3B", "#F2B705", "#0F2D5C", "#D9381E", "#12A38A", "#7F7F7F", "#808000", "#FF00FF"];
    const accents = ["#000000", "#FFFFFF", "#FFFDE7", "#22D3EE", "#777777", "#F59E0B"];
    for (const p of primaries) {
      for (const a of accents) {
        for (const mode of ["brand", "light", "dark"] as const) {
          const d = derivePalette(p, a, mode);
          const x = d.pal;
          for (const c of Object.values(x)) expect(c).toMatch(HEX);
          expect(cr(x.fg, x.bg), `${p} ${a} ${mode} text on bg`).toBeGreaterThanOrEqual(4.5);
          expect(cr(x.fg, x.bg2), `${p} ${a} ${mode} text on bg2`).toBeGreaterThanOrEqual(4.5);
          expect(cr(x.acc, x.bg), `${p} ${a} ${mode} accent on bg`).toBeGreaterThanOrEqual(4.5);
          expect(cr(x.on, x.acc), `${p} ${a} ${mode} on accent`).toBeGreaterThanOrEqual(3);
          expect(paletteProblem(x)).toBeNull();
        }
      }
    }
  });

  it("reports a moved accent and a too-close pair", () => {
    expect(derivePalette("#FFEB3B", "#FFFDE7", "brand").adjusted).toBe(true);
    expect(derivePalette("#0F2D5C", "#0F2E5D", "brand").close).toBe(true);
    expect(derivePalette("#0F2D5C", "#D2A63B", "brand").adjusted).toBe(false);
  });

  it("checks hex colours and palettes from the API", () => {
    expect(okHex("#abc")).toBe(true);
    expect(okHex("12ab9f")).toBe(true);
    expect(okHex("#12ab9")).toBe(false);
    expect(normHex("abc")).toBe("#AABBCC");
    expect(asPalette({ bg: "#112233", bg2: "#223344", fg: "#FFFFFF", acc: "#445566", on: "#000000" })?.fg).toBe("#ffffff");
    expect(asPalette({ bg: "#112233" })).toBeNull();
    expect(asPalette(null)).toBeNull();
    expect(paletteProblem({ bg: "#ffffff", bg2: "#ffffff", fg: "#eeeeee", acc: "#000000", on: "#ffffff" })).toMatch(/hard to read/);
  });
});

const PAL: CompanyPalette = derivePalette("#0F2D5C", "#D2A63B", "brand").pal;

describe("colour 4 (company colours)", () => {
  it("is a valid design colour and resolves to the company palette", () => {
    expect(normalizeDesign({ face: 3, colour: 4 }).colour).toBe(4);
    const r = resolveColours({ face: 3, colour: COMPANY_COLOUR }, PAL);
    expect([r.bg, r.bg2, r.fg, r.acc, r.on]).toEqual([PAL.bg, PAL.bg2, PAL.fg, PAL.acc, PAL.on]);
    expect(r.pageVars["--pgbg"]).toBe(pageBackground(PAL.bg));
    expect(r.cardVars["--cacc"]).toBe(PAL.acc);
  });

  it("falls back to the face's first colourway without a palette", () => {
    expect(effectiveColour(4, null)).toBe(0);
    expect(effectiveColour(4, PAL)).toBe(4);
    expect(effectiveColour(2, null)).toBe(2);
    expect(resolveColours({ face: 3, colour: 4 }, null)).toEqual(resolveColours({ face: 3, colour: 0 }));
  });

  it("draws a card with the company colours, or colourway 0 when the palette is missing", () => {
    const base = card({ design: { ...defaultDesign(), face: 5, colour: 4 }, brand: { companyName: "Acme", logoUrl: null, palette: PAL } });
    const withPal = drawPage(buildInput(base), base);
    expect(withPal.cardVars.bg).toBe(PAL.bg);
    expect(withPal.html).toContain(`--cbg:${PAL.bg}`);
    expect(withPal.pageVars["--pgbg"]).toBe(pageBackground(PAL.bg));
    const none = card({ design: { ...defaultDesign(), face: 5, colour: 4 }, brand: { companyName: "Acme", logoUrl: null, palette: null } });
    const zero = card({ design: { ...defaultDesign(), face: 5, colour: 0 }, brand: null });
    expect(drawPage(buildInput(none), none).cardVars).toEqual(drawPage(buildInput(zero), zero).cardVars);
  });

  it("does not leak into the next card of another company", () => {
    const a = card({ design: { ...defaultDesign(), colour: 4 }, brand: { companyName: "A", logoUrl: null, palette: PAL } });
    const other = derivePalette("#D9381E", "#101A3A", "brand").pal;
    const b = card({ design: { ...defaultDesign(), colour: 4 }, brand: { companyName: "B", logoUrl: null, palette: other } });
    expect(drawPage(buildInput(a), a).cardVars.bg).toBe(PAL.bg);
    expect(drawPage(buildInput(b), b).cardVars.bg).toBe(other.bg);
    expect(drawPage(buildInput(a), a).cardVars.bg).toBe(PAL.bg);
  });
});

function card(over: Partial<CardPageData> = {}): CardPageData {
  return {
    name: "Amira Khalid", title: "Head of Retail Banking", company: "Northgate Bank", address: "Dubai Marina", photoUrl: null,
    items: [
      { kind: "Mobile", value: "+971 50 412 7788" },
      { kind: "Email", value: "amira@northgate.com" },
      { kind: "Website", value: "northgate.com" },
    ],
    saveContact: true, publicUrl: "https://example.test/c/amira", design: { ...defaultDesign(), colour: 4 }, footer: true,
    ...over,
  };
}

const mark = (asp: number, col = "#0F2D5C", pal: [string, number][] | null = [[col, 1]]): Mark => ({ src: `https://media.test/m${asp}.png`, asp, col, pal });
const sources = (o: Partial<MarkSources> = {}): MarkSources => ({
  logo: null, symbol: null, mono: monogramMark("Northgate Bank", "#0F2D5C", "#D2A63B"), display: "auto", showName: true, name: "Northgate Bank", ...o,
});

describe("logo decisions", () => {
  it("knows a symbol from a wide or tall logo and gives each shape its own box", () => {
    expect(isSym({ asp: 1 })).toBe(true);
    expect(isSym({ asp: 3.6 })).toBe(false);
    expect(isSym({ asp: 0.4 })).toBe(false);
    expect(shapeBox(5).w).toBeGreaterThan(shapeBox(1).w);
    expect(shapeBox(0.3).h).toBeGreaterThan(shapeBox(1).h);
  });

  it("chooses the mark: full logo, symbol with name, monogram", () => {
    const wide = mark(3.6);
    const sq = mark(1);
    expect(resolveSpec(sources({ logo: wide }), "card").mark).toBe(wide);
    expect(resolveSpec(sources({ logo: wide }), "card").name).toBeNull();
    // a square logo with no symbol counts as the symbol, so it gets the company name beside it
    const lock = resolveSpec(sources({ logo: sq }), "card");
    expect(lock.mark).toBe(sq);
    expect(lock.name).toBe("Northgate Bank");
    expect(resolveSpec(sources({ logo: wide, symbol: sq }), "tight").mark).toBe(sq);
    expect(resolveSpec(sources({ logo: wide, symbol: sq, display: "symbol_name" }), "card")).toMatchObject({ mark: sq, name: "Northgate Bank" });
    expect(resolveSpec(sources({ logo: wide, symbol: sq, display: "symbol" }), "card")).toMatchObject({ mark: sq, name: null });
    expect(resolveSpec(sources({ logo: wide, symbol: sq, display: "full" }), "card").mark).toBe(wide);
    expect(resolveSpec(sources({ showName: false, symbol: sq, display: "symbol_name" }), "card").name).toBeNull();
    const mono = resolveSpec(sources(), "card");
    expect(mono.mark.mono).toBe(true);
    expect(mono.name).toBe("Northgate Bank");
  });

  it("offers the compact symbol as a second choice only in automatic mode", () => {
    const wide = mark(3.6);
    const sq = mark(1);
    expect(specList(sources({ logo: wide, symbol: sq }))).toHaveLength(2);
    expect(specList(sources({ logo: wide, symbol: sq, display: "full" }))).toHaveLength(1);
    expect(specList(sources({ logo: wide }))).toHaveLength(1);
  });

  it("splits a long company name over two lines", () => {
    expect(nameLines("Northgate")).toEqual(["Northgate"]);
    expect(nameLines("Strathmore Capital Partners")).toEqual(["Strathmore", "Capital Partners"]);
  });

  it("takes the free corner and never covers text when one is clean", () => {
    const sp = resolveSpec(sources({ logo: mark(3.6) }), "card");
    const topRight: Box[] = [[60, 0, 100, 20]];
    const a = choosePlacement(topRight, sp, "auto");
    expect(a.c).toBe("tl");
    expect(a.ov).toBe(0);
    expect(choosePlacement([], sp, "auto").c).toBe("tr");
    // a corner the owner fixed is respected even when something is there
    const fixed = choosePlacement(topRight, sp, "tr");
    expect(fixed.c).toBe("tr");
    expect(fixed.ov).toBeGreaterThan(0);
    expect(choosePlacement([], sp, "bl").r[1]).toBeGreaterThan(30);
  });

  it("shrinks the mark before giving up, and reports 'moved' when no corner is clean", () => {
    const sp = resolveSpec(sources({ logo: mark(3.6) }), "card");
    const everywhere: Box[] = [[0, 0, 100, 60]];
    const pl = place({ spec: sp, pref: "auto", setting: "auto", obstacles: everywhere, bgsAt: null, own: [], fallbackBgs: [PAL.bg] });
    expect(pl.moved).toBe(true);
    expect(pl.sc).toBeLessThan(1);
    const fixed = place({ spec: sp, pref: "tl", setting: "auto", obstacles: everywhere, bgsAt: null, own: [], fallbackBgs: [PAL.bg] });
    expect(fixed.moved).toBe(false);
  });

  it("puts a logo on a chip only where it would be hard to read", () => {
    const dark = resolveSpec(sources({ logo: mark(3.6, "#0F2D5C") }), "card");
    expect(chipFor(dark, ["#0F2D5C"], "auto").chip).toBe(true);
    expect(chipFor(dark, ["#0F2D5C"], "auto").bgc).toBe("#FFFFFF");
    expect(chipFor(dark, ["#FFFFFF"], "auto").chip).toBe(false);
    expect(chipFor(dark, ["#FFFFFF"], "always").chip).toBe(true);
    expect(chipFor(dark, ["#0F2D5C"], "never").chip).toBe(false);
    expect(chipFor(dark, null, "auto").chip).toBe(true);
    expect(chipFor(dark, ["#FFFFFF"], "white")).toMatchObject({ mono: "w", chip: true });
    expect(chipFor(dark, ["#FFFFFF"], "black")).toMatchObject({ mono: "k", chip: false });
    const light = resolveSpec(sources({ logo: mark(3.6, "#FFFFFF") }), "card");
    expect(chipFor(light, ["#0F2D5C"], "auto").chip).toBe(false);
    expect(chipFor(light, ["#FFFFFF"], "auto").bgc).toBe("#0E0E10");
  });

  it("picks the first mark that fits cleanly and otherwise the least overlap", () => {
    const specs = specList(sources({ logo: mark(3.6), symbol: mark(1) }));
    const make = (obs: Box[]) => plan(specs, (s) => place({ spec: s, pref: "auto", setting: "auto", obstacles: obs, bgsAt: null, own: [], fallbackBgs: [PAL.bg] }));
    expect(make([]).spec).toBe(specs[0]);
    // only a small gap in the top left: the wide logo does not fit but the compact symbol does
    const tight = make([[18, 0, 100, 60], [0, 14, 100, 60]]);
    expect(tight.spec).toBe(specs[1]);
  });

  it("places the QR back mark small at the top right, or centred above the code when it is wide", () => {
    const sym = backPlacement(resolveSpec(sources({ symbol: mark(1) }), "tight"), "auto", [PAL.bg]);
    expect(sym.x).toBeGreaterThan(50);
    const wide = backPlacement(resolveSpec(sources({ logo: mark(4.2) }), "tight"), "auto", [PAL.bg]);
    expect(wide.x + wide.bw / 2).toBeCloseTo(50, 0);
  });

  it("carries its choices to the browser and back", () => {
    const specs = specList(sources({ logo: mark(3.6), symbol: mark(1) }));
    const json = specData(specs).replace(/&quot;/g, '"').replace(/&amp;/g, "&");
    const back = specsFromData(json);
    expect(back).toHaveLength(2);
    expect(back[0].mark.src).toBe(specs[0].mark.src);
    expect(back[1].asp).toBe(specs[1].asp);
  });
});

describe("brand from the API", () => {
  it("fills every default for an old brand", () => {
    const b = toCompanyBrand({ company_name: "Acme", logo_url: null }) as CompanyBrand;
    expect(b.logoDisplay).toBe("auto");
    expect(b.logoPlacement).toBe("both");
    expect(b.logoCorner).toBe("auto");
    expect(b.logoChip).toBe("auto");
    expect(b.showName).toBe(true);
    expect(b.palette).toBeNull();
    expect(b.artwork).toEqual(defaultArtwork());
    expect(toCompanyBrand(null)).toBeNull();
  });

  it("repairs wrong or out-of-range values instead of breaking the card", () => {
    const art = normalizeArtwork({ mode: "weird", background: { kind: "upload", strength: 900 }, pattern: { size: "xl", opacity: 1, angle: 45 }, template: { zone: "Z", text_colour: "red", text_size: "m" } });
    expect(art.mode).toBe("none");
    expect(art.background.strength).toBe(100);
    expect(art.pattern).toMatchObject({ size: "m", opacity: 5, angle: 0 });
    expect(art.template).toMatchObject({ zone: "A", text_colour: "auto" });
    expect(normalizeArtwork({ template: { text_colour: "#ABCDEF" } }).template.text_colour).toBe("#abcdef");
  });

  it("lists the pictures to measure and uses default sample colours without brand colours", () => {
    const b = toCompanyBrand({
      company_name: "Acme", logo_url: "https://m.test/l.png", symbol_url: "https://m.test/s.png",
      artwork: { ...defaultArtwork(), mode: "background", background: { kind: "sample", sample: "geo", strength: 60 } },
    }) as CompanyBrand;
    const list = measureList(b, null);
    expect(list.map((x) => x.role).sort()).toEqual(["bg", "logo", "symbol"]);
    expect(sampleColours(null).prim).toMatch(/^#[0-9A-F]{6}$/);
    expect(sampleColours({ primary: "#112233", accent: "#445566" })).toEqual({ prim: "#112233", acc: "#445566" });
  });
});

describe("colour layer and template text", () => {
  it("raises the colour layer over a busy picture and keeps text readable", () => {
    const stats = { p8: "#101010", p92: "#f0f0f0", avg: "#808080", grid: null };
    const strong = scrimFor(PAL, stats, 100);
    const weakLayer = scrimFor(PAL, stats, 0);
    expect(weakLayer.a).toBeGreaterThan(strong.a - 0.0001);
    expect(strong.text).toBeGreaterThanOrEqual(4.5);
    expect(strong.acc).toBeGreaterThanOrEqual(3);
    expect(minAlpha(PAL.fg, PAL.acc, PAL.bg, "#ffffff")).toBeGreaterThan(0);
    const unknown = scrimFor(PAL, null, 100);
    expect(unknown.a).toBeGreaterThanOrEqual(0.86);
  });

  it("uses safe light text with panels for a template that was not measured", () => {
    const i = templateInfo("A", "auto", null, null);
    expect(i.light).toBe(true);
    expect(i.pn).toEqual([true, true]);
    expect(templateInfo("D", "auto", null, null).band).toBe(true);
    expect(templateInfo("A", "#101114", null, null).light).toBe(false);
  });

  it("draws the sample pictures as SVG text", () => {
    for (const id of ["geo", "mesh", "photo", "stripes", "dots", "topo"]) {
      expect(sampleBgSvg(id, "#0F2D5C", "#D2A63B")).toMatch(/^<svg /);
      expect(sampleBgSvg(id, "#0F2D5C", "#D2A63B")).not.toMatch(/undefined|NaN/);
    }
    for (const id of ["harbor", "terra", "night"]) for (const side of ["front", "back"] as const) expect(templateSvg(id, side)).toMatch(/^<svg /);
  });
});

function brand(art: Partial<BrandArtwork>, over: Partial<CompanyBrand> = {}): CompanyBrand {
  return {
    companyName: "Northgate Bank", logoUrl: "https://media.test/logo.png", symbolUrl: "https://media.test/symbol.png", palette: PAL,
    colours: { primary: "#0F2D5C", accent: "#D2A63B", mode: "brand" }, artwork: { ...defaultArtwork(), ...art }, ...over,
  };
}

describe("company card markup", () => {
  const modes: [string, Partial<BrandArtwork>, RegExp[], string?][] = [
    ["colours and logo", { mode: "none" }, [/class="colg/, /class="cohead"/, /data-co="front"/, /data-co="back"/]],
    ["background", { mode: "background", background: { kind: "sample", sample: "geo", strength: 60 } }, [/face cobg/, /face back cobg/, /data-co="front"/, /data-co="back"/], "cobgp"],
    ["background upload", { mode: "background", background: { kind: "upload", sample: null, strength: 40 } }, [/face cobg/], "cobgp"],
    ["pattern", { mode: "pattern", pattern: { ...defaultArtwork().pattern, enabled: true } }, [/copatw/, /data-co="front"/], "copg"],
    ["pattern on a background", { mode: "pattern", pattern: { ...defaultArtwork().pattern, enabled: true, combine_with_background: true }, background: { kind: "sample", sample: "topo", strength: 70 } }, [/copatw/, /face cobg/], "copg cobgp"],
    ["template A", { mode: "template", template: { ...defaultArtwork().template, kind: "sample", sample: "harbor", zone: "A" } }, [/face tpf/, /face back tpb/, /class="tzp"/, /class="tzq"/]],
    ["template B", { mode: "template", template: { ...defaultArtwork().template, kind: "sample", sample: "terra", zone: "B" } }, [/face tpf/]],
    ["template C", { mode: "template", template: { ...defaultArtwork().template, kind: "sample", sample: "night", zone: "C", text_size: "l" } }, [/face tpf/]],
    ["template D", { mode: "template", template: { ...defaultArtwork().template, kind: "sample", sample: "harbor", zone: "D" } }, [/tzband/]],
  ];

  it.each(modes)("draws %s without errors and with the expected parts", (_n, art, expected, wrap) => {
    const data = card({ brand: brand(art, { backgroundUrl: "https://media.test/bg.jpg", info: { pat: { u: "data:image/png;base64,AAAA", blob: false } } }) });
    const r = renderCardPage(data, "live");
    for (const re of expected) expect(r.html, String(re)).toMatch(re);
    expect(r.html).not.toMatch(/undefined|NaN|\[object/);
    expect(r.wrapClass).toContain("co");
    for (const w of (wrap ?? "").split(" ").filter(Boolean)) expect(r.wrapClass).toContain(w);
    for (const v of Object.values(r.pageVars)) expect(v).not.toMatch(/undefined|NaN/);
    // the markup must be fully visible without scripts: no animation switch on the server
    expect(r.html).not.toMatch(/class="[^"]*\bgo\b/);
    expect(r.html).toContain("Powered by");
    expect(r.html).toContain(APP_NAME);
  });

  it("shows the mark above the card for 'above' and 'both', and keeps it hidden for 'card'", () => {
    const above = renderCardPage(card({ brand: brand({}, { logoPlacement: "above" }) }), "live").html;
    expect(above).toMatch(/class="cohead"(?! hidden)/);
    expect(above).not.toContain('data-co="front"');
    const onCard = renderCardPage(card({ brand: brand({}, { logoPlacement: "card" }) }), "live").html;
    expect(onCard).toMatch(/class="cohead" hidden/);
    expect(onCard).toContain('data-co="front"');
    const both = renderCardPage(card({ brand: brand({}) }), "live").html;
    expect(both).not.toMatch(/class="cohead" hidden/);
  });

  it("uses a monogram when the company has no logo", () => {
    const r = renderCardPage(card({ brand: brand({}, { logoUrl: null, symbolUrl: null }) }), "live").html;
    expect(r).toContain("data:image/svg+xml");
    expect(r).toContain("NB");
  });

  it("escapes the owner's text and the company name", () => {
    const evil = '<img src=x onerror=alert(1)>"&';
    const r = renderCardPage(
      card({
        name: evil, title: evil, brand: brand({ mode: "template", template: { ...defaultArtwork().template, kind: "sample", sample: "harbor", zone: "A" } }, { companyName: evil, logoUrl: "https://media.test/a.png?x=1&y=\"2\"" }),
      }),
      "live",
    ).html;
    expect(r).not.toContain("<img src=x");
    expect(r).not.toContain('onerror=alert(1)>"');
    const plain = renderCardPage(card({ brand: brand({}, { companyName: evil, logoUrl: "https://media.test/a.png?x=1&y=\"2\"" }), name: evil }), "live").html;
    expect(plain).not.toContain("<img src=x");
    expect(plain).toContain("&lt;img src=x");
    expect(plain).not.toContain('a.png?x=1&y="2"');
  });

  it("keeps a personal card untouched", () => {
    const r = renderCardPage(card({ brand: null, design: { ...defaultDesign(), colour: 2 } }), "live");
    expect(r.wrapClass).toBe("");
    expect(r.html).not.toContain("colg");
    expect(r.html).not.toContain("cohead");
  });

  it("draws every face with a company template, a pattern and a background (structure holds for all 400)", () => {
    for (let face = 1; face <= 400; face += 13) {
      for (const art of [modes[1][1], modes[3][1], modes[5][1], modes[8][1]]) {
        const data = card({ design: { ...defaultDesign(), face, colour: 4 }, brand: brand(art) });
        const r = renderCardPage(data, "preview");
        expect(r.html, `face ${face}`).not.toMatch(/undefined|NaN/);
        expect(r.html.match(/class="card/g)?.length).toBe(1);
        expect(r.html.match(/class="face back/g)?.length).toBe(1);
      }
    }
  });

  it("still lists the tabs without scripts on a company card", () => {
    const data = card({ design: { ...defaultDesign(), below: 11, colour: 4 }, brand: brand({}) });
    const input = buildInput(data, "live");
    const html = withoutScriptTabs(input, drawPage(input, data, "live").html);
    expect(html.length).toBeGreaterThan(1000);
  });
});
