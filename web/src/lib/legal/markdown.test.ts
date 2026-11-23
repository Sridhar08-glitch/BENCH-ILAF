import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fillPlaceholders, parseInline, parseMarkdown, safeHref } from "./markdown";
import { legalSettings } from "@/lib/server/legal";

describe("legal markdown", () => {
  it("reads headings, paragraphs and lists, and skips note lines", () => {
    const b = parseMarkdown("%% a note\n# Title\n\nOne line\ncontinues.\n\n## Part\n- first\n- **second** item\n\nEnd");
    expect(b.map((x) => x.kind)).toEqual(["h1", "p", "h2", "ul", "p"]);
    const list = b[3];
    expect(list.kind === "ul" && list.items).toHaveLength(2);
    const p = b[1];
    expect(p.kind === "p" && p.inline).toEqual([{ kind: "text", text: "One line continues." }]);
  });

  it("keeps bold and safe links, turns unsafe links into plain text", () => {
    expect(parseInline("a **b** [c](/privacy) [d](javascript:alert(1)) [e](https://x.test)")).toEqual([
      { kind: "text", text: "a " }, { kind: "bold", text: "b" }, { kind: "text", text: " " },
      { kind: "link", text: "c", href: "/privacy" }, { kind: "text", text: " " },
      { kind: "text", text: "d" }, { kind: "text", text: ") " }, { kind: "link", text: "e", href: "https://x.test" },
    ]);
    expect(safeHref("//evil.test")).toBeNull();
    expect(safeHref("data:text/html,x")).toBeNull();
    expect(safeHref("mailto:a@b.co")).toBe("mailto:a@b.co");
  });

  it("fills placeholders and leaves a missing one visible", () => {
    expect(fillPlaceholders("{{A}} and {{B}} and {{C}}", { A: "x", B: "" })).toBe("x and {{B}} and {{C}}");
  });
});

describe("the legal documents", () => {
  const dir = path.join(__dirname, "..", "..", "..", "content", "legal");
  const read = (f: string) => fs.readFileSync(path.join(dir, f), "utf8");
  const h2 = (f: string) => parseMarkdown(read(f)).filter((b) => b.kind === "h2").length;

  it("exist in English and Arabic with the same sections", () => {
    for (const doc of ["privacy", "terms"]) {
      expect(h2(`${doc}.en.md`)).toBeGreaterThan(8);
      expect(h2(`${doc}.ar.md`)).toBe(h2(`${doc}.en.md`));
    }
  });

  it("only use placeholders the app fills in, and mention no third-party font host", () => {
    for (const f of fs.readdirSync(dir)) {
      const text = read(f);
      const names = [...text.matchAll(/\{\{([A-Z_]+)\}\}/g)].map((m) => m[1]);
      for (const n of names) expect(["COMPANY_NAME", "APP_NAME", "SUPPORT_EMAIL"]).toContain(n);
      expect(text).not.toMatch(/fonts\.googleapis|gstatic/);
    }
  });

  it("start with a title heading", () => {
    for (const f of fs.readdirSync(dir)) expect(parseMarkdown(read(f))[0].kind).toBe("h1");
  });
});

describe("legal settings", () => {
  it("shows the draft banner unless it is switched off", () => {
    expect(legalSettings({}).draftBanner).toBe(true);
    expect(legalSettings({ LEGAL_DRAFT_BANNER: "true" }).draftBanner).toBe(true);
    expect(legalSettings({ LEGAL_DRAFT_BANNER: "false" }).draftBanner).toBe(false);
    expect(legalSettings({ LEGAL_DRAFT_BANNER: "0" }).draftBanner).toBe(false);
  });
  it("reads the support address", () => {
    expect(legalSettings({ COMPANY_SUPPORT_EMAIL: " help@x.test " }).supportEmail).toBe("help@x.test");
    expect(legalSettings({}).supportEmail).toBe("");
  });
});
