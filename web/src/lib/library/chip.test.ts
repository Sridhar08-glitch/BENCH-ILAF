import { describe, expect, it } from "vitest";
import { PLATFORMS } from "@/lib/card/catalogue";
import { cr } from "./company/colour";
import { PALETTES } from "./generated/meta";
import { GLYPH_INK, MIN_VISIBLE, brandChip, chipBase, glyphOn, vanishes } from "./chip";
import { BELOW_COUNT, defaultDesign } from "./index";
import { buildInput, drawPage } from "./render";
import type { CardPageData } from "./types";
import type { ResolvedIcon } from "@/lib/card/brand";

const HEX = /^#[0-9a-f]{6}$/i;
const KINDS = PLATFORMS.map((p) => p.key);

/** Every kind and its official colour, exactly. */
const OFFICIAL: Record<string, string> = {
  WhatsApp: "#25D366", LinkedIn: "#0A66C2", Facebook: "#1877F2", Instagram: "#E4405F", X: "#000000", YouTube: "#FF0000", GitHub: "#181717",
  TikTok: "#000000", Telegram: "#26A5E4", Snapchat: "#FFFC00", Pinterest: "#E60023", Behance: "#1769FF", Dribbble: "#EA4C89", Medium: "#000000",
  Discord: "#5865F2", Twitch: "#9146FF", Spotify: "#1DB954", Reddit: "#FF4500", Threads: "#000000", Calendly: "#006BFF", Location: "#34A853",
  Mobile: "#34C759", Landline: "#34C759", SMS: "#34C759", Email: "#EA4335", Website: "#3B82F6",
};

describe("brand colour of each link kind", () => {
  it("is the official colour, exactly, for every kind", () => {
    for (const [k, c] of Object.entries(OFFICIAL)) expect(chipBase(k), k).toBe(c);
    expect(KINDS.filter((k) => k !== "Custom" && !(k in OFFICIAL))).toEqual(["SoundCloud", "AppStore", "GooglePlay", "PayPal"]);
    for (const k of KINDS.filter((x) => x !== "Custom")) expect(chipBase(k), k).toMatch(HEX);
    expect(chipBase("Custom")).toBeNull();
  });
  it("is the official colour for a brand the custom link is recognised as", () => {
    const brand = (title: string, hex: string): ResolvedIcon => ({ t: "brand", path: "M0 0", hex, title });
    const want: [string, string, string][] = [
      ["Pinterest", "BD081C", "#E60023"], ["Facebook", "0866FF", "#1877F2"], ["Spotify", "1ED760", "#1DB954"], ["Signal", "3B45FD", "#3A76F0"],
      ["Skype", "00AFF0", "#00AFF0"], ["Viber", "7360F2", "#7360F2"], ["Zoom", "0B5CFF", "#0B5CFF"], ["Google Maps", "4285F4", "#34A853"], ["X", "000000", "#000000"],
    ];
    for (const [t, hex, c] of want) expect(chipBase("Custom", brand(t, hex)), t).toBe(c);
    // a brand outside the list keeps the logo set's colour
    expect(chipBase("Custom", brand("SoundCloud", "ff5500"))).toBe("#FF5500");
  });
  it("follows the owner's chosen generic icon, and shows the accent for a picture or an unknown icon", () => {
    expect(chipBase("Custom", { t: "lucide", key: "mail" })).toBe("#EA4335");
    expect(chipBase("Custom", { t: "lucide", key: "phone" })).toBe("#34C759");
    expect(chipBase("Custom", { t: "lucide", key: "star" })).toBeNull();
    expect(chipBase("Custom", { t: "image", url: "https://x.y/a.png" })).toBeNull();
    expect(chipBase("Email", { t: "image", url: "https://x.y/a.png" })).toBe("#EA4335");
  });
});

describe("chip and icon colours on a page", () => {
  const pages = [...PALETTES.flatMap((p) => [p.bg, p.bg2]), "#000000", "#FFFFFF", "#808080", "#FFFC00", "#25D366", "#2F3A5A"];
  it("never changes a brand colour that shows, and gives it white (or dark ink on yellow) for the logo", () => {
    for (const k of Object.keys(OFFICIAL)) {
      for (const page of pages) {
        const base = OFFICIAL[k];
        const c = brandChip(base, page);
        if (!vanishes(base, page)) expect(c, `${k} on ${page}`).toEqual({ bc: base, bf: k === "Snapchat" ? GLYPH_INK : "#FFFFFF" });
      }
    }
    expect(glyphOn("#25D366")).toBe("#FFFFFF");
    expect(glyphOn("#26A5E4")).toBe("#FFFFFF");
    expect(glyphOn("#FFFC00")).toBe(GLYPH_INK);
  });
  it("puts a plain chip behind a logo that would vanish, and the logo keeps its colour", () => {
    expect(brandChip("#000000", "#10131C")).toEqual({ bc: "#FFFFFF", bf: "#000000" });
    expect(brandChip("#181717", "#2F3A5A")).toEqual({ bc: "#FFFFFF", bf: "#181717" });
    expect(brandChip("#FFFC00", "#FFFFFF")).toEqual({ bc: GLYPH_INK, bf: "#FFFC00" });
    expect(brandChip("#000000", "#FFFFFF")).toEqual({ bc: "#000000", bf: "#FFFFFF" });
    expect(brandChip("#25D366", "#FFFFFF").bc).toBe("#25D366");
  });
  it("always leaves a chip that stands out from the page and a logo that can be told from the chip", () => {
    for (const k of Object.keys(OFFICIAL)) {
      for (const page of pages) {
        const c = brandChip(OFFICIAL[k], page);
        expect(cr(c.bf, c.bc), `${k} logo on chip, page ${page}`).toBeGreaterThanOrEqual(1.9);
        if (vanishes(OFFICIAL[k], page)) expect(cr(c.bc, page), `${k} chip on page ${page}`).toBeGreaterThanOrEqual(3);
      }
    }
  });
});

const items = KINDS.map((kind) => ({ kind, value: kind === "Email" ? "a@b.co" : kind === "Mobile" || kind === "Landline" || kind === "WhatsApp" || kind === "SMS" ? "+97455123344" : kind === "Custom" ? "https://x.example/menu" : `https://${kind.toLowerCase()}.example/me` }));
const data = (patch: Partial<CardPageData["design"]>): CardPageData => ({
  name: "Sara Noor", title: "Designer", company: "Studio", address: "Doha", photoUrl: null, saveContact: true, publicUrl: "https://c.example/c/s", items,
  design: { ...defaultDesign(), intro: 0, ...patch },
});
const anchors = (html: string, from: number) => {
  const start = html.indexOf('class="dv dv' + from);
  const more = html.indexOf(' more"', start);
  const body = html.slice(start, more > 0 ? more : undefined);
  return body.match(/<a\b[^>]*\sdata-i="\d+"[^>]*>/g) ?? [];
};

describe("brand colours below the card, every layout", () => {
  it("gives every link of every layout its own colours when the switch is on, and nothing when it is off", () => {
    const badOn: string[] = [];
    const badOff: string[] = [];
    for (let below = 1; below <= BELOW_COUNT; below++) {
      const on = drawPage(buildInput(data({ below, brand_colors: true })), { brand: null }).html;
      const off = drawPage(buildInput(data({ below, brand_colors: false })), { brand: null }).html;
      if (below >= 13) {
        // every link of the layout that has a brand colour carries its chip and icon colours in the variables the layout
        // draws with (the custom link without a brand keeps the accent)
        const links = anchors(on, below - 1).filter((l) => !/aria-label="(Link|Our menu)"/.test(l) && !(below > 400 && /x\.example\/menu/.test(l)));
        if (below <= 400 && links.length < 5) badOn.push(`${below}: only ${links.length} links`);
        for (const l of links) {
          if (!(below > 400 ? /--bc:#[0-9A-F]{6};--bf:#[0-9A-F]{6};--pacc:#[0-9A-F]{6};--pon:#[0-9A-F]{6};/ : /--bc:#[0-9A-F]{6};--bf:#(FFFFFF|0F172A);--pacc:#[0-9A-F]{6};--pon:#(FFFFFF|0F172A);/).test(l)) badOn.push(`${below}: ${l.slice(0, 120)}`);
        }
      }
      if (/--bc:|--bf:|--pacc:#/.test(off)) badOff.push(String(below));
      expect(off, `layout ${below} off`).toContain(" harm");
      expect(on, `layout ${below} on`).not.toMatch(/class="dv dv\d+ k0 harm"/);
    }
    expect(badOn).toEqual([]);
    expect(badOff).toEqual([]);
  });

  it("colours the chips of the first 12 layouts with the checked brand colours", () => {
    const html = drawPage(buildInput(data({ below: 1, brand_colors: true })), { brand: null }).html;
    expect(html).toContain("--mc:#25D366");
    expect(html).toContain("--mc:#EA4335");
    expect(html).toContain("--mc:#34C759");
    expect(html).toContain("--mc:#3B82F6");
    expect(html).toContain("--mc:#0A66C2");
    expect(html).toContain("--mc:#1877F2");
    const off = drawPage(buildInput(data({ below: 1, brand_colors: false })), { brand: null }).html;
    expect(off).not.toContain("--mc:#25D366");
    expect(off).toContain("--mc:var(--pacc)");
  });

  it("works with a dark page and a company palette too", () => {
    const pal = { bg: "#0f2d5c", bg2: "#2b456f", fg: "#f8f9fa", acc: "#d2a63b", on: "#0f2d5c" };
    const d = { ...data({ below: 50, brand_colors: true, colour: 4 }), brand: { companyName: "Gulf", logoUrl: null, palette: pal } };
    const input = buildInput(d);
    const out = drawPage(input, d);
    expect(out.pageVars["--pgbg"]).toBe(input.page?.["--pgbg"]);
    for (const it of input.items.filter((i) => i.kind !== "Custom")) {
      expect(it.bc, it.kind).toMatch(HEX);
      expect(cr(it.bf as string, it.bc as string), it.kind).toBeGreaterThanOrEqual(1.9);
      expect(cr(it.bc as string, out.pageVars["--pgbg"]), it.kind).toBeGreaterThanOrEqual(MIN_VISIBLE);
    }
    expect(out.html).toContain("--pacc:#");
  });
});
