// NFC tags for a card: the address to write, whether it fits a tag, and the state machine of writing with Web NFC (Chrome on Android).
// Pure: the page passes in what the browser can do and reports what happened.

/** The card address with the tracking mark the app already understands (`s=nfc`), so taps are counted as NFC. */
export function nfcUrl(publicUrl: string): string {
  try {
    const u = new URL(publicUrl);
    u.searchParams.set("s", "nfc");
    return u.toString();
  } catch {
    return `${publicUrl}${publicUrl.includes("?") ? "&" : "?"}s=nfc`;
  }
}

export interface TagType {
  id: "ntag213" | "ntag215" | "ntag216";
  name: string;
  /** Bytes a tag can hold for our data (user memory). */
  bytes: number;
}

export const TAG_TYPES: TagType[] = [
  { id: "ntag213", name: "NTAG213", bytes: 144 },
  { id: "ntag215", name: "NTAG215", bytes: 504 },
  { id: "ntag216", name: "NTAG216", bytes: 888 },
];

// NFC Forum URI abbreviations: the start of the address is stored as one byte.
const PREFIXES = ["http://www.", "https://www.", "http://", "https://"];

/** Bytes a single URL record takes on a tag, including the wrapper the tag needs around it. */
export function ndefUrlBytes(url: string): number {
  let rest = url;
  for (const prefix of PREFIXES) {
    if (url.toLowerCase().startsWith(prefix)) {
      rest = url.slice(prefix.length);
      break;
    }
  }
  const payload = 1 + new TextEncoder().encode(rest).length;
  // Record header: flags, type length, payload length (1 byte when short, 4 when long) and the type "U".
  const record = (payload < 256 ? 3 : 6) + 1 + payload;
  // The tag stores it inside a TLV: type, length (1 byte, 3 when long), the record, then a terminator byte.
  return (record < 255 ? 2 : 4) + record + 1;
}

/** The smallest tag that holds the address, or null when none does. */
export function smallestTag(url: string): TagType | null {
  const need = ndefUrlBytes(url);
  return TAG_TYPES.find((t) => t.bytes >= need) ?? null;
}

export function fits(url: string, tag: TagType): boolean {
  return ndefUrlBytes(url) <= tag.bytes;
}

// ---- Web NFC

/** What the browser can do. `hasReader` is true when `NDEFReader` exists; NFC also needs a secure page. */
export interface NfcSupport {
  hasReader: boolean;
  secure: boolean;
  /** True on a phone or tablet (a laptop with Chrome has no NDEFReader, but the page explains why). */
  mobile: boolean;
}

export type UnsupportedReason = "no_api" | "insecure";

export function unsupportedReason(s: NfcSupport): UnsupportedReason | null {
  if (!s.secure) return "insecure";
  if (!s.hasReader) return "no_api";
  return null;
}

export type NfcErrorCode = "denied" | "unreadable" | "aborted" | "too_big" | "insecure" | "unsupported" | "failed";

/** Turns what the browser threw into one of our codes. */
export function nfcErrorCode(e: unknown): NfcErrorCode {
  const name = typeof e === "object" && e && "name" in e ? String((e as { name: unknown }).name) : "";
  switch (name) {
    case "NotAllowedError": return "denied";
    case "NotReadableError": return "unreadable";
    case "AbortError": return "aborted";
    case "SecurityError": return "insecure";
    case "NotSupportedError": return "unsupported";
    case "NetworkError": return "unreadable";
    case "InvalidStateError": return "failed";
    case "RangeError": return "too_big";
    default: return "failed";
  }
}

export type NfcState =
  | { kind: "checking" }
  | { kind: "unsupported"; reason: UnsupportedReason }
  | { kind: "idle" }
  /** Waiting for a tag to be held against the phone. */
  | { kind: "writing" }
  | { kind: "written" }
  | { kind: "verifying" }
  | { kind: "verified" }
  | { kind: "mismatch"; found: string }
  | { kind: "error"; code: NfcErrorCode; during: "write" | "verify" };

export type NfcEvent =
  | { type: "support"; support: NfcSupport }
  | { type: "write" }
  | { type: "written" }
  | { type: "verify" }
  | { type: "verified"; matches: boolean; found: string }
  | { type: "fail"; code: NfcErrorCode }
  | { type: "reset" };

export function nfcReduce(state: NfcState, event: NfcEvent): NfcState {
  switch (event.type) {
    case "support": {
      const why = unsupportedReason(event.support);
      return why ? { kind: "unsupported", reason: why } : { kind: "idle" };
    }
    case "write":
      return state.kind === "unsupported" || state.kind === "checking" || state.kind === "writing" || state.kind === "verifying" ? state : { kind: "writing" };
    case "written":
      return state.kind === "writing" ? { kind: "written" } : state;
    case "verify":
      return state.kind === "written" || state.kind === "verified" || state.kind === "mismatch" || (state.kind === "error" && state.during === "verify") ? { kind: "verifying" } : state;
    case "verified":
      return state.kind === "verifying" ? (event.matches ? { kind: "verified" } : { kind: "mismatch", found: event.found }) : state;
    case "fail":
      if (state.kind === "writing") return { kind: "error", code: event.code, during: "write" };
      if (state.kind === "verifying") return { kind: "error", code: event.code, during: "verify" };
      return state;
    case "reset":
      return state.kind === "unsupported" || state.kind === "checking" ? state : { kind: "idle" };
  }
}

/** Do two addresses mean the same page? Compared without a trailing slash and ignoring letter case of the host. */
export function sameUrl(a: string, b: string): boolean {
  const norm = (s: string) => {
    try {
      const u = new URL(s);
      return `${u.protocol}//${u.host.toLowerCase()}${u.pathname.replace(/\/+$/, "")}${u.search}`;
    } catch {
      return s.trim();
    }
  };
  return norm(a) === norm(b);
}
