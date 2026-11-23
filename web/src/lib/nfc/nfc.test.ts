import { describe, expect, it } from "vitest";
import { TAG_TYPES, fits, ndefUrlBytes, nfcErrorCode, nfcReduce, nfcUrl, sameUrl, smallestTag, unsupportedReason, type NfcState } from "./nfc";

describe("nfcUrl", () => {
  it("adds the NFC mark the app counts", () => {
    expect(nfcUrl("https://ilaf.one/ahmed-d")).toBe("https://ilaf.one/ahmed-d?s=nfc");
  });
  it("keeps other parts of the address and never doubles the mark", () => {
    expect(nfcUrl("https://ilaf.one/c/abc?lang=ar")).toBe("https://ilaf.one/c/abc?lang=ar&s=nfc");
    expect(nfcUrl("https://ilaf.one/c/abc?s=qr")).toBe("https://ilaf.one/c/abc?s=nfc");
  });
  it("copes with text that is not a full address", () => {
    expect(nfcUrl("ilaf.one/x")).toBe("ilaf.one/x?s=nfc");
  });
});

describe("tag sizes", () => {
  it("counts the bytes of a URL record, using the short prefix", () => {
    // "https://" is one byte on the tag: 3 (header) + 1 (type) + 1 (prefix) + rest, plus the 2-byte wrapper and the end byte.
    const url = "https://ilaf.one/ahmed-d?s=nfc";
    const rest = "ilaf.one/ahmed-d?s=nfc".length;
    expect(ndefUrlBytes(url)).toBe(2 + (3 + 1 + 1 + rest) + 1);
    expect(ndefUrlBytes("https://www.ilaf.one/a")).toBe(ndefUrlBytes("https://ilaf.one/a") - 0);
  });
  it("fits a normal card address on the smallest tag", () => {
    expect(smallestTag("https://ilaf.one/ahmed-d?s=nfc")?.id).toBe("ntag213");
    expect(TAG_TYPES.map((t) => t.bytes)).toEqual([144, 504, 888]);
  });
  it("needs a bigger tag for a very long address and none past the biggest", () => {
    const long = `https://ilaf.one/${"a".repeat(300)}`;
    expect(smallestTag(long)?.id).toBe("ntag215");
    expect(fits(long, TAG_TYPES[0])).toBe(false);
    expect(smallestTag(`https://ilaf.one/${"a".repeat(2000)}`)).toBeNull();
  });
  it("counts Arabic letters by their bytes", () => {
    expect(ndefUrlBytes("https://ilaf.one/محمد")).toBeGreaterThan(ndefUrlBytes("https://ilaf.one/abcd"));
  });
});

describe("support", () => {
  it("needs a secure page and the reader", () => {
    expect(unsupportedReason({ hasReader: true, secure: true, mobile: true })).toBeNull();
    expect(unsupportedReason({ hasReader: false, secure: true, mobile: true })).toBe("no_api");
    expect(unsupportedReason({ hasReader: true, secure: false, mobile: true })).toBe("insecure");
  });
});

describe("error codes", () => {
  it("maps what the browser throws", () => {
    expect(nfcErrorCode({ name: "NotAllowedError" })).toBe("denied");
    expect(nfcErrorCode({ name: "NotReadableError" })).toBe("unreadable");
    expect(nfcErrorCode({ name: "AbortError" })).toBe("aborted");
    expect(nfcErrorCode({ name: "NotSupportedError" })).toBe("unsupported");
    expect(nfcErrorCode({ name: "SecurityError" })).toBe("insecure");
    expect(nfcErrorCode(new Error("x"))).toBe("failed");
    expect(nfcErrorCode(null)).toBe("failed");
  });
});

describe("write state machine", () => {
  const ok = { hasReader: true, secure: true, mobile: true };
  const idle = nfcReduce({ kind: "checking" }, { type: "support", support: ok });

  it("starts unsupported or idle", () => {
    expect(idle).toEqual({ kind: "idle" });
    expect(nfcReduce({ kind: "checking" }, { type: "support", support: { ...ok, hasReader: false } })).toEqual({ kind: "unsupported", reason: "no_api" });
  });
  it("cannot write when unsupported", () => {
    const s: NfcState = { kind: "unsupported", reason: "no_api" };
    expect(nfcReduce(s, { type: "write" })).toBe(s);
    expect(nfcReduce(s, { type: "reset" })).toBe(s);
  });
  it("goes idle, writing, written, verifying, verified", () => {
    let s = nfcReduce(idle, { type: "write" });
    expect(s.kind).toBe("writing");
    s = nfcReduce(s, { type: "written" });
    expect(s.kind).toBe("written");
    s = nfcReduce(s, { type: "verify" });
    expect(s.kind).toBe("verifying");
    expect(nfcReduce(s, { type: "verified", matches: true, found: "x" })).toEqual({ kind: "verified" });
    expect(nfcReduce(s, { type: "verified", matches: false, found: "https://other" })).toEqual({ kind: "mismatch", found: "https://other" });
  });
  it("shows where it failed and lets the person try again", () => {
    const writing = nfcReduce(idle, { type: "write" });
    const failed = nfcReduce(writing, { type: "fail", code: "denied" });
    expect(failed).toEqual({ kind: "error", code: "denied", during: "write" });
    expect(nfcReduce(failed, { type: "write" }).kind).toBe("writing");
    const verifying = nfcReduce({ kind: "written" }, { type: "verify" });
    expect(nfcReduce(verifying, { type: "fail", code: "unreadable" })).toEqual({ kind: "error", code: "unreadable", during: "verify" });
    expect(nfcReduce({ kind: "error", code: "unreadable", during: "verify" }, { type: "verify" }).kind).toBe("verifying");
  });
  it("ignores events that do not fit the state", () => {
    expect(nfcReduce(idle, { type: "written" })).toBe(idle);
    expect(nfcReduce(idle, { type: "verify" })).toBe(idle);
    expect(nfcReduce(idle, { type: "fail", code: "failed" })).toBe(idle);
    const writing: NfcState = { kind: "writing" };
    expect(nfcReduce(writing, { type: "write" })).toBe(writing);
    expect(nfcReduce({ kind: "written" }, { type: "reset" })).toEqual({ kind: "idle" });
  });
});

describe("sameUrl", () => {
  it("ignores the host's letter case and a trailing slash", () => {
    expect(sameUrl("https://ILAF.one/a/?s=nfc", "https://ilaf.one/a?s=nfc")).toBe(true);
    expect(sameUrl("https://ilaf.one/a?s=nfc", "https://ilaf.one/b?s=nfc")).toBe(false);
    expect(sameUrl("x", " x ")).toBe(true);
  });
});
