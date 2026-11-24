import { describe, expect, it } from "vitest";
import {
  BELOW_COUNT, COLOUR_COUNT, FACE_COUNT, INTRO_COUNT, belowInfo, defaultDesign, faceInfo, introInfo, normalizeDesign, resolveColours,
} from "./index";
import { iconHtml } from "./icons";
import { renderCardPage, renderPage, renderTab, buildInput, withoutScriptTabs } from "./render";
import type { CardPageData } from "./types";
import type { Design } from "@/lib/types";

const HEX = /^#[0-9a-f]{6}$/i;

const sample: CardPageData = {
  name: "Sara Al Mansoori",
  title: "Brand Designer",
  company: "Studio Noor",
  address: "West Bay, Doha",
  photoUrl: "https://example.com/p.jpg",
  coverUrl: "https://example.com/c.jpg",
  saveContact: true,
  publicUrl: "https://cards.example/c/sara",
  design: defaultDesign(),
  brand: { companyName: "Studio Noor", logoUrl: "https://example.com/logo.png" },
  items: [
    { kind: "Mobile", value: "+974 5512 3344" },
    { kind: "WhatsApp", value: "+974 5512 3344" },
    { kind: "Email", value: "sara@studionoor.qa" },
    { kind: "Website", value: "studionoor.qa" },
    { kind: "Location", value: "West Bay, Doha" },
    { kind: "Instagram", value: "studionoor" },
    { kind: "LinkedIn", value: "linkedin.com/in/sara" },
    { kind: "Facebook", value: "facebook.com/studionoor" },
    { kind: "X", value: "saranoor" },
    { kind: "YouTube", value: "youtube.com/@studionoor" },
    { kind: "GitHub", value: "saranoor" },
    { kind: "Calendly", value: "calendly.com/sara" },
    { kind: "TikTok", value: "tiktok.com/@sara" },
    { kind: "Custom", value: "https://shop.example.com/menu?a=1&b=2", label: "Our menu" },
  ],
};

const empty: CardPageData = { ...sample, name: "", title: "", company: "", address: "", photoUrl: null, coverUrl: null, brand: null, items: [] };

const design = (patch: Partial<Design>): Design => ({ ...defaultDesign(), ...patch });

describe("library size", () => {
  it("has 500 faces (400 plus Design Pack 2), 400 layouts and 400 openings", () => {
    expect(FACE_COUNT).toBe(500);
    expect(BELOW_COUNT).toBe(400);
    expect(INTRO_COUNT).toBe(400);
    expect(COLOUR_COUNT).toBe(4);
  });
  it("keeps the first 400 faces as they were and numbers Design Pack 2 from 401", () => {
    expect(faceInfo(400).name).toBe("Typewriter");
    expect(faceInfo(401).name).toBe("Crushed Velvet");
    expect(faceInfo(437).name.length).toBeGreaterThan(0);
    expect(faceInfo(500).name).toBe("Pearl Monument");
    const names = new Set<string>();
    for (let n = 401; n <= 500; n++) names.add(faceInfo(n).name);
    expect(names.size).toBe(100);
    // every pack face has a light colourway first, so the default colour reads well
    for (let n = 401; n <= 500; n++) expect(faceInfo(n).palettes[0].bg, `face ${n}`).toMatch(/^#[E-F][0-9A-F]{5}$/i);
  });
  it("gives every face a name, tags and four valid colourways", () => {
    for (let n = 1; n <= FACE_COUNT; n++) {
      const f = faceInfo(n);
      expect(f.name.length, `face ${n}`).toBeGreaterThan(0);
      expect(f.tags.length, `face ${n}`).toBeGreaterThan(0);
      expect(f.palettes, `face ${n}`).toHaveLength(4);
      for (const p of f.palettes) for (const c of [p.bg, p.bg2, p.fg, p.acc, p.on]) expect(c, `face ${n}`).toMatch(HEX);
    }
  });
  it("keeps the first 25 faces, 12 layouts and 22 openings in their old order", () => {
    expect(faceInfo(1).name).toBe("Classic");
    expect(faceInfo(25).name).toBe("Ribbon");
    expect(belowInfo(1).name).toBe("List");
    expect(belowInfo(12).name).toBe("Accordion");
    expect(introInfo(1).key).toBe("fade-up");
    expect(introInfo(22).key).toBe("ripple");
    expect(introInfo(0)).toEqual({ key: "none", name: "No animation" });
  });
  it("gives every layout and opening a name", () => {
    for (let n = 1; n <= BELOW_COUNT; n++) expect(belowInfo(n).name.length, `layout ${n}`).toBeGreaterThan(0);
    const keys = new Set<string>();
    for (let n = 1; n <= INTRO_COUNT; n++) {
      const i = introInfo(n);
      expect(i.name.length, `opening ${n}`).toBeGreaterThan(0);
      keys.add(i.key);
    }
    expect(keys.size).toBe(INTRO_COUNT);
  });
});

describe("colours", () => {
  it("resolves the colourway of a face", () => {
    const c = resolveColours({ face: 1, colour: 0 });
    expect(c).toMatchObject({ name: "BENCH", bg: "#FFFFFF", bg2: "#F6F7F9", fg: "#101114", acc: "#FF6B35", on: "#101114" });
    // the page is a different tint from the card so the card stands out (see page.test.ts)
    expect(c.pageVars["--pgbg"]).not.toBe(c.bg);
    expect(Object.keys(c.pageVars).sort()).toEqual(["--pacc", "--pgbg", "--pgfg", "--pgline", "--pgsh", "--pon"]);
    expect(c.cardVars["--cbg"]).toBe(c.bg);
    expect(resolveColours({ face: 1, colour: 3 }).acc).toBe(faceInfo(1).palettes[3].acc);
  });
  it("never throws on bad numbers", () => {
    expect(resolveColours({ face: 9999, colour: 9 }).bg).toMatch(HEX);
  });
});

describe("normalizeDesign", () => {
  it("keeps a valid numbered design", () => {
    const d = { face: 300, custom_face: null, colour: 2, below: 250, intro: 0, font: "lora", size: 130, photo: false, brand_colors: true, foot: false };
    expect(normalizeDesign(d)).toEqual(d);
    expect(normalizeDesign({ ...d, face: 400, below: 400, intro: 400 })).toMatchObject({ face: 400, below: 400, intro: 400 });
  });
  it("converts an old named design to the same positions", () => {
    const d = normalizeDesign({ face: "aurora", bg: "#111111", details: "dock", intro: "curtain", photo: false });
    expect(d).toEqual({ face: 23, custom_face: null, colour: 0, below: 9, intro: 16, font: "face", size: 100, photo: false, brand_colors: false, foot: true });
    expect(normalizeDesign({ face: "ribbon", details: "accordion", intro: "none" })).toMatchObject({ face: 25, below: 12, intro: 0 });
    expect(normalizeDesign({ face: "classic", details: "list", intro: "fade-up" })).toMatchObject({ face: 1, below: 1, intro: 1 });
  });
  it("adds the face font and the normal size to a design that has none", () => {
    const d = normalizeDesign({ face: 5, colour: 1, below: 2, intro: 3, photo: true, brand_colors: false, foot: true });
    expect([d.font, d.size]).toEqual(["face", 100]);
    expect([defaultDesign().font, defaultDesign().size]).toEqual(["face", 100]);
  });
  it("keeps only a known font and a whole size from 60 to 150", () => {
    expect(normalizeDesign({ font: "cairo", size: 60 })).toMatchObject({ font: "cairo", size: 60 });
    expect(normalizeDesign({ font: "poppins", size: 150 })).toMatchObject({ font: "poppins", size: 150 });
    for (const size of [59, 151, 100.5, "120", null, true, NaN]) expect(normalizeDesign({ size }).size, String(size)).toBe(100);
    for (const font of ["comic-sans", "", "Poppins", 3, null]) expect(normalizeDesign({ font }).font, String(font)).toBe("face");
  });
  it("falls back to the default for garbage", () => {
    expect(normalizeDesign(null)).toEqual(defaultDesign());
    expect(normalizeDesign("x")).toEqual(defaultDesign());
    expect(normalizeDesign({ face: "nope", colour: "2", below: 1.5, intro: -1, photo: "yes" })).toEqual(defaultDesign());
    expect(normalizeDesign({ face: 0, colour: 5, below: 401, intro: 401 })).toEqual(defaultDesign());
    expect(normalizeDesign({ face: 501 })).toEqual(defaultDesign());
    expect(normalizeDesign({ face: 500 }).face).toBe(500);
  });
});

describe("icons", () => {
  it("draws kind, brand, generic and uploaded logos", () => {
    expect(iconHtml("Mobile")).toContain("<path");
    expect(iconHtml("Instagram")).toContain("fill:currentColor");
    expect(iconHtml("Custom", { t: "brand", path: "M0 0h1v1z", hex: "FFFFFF", title: "x" })).toContain('d="M0 0h1v1z"');
    expect(iconHtml("Custom", { t: "lucide", key: "heart" })).toMatch(/<path d="[^"]+"/);
    expect(iconHtml("Custom", { t: "image", url: "https://x.test/a.png" })).toContain('src="https://x.test/a.png"');
  });
});

describe("engine", () => {
  it("draws the whole card page in plain markup", () => {
    const r = renderCardPage(sample, "live");
    expect(r.html).toContain('class="pg ls-rise"');
    expect(r.html).toContain("Sara");
    expect(r.html).toContain('class="card');
    expect(r.html).toContain('aria-label="QR code"');
    expect(r.html).toContain("data-save");
    expect(r.html).toContain("Powered by BENCH");
    expect(r.html).toContain("by iLAF Tech");
    expect(r.html).toContain(`class="cohead"`);
    expect(r.pageVars["--pgbg"]).toMatch(HEX);
  });
  it("starts without any animation class, so the card is visible without scripts", () => {
    const r = renderCardPage({ ...sample, design: design({ intro: 40 }) }, "live");
    expect(r.html).toContain(`in-${introInfo(40).key}`);
    expect(r.html).not.toMatch(/class="[^"]*\bgo\b/);
    expect(renderCardPage({ ...sample, design: design({ intro: 0 }) }, "live").html).not.toContain(" in-");
  });
  it("makes buttons real links, as href.ts builds them", () => {
    const html = renderCardPage(sample, "live").html;
    expect(html).toContain('href="tel:+97455123344"');
    expect(html).toContain('href="mailto:sara@studionoor.qa"');
    expect(html).toContain('href="https://wa.me/97455123344"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(html).toContain("&amp;b=2");
  });
  it("has nothing tappable in thumbnails", () => {
    const html = renderCardPage(sample, "thumb").html;
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Tap the card");
  });
  it("escapes what the owner typed", () => {
    const html = renderCardPage({ ...sample, name: '<img src=x onerror="a()"> Bob', title: "<b>x</b>", company: "A & B" }, "live").html;
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("A &amp; B");
  });
  it("leaves no sample text of the design page behind", () => {
    const html = renderCardPage(empty, "live").html;
    for (const w of ["Jasir", "Jas Documents", "jascorps", "Dubai", "+971"]) expect(html).not.toContain(w);
  });
  it("keeps every button reachable, even in a layout with fixed places", () => {
    const one = { ...empty, items: [{ kind: "TikTok", value: "tiktok.com/@sara" }] };
    for (const below of [1, 13, 100, 250, 399]) {
      expect(renderCardPage({ ...one, design: design({ below }) }, "live").html, `layout ${below}`).toContain('href="https://tiktok.com/@sara"');
    }
  });
  it("switches the groups of the tabs layout", () => {
    const html = renderTab(buildInput(sample), "s");
    expect(html).toContain("Instagram");
    expect(html).not.toContain("Call mobile");
  });
  it("uses the colourway of the design", () => {
    const f = faceInfo(44).palettes[2];
    const html = renderCardPage({ ...sample, design: design({ face: 44, colour: 2 }) }, "live").html;
    expect(html).toContain(`--cbg:${f.bg}`);
    expect(html).toContain(`--cacc:${f.acc}`);
  });
  it("draws a Design Pack 2 face from the card's own details, inside the engine's face element", () => {
    const html = renderCardPage({ ...sample, design: design({ face: 437, colour: 1 }) }, "live").html;
    expect(html).toContain('class="face d437 tv0"><div class="fx"></div><div class="p2"');
    expect(html).toContain("Sara Al Mansoori");
    expect(html).toContain("Brand Designer");
    expect(html).toContain("Studio Noor");
    expect(html).toContain("+974 5512 3344");
    expect(html).toContain("sara@studionoor.qa");
    expect(html).toContain(`--cbg:${faceInfo(437).palettes[1].bg}`);
    expect(html).not.toMatch(/\{(name|first|last|ini|title|co|phone|email|site)\}/);
    // the marker classes the text settings and the long-name fitting look for
    expect(html).toMatch(/class="(?:p2-[\w-]+ )*n"/);
    expect(html).toMatch(/class="(?:p2-[\w-]+ )*t2"/);
    // the company's own colours work for a pack face too
    const brand = renderCardPage({ ...sample, brand: { ...sample.brand!, palette: { bg: "#123456", bg2: "#234567", fg: "#FFFFFF", acc: "#ABCDEF", on: "#000000" } }, design: design({ face: 437, colour: 4 }) }, "live").html;
    expect(brand).toContain("--cbg:#123456");
  });
  it("fills the Arabic-first pack face with the card's details, right to left, without the designers' sample person", () => {
    const html = renderCardPage({ ...sample, design: design({ face: 494 }) }, "live").html;
    expect(html).toContain('<div class="p2" dir="rtl"');
    expect(html).toContain("Sara Al Mansoori");
    expect(html).not.toMatch(/[؀-ۿ]/);
    const mirror = renderCardPage({ ...sample, design: design({ face: 491 }) }, "live").html;
    expect(mirror).not.toMatch(/[؀-ۿ]/);
    expect(mirror.split("Sara Al Mansoori").length).toBeGreaterThanOrEqual(3);
  });
  it("escapes what the owner typed in a pack face", () => {
    const html = renderCardPage({ ...sample, name: '<img src=x onerror="a()"> Bob', company: "A & B", design: design({ face: 401 }) }, "live").html;
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("A &amp; B");
  });

  const cases: [string, CardPageData][] = [["a full card", sample], ["an empty card", empty]];
  for (const [what, data] of cases) {
    it(`draws every face for ${what}`, () => {
      for (let face = 1; face <= FACE_COUNT; face++) {
        const html = renderPage(buildInput({ ...data, design: design({ face, colour: face % 4 }) })).html;
        expect(html.length, `face ${face}`).toBeGreaterThan(600);
        expect(html, `face ${face}`).toContain(`face d${face} `);
        expect(html, `face ${face}`).not.toMatch(/undefined|NaN|\[object/);
      }
    });
    it(`draws every layout for ${what}`, () => {
      let leaks = 0;
      for (let below = 1; below <= BELOW_COUNT; below++) {
        const r = renderPage(buildInput({ ...data, design: design({ below }) }));
        expect(r.html, `layout ${below}`).toContain(`class="dv dv${below - 1} `);
        expect(r.html, `layout ${below}`).not.toMatch(/undefined|NaN|\[object/);
        leaks += r.leaks;
      }
      expect(leaks).toBeLessThan(10_000);
    });
    it(`draws every opening for ${what}`, () => {
      for (let intro = 0; intro <= INTRO_COUNT; intro++) {
        const html = renderPage(buildInput({ ...data, design: design({ intro }) })).html;
        if (intro > 0) expect(html, `opening ${intro}`).toContain(` in-${introInfo(intro).key}"`);
        else expect(html).not.toContain(" in-");
      }
    });
  }

  it("never leaves text of a missing button in a layout", () => {
    const sparse = { ...empty, items: [{ kind: "Mobile", value: "+974 5512 3344" }] };
    const bad: number[] = [];
    for (let below = 1; below <= BELOW_COUNT; below++) if (renderPage(buildInput({ ...sparse, design: design({ below }) })).leaks > 0) bad.push(below);
    expect(bad, `layouts that leave placeholder text: ${bad.join(",")}`).toEqual([]);
  });
});

describe("tabs without scripts", () => {
  it("keeps every button reachable in every layout when scripts are off", () => {
    for (let below = 1; below <= BELOW_COUNT; below++) {
      const input = buildInput({ ...sample, design: design({ below }) });
      const html = withoutScriptTabs(input, renderPage(input).html);
      const missing = input.items.map((_, i) => i).filter((i) => !html.includes(`data-i="${i}"`));
      expect(missing, `layout ${below}`).toEqual([]);
    }
  });
  it("adds the other tabs only inside noscript and leaves other layouts alone", () => {
    const tabs = buildInput({ ...sample, design: design({ below: 11 }) });
    const html = withoutScriptTabs(tabs, renderPage(tabs).html);
    expect(html).toMatch(/<noscript>[\s\S]*data-i="3"[\s\S]*<\/noscript>/);
    const list = buildInput({ ...sample, design: design({ below: 1 }) });
    const plain = renderPage(list).html;
    expect(withoutScriptTabs(list, plain)).toBe(plain);
  });
});
