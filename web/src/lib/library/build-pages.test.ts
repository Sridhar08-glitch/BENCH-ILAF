import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { BELOW_COUNT, TOP_COUNT, defaultDesign, belowOfTop, topInfo } from "./index";
import { buildInput, renderCardPage } from "./render";
import { renderPage } from "./generated/engine";
import type { CardPageData } from "./types";
import type { Design } from "@/lib/types";

// The page-style build (scripts/build-pages.mjs) must give the same bytes every time, and the committed outputs
// must be what the designers' pages in scripts/pages produce (a forgotten re-run shows up here).
const WEB = path.join(__dirname, "..", "..", "..");
const OUTPUTS = [
  ["public", "card-library", "designs.css"],
  ["public", "card-library", "pages.css"],
  ["src", "lib", "library", "generated", "engine.js"],
  ["src", "lib", "library", "generated", "engine.d.ts"],
  ["src", "lib", "library", "generated", "meta.ts"],
  ["src", "lib", "library", "generated", "pages.js"],
  ["src", "lib", "library", "generated", "pages.d.ts"],
];
const digest = (file: string) => createHash("sha256").update(fs.readFileSync(file)).digest("hex");
const read = (...p: string[]) => fs.readFileSync(path.join(WEB, ...p), "utf8");

function buildInto(dir: string): Record<string, string> {
  execFileSync(process.execPath, [path.join(WEB, "scripts", "build-pages.mjs")], { cwd: WEB, env: { ...process.env, PAGES_OUT_DIR: dir }, stdio: "pipe" });
  return Object.fromEntries(OUTPUTS.map((p) => [p[p.length - 1], digest(path.join(dir, p[p.length - 1]))]));
}

const sample: CardPageData = {
  name: "Sara Al Mansoori", title: "Brand Designer", company: "Studio Noor", address: "West Bay, Doha", bio: "I design calm products for teams in the Gulf.",
  photoUrl: "https://example.com/p.jpg", coverUrl: "https://example.com/c.jpg", saveContact: true, publicUrl: "https://cards.example/c/sara",
  design: defaultDesign(), brand: null,
  items: [
    { kind: "Mobile", value: "+974 5512 3344" }, { kind: "WhatsApp", value: "+974 5512 3344" }, { kind: "Email", value: "sara@studionoor.qa" },
    { kind: "Website", value: "studionoor.qa" }, { kind: "Location", value: "West Bay, Doha" }, { kind: "Instagram", value: "studionoor" },
    { kind: "LinkedIn", value: "linkedin.com/in/sara" }, { kind: "Calendly", value: "calendly.com/sara" },
  ],
};
const bare: CardPageData = { ...sample, name: "Sara", title: "", company: "", address: "", bio: "", photoUrl: null, coverUrl: null, items: [{ kind: "Mobile", value: "+974 5512 3344" }] };
const design = (patch: Partial<Design>): Design => ({ ...defaultDesign(), ...patch });

describe("build-pages", () => {
  it("is deterministic and the committed library is up to date with the designer pages", () => {
    const base = fs.mkdtempSync(path.join(os.tmpdir(), "pages-"));
    try {
      const first = buildInto(path.join(base, "one"));
      const second = buildInto(path.join(base, "two"));
      expect(second).toEqual(first);
      const committed = Object.fromEntries(OUTPUTS.map((p) => [p[p.length - 1], digest(path.join(WEB, ...p))]));
      expect(committed, "run: npm run build:pages, then npm run build:pack2").toEqual(first);
    } finally {
      fs.rmSync(base, { recursive: true, force: true });
    }
  }, 90_000);

  it("ships the designer pages for all 127 page styles", () => {
    const numbers = new Set<number>();
    for (const f of fs.readdirSync(path.join(WEB, "scripts", "pages", "lab")).filter((f) => f.endsWith(".html"))) {
      const m = /<section class="page" data-no="(\d+)"/.exec(fs.readFileSync(path.join(WEB, "scripts", "pages", "lab", f), "utf8"));
      expect(m, f).not.toBeNull();
      expect(f).toMatch(/^\d{2,3}-[a-z0-9-]+\.html$/);
      numbers.add(Number(m![1]));
    }
    expect(numbers.size, "100 hand-made designs").toBe(100);
    for (const f of fs.readdirSync(path.join(WEB, "scripts", "pages")).filter((f) => /^pages_.*\.html$/.test(f))) {
      for (const m of fs.readFileSync(path.join(WEB, "scripts", "pages", f), "utf8").matchAll(/<section class="page" data-no="(\d+)"/g)) numbers.add(Number(m[1]));
    }
    for (const n of [1, 2, 3, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 21, 22, 23, 25, 28, 29, 30, 31, 32, 33, 34]) expect(numbers.has(n), `page ${n}`).toBe(true);
  });

  it("counts: 127 headers, layouts 401 to 527, names for every one", () => {
    expect(TOP_COUNT).toBe(127);
    expect(BELOW_COUNT).toBe(527);
    expect(belowOfTop(1)).toBe(401);
    expect(belowOfTop(27)).toBe(427);
    expect(belowOfTop(77)).toBe(477);
    expect(belowOfTop(127)).toBe(527);
    const styles = new Set<string>();
    for (let n = 1; n <= TOP_COUNT; n++) {
      const t = topInfo(n);
      expect(t.name.length, `top ${n}`).toBeGreaterThan(0);
      styles.add(t.style);
    }
    expect([...styles].sort()).toEqual(["Arabic", "Blinq", "Business", "Creative", "Digital", "Dot", "Editorial", "Events and Lifestyle", "Gulf", "Health and Hospitality", "HiHello", "Linq", "Mobilo", "Objects", "Popl", "Tech and Creative", "Trades and Industry", "Wave"].sort());
    // the hand-made styles have an Arabic name and description as well
    for (let n = 28; n <= TOP_COUNT; n++) {
      const t = topInfo(n);
      expect(t.ar, `top ${n}`).not.toBeNull();
      expect(t.ar![0].length, `top ${n}`).toBeGreaterThan(0);
      expect(t.ar![1].length, `top ${n}`).toBeGreaterThan(0);
      expect(t.description.length, `top ${n}`).toBeGreaterThan(10);
    }
    expect(topInfo(1).name).toBe("Popl cover photo");
    expect(topInfo(26).rtl).toBe(true);
    expect(topInfo(27).rtl).toBe(true);
    expect([4, 5, 6, 7, 8, 27].every((n) => topInfo(n).face)).toBe(true);
  });

  it("scopes every rule under a page header or layout, with the pg- prefix, and loads nothing from the web", () => {
    const block = read("public", "card-library", "pages.css");
    // the page styles are their own stylesheet (a classic card never loads it), not part of designs.css
    expect(read("public", "card-library", "designs.css")).not.toContain(".cfl .pg-t1 ");
    expect(block.length).toBeGreaterThan(10_000);
    expect(block).not.toMatch(/url\((['"]?)\s*(https?:|\/\/)/i);
    expect(block).not.toMatch(/@import/);
    for (let n = 1; n <= TOP_COUNT; n++) expect(block, `page ${n}`).toContain(`.cfl .pg-t${n}`);
    // every selector starts with .cfl (keyframe steps aside)
    const noKeyframes = block.replace(/@keyframes[^{]*\{(?:[^{}]*\{[^{}]*\})*[^{}]*\}/g, "");
    for (const m of noKeyframes.matchAll(/(?:^|\})([^{}@]+)\{/g)) {
      for (const sel of m[1].split(/,(?![^(]*\))/)) expect(sel.trim().startsWith(".cfl"), `selector ${sel.trim().slice(0, 60)}`).toBe(true);
    }
  });

  it("uses no <use> clones and no outside address in the generated markup", () => {
    const pages = read("src", "lib", "library", "generated", "pages.js");
    expect(pages).not.toMatch(/<use[\s>]/);
    expect(pages).not.toMatch(/https?:\/\//);
    expect(pages).not.toMatch(/<script|<iframe|\son\w+=|javascript:/i);
  });

  for (const [what, data] of [["a full card", sample], ["a bare card", bare]] as [string, CardPageData][]) {
    it(`draws every header with its own layout for ${what}`, () => {
      for (let top = 1; top <= TOP_COUNT; top++) {
        const r = renderPage(buildInput({ ...data, design: design({ top, below: belowOfTop(top) }) }, "live"));
        expect(r.html, `top ${top}`).toContain(`pg-top pg-t${top}`);
        expect(r.html, `top ${top}`).toContain('class="stg');
        if (!topInfo(top).face) expect(r.html, `top ${top}`).not.toContain(`class="card`);
        expect(r.html, `top ${top}`).not.toMatch(/undefined|NaN|\[object|\{(name|first|last|ini|title|co|phone|email|site|city|bio)\}/);
        expect(r.html, `top ${top}`).not.toContain("Tap the card");
        expect(r.html, `top ${top}`).toContain("data-save");
        expect(r.leaks, `top ${top}`).toBe(0);
        for (const w of ["Noura", "Doha, Qatar", "+974 5555", "Pearl Studio", "Sara Al Mansoori Design", "she / her"]) if (data === bare) expect(r.html, `top ${top} ${w}`).not.toContain(w);
      }
    });
  }

  it("draws the card's own details in the header and its real buttons below", () => {
    const r = renderPage(buildInput({ ...sample, design: design({ top: 1, below: 401 }) }, "live"));
    expect(r.html).toContain("Sara Al Mansoori");
    expect(r.html).toContain("Brand Designer");
    expect(r.html).toContain("Studio Noor");
    expect(r.html).toContain("background:url(https://example.com/c.jpg)");
    expect(r.html).toContain('src="https://example.com/p.jpg"');
    expect(r.html).toContain('href="tel:+97455123344"');
    expect(r.html).toContain('href="mailto:sara@studionoor.qa"');
  });

  it("shows initials and the palette gradient when there is no photo or cover", () => {
    const html = renderPage(buildInput({ ...bare, design: design({ top: 1, below: 401 }) }, "live")).html;
    expect(html).toContain('<span class="pic">S</span>');
    expect(html).not.toContain("url(");
    expect(html).toContain("pg-sun");
  });

  it("hides the bio block when the bio is empty and shows it when it is not", () => {
    for (const top of [9, 11, 13, 21, 23, 25]) {
      const withBio = renderPage(buildInput({ ...sample, design: design({ top, below: belowOfTop(top) }) }, "live")).html;
      const without = renderPage(buildInput({ ...sample, bio: "", design: design({ top, below: belowOfTop(top) }) }, "live")).html;
      expect(withBio, `top ${top}`).toContain("I design calm products");
      expect(without, `top ${top}`).not.toContain("I design calm");
      expect(without.length, `top ${top}`).toBeLessThan(withBio.length);
    }
  });

  it("escapes what the owner typed in a header", () => {
    const html = renderCardPage({ ...sample, name: '<img src=x onerror="a()"> Bob', bio: "<b>x</b> & y", design: design({ top: 25, below: 425 }) }, "live").html;
    expect(html).not.toContain("<img src=x");
    expect(html).not.toContain("<b>x</b>");
    expect(html).toContain("&amp; y");
  });

  it("draws the Arabic headers right to left and keeps the designers' sample person out", () => {
    for (const top of [26, 27]) {
      const html = renderPage(buildInput({ ...sample, design: design({ top, below: belowOfTop(top) }) }, "live")).html;
      expect(html, `top ${top}`).toContain(`pg-top pg-t${top}" dir="rtl"`);
      expect(html, `top ${top}`).not.toContain("نورة");
      expect(html, `top ${top}`).toContain("Sara");
    }
    expect(renderPage(buildInput({ ...sample, design: design({ top: 1, below: 401 }) }, "live")).html).not.toContain('dir="rtl"');
  });

  it("the hand-made styles follow the card language: Arabic cards are drawn right to left, no bilingual marker is left in the markup", () => {
    for (let top = 28; top <= TOP_COUNT; top++) {
      for (const locale of ["en", "ar"] as const) {
        const html = renderPage(buildInput({ ...sample, locale, design: design({ top, below: belowOfTop(top) }) }, "live")).html;
        expect(html, `top ${top} ${locale}`).not.toContain("[[");
        if (top >= 58 && top <= 67) expect(html, `top ${top} ${locale}`).toMatch(new RegExp(`class="pg-top pg-t${top}[^"]*" dir="${locale === "ar" ? "rtl" : "ltr"}"`));
      }
    }
  });

  it("puts the chosen face card inside the Blinq card block and the palette block otherwise", () => {
    const withFace = renderPage(buildInput({ ...sample, design: design({ top: 4, below: 404, face: 12 }) }, "live")).html;
    expect(withFace).toContain('class="pg-fc"');
    expect(withFace).toContain("face d12 ");
    const plain = renderPage(buildInput({ ...sample, design: design({ top: 4, below: 404, face: 12, photo: false }) }, "live")).html;
    expect(plain).not.toContain('class="pg-fc"');
    expect(plain).not.toContain("face d12 ");
  });

  it("keeps the classic face card when top is 0", () => {
    const html = renderPage(buildInput({ ...sample, design: design({ top: 0, below: 1 }) }, "live")).html;
    expect(html).toContain('class="card');
    expect(html).not.toContain("pg-top");
    expect(html).toContain("Tap the card");
  });

  it("gives thumbnails nothing tappable", () => {
    const html = renderCardPage({ ...sample, design: design({ top: 3, below: 403 }) }, "thumb").html;
    expect(html).not.toContain("href=");
    expect(html).not.toContain("<button");
  });
});
