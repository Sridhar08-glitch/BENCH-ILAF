// The visitor's address for calls the web server makes to the API on the visitor's behalf.
// Without it the API sees only this server (127.0.0.1), and every per-visitor limit becomes one shared counter.
import { createHmac } from "node:crypto";
import { isIP } from "node:net";

/** The only two header names the API reads for this. A visitor's own copies of them are never forwarded. */
export const CLIENT_IP_HEADER = "X-BENCH-Client-IP";
export const CLIENT_IP_SIGNATURE_HEADER = "X-BENCH-Client-IP-Signature";

type HeaderReader = { get(name: string): string | null };

/** One clean address from header text: handles "ip:port" and "[v6]:port", rejects anything that is not an IP address. */
export function cleanIp(value: string | null | undefined): string | null {
  let v = (value ?? "").trim();
  if (!v || v.length > 64) return null;
  if (v.startsWith("[") && v.includes("]")) v = v.slice(1, v.indexOf("]"));
  else if (v.split(":").length === 2) v = v.split(":")[0];
  const kind = isIP(v);
  if (!kind) return null;
  if (kind === 4) return v;
  // The API signs the address in its short form (RFC 5952, IPv4-mapped addresses as plain IPv4), so send exactly that form.
  try {
    const host = new URL(`http://[${v}]/`).hostname.slice(1, -1);
    const mapped = /^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/.exec(host);
    if (mapped) {
      const hi = parseInt(mapped[1], 16);
      const lo = parseInt(mapped[2], 16);
      return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
    }
    return host;
  } catch {
    return null;
  }
}

/**
 * The visitor address from the headers the reverse proxy sets. nginx overwrites X-Forwarded-For with the address it
 * really saw, so the last entry is the visitor and entries to its left (written by the visitor) are never used.
 * X-Real-IP is the fallback.
 */
export function visitorIp(h: HeaderReader): string | null {
  const parts = (h.get("x-forwarded-for") ?? "").split(",");
  for (let i = parts.length - 1; i >= 0; i -= 1) {
    const ip = cleanIp(parts[i]);
    if (ip) return ip;
    // A garbled last entry is skipped; an empty list falls through to X-Real-IP.
  }
  return cleanIp(h.get("x-real-ip"));
}

/** The headers to add to an API call for this visitor. Empty when no address is known (the API then falls back to its peer). */
export function visitorHeaders(h: HeaderReader, secret: string | undefined = process.env.CLIENT_IP_HEADER_SECRET): Record<string, string> {
  const ip = visitorIp(h);
  if (!ip) return {};
  const out: Record<string, string> = { [CLIENT_IP_HEADER]: ip };
  if (secret) out[CLIENT_IP_SIGNATURE_HEADER] = createHmac("sha256", secret).update(ip).digest("hex");
  return out;
}
