import { describe, expect, it } from "vitest";
import { hrefFor } from "./href";
import { EXTRA_PLATFORMS, itemLabel, platformName, platformOf } from "./catalogue";
import { DOWNLOAD_KIND, MORE_KINDS, WEB_KIND_HOSTS, kindLinkProblem } from "./kind-rules";
import { buildEntries, groupOf } from "./entries";
import { KIND_COLOURS, chipBase, glyphOn } from "@/lib/library/chip";
import { cr } from "@/lib/library/company/colour";

const GOOD: Record<string, string> = {
  Document: "https://northgate.com/catalogue.pdf",
  Menu: "northgate.com/menu",
  Vimeo: "vimeo.com/12345",
  Loom: "https://www.loom.com/share/abc",
  GoogleReview: "https://g.page/r/CabC/review",
  Trustpilot: "https://www.trustpilot.com/review/northgate.com",
  TripAdvisor: "https://www.tripadvisor.co.uk/Hotel_Review-g1",
  AppleMaps: "https://maps.apple.com/?q=cafe",
  WhatsAppChannel: "https://whatsapp.com/channel/0029Vabc",
  Airbnb: "https://www.airbnb.com/rooms/1",
  Etsy: "https://www.etsy.com/shop/north",
  Shopify: "https://north.myshopify.com",
  Amazon: "https://www.amazon.ae/dp/B0",
};

describe("link rules per kind", () => {
  it("accepts a good link for every kind with rules", () => {
    for (const [kind, value] of Object.entries(GOOD)) expect(kindLinkProblem(kind, value), kind).toBeNull();
  });

  it("every kind with rules has a good example here", () => {
    expect(Object.keys(WEB_KIND_HOSTS).sort()).toEqual(Object.keys(GOOD).sort());
  });

  it("refuses http, other schemes, spaces and logins", () => {
    for (const kind of Object.keys(GOOD)) {
      for (const bad of ["http://example.com/x", "javascript:alert(1)", "ftp://example.com/x", "https://user:pw@example.com/x", "not a link"]) {
        expect(kindLinkProblem(kind, bad), `${kind} ${bad}`).toBe("https");
      }
    }
  });

  it("refuses the wrong site, including look-alike hosts", () => {
    const cases: [string, string][] = [
      ["Vimeo", "https://youtube.com/watch?v=1"], ["Loom", "https://evil-loom.com/x"], ["GoogleReview", "https://example.com/r"],
      ["Trustpilot", "https://trustpilot.com.evil.io/x"], ["TripAdvisor", "https://example.com/x"], ["AppleMaps", "https://maps.google.com/x"],
      ["Airbnb", "https://example.com/x"], ["Etsy", "https://etsy.evil.com/x"], ["Amazon", "https://example.com/dp/1"],
      ["WhatsAppChannel", "https://whatsapp.com/send?phone=1"],
    ];
    for (const [kind, bad] of cases) expect(kindLinkProblem(kind, bad), kind).toBe("site");
  });

  it("a WhatsApp community invite is fine and an empty value is no problem", () => {
    expect(kindLinkProblem("WhatsAppChannel", "https://chat.whatsapp.com/Abc123")).toBeNull();
    expect(kindLinkProblem("Vimeo", "  ")).toBeNull();
    expect(kindLinkProblem("Website", "anything goes")).toBeNull();
  });

  it("a Download file button needs an uploaded PDF address", () => {
    expect(kindLinkProblem(DOWNLOAD_KIND, "https://api.test/media/files/ab/doc-1.pdf")).toBeNull();
    expect(kindLinkProblem(DOWNLOAD_KIND, "https://api.test/media/files/ab/doc.pdf?x=1")).toBeNull();
    expect(kindLinkProblem(DOWNLOAD_KIND, "https://api.test/x.exe")).toBe("upload");
    expect(kindLinkProblem(DOWNLOAD_KIND, "doc.pdf")).toBe("upload");
  });
});

describe("the new kinds are complete", () => {
  it("each one is in the catalogue, in the picker list, with a name, a button text and a link", () => {
    expect(new Set(MORE_KINDS).size).toBe(MORE_KINDS.length);
    for (const kind of MORE_KINDS) {
      expect(EXTRA_PLATFORMS.some((p) => p.key === kind), kind).toBe(true);
      expect(platformOf(kind).key).toBe(kind);
      expect(platformName(kind).length).toBeGreaterThan(1);
      expect(itemLabel({ kind, value: "https://x.example/y" }).length).toBeGreaterThan(1);
    }
    for (const [kind, value] of Object.entries(GOOD)) expect(hrefFor(kind, value), kind).toMatch(/^https:\/\//);
  });

  it("has a brand colour on the chip, exactly as specified, and a visible glyph", () => {
    const expected: Record<string, string> = {
      Document: "#DC2626", Menu: "#F59E0B", Vimeo: "#1AB7EA", Loom: "#625DF5", GoogleReview: "#4285F4", Trustpilot: "#00B67A",
      TripAdvisor: "#34E0A1", AppleMaps: "#000000", WhatsAppChannel: "#25D366", Airbnb: "#FF5A5F", Etsy: "#F1641E", Shopify: "#7AB55C",
      Amazon: "#FF9900",
    };
    for (const kind of MORE_KINDS) {
      const colour = KIND_COLOURS[kind];
      expect(colour, kind).toMatch(/^#[0-9A-F]{6}$/);
      if (expected[kind]) expect(colour).toBe(expected[kind]);
      expect(chipBase(kind)).toBe(colour);
      // white or the dark ink, whichever the chip rules choose, shows against the chip
      expect(cr(glyphOn(colour), colour), kind).toBeGreaterThanOrEqual(1.6);
    }
  });

  it("the buttons sit with the web links under the card, and show a safe link", () => {
    for (const kind of MORE_KINDS) expect(groupOf(kind), kind).toBe("w");
    const entries = buildEntries([{ kind: "Menu", value: "northgate.com/menu", on: true }, { kind: "Vimeo", value: "javascript:alert(1)", on: true }], "");
    expect(entries.find((e) => e.kind === "Menu")?.href).toBe("https://northgate.com/menu");
    expect(entries.find((e) => e.kind === "Vimeo")?.href).toBeNull();
  });
});
