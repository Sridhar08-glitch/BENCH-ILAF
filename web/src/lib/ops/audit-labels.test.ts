import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createI18n } from "@/lib/i18n";
import { CATALOGUES } from "@/lib/i18n/messages";
import { describeEvent } from "./audit";

// Every action key the backend can write to the activity log needs a sentence in English and in Arabic.
const AUDIT = path.join(__dirname, "..", "..", "..", "..", "backend", "operations", "audit.py");

function backendKeys(): string[] {
  if (!fs.existsSync(AUDIT)) return [];
  const text = fs.readFileSync(AUDIT, "utf8");
  const block = text.slice(text.indexOf("ACTIONS = {"), text.indexOf("}\n", text.indexOf("ACTIONS = {")));
  return [...block.matchAll(/^\s+"([a-z_]+\.[a-z_]+)":/gm)].map((m) => m[1]);
}

describe("activity log sentences", () => {
  const keys = backendKeys();
  const details: Record<string, Record<string, unknown>> = {
    "lead.assigned": { to: "Sara" },
    "lead.status_changed": { old: "new", new: "won" },
    "lead.bulk_updated": { action: "assign", count: 3, assignee: "Sara" },
    "lead.exported": { rows: 12, notes: true },
  };
  for (const locale of ["en", "ar"] as const) {
    it(`writes a sentence of its own for every backend action in ${locale}`, () => {
      expect(keys.length).toBeGreaterThan(30);
      const i18n = createI18n(locale, "latn", CATALOGUES[locale]);
      for (const action of keys) {
        const text = describeEvent({ action, target_label: "X", details: details[action] ?? {}, label: "BACKEND-LABEL" }, i18n);
        expect(text, action).not.toBe("BACKEND-LABEL");
        expect(text, action).not.toMatch(/\{|company\.|contacts\./);
      }
    });
  }

  it("says whether an employee started or stopped sharing contacts", () => {
    const en = createI18n("en", "latn", CATALOGUES.en);
    expect(describeEvent({ action: "member.share_contacts_changed", target_label: "Eve", details: { share_contacts: true }, label: "" }, en)).toBe("Eve started sharing new contacts with the company");
    expect(describeEvent({ action: "member.share_contacts_changed", target_label: "Eve", details: { share_contacts: false }, label: "" }, en)).toBe("Eve stopped sharing new contacts with the company");
  });

  it("says what the spreadsheet download contained", () => {
    const en = createI18n("en", "latn", CATALOGUES.en);
    expect(describeEvent({ action: "lead.exported", target_label: "", details: { rows: 1, notes: false }, label: "" }, en)).toBe("Downloaded 1 contact as a spreadsheet");
    expect(describeEvent({ action: "lead.exported", target_label: "", details: { rows: 5, notes: true }, label: "" }, en)).toContain("with internal notes");
  });
});
