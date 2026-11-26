import { describe, expect, it } from "vitest";
import { defaultDesign } from "./index";
import { renderCardPage } from "./render";
import { splitTail } from "./tail";

const data = { name: "A", title: "B", company: "C", address: "D", photoUrl: null, coverUrl: null, saveContact: true, publicUrl: "https://x.test/c/x", brand: null, locale: "en", items: [{ kind: "Mobile", value: "+974 5512 3344" }] };

describe("splitTail", () => {
  it("cuts the footer off a card face page", () => {
    const html = renderCardPage({ ...data, design: { ...defaultDesign() }, footer: true } as never, "live").html;
    const { main, tail } = splitTail(html);
    expect(main).not.toContain('class="foot"');
    expect(tail).toContain('class="foot"');
    expect(main + tail.length).toBeTruthy();
  });
  it("takes the QR code of a page style with the footer", () => {
    const html = renderCardPage({ ...data, design: { ...defaultDesign(), top: 3, below: 403 } } as never, "live").html;
    const { main, tail } = splitTail(html);
    expect(tail).toContain('class="pg-qr"');
    expect(main).not.toContain('class="pg-qr"');
  });
  it("keeps the page whole: main plus tail is the page with the same tags", () => {
    const html = renderCardPage({ ...data, design: { ...defaultDesign(), top: 3, below: 403 } } as never, "live").html;
    const { main, tail } = splitTail(html);
    expect(main.slice(0, -"</div>".length) + tail + "</div>").toBe(html);
  });
  it("leaves other markup alone", () => {
    expect(splitTail("<p>x</p>")).toEqual({ main: "<p>x</p>", tail: "" });
  });
});
