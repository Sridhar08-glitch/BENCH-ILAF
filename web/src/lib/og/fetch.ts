// Picture downloads for the share-preview image: only http(s), a short wait, a size cap, and never an error (a missing picture is just left out).

const MAX_BYTES = 6 * 1024 * 1024;

export async function fetchImage(url: string | null | undefined, timeoutMs = 3000): Promise<Buffer | null> {
  if (!url || !/^https?:\/\//i.test(url)) return null;
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(timeoutMs), next: { revalidate: 300 } });
    if (!res.ok) return null;
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) return null;
    const bytes = Buffer.from(await res.arrayBuffer());
    return bytes.length > MAX_BYTES ? null : bytes;
  } catch {
    return null;
  }
}
