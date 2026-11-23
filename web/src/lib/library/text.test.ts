import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import postcss from "postcss";
import { PERSONAS } from "@/lib/card/arabic-personas";
import { defaultDesign } from "./index";
import { renderCardPage } from "./render";
import {
  FONTS, FONT_FACE, FONT_KEYS, FONT_LOCKED_FACES, HOSTED_FAMILIES, TEXT_CSS, TEXT_SIZE_DEFAULT, TEXT_SIZE_MAX, TEXT_SIZE_MIN, addsNoProblem, appliedSize, arabicStack, fontApplies, fontInfo,
  fontStack, isFontLocked, keepsSize, largestFit, nearestFit, normalizeFont, normalizeSize, problems, safeScale, textClasses, textVars, type Measured, type Rect,
} from "./text";
import type { CardPageData } from "./types";

const web = path.resolve(__dirname, "../../..");
const read = (...p: string[]) => fs.readFileSync(path.join(web, ...p), "utf8");

describe("font keys", () => {
  it("lists 12 Latin fonts and the 3 Arabic ones, without repeats", () => {
    expect(FONTS.filter((f) => f.script === "latin")).toHaveLength(12);
    expect(FONTS.filter((f) => f.script === "arabic").map((f) => f.key)).toEqual(["plex-arabic", "cairo", "tajawal"]);
    expect(new Set(FONT_KEYS).size).toBe(FONT_KEYS.length);
    expect(FONT_KEYS[0]).toBe(FONT_FACE);
  });

  it("is the same list the backend accepts", () => {
    const py = fs.readFileSync(path.resolve(web, "../backend/ilaf/design.py"), "utf8");
    const block = /FONT_KEYS = \(([\s\S]*?)\n\)/.exec(py)?.[1] ?? "";
    const backend = [...block.matchAll(/"([a-z-]+)"/g)].map((m) => m[1]).filter((k) => k !== "face");
    expect(backend.sort()).toEqual(FONTS.map((f) => f.key).sort());
    expect(py).toMatch(/SIZE_MIN = 60/);
    expect(py).toMatch(/SIZE_MAX = 150/);
  });

  it("maps every font to a family the page really has", () => {
    const script = read("scripts", "copy-card-fonts.mjs");
    // one family per line: ["Family", "package", [[weight], ...], optional subsets]
    const hosted = new Map([...script.matchAll(/^\s*\["([^"]+)", "[a-z0-9-]+", (.*)\],$/gm)].map((m) => [m[1], m[2].includes('"arabic"') ? "latin arabic" : "latin"]));
    for (const f of FONTS) {
      if (f.key === "plex-arabic") continue; // the app's own Arabic font (next/font in the root layout)
      expect(hosted.has(f.family), `${f.family} is declared by scripts/copy-card-fonts.mjs`).toBe(true);
      if (f.script === "arabic") expect(hosted.get(f.family), `${f.family} has the Arabic subset`).toContain("arabic");
    }
    expect(read("src", "app", "layout.tsx")).toContain("IBM_Plex_Sans_Arabic");
    expect(HOSTED_FAMILIES.length).toBe(FONTS.length - 1);
  });

  it("gives every font a stack that starts with its own family and ends in a generic one", () => {
    for (const f of FONTS) {
      const stack = fontStack(f.key)!;
      expect(stack, f.key).toBeTruthy();
      if (f.key !== "plex-arabic") expect(stack.startsWith(`"${f.family}"`), f.key).toBe(true);
      expect(stack.endsWith(f.generic) || stack.endsWith("sans-serif"), f.key).toBe(true);
    }
    expect(fontStack(FONT_FACE)).toBeNull();
    expect(fontStack("nope")).toBeNull();
  });

  it("falls back to an Arabic font for every key, and an Arabic font for the Arabic keys themselves", () => {
    for (const f of FONTS) {
      const ar = fontInfo(f.arabic);
      expect(ar?.script, `${f.key} falls back to ${f.arabic}`).toBe("arabic");
      expect(arabicStack(f.key), f.key).toContain(ar!.key === "plex-arabic" ? "--font-plex-ar" : `"${ar!.family}"`);
    }
    for (const key of ["plex-arabic", "cairo", "tajawal"]) expect(fontInfo(key)!.arabic).toBe(key);
    expect(arabicStack("face")).toContain("--font-plex-ar");
  });

  it("gives every variable in a stack a fallback, so a missing one cannot void the whole font", () => {
    for (const f of FONTS) {
      for (const stack of [fontStack(f.key)!, arabicStack(f.key)]) expect(stack, f.key).not.toMatch(/var\(--[a-z-]+\)/);
    }
  });

  it("never links a third-party font server", () => {
    const all = JSON.stringify(FONTS) + TEXT_CSS + FONTS.map((f) => fontStack(f.key)).join("");
    expect(all).not.toMatch(/googleapis|gstatic|http/);
  });
});

describe("normalising", () => {
  it("accepts only a known font key", () => {
    for (const f of FONTS) expect(normalizeFont(f.key)).toBe(f.key);
    expect(normalizeFont(FONT_FACE)).toBe(FONT_FACE);
    for (const bad of ["", "Poppins", "comic-sans", 5, null, undefined, {}, ["lora"]]) expect(normalizeFont(bad)).toBe(FONT_FACE);
  });
  it("accepts only a whole size from 60 to 150", () => {
    for (const ok of [60, 61, 100, 149, 150]) expect(normalizeSize(ok)).toBe(ok);
    for (const bad of [59, 151, 0, -100, 100.5, "120", null, undefined, NaN, Infinity, true]) expect(normalizeSize(bad)).toBe(TEXT_SIZE_DEFAULT);
  });
});

describe("how a design reaches the card", () => {
  const d = (patch: object) => ({ ...defaultDesign(), ...patch });

  it("adds nothing for the default design", () => {
    expect(textClasses(defaultDesign())).toBe("");
    expect(textVars(defaultDesign())).toEqual({});
  });
  it("holds an enlarged size at 100% until it is measured, and passes a smaller size on as it is", () => {
    expect(textVars(d({ size: 130 }))).toEqual({ "--ts": "1", "--tsr": "130" });
    expect(textVars(d({ size: 150 }))["--ts"]).toBe("1");
    expect(textVars(d({ size: 80 }))).toEqual({ "--ts": "0.8", "--tsr": "80" });
    expect(textVars(d({ size: 60 }))["--ts"]).toBe("0.6");
    expect(textClasses(d({ size: 130 }))).toBe("tx-size");
    expect(safeScale(150)).toBe(1);
    expect(safeScale(75)).toBe(0.75);
    expect(safeScale(7)).toBe(1); // not a valid size: the normal one
  });
  it("sets the font stacks for a font and the class that turns them on", () => {
    const v = textVars(d({ font: "playfair" }));
    expect(v["--tf"]).toContain("Playfair Display");
    expect(v["--tfa"]).toContain("--font-plex-ar");
    expect(textClasses(d({ font: "playfair" }))).toBe("tx-font");
    expect(textClasses(d({ font: "cairo", size: 90 }))).toBe("tx-font tx-size");
    expect(textVars(d({ font: "cairo" }))["--tf"]).toContain('"Cairo"');
  });
  it("leaves a face with a fixed typeface alone", () => {
    expect(FONT_LOCKED_FACES.length).toBeGreaterThan(5);
    expect(FONT_LOCKED_FACES.length).toBeLessThan(40);
    expect(isFontLocked(12)).toBe(true); // terminal
    expect(isFontLocked(43)).toBe(true); // 8-bit
    expect(isFontLocked(1)).toBe(false);
    expect(fontApplies(d({ face: 12, font: "lora" }))).toBe(false);
    expect(textClasses(d({ face: 12, font: "lora" }))).toBe("");
    expect(textClasses(d({ face: 12, font: "lora", size: 120 }))).toBe("tx-size"); // the size still applies
    expect(fontApplies(d({ face: 1, font: "lora" }))).toBe(true);
  });
  it("scopes the stylesheet to the card text and uses zoom, once per outermost block", () => {
    expect(TEXT_CSS).toContain("zoom:var(--ts,1)");
    expect(TEXT_CSS).toContain(".face:not(.back)");
    expect(TEXT_CSS).toMatch(/:not\(:is\([^)]*\) \*\)/);
    expect(TEXT_CSS).toContain("font-family:var(--tf)");
    expect(TEXT_CSS).toContain("font-family:var(--tfa)");
  });
});

describe("the list of fixed-typeface faces matches the face stylesheet", () => {
  const css = fs.readFileSync(path.join(web, "public", "card-library", "designs.css"), "utf8");
  const fixed = /Press Start 2P|JetBrains Mono|Space Mono/;
  const found = new Set<number>();
  postcss.parse(css).walkDecls(/^font(-family)?$/, (decl) => {
    if (decl.parent?.type !== "rule" || !fixed.test(decl.value.split(",")[0])) return;
    for (const m of (decl.parent as postcss.Rule).selector.matchAll(/\.cfl \.d(\d+)(?!\d)([^,]*)/g)) {
      const target = m[2].trim();
      // the face itself, or its name or contact lines
      if (target === "" || /\.n$/.test(target) || /\.ln$/.test(target) || /\.q\d+-[a-z]+ \.n$/.test(target)) found.add(Number(m[1]));
    }
  });
  it("lists exactly the faces that set their own mono or pixel typeface", () => {
    expect([...found].filter((n) => n <= 400).sort((a, b) => a - b)).toEqual([...FONT_LOCKED_FACES].sort((a, b) => a - b));
  });
});

// ---- the fit rule, on synthetic boxes

const rect = (left: number, top: number, right: number, bottom: number): Rect => ({ left, top, right, bottom });
const faceBox = rect(0, 0, 700, 400);

describe("problems and the fit rule", () => {
  const m = (over: Partial<Measured>): Measured => ({ face: faceBox, texts: [], obstacles: [], ...over });

  it("finds nothing on a clean face", () => {
    expect(problems(m({ texts: [{ id: "n0", rect: rect(40, 100, 300, 160) }, { id: "t10", rect: rect(40, 170, 300, 200) }], obstacles: [{ id: "pw0", rect: rect(500, 40, 660, 200) }] })).size).toBe(0);
  });
  it("finds text that runs off an edge, on another block or on a picture", () => {
    expect([...problems(m({ texts: [{ id: "n0", rect: rect(40, 100, 690, 160) }] }))]).toEqual(["n0:edge"]);
    expect([...problems(m({ texts: [{ id: "n0", rect: rect(-5, 100, 200, 160) }] }))]).toEqual(["n0:edge"]);
    expect([...problems(m({ texts: [{ id: "n0", rect: rect(40, 360, 200, 399) }] }))]).toEqual(["n0:edge"]);
    expect([...problems(m({ texts: [{ id: "n0", rect: rect(40, 100, 300, 160) }, { id: "t10", rect: rect(40, 150, 300, 190) }] }))]).toEqual(["n0+t10"]);
    expect([...problems(m({ texts: [{ id: "n0", rect: rect(480, 100, 600, 160) }], obstacles: [{ id: "pw0", rect: rect(500, 40, 660, 200) }] }))]).toEqual(["n0>pw0"]);
  });
  it("does not count a one pixel touch", () => {
    expect(problems(m({ texts: [{ id: "n0", rect: rect(40, 100, 300, 160) }, { id: "t10", rect: rect(40, 160.5, 300, 190) }] })).size).toBe(0);
  });
  it("only counts a problem the face did not already have", () => {
    const base = new Set(["n0+t10"]);
    expect(addsNoProblem(new Set(["n0+t10"]), base)).toBe(true);
    expect(addsNoProblem(new Set(), base)).toBe(true);
    expect(addsNoProblem(new Set(["n0+t10", "ln0:edge"]), base)).toBe(false);
  });
  it("treats a name or title the face had to shrink further as not fitting", () => {
    expect(keepsSize(20, 20)).toBe(true);
    expect(keepsSize(19.6, 20)).toBe(true);
    expect(keepsSize(18.5, 20)).toBe(false);
    expect(keepsSize(10, 0)).toBe(true);
  });
});

describe("largestFit, nearestFit and appliedSize", () => {
  it("finds the edge of a monotone fit", () => {
    for (const edge of [100, 101, 117, 149, 150]) {
      const fits = (s: number) => s <= edge;
      expect(largestFit(fits, 150, 100)).toBe(edge);
      expect(largestFit(fits, 130, 100)).toBe(Math.min(edge, 130));
    }
  });
  it("returns the floor when nothing fits, and never a size that does not fit", () => {
    expect(largestFit(() => false, 150, 100)).toBe(100);
    expect(largestFit(() => false, 150)).toBe(TEXT_SIZE_MIN);
    // a fit that is not monotone: the answer still fits
    const odd = (s: number) => s <= 70 || s === 90 || s === 91;
    const r = largestFit(odd, 150, 60);
    expect(odd(r)).toBe(true);
  });
  it("never goes past what was asked", () => {
    expect(largestFit(() => true, 120, 100)).toBe(120);
    expect(largestFit(() => true, 400, 100)).toBe(TEXT_SIZE_MAX);
  });
  it("looks upward from a small size to the nearest one that works", () => {
    expect(nearestFit(() => true, 70)).toBe(70);
    expect(nearestFit((s) => s >= 80, 62)).toBe(82);
    expect(nearestFit(() => false, 60)).toBe(100);
    expect(nearestFit(() => true, 10)).toBe(TEXT_SIZE_MIN);
  });
  it("applies the asked size only where it fits and never shows an unmeasured enlargement", () => {
    expect(appliedSize(130, null)).toBe(100);
    expect(appliedSize(130, 150)).toBe(130);
    expect(appliedSize(130, 112)).toBe(112);
    expect(appliedSize(130, 100)).toBe(100);
    expect(appliedSize(130, 80)).toBe(100); // never below the face as drawn when asked for more
    expect(appliedSize(70, null)).toBe(70);
    expect(appliedSize(60, 100)).toBe(60);
    expect(appliedSize(999, 150)).toBe(100); // not a valid size
  });
});

// ---- ten sample people on forty faces at three sizes

const LONG_EN: Pick<CardPageData, "name" | "title" | "company" | "address"> = {
  name: "Alexandria Konstantinopoulos-Fitzgerald", title: "Senior Vice President of Global Strategic Partnerships", company: "International Consolidated Holdings and Associates", address: "West Bay, Corniche Street, Tower 12, Doha",
};
const SHORT_EN: Pick<CardPageData, "name" | "title" | "company" | "address"> = { name: "Ann Li", title: "CEO", company: "Acme", address: "Doha" };
const PEOPLE = [LONG_EN, SHORT_EN, ...PERSONAS.slice(0, 8)];
const FACES = Array.from({ length: 40 }, (_, i) => 1 + i * 10);
const SIZES = [60, 100, 150];

const dataFor = (p: (typeof PEOPLE)[number], face: number, size: number): CardPageData => ({
  ...p, photoUrl: null, coverUrl: null, saveContact: true, publicUrl: "https://cards.example/c/x", design: { ...defaultDesign(), face, size },
  items: [{ kind: "Mobile", value: "+974 5512 3344" }, { kind: "Email", value: "name@company.example" }],
});

/**
 * A stand-in for the browser: block widths grow with the text length and the size, so a longer name reaches the edge
 * sooner. Good enough to check the fit rule end to end; the real layout is measured by scripts in a browser.
 */
function synthetic(p: (typeof PEOPLE)[number], face: number, size: number): Measured {
  const k = size / 100;
  const room = 640;
  const w = (text: string, em: number) => Math.min(900, text.length * em * 0.55 * k);
  const left = 30 + (face % 3) * 10;
  return {
    face: faceBox,
    texts: [
      { id: "n0", rect: rect(left, 90, left + w(p.name, 44), 90 + 48 * k) },
      { id: "t10", rect: rect(left, 90 + 52 * k, left + w(p.title, 20), 90 + 52 * k + 22 * k) },
      { id: "ln0", rect: rect(left, 300 - 22 * k, left + w(p.address, 18), 300) },
    ].map((t) => ({ ...t, rect: { ...t.rect, right: Math.min(t.rect.right, room + 200) } })),
    obstacles: [{ id: "pw0", rect: rect(room - 100 + (face % 2) * 20, 40, room + 20, 190) }],
  };
}

describe("ten people, forty faces, three sizes", () => {
  it("renders every one with the text classes and variables that were asked for", () => {
    for (const p of PEOPLE) {
      for (const face of FACES) {
        for (const size of SIZES) {
          const out = renderCardPage(dataFor(p, face, size), "live");
          const tag = `${p.name} face ${face} size ${size}`;
          expect(out.wrapClass.includes("tx-size"), tag).toBe(size !== 100);
          expect(out.pageVars["--ts"], tag).toBe(size === 100 ? undefined : String(Math.min(size, 100) / 100));
          expect(out.pageVars["--tsr"], tag).toBe(size === 100 ? undefined : String(size));
          expect(out.html, tag).toContain('class="card"');
        }
      }
    }
  });

  it("clamps every size to one that fits, as large as it can be", () => {
    for (const p of PEOPLE) {
      for (const face of FACES) {
        const base = problems(synthetic(p, face, 100));
        const fits = (s: number) => s === 100 || addsNoProblem(problems(synthetic(p, face, s)), base);
        const max = largestFit(fits, TEXT_SIZE_MAX, TEXT_SIZE_DEFAULT);
        for (const size of SIZES) {
          const applied = appliedSize(size, max);
          const tag = `${p.name} face ${face} size ${size} -> ${applied}`;
          expect(applied, tag).toBeGreaterThanOrEqual(Math.min(size, TEXT_SIZE_DEFAULT));
          expect(applied, tag).toBeLessThanOrEqual(Math.max(size, TEXT_SIZE_DEFAULT));
          expect(fits(applied), tag).toBe(true);
          if (size > TEXT_SIZE_DEFAULT && applied < size) expect(fits(applied + 1), `${tag} is the largest`).toBe(false);
        }
      }
    }
  });

  it("really does clamp: some people on some faces cannot take 150%", () => {
    let held = 0;
    for (const p of PEOPLE) {
      for (const face of FACES) {
        const base = problems(synthetic(p, face, 100));
        if (!addsNoProblem(problems(synthetic(p, face, 150)), base)) held++;
      }
    }
    expect(held).toBeGreaterThan(20);
    expect(held).toBeLessThan(PEOPLE.length * FACES.length);
  });
});
