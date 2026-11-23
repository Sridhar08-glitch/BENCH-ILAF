import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { ADMIN_NAV, PERMISSIONS, can, navFor, whyNot, type Permission } from "./roles";

// The server's permission table, read from the Python source so the two can never drift apart.
function serverTable(): Record<string, string[]> {
  const file = path.resolve(__dirname, "../../../../backend/staff/perms_map.py");
  const text = fs.readFileSync(file, "utf8");
  const out: Record<string, string[]> = {};
  for (const m of text.matchAll(/^\s{4}"(\w+)": \(".*?", "[^"]+", \(([^)]*)\)\),?$/gm)) {
    out[m[1]] = [...m[2].matchAll(/"(\w+)"/g)].map((x) => x[1]);
  }
  return out;
}

describe("staff permissions", () => {
  it("match the table the server enforces", () => {
    const server = serverTable();
    expect(Object.keys(server).sort()).toEqual(Object.keys(PERMISSIONS).sort());
    for (const [key, roles] of Object.entries(PERMISSIONS)) expect([...roles].sort()).toEqual([...server[key]].sort());
  });

  it("gives read-only people the look-only permissions and nothing else", () => {
    const mine = (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can("read_only", p));
    expect(mine.sort()).toEqual(["search", "view"]);
    expect(can("read_only", "support")).toBe(false);
    expect(can("read_only", "export")).toBe(false);
  });

  it("lets support handle single cards, data requests and abuse but not companies, plans, flags or staff", () => {
    for (const p of ["support", "suspendCard", "triage", "data", "notes", "resend", "export"] as Permission[]) expect(can("support", p)).toBe(true);
    for (const p of ["suspendCo", "announce", "flags", "plans", "staff", "signOutUser"] as Permission[]) expect(can("support", p)).toBe(false);
  });

  it("lets an admin do everything", () => {
    expect((Object.keys(PERMISSIONS) as Permission[]).every((p) => can("admin", p))).toBe(true);
  });

  it("says nothing for an unknown person and explains a refusal", () => {
    expect(can(undefined, "view")).toBe(false);
    expect(whyNot("support", "flags")).toBe("Only an admin can do this.");
    expect(whyNot("read_only", "triage")).toBe("Your role cannot do this.");
    expect(whyNot("admin", "flags")).toBe("");
  });

  it("hides the support view entry from read-only people", () => {
    expect(navFor("read_only").some((n) => n.href === "/staff/support-view")).toBe(false);
    expect(navFor("support").some((n) => n.href === "/staff/support-view")).toBe(true);
    expect(new Set(ADMIN_NAV.map((n) => n.href)).size).toBe(ADMIN_NAV.length);
  });
});
