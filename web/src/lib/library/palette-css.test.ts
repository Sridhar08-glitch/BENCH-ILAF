import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

const read = (...p: string[]) => fs.readFileSync(path.join(__dirname, "..", "..", "..", ...p), "utf8");
const css = read("public", "card-library", "designs.css");

// The area below the card must be drawn from the colourway's own page colours, never a fixed white.
describe("card stylesheet keeps the colourway palette", () => {
  it("draws the link rows and round action buttons from the page colours", () => {
    const lk = /\.cfl \.dv \.lk\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(lk).toContain("var(--pgfg)");
    expect(lk).not.toMatch(/background:(#fff|#ffffff|white)/i);
    const act = /\.cfl \.dv \.acts span\{[^}]*\}/.exec(css)?.[0] ?? "";
    expect(act).toContain("var(--pgfg)");
    expect(act).toContain("var(--pacc)");
  });

  it("paints the page itself from the page colour", () => {
    expect(css).toMatch(/\.cfl\{[^}]*background:var\(--pgbg\)/);
  });

  it("never blurs or fades the card page or its wrappers", () => {
    for (const rule of css.match(/\.cfl(?:\.thumb|\.full)?\{[^}]*\}/g) ?? []) {
      expect(rule).not.toMatch(/filter:|backdrop-filter/);
    }
    expect(css).not.toMatch(/\.cfl \.(?:stg|face|dv)\{[^}]*(?:blur\(|backdrop-filter)/);
  });
});

// The editor preview and the picker thumbnails only scale the card; they add no blur, fade or overlay.
describe("editor preview wrappers apply no blur", () => {
  for (const file of [["src", "components", "app", "preview.module.css"], ["src", "components", "editor", "design", "Preview.tsx"], ["src", "components", "app", "PreviewDock.tsx"]]) {
    it(file.join("/"), () => {
      const text = read(...file);
      expect(text).not.toMatch(/blur\(|backdrop-filter|filter:/);
      expect(text).not.toMatch(/image-rendering/);
    });
  }
});
