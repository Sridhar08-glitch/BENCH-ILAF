import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
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

  it("carries Design Pack 2 in one marked block whose rules are all scoped under a pack face", () => {
    const blocks = css.match(/\/\* pack2 start \*\/[\s\S]*?\/\* pack2 end \*\//g) ?? [];
    expect(blocks).toHaveLength(1);
    const pack = (blocks[0] ?? "").slice("/* pack2 start */".length, -"/* pack2 end */".length);
    // the wrapper rule, then only rules under .cfl .d401 … .d500 (and the pack's own keyframes)
    const selectors = [...pack.replace(/@keyframes [\w-]+\{[^{}]*(\{[^{}]*\})*[^{}]*\}/g, "").matchAll(/(^|\})([^{}]+)\{/g)].map((m) => m[2]);
    expect(selectors.length).toBeGreaterThan(500);
    const loose = selectors.flatMap((s) => s.split(",")).filter((s) => !/^\.cfl \.d(4[0-9]{2}|500) \.p2\b/.test(s.trim()) && s.trim() !== ".cfl .face .p2");
    expect(loose).toEqual([]);
    for (let n = 401; n <= 500; n++) expect(pack, `face ${n}`).toContain(`.cfl .d${n} .p2`);
    // the designers' own class names are prefixed, so none can meet a library or app rule
    expect(pack).not.toMatch(/\.p2 \.(ln|dot|bar|chip|tag|row|cell|lab|n|t1|co|cl)\b/);
    expect(css.slice(css.indexOf("/* pack2 start */"))).not.toMatch(/\.k4\d\d\b/);
  });

  it("names the stylesheet by the hash of the whole file, pack included", () => {
    const meta = read("src", "lib", "library", "generated", "meta.ts");
    const v = /CSS_URL = "\/card-library\/designs\.css\?v=([0-9a-f]+)"/.exec(meta)?.[1];
    expect(v).toBe(createHash("sha1").update(css).digest("hex").slice(0, 8));
    expect(meta).toMatch(/\/\* pack2 start: faces 401 to 500[^\n]*\*\/\nexport const FACE_META/);
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
