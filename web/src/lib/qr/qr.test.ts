import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { qrModules } from "@/lib/card/qr";
import { eyeOrigins, frameLayout, qrPaths, qrSvg, rrect } from "./render";
import { DEFAULT_STYLE, DOT_SHAPES, EYE_SHAPES, FRAME_STYLES, effectiveStyle, eccFor, logoSide, logoShare, normaliseStyle, presetsFor, scanGuard, type QrStyle } from "./style";

const TEXT = "https://ilaf.one/ahmed-d?s=qr";
const modules = qrModules(TEXT, "M")!;

function dump(name: string, svg: string) {
  const dir = process.env.QR_DUMP;
  if (!dir) return Promise.resolve();
  mkdirSync(dir, { recursive: true });
  return sharp(Buffer.from(svg), { density: 144 }).png().toBuffer().then((b) => writeFileSync(path.join(dir, `${name}.png`), b));
}

describe("scanGuard", () => {
  it("accepts dark on white", () => {
    const g = scanGuard(DEFAULT_STYLE);
    expect(g.level).toBe("ok");
    expect(g.issues).toEqual([]);
    expect(g.ratio).toBeGreaterThan(10);
  });
  it("refuses low contrast", () => {
    const g = scanGuard({ ...DEFAULT_STYLE, fg: "#AAAAAA", bg: "#FFFFFF" });
    expect(g.level).toBe("bad");
    expect(g.issues[0]).toMatchObject({ code: "low_contrast" });
  });
  it("warns about light modules on a dark background", () => {
    const g = scanGuard({ ...DEFAULT_STYLE, fg: "#FFFFFF", bg: "#101114" });
    expect(g.level).toBe("warn");
    expect(g.issues).toEqual([{ code: "light_on_dark" }]);
  });
  it("checks the corner squares, the quiet zone and the frame colour", () => {
    expect(scanGuard({ ...DEFAULT_STYLE, eyeFg: "#EEEEEE" }).issues.map((i) => i.code)).toContain("eye_contrast");
    expect(scanGuard({ ...DEFAULT_STYLE, quiet: 0 }).level).toBe("bad");
    expect(scanGuard({ ...DEFAULT_STYLE, quiet: 1 })).toMatchObject({ level: "warn", issues: [{ code: "quiet_small" }] });
    expect(scanGuard({ ...DEFAULT_STYLE, frame: "box", frameColor: "#F5F5F5" }).issues.map((i) => i.code)).toContain("frame_contrast");
  });
  it("warns about round dots on a long text", () => {
    expect(scanGuard({ ...DEFAULT_STYLE, dots: "dots" }, { bytes: 800 }).issues).toEqual([{ code: "dense_dots" }]);
    expect(scanGuard({ ...DEFAULT_STYLE, dots: "dots" }, { bytes: 60 }).level).toBe("ok");
  });
  it("print forces black on white and a full quiet zone", () => {
    const style: QrStyle = { ...DEFAULT_STYLE, fg: "#AAAAAA", bg: "#EEEEEE", dots: "dots", eyes: "leaf", quiet: 1, print: true };
    const e = effectiveStyle(style);
    expect([e.fg, e.bg, e.dots, e.eyes, e.quiet]).toEqual(["#000000", "#FFFFFF", "square", "square", 4]);
    expect(scanGuard(style).level).toBe("ok");
  });
});

describe("normaliseStyle", () => {
  it("fills in defaults for anything unknown", () => {
    expect(normaliseStyle(null)).toEqual(DEFAULT_STYLE);
    expect(normaliseStyle("junk")).toEqual(DEFAULT_STYLE);
  });
  it("keeps valid values and drops invalid ones", () => {
    const s = normaliseStyle({ dots: "dots", eyes: "triangle", fg: "#0a7", bg: "nope", quiet: 99, label: "  Scan   me  ", logo: "photo", print: "yes", frame: "pill", eyeFg: "" });
    expect(s).toMatchObject({ dots: "dots", eyes: "square", fg: "#00AA77", bg: "#FFFFFF", quiet: 8, label: "Scan me", logo: "photo", print: false, frame: "pill", eyeFg: "" });
  });
  it("limits the label length", () => {
    expect(normaliseStyle({ label: "x".repeat(100) }).label).toHaveLength(32);
  });
});

describe("logo rules", () => {
  it("raises error correction only when a logo is really drawn", () => {
    expect(eccFor({ logo: "company" }, true)).toBe("H");
    expect(eccFor({ logo: "company" }, false)).toBe("M");
    expect(eccFor({ logo: "none" }, true)).toBe("M");
  });
  it("covers at most about 20% of the code, centred on an odd side", () => {
    for (const n of [21, 25, 29, 37, 45, 57, 77]) {
      const side = logoSide(n);
      expect(side % 2).toBe(1);
      expect(logoShare(n, side)).toBeLessThanOrEqual(0.2);
    }
  });
});

describe("presets", () => {
  it("offers only colour pairs that scan, without repeats", () => {
    const list = presetsFor({ bg: "#1F3A5F", fg: "#FFFFFF", acc: "#F5E6A0" }, { bg: "#1F3A5F", fg: "#fff", acc: "#D9A441" });
    const ids = list.map((p) => p.id);
    expect(ids).toContain("card");
    expect(ids).not.toContain("card-acc");
    expect(ids).not.toContain("company");
    expect(new Set(list.map((p) => p.fg.toLowerCase())).size).toBe(list.length);
    expect(presetsFor(null, null).map((p) => p.id)).toEqual(["bench", "classic"]);
  });
});

describe("qrPaths", () => {
  const n = modules.size;
  const inEye = (r: number, c: number) => eyeOrigins(n).some((o) => r >= o.row && r < o.row + 7 && c >= o.col && c < o.col + 7);
  let dataDark = 0;
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (modules.dark(r, c) && !inEye(r, c)) dataDark += 1;

  it("draws every dark data module once for each dot shape", () => {
    for (const dots of DOT_SHAPES) {
      const p = qrPaths(modules, { ...DEFAULT_STYLE, dots }, false);
      expect((p.dots.match(/M/g) ?? []).length).toBe(dataDark);
      expect(p.dots).not.toMatch(/NaN|undefined/);
    }
  });
  it("leaves room for a logo and no more than 20% is cleared", () => {
    const p = qrPaths(modules, DEFAULT_STYLE, true);
    expect(p.hole.side).toBe(logoSide(n));
    expect((p.dots.match(/M/g) ?? []).length).toBeLessThan(dataDark);
    expect(logoShare(n, p.hole.side)).toBeLessThanOrEqual(0.2);
  });
  it("draws three corner squares in every shape", () => {
    for (const eyes of EYE_SHAPES) {
      const p = qrPaths(modules, { ...DEFAULT_STYLE, eyes }, false);
      expect((p.eyes.match(/z/g) ?? []).length).toBe(9);
      expect(p.eyes).not.toMatch(/NaN/);
    }
  });
  it("rounds only the corners asked for", () => {
    expect(rrect(0, 0, 4, 4, 0, 0, 0, 0)).not.toContain("a");
    expect((rrect(0, 0, 4, 4, 1, 0, 1, 0).match(/a/g) ?? []).length).toBe(2);
  });
});

describe("qrSvg", () => {
  it("is a complete svg for every frame style", async () => {
    for (const frame of FRAME_STYLES) {
      const style = { ...DEFAULT_STYLE, frame, label: "Scan to save my contact", frameColor: frame === "none" ? "" : "#FF6B35", dots: "rounded" as const, eyes: "leaf" as const };
      const { svg, width, height } = qrSvg(modules, style, { width: 600 });
      expect(svg.startsWith("<svg")).toBe(true);
      expect(svg.endsWith("</svg>")).toBe(true);
      expect(svg).not.toMatch(/NaN|undefined|Infinity/);
      expect(width).toBe(600);
      expect(height).toBeGreaterThanOrEqual(600);
      if (frame !== "none") expect(svg).toContain("Scan to save my contact");
      const layout = frameLayout(modules.size, style);
      expect(layout.tile.x + layout.tile.side).toBeLessThanOrEqual(layout.width);
      expect(layout.tile.y + layout.tile.side).toBeLessThanOrEqual(layout.height);
      await dump(`frame-${frame}`, svg);
    }
  });
  it("escapes the label and omits it when empty", () => {
    const { svg } = qrSvg(modules, { ...DEFAULT_STYLE, frame: "bar", label: "A <b> & \"c\"" });
    expect(svg).toContain("A &lt;b&gt; &amp; &quot;c&quot;");
    expect(qrSvg(modules, { ...DEFAULT_STYLE, frame: "bar", label: "" }).svg).not.toContain("<text");
  });
  it("shows a logo only when there is one to show", () => {
    const style = { ...DEFAULT_STYLE, logo: "company" as const };
    expect(qrSvg(modules, style).svg).not.toContain("<image");
    expect(qrSvg(modules, style, { logoHref: "data:image/png;base64,AAAA" }).svg).toContain("<image");
    expect(qrSvg(modules, { ...DEFAULT_STYLE }, { logoHref: "data:image/png;base64,AAAA" }).svg).not.toContain("<image");
  });
  it("draws Arabic labels", () => {
    expect(qrSvg(modules, { ...DEFAULT_STYLE, frame: "pill", label: "امسح لحفظ جهة اتصالي" }).svg).toContain("امسح لحفظ جهة اتصالي");
  });
  it("forces plain black squares for print", async () => {
    const { svg } = qrSvg(modules, { ...DEFAULT_STYLE, fg: "#FF6B35", dots: "dots", eyes: "leaf", print: true });
    expect(svg).toContain('fill="#000000"');
    expect(svg).not.toContain("#FF6B35");
    await dump("print", svg);
  });
  it("can be written with a sample colourway", async () => {
    await dump("styled", qrSvg(modules, { ...DEFAULT_STYLE, dots: "classy", eyes: "rounded", fg: "#1F3A5F", frame: "badge", frameColor: "#D9A441", label: "Scan to save my contact" }).svg);
  });
});
