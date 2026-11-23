// Brand logo data (about 3,000 brands) from the Simple Icons package.
// This stays on the server: browsers get a small search list on demand and one logo path at a time,
// and the public card page inlines the logo it needs, so visitors never call a third party.
import * as si from "simple-icons";
import { brandFromHost, buildLookup, resolveIcon, type BrandEntry, type IconLookup, type ResolvedIcon } from "@/lib/card/brand";
import type { ItemIcon } from "@/lib/types";

interface RawIcon {
  slug: string;
  title: string;
  hex: string;
  path: string;
}

let cache: { list: RawIcon[]; bySlug: Map<string, RawIcon>; lookup: ReturnType<typeof buildLookup> } | null = null;

function load() {
  if (cache) return cache;
  const list = (Object.values(si) as unknown[])
    .filter((v): v is RawIcon => typeof v === "object" && v !== null && "slug" in v && "path" in v)
    .sort((a, b) => a.title.localeCompare(b.title));
  const entries: BrandEntry[] = list.map((v) => ({ slug: v.slug, title: v.title, hex: v.hex }));
  cache = { list, bySlug: new Map(list.map((v) => [v.slug, v])), lookup: buildLookup(entries) };
  return cache;
}

/** Compact search list: [slug, title, hex]. */
export function brandIndex(): [string, string, string][] {
  return load().list.map((v) => [v.slug, v.title, v.hex]);
}

export function brandIcon(slug: string): { slug: string; title: string; hex: string; path: string } | null {
  const v = load().bySlug.get(slug.toLowerCase());
  return v ? { slug: v.slug, title: v.title, hex: v.hex, path: v.path } : null;
}

export function detectBrand(host: string): { slug: string; title: string; hex: string; path: string } | null {
  const e = brandFromHost(host, load().lookup);
  return e ? brandIcon(e.slug) : null;
}

const serverLookup: IconLookup = {
  brand: (slug) => {
    const b = brandIcon(slug);
    return b ? { path: b.path, hex: b.hex, title: b.title } : null;
  },
  detect: (host) => {
    const e = brandFromHost(host, load().lookup);
    return e ?? null;
  },
};

/** Logo for each item, in the same order as the input. */
export function resolveItemIcons(items: { kind: string; value: string; icon?: ItemIcon | null }[]): ResolvedIcon[] {
  return items.map((it) => resolveIcon(it, serverLookup));
}
