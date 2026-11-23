import { describe, expect, it } from "vitest";
import { buildVcard, parseVcard, previewFromCard, unvq, vcardFields, vq, type VcSource } from "./vcard";

const base: VcSource = {
  name: "Jasir Vadakkedath",
  title: "Managing Director",
  company: "Jas, Documents; Services",
  address: "Al Yasmin Building, Dubai",
  cardUrl: "https://cards.example/c/jasir",
  vc: { company: true, photo: true, phones: true, emails: true, urls: true, social: true, addr: true, note: "Met at expo" },
  items: [
    { kind: "Mobile", value: "+971 50 669 8770", label: "", on: true },
    { kind: "WhatsApp", value: "+971 50 669 8770", label: "", on: true },
    { kind: "Landline", value: "+971 4 331 9655", label: "", on: true },
    { kind: "Email", value: "info@jascorps.com", label: "", on: true },
    { kind: "Instagram", value: "instagram.com/jascorps", label: "", on: true },
    { kind: "Website", value: "jascorps.com", label: "", on: true },
    { kind: "Custom", value: "example.com/menu", label: "Menu", on: true },
    { kind: "Facebook", value: "facebook.com/x", label: "", on: false },
  ],
};

describe("escaping", () => {
  it("escapes and restores special characters", () => {
    expect(vq("a,b;c\\d\ne")).toBe("a\\,b\\;c\\\\d\\ne");
    expect(unvq(vq("a,b;c\\d\ne"))).toBe("a,b;c\\d\ne");
  });
});

describe("fields", () => {
  it("does not add WhatsApp twice when it is the same number as the mobile", () => {
    const tels = vcardFields(base).filter((f) => f.t === "tel");
    expect(tels).toHaveLength(2);
    expect(tels.map((t) => t.l)).toEqual(["mobile", "work"]);
  });
  it("skips buttons that are switched off", () => {
    expect(vcardFields(base).some((f) => f.v.includes("facebook"))).toBe(false);
  });
  it("honours the owner's switches", () => {
    const f = vcardFields({ ...base, vc: { ...base.vc, phones: false, emails: false, social: false, urls: false, addr: false } });
    expect(f).toEqual([{ t: "url", l: "my card", v: "https://cards.example/c/jasir" }]);
  });
  it("labels custom links with the owner's label and adds https", () => {
    const f = vcardFields(base).find((x) => x.l === "Menu");
    expect(f?.v).toBe("https://example.com/menu");
  });
});

describe("contact file text", () => {
  const text = buildVcard(base);
  it("is a vCard 3.0 with escaped company", () => {
    expect(text.startsWith("BEGIN:VCARD\nVERSION:3.0")).toBe(true);
    expect(text).toContain("ORG:Jas\\, Documents\\; Services");
    expect(text).toContain("N:Vadakkedath;Jasir;;;");
    expect(text.endsWith("END:VCARD")).toBe(true);
  });
  it("writes social links as itemN.URL with a label", () => {
    expect(text).toContain("item1.URL:https://instagram.com/jascorps");
    expect(text).toContain("item1.X-ABLabel:Instagram");
  });
  it("leaves out company and photo when switched off", () => {
    const t = buildVcard({ ...base, vc: { ...base.vc, company: false, photo: false } });
    expect(t).not.toContain("ORG:");
    expect(t).not.toContain("PHOTO");
  });
});

describe("preview", () => {
  it("builds from the card", () => {
    const p = previewFromCard(base);
    expect(p.subtitle).toBe("Managing Director - Jas, Documents; Services");
    expect(p.rows[0]).toEqual({ label: "mobile", value: "+971 50 669 8770" });
    expect(p.note).toBe("Met at expo");
  });
  it("reads back a real vCard file", () => {
    const file = [
      "BEGIN:VCARD", "VERSION:3.0", "N:Reid;Marcus;;;", "FN:Marcus Reid", "ORG:Northwind\\, Labs", "TITLE:CEO",
      "TEL;TYPE=CELL:+44 7700 900123", "EMAIL;TYPE=INTERNET,WORK:m@nw.io",
      "item1.URL:https://linkedin.com/in/m", "item1.X-ABLabel:LinkedIn",
      "ADR;TYPE=WORK:;;1 High St\\, Leeds;;;;", "PHOTO;ENCODING=b;TYPE=JPEG:AAAA", "NOTE:Hello", "END:VCARD",
    ].join("\r\n");
    const p = parseVcard(file);
    expect(p.name).toBe("Marcus Reid");
    expect(p.subtitle).toBe("CEO - Northwind, Labs");
    expect(p.hasPhoto).toBe(true);
    expect(p.note).toBe("Hello");
    expect(p.rows).toContainEqual({ label: "mobile", value: "+44 7700 900123" });
    expect(p.rows).toContainEqual({ label: "LinkedIn", value: "linkedin.com/in/m" });
    expect(p.rows).toContainEqual({ label: "work", value: "1 High St, Leeds" });
  });
});
