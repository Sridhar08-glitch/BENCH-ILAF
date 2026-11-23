import { describe, expect, it } from "vitest";
import { defaultDesign } from "../index";
import { buildInput, renderCardPage } from "../render";
import type { CardPageData } from "../types";
import type { Design } from "@/lib/types";
import { cleanFace, customColours, fillTemplate, onceStyles, ownMedia, placeholderValues, swapFront, usesLogo } from "./render";
import type { CustomFaceData } from "./types";

const palettes = [
  { name: "Ink", bg: "#101114", bg2: "#1b1d22", fg: "#f6f7f9", acc: "#ff6b35", on: "#101114" },
  { name: "Paper", bg: "#ffffff", bg2: "#f1f2f4", fg: "#101114", acc: "#e8531f", on: "#ffffff" },
  { name: "Ocean", bg: "#0b1f3a", bg2: "#12305a", fg: "#ffffff", acc: "#60a5fa", on: "#0b1f3a" },
  { name: "Forest", bg: "#0e2a22", bg2: "#14392d", fg: "#ecfdf5", acc: "#34d399", on: "#06231a" },
];

const TEMPLATE = `<div class="edge"></div><div class="hd"><div class="co">{{company}}</div><div class="n">{{name}}</div><div class="t1">{{title}}</div></div><div class="pw">{{photo}}</div><div class="cl">{{phone_line}}{{email_line}}{{web_line}}</div>{{#if logo}}<div class="lg">{{logo}}</div>{{/if}}`;
const CSS = `:scope{background:var(--cbg)}.edge{position:absolute;left:0;top:0;bottom:0;width:2.4cqw;background:var(--cacc)}.n{font-size:7cqw;font-weight:800}`;

function face(over: Partial<CustomFaceData> = {}): CustomFaceData {
  return { id: 12, name: "Acme card", tags: ["corporate"], palettes, template: TEMPLATE, css: `.cfl .face.cf-12${CSS.replace(":scope", "").replace(/^/, "")}`, font_locked: false, version: 1, hash: "abc123", ...over };
}
// the stored CSS is the cleaned form; build it the way the backend stores it
import { sanitizeCss } from "./sanitize";
const stored = (css = CSS, id = 12) => sanitizeCss(css, id).value;
const mk = (over: Partial<CustomFaceData> = {}) => face({ css: stored(), ...over });

const base: CardPageData = {
  name: "Sara Al Mansoori", title: "Brand Designer", company: "Acme Ltd", address: "West Bay, Doha", photoUrl: "https://example.com/p.jpg", coverUrl: null,
  saveContact: true, publicUrl: "https://cards.example/c/sara", design: { ...defaultDesign(), custom_face: 12 } as Design,
  brand: { companyName: "Acme Ltd", logoUrl: "https://api.test/media/logos/acme.png" },
  items: [
    { kind: "Mobile", value: "+974 5512 3344" },
    { kind: "Email", value: "sara@acme.test" },
    { kind: "Website", value: "acme.test" },
  ],
  customFace: mk(),
};
const design = (patch: Partial<Design>): Design => ({ ...defaultDesign(), custom_face: 12, ...patch });
const html = (data: Partial<CardPageData> = {}, mode: "live" | "preview" | "thumb" = "live") => renderCardPage({ ...base, ...data }, mode).html;

describe("custom face drawing", () => {
  it("puts the face in place of the library face, inside the usual card wrapper", () => {
    const h = html();
    expect(h).toContain('<div class="card"');
    expect(h).toContain('<div class="inner">');
    expect(h).toContain('<div class="face d0 cf-12 tv0"><div class="fx"></div>');
    expect(h).toContain('<div class="face back">');
    expect(h.indexOf('class="face d0 cf-12')).toBeLessThan(h.indexOf('<div class="face back">'));
    expect(h.match(/class="face d\d+/g)).toHaveLength(1);
    expect(h).toContain('<div class="n">Sara Al Mansoori</div>');
    expect(h).toContain('<div class="t1">Brand Designer</div>');
    expect(h).toContain('class="ln"');
    expect(h).toContain("+974 5512 3344");
    expect(h).toContain('<img class="pic" alt="" src="https://example.com/p.jpg">');
  });

  it("includes the scoped style sheet once with a content hash, working without scripts", () => {
    const h = html();
    const styles = h.match(/<style data-cf="abc123">[\s\S]*?<\/style>/g) ?? [];
    expect(styles).toHaveLength(1);
    expect(styles[0]).toContain(".cfl .face.cf-12 .n{font-size:7cqw;font-weight:800}");
    expect(styles[0]).toContain(".cfl .face.cf-12 .cfm{display:block");
    expect(h).not.toContain("<script");
    // the page is complete markup: nothing waits for the browser
    expect(h).not.toMatch(/undefined|NaN|\[object/);
  });

  it("draws the four colourways of the face and colour 4 as company colours", () => {
    for (let colour = 0; colour < 4; colour++) {
      const r = renderCardPage({ ...base, design: design({ colour }) }, "live");
      expect(r.html).toContain(`--cbg:${palettes[colour].bg}`);
      expect(r.html).toContain(`--cacc:${palettes[colour].acc}`);
      expect(r.pageVars["--pgbg"]).toBeTruthy();
    }
    const company = { bg: "#102030", bg2: "#203040", fg: "#ffffff", acc: "#ff00aa", on: "#000000" };
    const r = renderCardPage({ ...base, design: design({ colour: 4 }), brand: { ...base.brand!, palette: company } }, "live");
    expect(r.html).toContain("--cbg:#102030");
    // without a company palette colour 4 falls back to the face's first colourway
    expect(html({ design: design({ colour: 4 }) })).toContain(`--cbg:${palettes[0].bg}`);
  });

  it("is used only when the design names this face and the face was sent along", () => {
    expect(html({ design: design({ custom_face: null }) })).not.toContain("cf-12");
    expect(html({ design: design({ custom_face: 13 }) })).not.toContain("cf-12");
    expect(html({ customFace: null })).not.toContain("cf-12");
    expect(html({ customFace: undefined })).toMatch(/class="face d1 tv0"/);
  });

  it("uses the engine's photo element: initials when the photo is off or missing", () => {
    expect(html({ design: design({ photo: false }) })).toContain('<span class="pic">SA</span>');
    expect(html({ photoUrl: null })).toContain('<span class="pic">SA</span>');
    expect(html()).not.toContain('<span class="pic">SA</span><div');
  });

  it("escapes every value a card owner typed", () => {
    const h = html({
      name: '<img src=x onerror="alert(1)"> Bob', title: "<script>x()</script>", company: 'A & "B" <i>', address: "<b>Street</b>",
      items: [{ kind: "Mobile", value: "<svg onload=a()>" }, { kind: "Email", value: '"><script>' }],
    });
    expect(h).not.toContain("<script>x()");
    expect(h).not.toContain("<img src=x");
    expect(h).not.toContain("<svg onload");
    expect(h).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt; Bob");
    expect(h).toContain("A &amp; &quot;B&quot; &lt;i&gt;");
    expect(h).toContain("&lt;svg onload=a()&gt;");
    // the photo address is escaped too
    expect(html({ photoUrl: 'https://x.test/a.jpg" onerror="alert(1)' })).not.toContain('onerror="alert(1)"');
  });

  it("re-checks the stored face before drawing: hostile text never reaches the page", () => {
    const hostile = mk({
      template: '<div class="n" onclick="x()">{{name}}<script>alert(1)</script><img src="javascript:alert(1)"></div><iframe src="//evil"></iframe>',
      css: ".cfl .face.cf-12 .n{background:url(javascript:alert(1));color:red}</style><script>alert(2)</script>@import url(//evil/x.css);",
      hash: "evil1",
    });
    const h = html({ customFace: hostile });
    expect(h).not.toMatch(/onclick|<script|<iframe|javascript:|@import|<img src="javascript/);
    expect(h).toContain('<div class="n">Sara Al Mansoori</div>');
    expect(h).toContain(".cfl .face.cf-12 .n{color:red}");
  });

  it("draws nothing from a face whose text cannot be checked, rather than unchecked text", () => {
    const h = html({ brand: null, customFace: mk({ template: "<div></div>".repeat(6000), hash: "big1" }) });
    expect(h).toContain('<div class="face d0 cf-12 tv0"><div class="fx"></div></div>');
  });

  it("evaluates conditionals", () => {
    const input = buildInput({ ...base, items: [{ kind: "Email", value: "a@b.co" }] }, "live");
    const values = placeholderValues(input, base.brand);
    expect(fillTemplate("{{#if phone}}P:{{phone}}{{else}}no phone{{/if}}|{{#if email}}E:{{email}}{{/if}}", values, input)).toBe("no phone|E:a@b.co");
    expect(fillTemplate("{{#if logo}}{{#if phone}}A{{else}}B{{/if}}{{else}}C{{/if}}", values, input)).toBe("B");
    expect(fillTemplate("{{#if photo}}photo{{else}}initials{{/if}}", values, input)).toBe("photo");
    const none = buildInput({ ...base, photoUrl: null, brand: null }, "live");
    expect(fillTemplate("{{#if photo}}photo{{else}}initials{{/if}}{{#if logo}}L{{/if}}", placeholderValues(none, null), none)).toBe("initials");
    expect(fillTemplate("{{bogus}}{{name}}", values, input)).toBe("Sara Al Mansoori");
    expect(fillTemplate("{{#if phone}}x{{/if}}{{/if}}tail", values, input)).toBe("tail");
  });

  it("gives name, first, last, initials and the contact lines the classes the engine's fitting works on", () => {
    const input = buildInput(base, "live");
    const v = placeholderValues(input, base.brand);
    expect(v.first).toBe("Sara");
    expect(v.last).toBe("Al Mansoori");
    expect(v.initials).toBe("SA");
    expect(v.phone_line).toMatch(/^<span class="ln"><svg class="ico"[\s\S]*<b>\+974 5512 3344<\/b><\/span>$/);
    expect(v.address_line).toContain("West Bay, Doha");
    expect(v.qr).toContain('aria-label="QR code"');
    expect(v.qr).not.toContain("NaN");
    expect(v.logo).toBe('<img class="cfm cfm-logo" alt="Acme Ltd" src="https://api.test/media/logos/acme.png">');
    expect(v.symbol).toContain("cfm-symbol");
    expect(placeholderValues(input, null).logo).toBe("");
  });

  it("places the company logo itself and skips the automatic corner logo when the face uses {{logo}}", () => {
    const withLogo = html({ customFace: mk({ hash: "lg1" }) }, "preview");
    expect(withLogo).toContain('class="cfm cfm-logo"');
    expect(withLogo).not.toContain('data-co="front"');
    expect(withLogo).toContain('data-co="back"');
    expect(usesLogo(TEMPLATE)).toBe(true);
    const plain = mk({ template: '<div class="n">{{name}}</div>', css: stored(".n{font-size:6cqw}"), hash: "nl1" });
    const without = html({ customFace: plain }, "preview");
    expect(without).toContain('data-co="front"');
    expect(usesLogo(plain.template)).toBe(false);
  });

  it("keeps the font a face was drawn with when it is font-locked, and follows the owner's font otherwise", () => {
    const pick = design({ font: "oswald" });
    expect(renderCardPage({ ...base, design: pick }, "live").wrapClass).toContain("tx-font");
    expect(renderCardPage({ ...base, design: pick, customFace: mk({ font_locked: true, hash: "fl1" }) }, "live").wrapClass).not.toContain("tx-font");
  });

  it("works for thumbnails, the flipped card and in Arabic", () => {
    expect(html({}, "thumb")).toContain("cf-12");
    expect(renderCardPage({ ...base, locale: "ar", name: "سارة المنصوري", title: "مصممة" }, "live").html).toContain("سارة");
    const flipped = renderCardPage({ ...base }, "live", true).html;
    expect(flipped).toContain("flipped");
    // Arabic text inside a style sheet is never touched
    const css = stored('.n::before{content:"مرحبا"}');
    const h = html({ customFace: mk({ css, hash: "ar1" }) });
    expect(h).toContain('content:"مرحبا"');
  });

  it("never puts NaN or undefined into the markup for an empty card", () => {
    const h = html({ name: "", title: "", company: "", address: "", photoUrl: null, items: [], brand: null });
    expect(h).not.toMatch(/NaN|undefined|\[object|null/);
    expect(h).toContain("cf-12");
  });

  it("drops repeated style elements of the same face on one page", () => {
    const seen = new Set<string>();
    const first = onceStyles(html(), seen);
    const second = onceStyles(html(), seen);
    expect(first).toContain("<style data-cf=");
    expect(second).not.toContain("<style data-cf=");
    expect(second).toContain("cf-12");
  });

  it("swaps only the front and leaves the page alone when the markup is not found", () => {
    expect(swapFront("<p>nothing</p>", "<x>")).toBe("<p>nothing</p>");
    expect(swapFront('<div class="face d3 tv0">A</div><div class="face back">B</div>', "<F/>")).toBe('<F/><div class="face back">B</div>');
  });

  it("lists only the company's own pictures as allowed addresses", () => {
    expect(ownMedia(base.brand)).toEqual(["https://api.test/media/logos/acme.png"]);
    expect(ownMedia(null)).toEqual([]);
    const f = mk({ css: stored(".n{background-image:url(/media/logos/acme.png)}") });
    expect(f.css).toBe("");
    const b = { ...base.brand!, logoUrl: "https://api.test/media/logos/acme.png" };
    const g = face({ css: sanitizeCss(".n{background-image:url(/media/logos/acme.png)}", 12, ["https://api.test/media/logos/acme.png"]).value, hash: "m1" });
    expect(cleanFace(g, ownMedia(b)).css).toContain('url("/media/logos/acme.png")');
    expect(cleanFace({ ...g, hash: "m2" }, []).css).not.toContain("url(");
  });

  it("reads the colourway number safely", () => {
    expect(customColours({ palettes }, 2).bg).toBe(palettes[2].bg);
    expect(customColours({ palettes }, 9).bg).toBe(palettes[0].bg);
    expect(customColours({ palettes }, -1).bg).toBe(palettes[0].bg);
    expect(customColours({ palettes }, 1).pageVars["--pgbg"]).toMatch(/^#/);
  });
});
