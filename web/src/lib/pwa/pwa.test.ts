import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import { DEFAULT_STYLE } from "@/lib/qr/style";
import { DISMISS_DAYS, detectPlatform, installOffer, isStandalone } from "./install";
import { offlineQrChanged, parseOfflineQr, upsertOfflineQr, type OfflineQr } from "./offline-qr";
import { canRegister } from "./register";

// The worker's rules are plain JavaScript in public/, loaded the same way the worker loads them.
const rules = createRequire(import.meta.url)("../../../public/sw-rules.js") as {
  VERSION: string;
  cacheNames: (v: string) => { assets: string; pages: string };
  staleCaches: (all: string[], v: string) => string[];
  classify: (r: { url: string; method: string; mode: string; origin: string }) => string;
  cacheable: (r: { status: number; redirected?: boolean; type?: string; headers?: { get: (n: string) => string | null } }) => boolean;
  isSkipWaiting: (d: unknown) => boolean;
  isClear: (d: unknown) => boolean;
};

const ORIGIN = "https://bench.test";
const route = (path: string, mode = "navigate", method = "GET", origin = ORIGIN) => rules.classify({ url: (origin === ORIGIN ? ORIGIN : origin) + path, method, mode, origin: ORIGIN });

describe("service worker routing", () => {
  it("serves build files, fonts and brand pictures from the cache first", () => {
    expect(route("/_next/static/chunks/main-abc.js", "no-cors")).toBe("asset");
    expect(route("/card-fonts/poppins-5.3.0-700-normal.woff2", "cors")).toBe("asset");
    expect(route("/card-library/cards.css", "no-cors")).toBe("asset");
    expect(route("/brand/icon-192.png", "no-cors")).toBe("asset");
  });
  it("keeps card-page fonts cached but never touches the card page itself", () => {
    expect(route("/c/ahmed-d")).toBe("ignore");
    expect(route("/c/ahmed-d/og.png", "no-cors")).toBe("ignore");
    expect(route("/c/ahmed-d?s=nfc")).toBe("ignore");
    expect(route("/card-fonts/cairo-arabic-5.3.0-700-normal.woff2", "cors")).toBe("asset");
  });
  it("uses network first for the signed-in screens", () => {
    expect(route("/app")).toBe("page");
    expect(route("/app/share")).toBe("page");
    expect(route("/app/cards/123")).toBe("page");
  });
  it("leaves the card preview tab, the sign-in and everything else to the network", () => {
    expect(route("/app/preview/123")).toBe("ignore");
    expect(route("/login")).toBe("ignore");
    expect(route("/")).toBe("ignore");
    expect(route("/application")).toBe("ignore");
  });
  it("precaches and serves the offline page", () => {
    expect(route("/offline")).toBe("offline");
  });
  it("never keeps data requests, other origins, other methods or the worker's own files", () => {
    expect(route("/api/auth/login", "cors")).toBe("ignore");
    expect(route("/app/qr?_rsc=abc", "cors")).toBe("ignore");
    expect(route("/_next/data/x/app.json", "cors")).toBe("ignore");
    expect(route("/sw.js", "same-origin")).toBe("ignore");
    expect(route("/manifest.webmanifest", "cors")).toBe("ignore");
    expect(route("/ocr/worker.js", "cors")).toBe("ignore");
    expect(route("/_next/static/a.js", "no-cors", "POST")).toBe("ignore");
    expect(rules.classify({ url: "https://api.other.test/public/cards/x/qr.svg", method: "GET", mode: "cors", origin: ORIGIN })).toBe("ignore");
    expect(rules.classify({ url: "not a url", method: "GET", mode: "cors", origin: ORIGIN })).toBe("ignore");
  });
  it("keeps only plain successful responses", () => {
    const h = (cc: string) => ({ get: () => cc });
    expect(rules.cacheable({ status: 200, headers: h("") })).toBe(true);
    expect(rules.cacheable({ status: 200, redirected: true, headers: h("") })).toBe(false);
    expect(rules.cacheable({ status: 404, headers: h("") })).toBe(false);
    expect(rules.cacheable({ status: 200, type: "opaque", headers: h("") })).toBe(false);
    expect(rules.cacheable({ status: 200, headers: h("private, no-store") })).toBe(false);
  });
});

describe("service worker versions", () => {
  it("names the caches after the version", () => {
    expect(rules.cacheNames("7")).toEqual({ assets: "bench-assets-7", pages: "bench-pages-7" });
  });
  it("lists only our own caches of other versions for deletion", () => {
    const all = ["bench-assets-1", "bench-pages-1", "bench-assets-2", "bench-pages-2", "workbox-other", "bench-old"];
    expect(rules.staleCaches(all, "2")).toEqual(["bench-assets-1", "bench-pages-1", "bench-old"]);
    expect(rules.staleCaches(["bench-assets-2"], "2")).toEqual([]);
  });
  it("understands the two messages the app sends", () => {
    expect(rules.isSkipWaiting({ type: "SKIP_WAITING" })).toBe(true);
    expect(rules.isSkipWaiting({ type: "CLEAR" })).toBe(false);
    expect(rules.isSkipWaiting(null)).toBe(false);
    expect(rules.isClear({ type: "CLEAR" })).toBe(true);
    expect(rules.isClear(undefined)).toBe(false);
  });
  it("has a version", () => {
    expect(rules.VERSION).toMatch(/^\d+$/);
  });
});

describe("registration rules", () => {
  const base = { production: true, protocol: "https:", hostname: "bench.test", hasApi: true };
  it("registers on https and on localhost, in production only", () => {
    expect(canRegister(base)).toBe(true);
    expect(canRegister({ ...base, protocol: "http:", hostname: "localhost" })).toBe(true);
    expect(canRegister({ ...base, protocol: "http:", hostname: "127.0.0.1" })).toBe(true);
    expect(canRegister({ ...base, protocol: "http:" })).toBe(false);
    expect(canRegister({ ...base, production: false })).toBe(false);
    expect(canRegister({ ...base, hasApi: false })).toBe(false);
  });
});

const IPHONE_SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/123.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Mobile Safari/537.36";
const MAC = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.4 Safari/605.1.15";

describe("install offer", () => {
  it("detects the platform", () => {
    expect(detectPlatform(IPHONE_SAFARI)).toBe("ios-safari");
    expect(detectPlatform(IPHONE_CHROME)).toBe("ios-other");
    expect(detectPlatform(ANDROID)).toBe("android");
    expect(detectPlatform(MAC)).toBe("desktop");
    expect(detectPlatform(MAC, 5)).toBe("ios-safari");
    expect(detectPlatform("")).toBe("desktop");
  });
  it("knows when the app is already installed", () => {
    expect(isStandalone({ navigatorStandalone: true })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: true }) })).toBe(true);
    expect(isStandalone({ matchMedia: () => ({ matches: false }) })).toBe(false);
    expect(isStandalone({})).toBe(false);
  });
  const now = 1_000_000_000_000;
  const base = { platform: "android" as const, standalone: false, hasPrompt: true, dismissedAt: null, now };
  it("offers the prompt where the browser gives one and the how-to on iPhone Safari", () => {
    expect(installOffer(base)).toBe("prompt");
    expect(installOffer({ ...base, hasPrompt: false })).toBe("none");
    expect(installOffer({ ...base, platform: "ios-safari", hasPrompt: false })).toBe("ios");
    expect(installOffer({ ...base, platform: "ios-other", hasPrompt: false })).toBe("none");
  });
  it("stays quiet when installed or recently dismissed, then comes back", () => {
    expect(installOffer({ ...base, standalone: true })).toBe("none");
    expect(installOffer({ ...base, dismissedAt: now - 86_400_000 })).toBe("none");
    expect(installOffer({ ...base, dismissedAt: now - (DISMISS_DAYS + 1) * 86_400_000 })).toBe("prompt");
  });
});

describe("offline QR records", () => {
  const entry: OfflineQr = {
    id: "c1", name: "Ahmed", title: "CEO", company: "Zeta", publicUrl: "https://ilaf.one/ahmed", linkText: "https://ilaf.one/ahmed?s=qr",
    contactText: "BEGIN:VCARD", style: DEFAULT_STYLE, logoHref: null, savedAt: 100,
  };
  it("accepts a good record and refuses junk", () => {
    expect(parseOfflineQr(entry)).toEqual(entry);
    expect(parseOfflineQr(null)).toBeNull();
    expect(parseOfflineQr({ id: "c1" })).toBeNull();
    expect(parseOfflineQr({ ...entry, id: "" })).toBeNull();
  });
  it("repairs a bad style and drops a picture that is not an image", () => {
    const r = parseOfflineQr({ ...entry, style: { dots: "triangle", fg: "red" }, logoHref: "https://evil.test/x.png" });
    expect(r?.style).toEqual(DEFAULT_STYLE);
    expect(r?.logoHref).toBeNull();
  });
  it("replaces a card's older record and sorts newest first", () => {
    const list = upsertOfflineQr([entry, { ...entry, id: "c2", savedAt: 50 }], { ...entry, name: "New", savedAt: 200 });
    expect(list.map((e) => e.id)).toEqual(["c1", "c2"]);
    expect(list[0].name).toBe("New");
  });
  it("skips a write when only the time changed", () => {
    expect(offlineQrChanged(entry, { ...entry, savedAt: 999 })).toBe(false);
    expect(offlineQrChanged(entry, { ...entry, name: "Other" })).toBe(true);
    expect(offlineQrChanged(undefined, entry)).toBe(true);
  });
});
