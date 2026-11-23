"use client";

// Asks the server what the company's pictures look like (true logo shape and colours, how light a background is), so the
// editor draws exactly what visitors will see. Until the answer arrives the card is drawn with safe defaults.
import { useEffect, useState } from "react";
import type { BrandInfo, CompanyBrand } from "@/lib/library/types";

const done = new Map<string, BrandInfo>();
const asked = new Map<string, Promise<BrandInfo | null>>();

function ask(key: string, brand: CompanyBrand): Promise<BrandInfo | null> {
  let p = asked.get(key);
  if (!p) {
    p = fetch("/api/brand-info", { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(brand) })
      .then((r) => (r.ok ? (r.json() as Promise<BrandInfo>) : null))
      .catch(() => null)
      .finally(() => asked.delete(key));
    asked.set(key, p);
  }
  return p;
}

/** Only what changes the measurements: moving a slider or editing text never asks again. */
function keyOf(b: CompanyBrand): string {
  const a = b.artwork;
  return JSON.stringify([
    b.logoUrl, b.symbolUrl, b.colours?.primary, b.colours?.accent, b.logoDisplay, b.showName, b.companyName,
    a?.mode, a?.background.kind, a?.background.sample, b.backgroundUrl, a?.pattern.combine_with_background,
    a?.template.kind, a?.template.sample, b.templateFrontUrl, b.templateBackUrl,
  ]);
}

/** Does this brand have anything to measure? (A plain palette needs no measuring.) */
function needsInfo(b: CompanyBrand): boolean {
  const mode = b.artwork?.mode ?? "none";
  return !!(b.logoUrl || b.symbolUrl) || mode !== "none";
}

/** The brand with its measurements (from the server when it already sent them, else asked for here). */
export function useBrandInfo(brand: CompanyBrand | null | undefined): CompanyBrand | null {
  const key = brand ? keyOf(brand) : "";
  const [got, setGot] = useState<{ key: string; info: BrandInfo } | null>(null);
  const known = brand && !brand.info ? done.get(key) : undefined;

  useEffect(() => {
    if (!brand || brand.info || !needsInfo(brand) || done.has(key)) return;
    let live = true;
    const t = window.setTimeout(() => {
      void ask(key, brand).then((info) => {
        if (!info) return;
        done.set(key, info);
        if (live) setGot({ key, info });
      });
    }, 250);
    return () => {
      live = false;
      window.clearTimeout(t);
    };
    // the key covers every field that changes what is measured
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, !!brand?.info]);

  if (!brand) return null;
  if (brand.info) return brand;
  const info = known ?? (got && got.key === key ? got.info : undefined);
  return info ? { ...brand, info } : brand;
}
