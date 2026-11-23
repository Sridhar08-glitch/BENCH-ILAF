import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { FACE_COUNT, BELOW_COUNT } from "./index";
import { renderCardPage } from "./render";
import type { CardPageData } from "./types";

// The card faces and the app's own screens share one document, so a short class name used by both (cl, cr, chip, tab,
// side ...) would let an app rule paint inside a card. These tests keep the app sheet out of the cards.

const WEB = path.join(__dirname, "..", "..", "..");
const read = (...p: string[]) => fs.readFileSync(path.join(WEB, ...p), "utf8");
const app = read("src", "app", "globals.css").replace(/\/\*[\s\S]*?\*\//g, "");
const GUARD = ":where(:not(.cfl *))";

const sample = (face: number, below: number, colour = 0): CardPageData => ({
  name: "Sridhar Mahalingam", title: "Software Developer", company: "iLAF Technologies", address: "Doha, Qatar", photoUrl: null,
  items: [
    { kind: "Mobile", value: "31452430" }, { kind: "Email", value: "sridharansridharr22@gmail.com" },
    { kind: "Website", value: "sridharportfolio1.netlify.app" }, { kind: "WhatsApp", value: "31452430" },
    { kind: "Location", value: "Doha, Qatar" }, { kind: "LinkedIn", value: "https://linkedin.com/in/sridhar" },
    { kind: "GitHub", value: "https://github.com/sridhar" },
  ],
  saveContact: true, design: { face, colour, below, intro: 0, font: "face", size: 100, photo: true, brand_colors: false, foot: true },
  publicUrl: "https://example.test/c/x",
});

/** Every class name the engine writes into a card: all faces, all layouts below the card and the words the engine adds in script. */
function emittedClasses(): Set<string> {
  const out = new Set<string>();
  const take = (html: string) => {
    for (const m of html.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach((c) => c && out.add(c));
  };
  for (let n = 1; n <= FACE_COUNT; n++) take(renderCardPage(sample(n, 1), "thumb").html);
  for (let n = 1; n <= BELOW_COUNT; n++) take(renderCardPage(sample(1, n), "thumb").html);
  const engine = read("src", "lib", "library", "generated", "engine.js");
  for (const m of engine.matchAll(/class=\\?["']([^"'\\]*)/g)) m[1].split(/\s+/).forEach((c) => /^[a-zA-Z][\w-]*$/.test(c) && out.add(c));
  return out;
}

interface Rule {
  selector: string;
  body: string;
}

function appRules(): Rule[] {
  const rules: Rule[] = [];
  for (const m of app.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const pre = m[1].trim();
    if (pre.startsWith("@") || /^(\d|from\b|to\b)/.test(pre)) continue;
    for (const sel of pre.split(",")) if (sel.trim()) rules.push({ selector: sel.trim(), body: m[2] });
  }
  return rules;
}

const lastCompound = (sel: string) => sel.split(/\s+|\s*[>+~]\s*/).pop() ?? "";

describe("the app stylesheet stays out of the cards", () => {
  const classes = emittedClasses();

  it("sees the class names that caused the white contact plate", () => {
    for (const c of ["cl", "cr", "ln", "face", "card", "stg"]) expect(classes.has(c)).toBe(true);
  });

  it("guards every app rule that names a class the cards use", () => {
    const bad = appRules()
      .filter((r) => !r.selector.includes(".cfl"))
      .filter((r) => [...r.selector.matchAll(/\.([a-zA-Z][\w-]*)/g)].some((m) => classes.has(m[1])))
      .filter((r) => !lastCompound(r.selector).includes(GUARD))
      .map((r) => r.selector);
    expect(bad).toEqual([]);
  });

  it("does not let the Save contact sheet's list style reach a card's contact lines", () => {
    const rule = appRules().find((r) => r.selector.startsWith(".cl:") || r.selector === ".cl");
    expect(rule?.selector).toBe(`.cl${GUARD}`);
    expect(rule?.body).toContain("background: #fff");
  });

  it("does not style headings inside a card", () => {
    for (const r of appRules().filter((r) => /^h[1-3]$/.test(r.selector) && /font-size|display/.test(r.body))) expect(r.selector).toBe("never");
    for (const r of appRules().filter((r) => /^h[1-3]:/.test(r.selector))) expect(r.selector).toContain(GUARD);
  });

  it("clears the variables the library's gallery rules read, so no gallery rule draws a border or fill in a card", () => {
    const rule = appRules().find((r) => r.selector === ".cfl" && r.body.includes("--line"));
    expect(rule?.body).toMatch(/--line:\s*initial/);
    const designs = read("public", "card-library", "designs.css");
    // the gallery chip rule reads --line; the company logo chip is a `.chip` too
    expect(designs).toMatch(/\.cfl \.chip\{[^}]*var\(--line\)/);
  });
});

describe("a card is drawn flat so its text is sharp", () => {
  const rule = (sel: string) => appRules().find((r) => r.selector === sel);

  it("has no perspective at rest, only while it turns or its opening plays", () => {
    expect(rule(".cfl .stg .card")?.body).toMatch(/perspective:\s*none/);
    expect(rule(".cfl .stg:not(.go)")?.body).toMatch(/perspective:\s*none/);
    expect(rule(".cfl .stg.still")?.body).toMatch(/perspective:\s*none/);
    expect(rule(".cfl .stg .card.turning")?.body).toMatch(/perspective:\s*1400px/);
    expect(rule(".cfl .stg.go:not(.still) .card")?.body).toMatch(/perspective:\s*1400px/);
  });

  it("outranks the library's own perspective rules", () => {
    // the library declares perspective on .stg and .card at specificity 0,2,0; the overrides are 0,3,0 or more
    const designs = read("public", "card-library", "designs.css");
    expect(designs).toMatch(/\.cfl \.card\{[^}]*perspective:1400px/);
    expect(designs).toMatch(/\.cfl \.stg\{[^}]*perspective:1400px/);
  });
});
