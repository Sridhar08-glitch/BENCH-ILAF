import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { FONTS_CSS_URL } from "@/lib/library/generated/fonts";

const ROOT = path.join(__dirname, "..", "..");

function walk(dir: string, out: string[] = []): string[] {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (/\.(ts|tsx|css|js|mjs)$/.test(e.name)) out.push(p);
  }
  return out;
}

describe("no third-party font host", () => {
  it("is not named anywhere in the app source or the card stylesheet", () => {
    const files = [...walk(path.join(ROOT, "src")), path.join(ROOT, "public", "card-library", "designs.css")].filter((f) => !f.endsWith(".test.ts"));
    for (const f of files) {
      const text = fs.readFileSync(f, "utf8");
      expect(text.includes("fonts.googleapis.com") || text.includes("fonts.gstatic.com"), f).toBe(false);
    }
  });

  it("the card pages link the self-hosted stylesheet", () => {
    expect(FONTS_CSS_URL).toMatch(/^\/card-fonts\/fonts\.css\?v=[0-9a-f]{10}$/);
  });
});
