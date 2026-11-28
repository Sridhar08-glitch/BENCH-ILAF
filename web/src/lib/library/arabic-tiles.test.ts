import { describe, expect, it } from "vitest";
import { defaultDesign, belowOfTop } from "./index";
import { renderCardPage } from "./render";
import { joinArabicTiles } from "./arabic-tiles";
import type { CardPageData } from "./types";

const base: CardPageData = {
  name: "ليلى حسن", title: "مصممة", company: "استوديو", address: "الدوحة", photoUrl: null, coverUrl: null, saveContact: true,
  publicUrl: "https://x.test/c/x", design: defaultDesign(), brand: null, locale: "ar", items: [{ kind: "Mobile", value: "+974 5512 3344" }],
};
const draw = (face: number, name = base.name) => renderCardPage({ ...base, name, design: { ...defaultDesign(), face, below: belowOfTop(0), intro: 0 } }, "live").html;

describe("faces that draw the name as letter tiles", () => {
  it.each([62, 97, 193])("face %i draws an Arabic word in one tile, so the letters join", (face) => {
    const html = draw(face);
    expect(html).toContain("ليلى");
    expect(html).toContain("حسن");
    // no tile holds a single Arabic letter any more
    expect(/<(?:i|b)[^>]*>(?:<span[^>]*>)?[؀-ۿ](?:<\/span>)?<\/(?:i|b)>/.test(html)).toBe(false);
  });
  it.each([62, 97, 193])("face %i still draws a Latin name letter by letter", (face) => {
    const html = draw(face, "Sara Mansoori");
    expect(/<(?:i|b)[^>]*>S<\/(?:i|b)>|<i class="tk"[^>]*>S/.test(html)).toBe(true);
  });
  it("leaves other markup and Latin pages alone", () => {
    const latin = '<div class="n"><u><i class="c0" style="transform:rotate(1deg)">S</i></u></div>';
    expect(joinArabicTiles(latin)).toBe(latin);
  });
});
