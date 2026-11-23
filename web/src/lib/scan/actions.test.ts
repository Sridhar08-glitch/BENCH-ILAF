import { describe, expect, it } from "vitest";
import { applyFill, fillChanges, scanLead as scanLeadT, scanVcard, type ScanFields } from "./actions";
import { createI18n } from "@/lib/i18n";
import { en } from "@/lib/i18n/messages";
import { fitSide, ocrFilesPresent } from "./ocr";

const scanLead = (f: ScanFields) => scanLeadT(f, createI18n("en", "latn", en).t);

const f: ScanFields = {
  name: "Sara Al Thani", title: "Head of Sales", company: "Gulf Studio, W.L.L", phones: ["+974 5555 1234", "+974 4444 1234"], emails: ["sara@gulfstudio.example"],
  websites: ["www.gulfstudio.example"], address: "West Bay, Doha", social: ["https://instagram.com/sara"],
};

describe("contact file from a scan", () => {
  it("is a vCard 3.0 with the reviewed fields", () => {
    const v = scanVcard(f);
    expect(v.startsWith("BEGIN:VCARD\r\nVERSION:3.0\r\n")).toBe(true);
    expect(v).toContain("N:Al Thani;Sara;;;");
    expect(v).toContain("FN:Sara Al Thani");
    expect(v).toContain("ORG:Gulf Studio\\, W.L.L");
    expect(v).toContain("TITLE:Head of Sales");
    expect(v).toContain("TEL;TYPE=CELL:+97455551234");
    expect(v).toContain("TEL;TYPE=WORK,VOICE:+97444441234");
    expect(v).toContain("EMAIL;TYPE=INTERNET:sara@gulfstudio.example");
    expect(v).toContain("URL:https://www.gulfstudio.example");
    expect(v).toContain("ADR;TYPE=WORK:;;West Bay\\, Doha;;;;");
    expect(v).toContain("item1.URL:https://instagram.com/sara");
    expect(v.endsWith("END:VCARD\r\n")).toBe(true);
  });
  it("needs a name", () => {
    expect(scanVcard({ ...f, name: "  " })).toBe("");
  });
  it("skips empty rows and handles that are not links", () => {
    const v = scanVcard({ ...f, phones: ["", "  "], emails: [""], social: ["@sara"] });
    expect(v).not.toContain("TEL");
    expect(v).not.toContain("EMAIL");
    expect(v).not.toContain("item1");
  });
});

describe("lead from a scan", () => {
  it("carries contact details and puts the rest in the note", () => {
    const l = scanLead(f);
    expect(l).toMatchObject({ name: "Sara Al Thani", email: "sara@gulfstudio.example", phone: "+974 5555 1234", company: "Gulf Studio, W.L.L" });
    expect(l.note).toContain("Title: Head of Sales");
    expect(l.note).toContain("Website: www.gulfstudio.example");
    expect(l.note).toContain("Other phone: +974 4444 1234");
    expect(l.note).toContain("Scanned from a paper card");
  });
  it("leaves missing values out", () => {
    const l = scanLead({ ...f, emails: [""], phones: [""], company: "" });
    expect(l.email).toBeUndefined();
    expect(l.phone).toBeUndefined();
    expect(l.company).toBeUndefined();
  });
});

describe("fill my card", () => {
  const card = { name: "Sara", title: "", company: "Studio", items: [{ kind: "Mobile" as const, value: "+974 5555 0000", label: "", on: false }, { kind: "Website" as const, value: "x.example", label: "", on: true }] };
  it("lists only what is new or different", () => {
    const c = fillChanges(card, f);
    expect(c.map((x) => x.field)).toEqual(["name", "title", "company", "phone", "email"]);
    expect(c[0]).toMatchObject({ from: "Sara", to: "Sara Al Thani" });
    expect(fillChanges({ ...card, name: "Sara Al Thani" }, { ...f, title: "" }).map((x) => x.field)).toEqual(["company", "phone", "email"]);
  });
  it("never blanks a field the scan did not find", () => {
    expect(fillChanges(card, { ...f, name: "", company: "", phones: [""], emails: [""], title: "" })).toEqual([]);
  });
  it("applies the accepted changes: text, the first mobile (switched on) and a new email button", () => {
    const next = applyFill(card, fillChanges(card, f));
    expect(next).toMatchObject({ name: "Sara Al Thani", title: "Head of Sales", company: "Gulf Studio, W.L.L" });
    expect(next.items[0]).toMatchObject({ kind: "Mobile", value: "+974 5555 1234", on: true });
    expect(next.items[2]).toMatchObject({ kind: "Email", value: "sara@gulfstudio.example", on: true });
    expect(next.items[1].value).toBe("x.example");
    expect(card.items[0].on).toBe(false);
  });
  it("applies only the changes that were accepted", () => {
    const only = fillChanges(card, f).filter((c) => c.field === "title");
    const next = applyFill(card, only);
    expect(next.title).toBe("Head of Sales");
    expect(next.name).toBe("Sara");
    expect(next.items).toHaveLength(2);
  });
});

describe("reading the photo", () => {
  it("shrinks big photos and leaves small ones", () => {
    expect(fitSide(4000, 3000)).toEqual({ width: 2000, height: 1500 });
    expect(fitSide(3000, 4000)).toEqual({ width: 1500, height: 2000 });
    expect(fitSide(1200, 800)).toEqual({ width: 1200, height: 800 });
    expect(fitSide(0, 0)).toEqual({ width: 0, height: 0 });
  });
  it("says the engine is missing when its files are not on the site", async () => {
    const old = globalThis.fetch;
    globalThis.fetch = (async () => new Response("", { status: 404 })) as typeof fetch;
    try {
      expect(await ocrFilesPresent()).toBe(false);
    } finally {
      globalThis.fetch = old;
    }
  });
  it("says it is there when every file answers", async () => {
    const old = globalThis.fetch;
    globalThis.fetch = (async () => new Response("", { status: 200 })) as typeof fetch;
    try {
      expect(await ocrFilesPresent()).toBe(true);
    } finally {
      globalThis.fetch = old;
    }
  });
});
