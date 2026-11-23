import { describe, expect, it } from "vitest";
import QRCode from "qrcode";
import { QR_COMFORTABLE_BYTES, QR_MAX_BYTES, buildQrContact, phoneOf, qrSizeWarning as warn, utf8Bytes } from "./qr-vcard";
import { fullI18n } from "@/lib/i18n/catalogue";

const qrSizeWarning = (q: Parameters<typeof warn>[0]) => warn(q, fullI18n("en", "latn").t);

const base = {
  name: "Sara Al Thani", title: "Head of Sales", company: "Gulf Studio", address: "West Bay, Doha, Qatar", note: "Met at the expo",
  items: [
    { kind: "Mobile", value: "+974 5555 1234", on: true },
    { kind: "Email", value: "sara@gulfstudio.example", on: true },
    { kind: "Website", value: "gulfstudio.example", on: true },
    { kind: "Instagram", value: "@sara", on: true },
  ],
};

describe("contact inside the QR", () => {
  it("holds only name, title, company, phone, email and website", () => {
    const q = buildQrContact(base);
    expect(q.text).toContain("BEGIN:VCARD\nVERSION:3.0");
    expect(q.text).toContain("FN:Sara Al Thani");
    expect(q.text).toContain("N:Al Thani;Sara;;;");
    expect(q.text).toContain("ORG:Gulf Studio");
    expect(q.text).toContain("TITLE:Head of Sales");
    expect(q.text).toContain("TEL;TYPE=CELL:+97455551234");
    expect(q.text).toContain("EMAIL:sara@gulfstudio.example");
    expect(q.text).toContain("URL:https://gulfstudio.example");
    expect(q.text).not.toContain("ADR");
    expect(q.text).not.toContain("NOTE");
    expect(q.text).not.toContain("instagram");
    expect(q.trimmed).toEqual([]);
    expect(q.level).toBe("ok");
    expect(q.bytes).toBeLessThan(QR_COMFORTABLE_BYTES);
    expect(qrSizeWarning(q)).toBeNull();
  });
  it("adds address and note only when asked", () => {
    const q = buildQrContact(base, { address: true, note: true });
    expect(q.text).toContain("ADR;TYPE=WORK:;;West Bay\\, Doha\\, Qatar;;;;");
    expect(q.text).toContain("NOTE:Met at the expo");
  });
  it("cuts the note and address first, then the website, when the code would be too dense", () => {
    const long = { ...base, note: "x".repeat(200), address: "y".repeat(120) };
    const q = buildQrContact(long, { address: true, note: true });
    expect(q.trimmed.slice(0, 2)).toEqual(["note", "address"]);
    expect(q.text).not.toContain("NOTE");
    expect(q.text).toContain("EMAIL:");
    expect(qrSizeWarning(q)).toMatch(/left out: the note, the address/);
  });
  it("never cuts the name, phone or email", () => {
    const huge = { ...base, title: "t".repeat(300), company: "c".repeat(300) };
    const q = buildQrContact(huge);
    expect(q.trimmed).toEqual(["website", "title", "company"]);
    expect(q.text).toContain("FN:Sara Al Thani");
    expect(q.text).toContain("TEL");
    expect(q.text).toContain("EMAIL");
  });
  it("warns when it is still dense, and when it is too long to encode at all", () => {
    const dense = buildQrContact({ ...base, name: "N".repeat(150) });
    expect(dense.level).toBe("dense");
    expect(qrSizeWarning(dense)).toMatch(/still scans/);
    const over = buildQrContact({ ...base, name: "N".repeat(900) });
    expect(over.bytes).toBeGreaterThan(QR_MAX_BYTES);
    expect(qrSizeWarning(over)).toMatch(/too long/);
  });
  it("escapes commas and semicolons, and counts Arabic text in bytes", () => {
    const q = buildQrContact({ ...base, name: "Sara; Al, Thani", company: "شركة الخليج" });
    expect(q.text).toContain("FN:Sara\\; Al\\, Thani");
    expect(q.bytes).toBeGreaterThan(q.text.length);
    expect(utf8Bytes("شركة")).toBe(8);
  });
  it("normalises phone numbers", () => {
    expect(phoneOf("00971 50 123 4567")).toBe("+971501234567");
    expect(phoneOf("(050) 123-4567")).toBe("0501234567");
    expect(phoneOf("+974 5555 1234")).toBe("+97455551234");
    expect(phoneOf("")).toBe("");
  });
  it("skips switched-off buttons", () => {
    const q = buildQrContact({ ...base, items: base.items.map((i) => (i.kind === "Email" ? { ...i, on: false } : i)) });
    expect(q.text).not.toContain("EMAIL");
  });
  it("fits in a real QR code", () => {
    const q = buildQrContact(base);
    const code = QRCode.create(q.text, { errorCorrectionLevel: "M" });
    expect(code.version).toBeLessThanOrEqual(12);
  });
});
