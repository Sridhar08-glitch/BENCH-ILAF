import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { describe, expect, it } from "vitest";
import { BRAND_COLOURS, OG_HEIGHT, OG_WIDTH, readableOn, renderCardOg, renderGenericOg, textLine } from "./compose";
import { cacheKey, OgCache } from "./cache";
import { shortHash } from "./hash";
import { initials, isRtlText, splitRuns, visualOrder } from "./runs";

const colours = { bg: "#1F3A5F", bg2: "#2B4C7E", fg: "#FFFFFF", acc: "#D9A441", on: "#101114" };

async function photo(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 500, channels: 3, background: "#cc6644" } }).jpeg().toBuffer();
}
async function logo(): Promise<Buffer> {
  return Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="300" height="100"><rect width="300" height="100" rx="20" fill="#0A7"/><circle cx="50" cy="50" r="30" fill="#fff"/></svg>');
}

/** Set OG_DUMP=<folder> to write the pictures there and look at them. */
function dump(name: string, png: Buffer) {
  const dir = process.env.OG_DUMP;
  if (!dir) return;
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${name}.png`), png);
}

describe("splitRuns", () => {
  it("keeps one run for one script", () => {
    expect(splitRuns("Sara Ahmed")).toEqual([{ text: "Sara Ahmed", arabic: false }]);
    expect(splitRuns("محمد العلي")).toEqual([{ text: "محمد العلي", arabic: true }]);
  });
  it("splits mixed text and drops the space between runs", () => {
    expect(splitRuns("محمد Ahmed العلي")).toEqual([
      { text: "محمد", arabic: true }, { text: "Ahmed", arabic: false }, { text: "العلي", arabic: true },
    ]);
  });
  it("keeps punctuation with the run before it and ignores empty text", () => {
    expect(splitRuns("Acme, Inc.")).toEqual([{ text: "Acme, Inc.", arabic: false }]);
    expect(splitRuns("   ")).toEqual([]);
  });
  it("orders runs for the screen", () => {
    const runs = splitRuns("محمد Ahmed");
    expect(visualOrder(runs, true).map((r) => r.text)).toEqual(["Ahmed", "محمد"]);
    expect(visualOrder(runs, false).map((r) => r.text)).toEqual(["محمد", "Ahmed"]);
  });
  it("detects the reading direction and initials", () => {
    expect(isRtlText("محمد Ali")).toBe(true);
    expect(isRtlText("Ali محمد")).toBe(false);
    expect(isRtlText("")).toBe(false);
    expect(initials("sara ali khan")).toBe("SK");
    expect(initials("  ")).toBe("");
  });
});

describe("share preview image", () => {
  it("is 1200 x 630 for a Latin card with a photo and a logo", async () => {
    const png = await renderCardOg({ name: "Sara Ahmed", title: "Head of Design", company: "Acme Studio", photo: await photo(), logo: await logo(), colours, appName: "BENCH", footer: "Digital business card" });
    const meta = await sharp(png).metadata();
    expect([meta.width, meta.height, meta.format]).toEqual([OG_WIDTH, OG_HEIGHT, "png"]);
    dump("latin", png);
  }, 30000);

  it("draws Arabic names right to left and differently from the Latin one", async () => {
    const base = { title: "مدير التصميم", company: "استوديو أكمي", colours, appName: "BENCH", footer: "بطاقة عمل رقمية" };
    const ar = await renderCardOg({ ...base, name: "محمد العلي", photo: null });
    const lt = await renderCardOg({ ...base, name: "Mohammed Al Ali", photo: null, rtl: false });
    const meta = await sharp(ar).metadata();
    expect([meta.width, meta.height]).toEqual([OG_WIDTH, OG_HEIGHT]);
    expect(ar.equals(lt)).toBe(false);
    dump("arabic", ar);
    dump("mixed", await renderCardOg({ ...base, name: "عبدالله Smith", photo: await photo(), logo: await logo() }));
  }, 30000);

  it("shrinks long names to fit the column", async () => {
    const line = await textLine("A very long name that would never fit in the space of one line of the picture at all", { size: 68, weight: "bold", colour: "#fff", maxWidth: 640, rtl: false, minSize: 40 });
    expect(line && line.width).toBeLessThanOrEqual(640);
  }, 30000);

  it("survives an unreadable photo and empty fields", async () => {
    const png = await renderCardOg({ name: "Sara", title: "", company: "", photo: Buffer.from("not an image"), logo: Buffer.from("nope"), colours, appName: "BENCH", footer: "" });
    expect((await sharp(png).metadata()).width).toBe(OG_WIDTH);
  }, 30000);

  it("draws a generic picture with no personal data", async () => {
    const png = await renderGenericOg({ appName: "BENCH", line: "Digital business card" });
    expect((await sharp(png).metadata()).height).toBe(OG_HEIGHT);
    dump("generic", png);
    const ar = await renderGenericOg({ appName: "BENCH", line: "بطاقة عمل رقمية", rtl: true });
    expect(ar.equals(png)).toBe(false);
  }, 30000);

  it("keeps text readable on any background", () => {
    expect(readableOn("#FFFFFF", "#FFFFFF")).toBe("#0A0A0A");
    expect(readableOn("#101114", "#FFFFFF")).toBe("#FFFFFF");
    expect(readableOn(BRAND_COLOURS.bg, "#222222")).toBe("#FFFFFF");
  });
});

describe("shortHash", () => {
  it("is stable and changes with the text", () => {
    expect(shortHash("a|b")).toBe(shortHash("a|b"));
    expect(shortHash("a|b")).not.toBe(shortHash("a|c"));
  });
});

describe("OgCache", () => {
  it("remembers a picture for its lifetime and forgets the oldest past its size", () => {
    let now = 1000;
    const cache = new OgCache(2, 100, () => now);
    cache.set("a", Buffer.from("1"));
    cache.set("b", Buffer.from("2"));
    expect(cache.get("a")?.toString()).toBe("1");
    cache.set("c", Buffer.from("3"));
    expect(cache.get("b")).toBeUndefined();
    now += 101;
    expect(cache.get("a")).toBeUndefined();
  });
  it("makes a key from what the picture shows", () => {
    const a = cacheKey({ code: "x", name: "A", title: "", company: "", photo: "p", logo: "", design: "1" });
    expect(a).toBe(cacheKey({ code: "x", name: "A", title: "", company: "", photo: "p", logo: "", design: "1" }));
    expect(a).not.toBe(cacheKey({ code: "x", name: "B", title: "", company: "", photo: "p", logo: "", design: "1" }));
  });
});
