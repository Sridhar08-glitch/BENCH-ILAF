import { describe, expect, it } from "vitest";
import { PALETTES } from "@/lib/library/generated/meta";
import {
  HEIGHT, LAYOUTS, MIN_NAME_SIZE, MIN_QR, MIN_TITLE_SIZE, PERSON_ZONE, WIDTH, contentRects, contrast, coloursFor, drawBackground, fitSize, intersects, layoutFor,
  titleLine, type BackgroundLayout, type BackgroundSpec, type BackgroundTheme, type Ctx, type Palette,
} from "./background";

const palette: Palette = { bg: "#0F2D5C", bg2: "#2B456F", fg: "#F8F9FA", acc: "#D2A63B", on: "#0F2D5C" };
const spec = (layout: BackgroundLayout, over: Partial<BackgroundSpec> = {}): BackgroundSpec => ({
  layout, theme: "brand", soft: false, palette, name: "Sara Al Thani", title: "Head of Sales", company: "Gulf Studio", qrText: "https://bench.example.com/c/sara?s=qr", ...over,
});


function recorder() {
  const calls: { op: string; args: unknown[]; font?: string; fill?: unknown }[] = [];
  const s = { fillStyle: "" as unknown, font: "" };
  const ctx = {
    get fillStyle() { return s.fillStyle; },
    set fillStyle(v: unknown) { s.fillStyle = v; },
    get font() { return s.font; },
    set font(v: string) { s.font = v; },
    textAlign: "left", textBaseline: "middle",
    fillRect(...a: number[]) { calls.push({ op: "rect", args: a, fill: s.fillStyle }); },
    fillText(...a: unknown[]) { calls.push({ op: "text", args: a, font: s.font, fill: s.fillStyle }); },
    measureText(t: string) { const size = Number(/(\d+)px/.exec(s.font)?.[1] ?? 10); return { width: t.length * size * 0.55 }; },
    createLinearGradient() { return { addColorStop() {} }; },
    beginPath() {}, arc() {}, fill() {}, save() {}, restore() {},
    drawImage(...a: unknown[]) { calls.push({ op: "image", args: a }); },
  } as unknown as Ctx;
  return { ctx, calls };
}

describe("layouts keep the person in the middle clear", () => {
  for (const { key } of LAYOUTS) {
    it(`${key}: no text, logo or QR code touches the person zone, and all of it is on the picture`, () => {
      const L = layoutFor(key);
      for (const r of contentRects(L)) {
        expect(intersects(r, PERSON_ZONE), `${key} ${JSON.stringify(r)}`).toBe(false);
        expect(r.x).toBeGreaterThanOrEqual(0);
        expect(r.y).toBeGreaterThanOrEqual(0);
        expect(r.x + r.w).toBeLessThanOrEqual(WIDTH);
        expect(r.y + r.h).toBeLessThanOrEqual(HEIGHT);
      }
      if (L.bar) expect(intersects(L.bar, PERSON_ZONE)).toBe(false);
    });
    it(`${key}: text and QR are big enough to read when the picture is shown small`, () => {
      const L = layoutFor(key);
      expect(L.name.size).toBeGreaterThanOrEqual(MIN_NAME_SIZE);
      expect(L.title.size).toBeGreaterThanOrEqual(MIN_TITLE_SIZE);
      expect(L.qr.w).toBeGreaterThanOrEqual(MIN_QR);
      expect(L.qr.w).toBe(L.qr.h);
    });
    it(`${key}: content does not overlap itself`, () => {
      const L = layoutFor(key);
      const rects = contentRects(L);
      rects.forEach((a, i) => rects.slice(i + 1).forEach((b) => expect(intersects(a, b), `${key} ${i}`).toBe(false)));
    });
  }
  it("has the six layouts", () => {
    expect(LAYOUTS.map((l) => l.key)).toEqual(["qr-left", "qr-right", "centred", "corner", "banner", "minimal"]);
  });
});

describe("colours stay readable in every theme and palette", () => {
  const themes: BackgroundTheme[] = ["brand", "dark", "light"];
  it("text is at least 4.5:1 on both ends of the background", () => {
    for (const p of PALETTES.slice(0, 80)) {
      const pal: Palette = { bg: p.bg, bg2: p.bg2, fg: p.fg, acc: p.acc, on: p.on };
      for (const theme of themes) for (const soft of [false, true]) {
        const c = coloursFor(pal, theme, soft);
        expect(contrast(c.text, c.from), `${p.name} ${theme} ${soft}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.text, c.to), `${p.name} ${theme} ${soft}`).toBeGreaterThanOrEqual(4.5);
        expect(contrast(c.barText, c.bar), `${p.name} bar`).toBeGreaterThanOrEqual(4.5);
      }
    }
  });
  it("the QR code is always dark on white", () => {
    const c = coloursFor(palette, "dark", true);
    expect([c.qrInk, c.qrTile]).toEqual(["#101114", "#FFFFFF"]);
  });
  it("dark and light ignore the card background", () => {
    expect(coloursFor(palette, "dark", false).from).toBe("#101114");
    expect(coloursFor(palette, "light", false).from).toBe("#FFFFFF");
    expect(coloursFor(palette, "brand", false).from).toBe(palette.bg);
  });
});

describe("drawing", () => {
  it("paints the background, the name, the title line and the QR code", () => {
    const { ctx, calls } = recorder();
    drawBackground(ctx, spec("qr-left"), null);
    const texts = calls.filter((c) => c.op === "text");
    expect(texts.map((t) => t.args[0])).toEqual(["Sara Al Thani", "Head of Sales - Gulf Studio"]);
    const rects = calls.filter((c) => c.op === "rect");
    expect(rects[0].args).toEqual([0, 0, WIDTH, HEIGHT]);
    expect(rects.length).toBeGreaterThan(200); // the QR modules
    expect(calls.some((c) => c.op === "image")).toBe(false);
  });
  it("shrinks a long name to fit its box but never below the minimum", () => {
    const { ctx } = recorder();
    const L = layoutFor("qr-left");
    const size = fitSize(ctx, "A very long name that does not fit on one line", L.name, MIN_NAME_SIZE);
    expect(size).toBe(MIN_NAME_SIZE);
    expect(fitSize(ctx, "Sara", L.name, MIN_NAME_SIZE)).toBe(L.name.size);
    const mid = fitSize(ctx, "Sara Al Thani-Hamad", L.name, MIN_NAME_SIZE);
    expect(mid).toBeLessThan(L.name.size);
    expect(mid).toBeGreaterThanOrEqual(MIN_NAME_SIZE);
  });
  it("draws the logo inside its box, keeping its shape", () => {
    const { ctx, calls } = recorder();
    drawBackground(ctx, spec("banner"), { image: {} as CanvasImageSource, width: 400, height: 100 });
    const img = calls.find((c) => c.op === "image");
    expect(img).toBeTruthy();
    const [, x, y, w, h] = img!.args as number[];
    expect(w / h).toBeCloseTo(4, 3);
    const box = layoutFor("banner").logo!;
    expect(x).toBeGreaterThanOrEqual(box.x);
    expect(x + w).toBeLessThanOrEqual(box.x + box.w + 0.001);
    expect(y).toBeGreaterThanOrEqual(box.y);
    expect(y + h).toBeLessThanOrEqual(box.y + box.h + 0.001);
  });
  it("skips the logo for the minimal layout and when there is none", () => {
    const a = recorder();
    drawBackground(a.ctx, spec("minimal"), { image: {} as CanvasImageSource, width: 10, height: 10 });
    expect(a.calls.some((c) => c.op === "image")).toBe(false);
    const b = recorder();
    drawBackground(b.ctx, spec("centred"), null);
    expect(b.calls.some((c) => c.op === "image")).toBe(false);
  });
  it("leaves the title out when there is nothing to say, and handles Arabic text", () => {
    expect(titleLine("", "")).toBe("");
    expect(titleLine("Manager", "")).toBe("Manager");
    const { ctx, calls } = recorder();
    drawBackground(ctx, spec("corner", { name: "سارة الثاني", title: "", company: "" }), null);
    expect(calls.filter((c) => c.op === "text").map((t) => t.args[0])).toEqual(["سارة الثاني"]);
  });
  it("draws on the bar in the banner layout with the bar's text colour", () => {
    const { ctx, calls } = recorder();
    drawBackground(ctx, spec("banner"), null);
    const c = coloursFor(palette, "brand", false);
    expect(calls.find((x) => x.op === "text")?.fill).toBe(c.barText);
    expect(calls.filter((x) => x.op === "rect")[1].fill).toBe(c.bar);
  });
});
