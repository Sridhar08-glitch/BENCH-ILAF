import { describe, expect, it } from "vitest";
import { measureBrand, withBrandInfo } from "./brand-info";
import { defaultArtwork } from "@/lib/library/company/brand";
import { derivePalette } from "@/lib/library/company/colour";
import { drawPage, buildInput } from "@/lib/library/render";
import { defaultDesign } from "@/lib/library";
import type { CardPageData, CompanyBrand } from "@/lib/library/types";

const PAL = derivePalette("#0F2D5C", "#D2A63B", "brand").pal;

function brand(art: Partial<CompanyBrand["artwork"]>): CompanyBrand {
  return { companyName: "Acme", logoUrl: null, palette: PAL, colours: { primary: "#0F2D5C", accent: "#D2A63B", mode: "brand" }, artwork: { ...defaultArtwork(), ...art } };
}

describe("measuring a company's pictures on the server", () => {
  it("measures a sample background: lightest and darkest spots and a 14 x 8 grid", async () => {
    const info = await measureBrand(brand({ mode: "background", background: { kind: "sample", sample: "geo", strength: 60 } }));
    expect(info.bg).toBeTruthy();
    expect(info.bg!.grid).toHaveLength(8);
    expect(info.bg!.grid![0]).toHaveLength(14);
    expect(info.bg!.p8).toMatch(/^#[0-9a-f]{6}$/);
    expect(info.bg!.p92).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("measures the sample template front and back", async () => {
    const info = await measureBrand(brand({ mode: "template", template: { ...defaultArtwork().template, kind: "sample", sample: "terra", zone: "B" } }));
    expect(info.front?.avg).toMatch(/^#[0-9a-f]{6}$/);
    expect(info.back?.avg).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("never reads a picture from an address that is not the API's own", async () => {
    const info = await measureBrand({ ...brand({}), logoUrl: "https://evil.example/logo.png", symbolUrl: "http://127.0.0.1:1/x.png" });
    expect(info.logo).toBeUndefined();
    expect(info.symbol).toBeUndefined();
  });

  it("returns null for no company, and measurements that make the card draw", async () => {
    expect(await withBrandInfo(null)).toBeNull();
    const b = (await withBrandInfo(brand({ mode: "template", template: { ...defaultArtwork().template, kind: "sample", sample: "harbor", zone: "A" } })))!;
    const data: CardPageData = {
      name: "Amira", title: "Head", company: "Acme", address: "", photoUrl: null, items: [{ kind: "Email", value: "a@b.co" }], saveContact: true,
      publicUrl: "https://x.test/c/a", design: { ...defaultDesign(), colour: 4 }, brand: b,
    };
    const html = drawPage(buildInput(data), data).html;
    expect(html).toContain("face tpf");
    expect(html).not.toMatch(/undefined|NaN/);
  });
});
