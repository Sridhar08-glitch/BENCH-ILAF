// Measures a company's pictures on the server: the true shape and colours of the logo and symbol, how light a
// background or template is, and the logo as a small tile for the pattern. The public card page uses it to draw
// the right placement and text colour in the first bytes; the editor asks for the same numbers through
// /api/brand-info, so both always agree. Everything is cached by address (uploaded pictures never change
// under the same address). When the image tool is not available every measurement is simply missing and the
// card falls back to safe defaults.
import { API_PUBLIC_URL, API_SERVER_URL } from "@/lib/config";
import { measureList, type MeasureSource } from "@/lib/library/company/brand";
import { patternMarkUrl } from "@/lib/library/company/compose";
import { sampleBgSvg, templateSvg } from "@/lib/library/company/artwork";
import { r2h } from "@/lib/library/company/colour";
import type { ArtStats, BrandInfo, CompanyBrand, MarkInfo, PatternMark } from "@/lib/library/types";

type Sharp = typeof import("sharp").default;
let sharpLib: Promise<Sharp | null> | null = null;

function loadSharp(): Promise<Sharp | null> {
  return (sharpLib ??= import("sharp").then((m) => m.default).catch(() => null));
}

const MAX_BYTES = 6 * 1024 * 1024;

/** Pictures may only come from the API's own address (its media folder), never from an address a visitor chose. */
function allowed(u: string): boolean {
  try {
    const t = new URL(u);
    if (t.protocol !== "http:" && t.protocol !== "https:") return false;
    return [API_SERVER_URL, API_PUBLIC_URL].some((a) => {
      try {
        return new URL(a).origin === t.origin;
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

async function fetchBytes(u: string): Promise<Buffer | null> {
  if (!allowed(u)) return null;
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(6000), next: { revalidate: 3600 } });
    if (!res.ok) return null;
    const len = Number(res.headers.get("content-length") || 0);
    if (len > MAX_BYTES) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length > MAX_BYTES ? null : buf;
  } catch {
    return null;
  }
}

const cache = new Map<string, Promise<unknown>>();
function cached<T>(key: string, make: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit) return hit as Promise<T>;
  const p = make().catch(() => null as T);
  cache.set(key, p);
  if (cache.size > 400) cache.delete(cache.keys().next().value as string);
  return p;
}

const hex = (r: number, g: number, b: number) => r2h([r, g, b]).toLowerCase();

/** Shape and colours of a mark. Colours that cover 4% or more of the visible pixels are kept, up to eight. */
async function markStats(buf: Buffer, url: string): Promise<MarkInfo | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const meta = await sharp(buf).metadata();
  if (!meta.width || !meta.height) return null;
  const { data, info } = await sharp(buf).resize({ width: 128, height: 128, fit: "inside" }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  const bins = new Map<number, number>();
  for (let i = 0; i < info.width * info.height; i++) {
    const o = i * 4;
    if (data[o + 3] > 40) {
      r += data[o];
      g += data[o + 1];
      b += data[o + 2];
      n++;
      const k = ((data[o] >> 4) << 8) | ((data[o + 1] >> 4) << 4) | (data[o + 2] >> 4);
      bins.set(k, (bins.get(k) || 0) + 1);
    }
  }
  const pal = [...bins.entries()]
    .map(([k, c]) => [hex(((k >> 8) & 15) * 17, ((k >> 4) & 15) * 17, (k & 15) * 17), c / Math.max(1, n)] as [string, number])
    .filter((c) => c[1] >= 0.04)
    .sort((a, c) => c[1] - a[1])
    .slice(0, 8);
  return { url, asp: Math.max(0.15, Math.min(8, meta.width / meta.height)), col: n ? hex(r / n, g / n, b / n) : "#222222", pal };
}

const lum = (r: number, g: number, b: number) => {
  const f = (v: number) => {
    const x = v / 255;
    return x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
};

/** Lightest and darkest spots, average colour and a 14 x 8 grid of a picture (a plain white page under any transparency). */
async function artStats(input: Buffer): Promise<ArtStats | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const W = 112;
  const H = 64;
  const { data } = await sharp(input).flatten({ background: "#ffffff" }).resize(W, H, { fit: "fill" }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const arr: [number, number, number, number][] = [];
  let R = 0;
  let G = 0;
  let B = 0;
  for (let i = 0; i < W * H; i++) {
    const r = data[i * 3];
    const g = data[i * 3 + 1];
    const b = data[i * 3 + 2];
    arr.push([lum(r, g, b), r, g, b]);
    R += r;
    G += g;
    B += b;
  }
  const srt = arr.slice().sort((a, b) => a[0] - b[0]);
  const lo = srt[Math.floor(arr.length * 0.06)];
  const hi = srt[Math.floor(arr.length * 0.94)];
  const grid: string[][] = [];
  for (let y = 0; y < 8; y++) {
    const row: string[] = [];
    for (let x = 0; x < 14; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let c = 0;
      for (let yy = y * 8; yy < y * 8 + 8; yy++) {
        for (let xx = x * 8; xx < x * 8 + 8; xx++) {
          const o = (yy * W + xx) * 3;
          r += data[o];
          g += data[o + 1];
          b += data[o + 2];
          c++;
        }
      }
      row.push(hex(r / c, g / c, b / c));
    }
    grid.push(row);
  }
  return { p8: hex(lo[1], lo[2], lo[3]), p92: hex(hi[1], hi[2], hi[3]), avg: hex(R / (W * H), G / (W * H), B / (W * H)), grid };
}

/** The logo as a small picture for the pattern tile, and whether it is a solid blob (a one-colour filter would hide its shape). */
async function patternTile(buf: Buffer): Promise<PatternMark | null> {
  const sharp = await loadSharp();
  if (!sharp) return null;
  const small = sharp(buf).resize({ width: 240, height: 240, fit: "inside" }).ensureAlpha();
  const { data } = await small.clone().raw().toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 3; i < data.length; i += 4) if (data[i] > 128) n++;
  const png = await small.png({ palette: true, quality: 80 }).toBuffer();
  return { u: "data:image/png;base64," + png.toString("base64"), blob: n / (data.length / 4) > 0.62 };
}

async function measureOne(s: MeasureSource): Promise<MarkInfo | ArtStats | PatternMark | null> {
  if ("u" in s) {
    const key = `${s.role}|${s.u}`;
    return cached(key, async () => {
      const buf = await fetchBytes(s.u);
      if (!buf) return null;
      if (s.role === "logo" || s.role === "symbol") return markStats(buf, s.u);
      if (s.role === "pat") return patternTile(buf);
      return artStats(buf);
    });
  }
  if ("sample" in s) {
    return cached(`bg|${s.sample}|${s.p}|${s.a}`, async () => artStats(Buffer.from(sampleBgSvg(s.sample, s.p, s.a))));
  }
  return cached(`${s.role}|${s.tpl}`, async () => artStats(Buffer.from(templateSvg(s.tpl, s.role === "back" ? "back" : "front"))));
}

/** Everything measured about a company's pictures. Missing parts stay undefined (the card uses safe defaults for them). */
export async function measureBrand(brand: CompanyBrand): Promise<BrandInfo> {
  const first = measureList(brand, null);
  const got = await Promise.all(first.map((s) => measureOne(s)));
  const info: BrandInfo = {};
  first.forEach((s, i) => {
    const v = got[i];
    if (!v) return;
    if (s.role === "logo") info.logo = v as MarkInfo;
    else if (s.role === "symbol") info.symbol = v as MarkInfo;
    else if (s.role === "bg") info.bg = v as ArtStats;
    else if (s.role === "front") info.front = v as ArtStats;
    else if (s.role === "back") info.back = v as ArtStats;
  });
  if (brand.artwork?.mode === "pattern") {
    const u = patternMarkUrl({ ...brand, info });
    if (u) {
      const v = (await measureOne({ role: "pat", u })) as PatternMark | null;
      if (v) info.pat = v;
    }
  }
  return info;
}

/** The brand with its measurements attached. */
export async function withBrandInfo(brand: CompanyBrand | null): Promise<CompanyBrand | null> {
  if (!brand) return null;
  return { ...brand, info: await measureBrand(brand) };
}

