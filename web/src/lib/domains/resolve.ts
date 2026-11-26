// Asking the API which company a host belongs to, with a small in-memory cache so a busy domain costs one call every few seconds.
import type { Resolution } from "./route";

type Fetcher = (url: string, init: { signal: AbortSignal; headers: Record<string, string> }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

interface Entry {
  value: Resolution;
  expires: number;
}

/** How long an answer is kept: short, so a domain that was just verified, removed or whose plan lapsed changes within a minute. */
export const TTL_ACTIVE_MS = 20_000;
export const TTL_OTHER_MS = 10_000;
/** Most hosts kept: a flood of made-up host names cannot grow the memory without limit. */
export const MAX_ENTRIES = 500;

export function createResolver(opts: { apiUrl: string; fetcher?: Fetcher; now?: () => number; timeoutMs?: number }) {
  const cache = new Map<string, Entry>();
  const now = opts.now ?? (() => Date.now());
  const doFetch: Fetcher = opts.fetcher ?? ((url, init) => fetch(url, { ...init, cache: "no-store" }));

  return async function resolveHost(host: string): Promise<Resolution | null> {
    const hit = cache.get(host);
    if (hit && hit.expires > now()) return hit.value;
    try {
      const res = await doFetch(`${opts.apiUrl.replace(/\/+$/, "")}/domains/resolve?host=${encodeURIComponent(host)}`, {
        signal: AbortSignal.timeout(opts.timeoutMs ?? 2500),
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return null; // the API had a problem (or throttled us): never keep that as "unknown"
      const body = (await res.json()) as Partial<Resolution>;
      const value: Resolution = {
        verified: body.verified === true,
        state: body.state === "active" || body.state === "inactive" ? body.state : "unknown",
        workspace: typeof body.workspace === "string" ? body.workspace : undefined,
        kind: body.kind === "directory" || body.kind === "card" || body.kind === "none" ? body.kind : undefined,
        directory_enabled: body.directory_enabled === true,
        directory_slug: typeof body.directory_slug === "string" ? body.directory_slug : null,
        company_card: typeof body.company_card === "string" ? body.company_card : null,
      };
      if (cache.size >= MAX_ENTRIES) cache.delete(cache.keys().next().value as string);
      cache.set(host, { value, expires: now() + (value.state === "active" ? TTL_ACTIVE_MS : TTL_OTHER_MS) });
      return value;
    } catch {
      return null;
    }
  };
}
