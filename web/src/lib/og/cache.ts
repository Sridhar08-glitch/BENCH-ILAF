// A small in-memory cache for share-preview pictures, so a link pasted into a busy chat is drawn once, not once per
// crawler. Bounded in size and age; a new server process starts empty.
import { createHash } from "node:crypto";

export class OgCache {
  private items = new Map<string, { at: number; png: Buffer }>();
  private pending = new Map<string, Promise<Buffer>>();

  constructor(private max = 150, private ttlMs = 60 * 60 * 1000, private now: () => number = Date.now) {}

  get(key: string): Buffer | undefined {
    const hit = this.items.get(key);
    if (!hit) return undefined;
    if (this.now() - hit.at > this.ttlMs) {
      this.items.delete(key);
      return undefined;
    }
    // Most recently used goes last, so the oldest unused picture is the one dropped.
    this.items.delete(key);
    this.items.set(key, hit);
    return hit.png;
  }

  set(key: string, png: Buffer): void {
    this.items.delete(key);
    this.items.set(key, { at: this.now(), png });
    while (this.items.size > this.max) {
      const oldest = this.items.keys().next().value;
      if (oldest === undefined) break;
      this.items.delete(oldest);
    }
  }

  /** The cached picture, or the result of `make` (one drawing at a time per key). */
  async getOrMake(key: string, make: () => Promise<Buffer>): Promise<Buffer> {
    const hit = this.get(key);
    if (hit) return hit;
    const running = this.pending.get(key);
    if (running) return running;
    const job = make()
      .then((png) => {
        this.set(key, png);
        return png;
      })
      .finally(() => this.pending.delete(key));
    this.pending.set(key, job);
    return job;
  }
}

/** A key that changes whenever anything the picture shows changes. */
export function cacheKey(parts: Record<string, string>): string {
  return createHash("sha1").update(JSON.stringify(parts)).digest("hex");
}

export const ogCache = new OgCache();
