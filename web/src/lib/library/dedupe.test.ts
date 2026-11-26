import { describe, expect, it } from "vitest";
import { BELOW_COUNT, TOP_COUNT, defaultDesign } from "./index";
import { renderCardPage } from "./render";
import { withoutRepeatedButtons } from "./dedupe";
import type { CardPageData } from "./types";

const data: CardPageData = {
  name: "Maya Haddad", title: "Designer", company: "Studio", address: "Doha", photoUrl: null, coverUrl: null, saveContact: true,
  publicUrl: "https://x.test/c/x", design: defaultDesign(), brand: null, locale: "en",
  items: [
    { kind: "Mobile", value: "+974 5512 3344" }, { kind: "WhatsApp", value: "+974 5512 3344" }, { kind: "Email", value: "x@example.test" },
    { kind: "Website", value: "example.test" }, { kind: "Instagram", value: "https://instagram.com/x" }, { kind: "Location", value: "Doha" },
  ],
};
const ids = (html: string) => [...html.matchAll(/<a\b[^>]*\sdata-i="(\d+)"/g)].map((m) => m[1]);
const page = (top: number, below: number) => renderCardPage({ ...data, design: { ...defaultDesign(), top, below } }, "live").html;

describe("each button appears once", () => {
  it("the default List layout has no repeated icon row", () => {
    expect(page(0, 1)).not.toContain('class="acts"');
    const found = ids(page(0, 1));
    expect(new Set(found).size).toBe(found.length);
  });

  it("no header lists a button that its own layout under it lists again", () => {
    const bad: number[] = [];
    for (let t = 1; t <= TOP_COUNT; t++) {
      const found = ids(page(t, 400 + t));
      if (new Set(found).size !== found.length) bad.push(t);
    }
    expect(bad).toEqual([]);
  });

  it("the plain layouts below a classic face do not repeat a button either", () => {
    const bad: number[] = [];
    for (let b = 1; b <= BELOW_COUNT; b++) {
      const found = ids(page(0, b));
      if (new Set(found).size !== found.length) bad.push(b);
    }
    // Playlist, Story rings and Marquee tickers are built on a second copy (a player, a story viewer, a looping ticker).
    expect(bad.filter((b) => ![30, 59, 60].includes(b))).toEqual([]);
  });

  it("leaves a page without header buttons unchanged", () => {
    const html = '<div class="pg"><div class="dv a"><a data-i="0">x</a></div></div>';
    expect(withoutRepeatedButtons(html)).toBe(html);
  });

  it("drops a repeated button and an emptied more list", () => {
    const html = '<div class="pg"><a data-i="0">h</a><div class="dv k0 harm more"><a class="lk" data-i="0">x</a></div></div>';
    expect(withoutRepeatedButtons(html)).toBe('<div class="pg"><a data-i="0">h</a></div>');
  });
});

describe("page style QR code", () => {
  const html = (top: number, mode: "live" | "thumb" = "live") => renderCardPage({ ...data, design: { ...defaultDesign(), top, below: top > 0 ? 400 + top : 1 } }, mode).html;
  it("a page style shows a QR code above the footer, a card face keeps it on the back", () => {
    expect(html(3)).toContain('class="pg-qr"');
    expect(html(3).indexOf('class="pg-qr"')).toBeLessThan(html(3).indexOf('class="foot"'));
    expect(html(0)).not.toContain('class="pg-qr"');
  });
  it("every page style has one, and a small thumbnail does not", () => {
    for (let t = 1; t <= TOP_COUNT; t++) expect(html(t), `header ${t}`).toContain('class="pg-qr"');
    expect(html(3, "thumb")).not.toContain('class="pg-qr"');
  });
});

describe("openings made for page styles", () => {
  it("a page style with opening 401 to 406 carries that opening's class", () => {
    const names = ["pg-cover", "pg-avatar", "pg-cascade", "pg-focus", "pg-rise", "pg-glow"];
    names.forEach((n, i) => {
      const html = renderCardPage({ ...data, design: { ...defaultDesign(), top: 3, below: 403, intro: 401 + i } }, "live").html;
      expect(html, n).toContain(`in-${n}`);
    });
  });
});
