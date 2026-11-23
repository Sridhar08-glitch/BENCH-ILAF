import { describe, expect, it } from "vitest";
import { REPORT_REASONS, seeOther, textFields } from "./public-form";

describe("public form helpers", () => {
  it("keeps only text fields, trimmed and capped", () => {
    const f = new FormData();
    f.set("a", "  hello ");
    f.set("b", "x".repeat(2000));
    f.set("file", new Blob(["x"]), "x.txt");
    const out = textFields(f, ["a", "b", "file", "missing"]);
    expect(out.a).toBe("hello");
    expect(out.b).toHaveLength(1000);
    expect("file" in out).toBe(false);
    expect("missing" in out).toBe(false);
  });
  it("lists the five report reasons the API accepts", () => {
    expect([...REPORT_REASONS]).toEqual(["spam", "fake", "offensive", "impersonation", "other"]);
  });
  it("redirects with 303 to a relative address", () => {
    const r = seeOther("/c/abc/report?sent=1");
    expect(r.status).toBe(303);
    expect(r.headers.get("location")).toBe("/c/abc/report?sent=1");
  });
});
