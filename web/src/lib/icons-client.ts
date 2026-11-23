"use client";

// Browser side of the logo service: the search list (loaded only when needed), logo paths on demand,
// brand detection from a website and the editor's resolved logos.
import { useEffect, useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import type { ResolvedIcon } from "./card/brand";
import type { ItemIcon } from "./types";

export type BrandRow = [slug: string, title: string, hex: string];
export interface BrandGlyphData {
  path: string;
  hex: string;
  title: string;
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  if (!r.ok) throw new Error(`Request failed: ${r.status}`);
  return (await r.json()) as T;
}

/** The ~3,000-brand search list. Only fetched when `enabled` is true (when the picker or search opens). */
export function useBrandIndex(enabled: boolean) {
  return useQuery({ queryKey: ["brand-index"], queryFn: () => getJson<BrandRow[]>("/api/icons/index"), enabled, staleTime: Infinity });
}

/** Logo paths for a set of brand slugs. */
export function useBrandGlyphs(slugs: string[]) {
  const key = [...new Set(slugs)].sort().slice(0, 60);
  return useQuery({
    queryKey: ["brand-glyphs", key.join(",")],
    queryFn: async () => (await getJson<{ icons: Record<string, BrandGlyphData> }>(`/api/icons/batch?slugs=${encodeURIComponent(key.join(","))}`)).icons,
    enabled: key.length > 0,
    staleTime: Infinity,
    placeholderData: keepPreviousData,
  });
}

/** Which brand a website host belongs to. */
export async function detectBrand(host: string): Promise<(BrandGlyphData & { slug: string }) | null> {
  const r = await getJson<{ brand: (BrandGlyphData & { slug: string }) | null }>(`/api/icons/detect?host=${encodeURIComponent(host)}`);
  return r.brand;
}

/** Wait a moment after the value stops changing. */
export function useDebounced<T>(value: T, ms = 350): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** The logo for each button, as the public page will draw it. Same order as the input. */
export function useResolvedIcons(items: { kind: string; value: string; icon?: ItemIcon | null }[]): ResolvedIcon[] {
  const payload = items.map((i) => ({ kind: i.kind, value: i.value, icon: i.icon ?? null }));
  const debounced = useDebounced(JSON.stringify(payload), 300);
  const q = useQuery({
    queryKey: ["resolved-icons", debounced],
    queryFn: async () => {
      const r = await getJson<{ icons: ResolvedIcon[] }>("/api/icons/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: debounced,
      });
      return r.icons;
    },
    staleTime: 60_000,
    placeholderData: keepPreviousData,
  });
  const out = q.data ?? [];
  // While a new answer is on its way, keep the old logos for items that are still at the same place.
  return items.map((_, i) => out[i] ?? { t: "kind" as const });
}
