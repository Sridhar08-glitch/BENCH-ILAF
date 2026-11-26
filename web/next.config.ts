import type { NextConfig } from "next";
import { LEGACY_ROUTES } from "./src/lib/share/legacy-routes";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Card photos and logos come from the API's media storage, which can be any host.
  images: { unoptimized: true },
  // The old addresses of QR, NFC, signature, event mode and the paper-card scanner lead to the Share hub and to Contacts (the query string is kept).
  async redirects() {
    return LEGACY_ROUTES.map((r) => ({ ...r, permanent: false }));
  },
  async headers() {
    return [
      // The card stylesheet is a static file whose address carries a content hash (`?v=`), so it can be cached for a year.
      { source: "/card-library/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // The self-hosted card fonts: the file names carry the font package version and the stylesheet address a hash, so a year is safe.
      { source: "/card-fonts/:path*", headers: [{ key: "Cache-Control", value: "public, max-age=31536000, immutable" }] },
      // The service worker and its rules are fetched fresh every time, so a new version reaches people within a day at most
      // (and the browser's own update check is never served a stale copy).
      { source: "/sw.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Service-Worker-Allowed", value: "/" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      { source: "/sw-rules.js", headers: [{ key: "Cache-Control", value: "no-cache, no-store, must-revalidate" }, { key: "Content-Type", value: "application/javascript; charset=utf-8" }] },
      // The manifest changes with the visitor's language (shortcut names), so it is revalidated on every use.
      { source: "/manifest.webmanifest", headers: [{ key: "Cache-Control", value: "no-cache" }, { key: "Content-Type", value: "application/manifest+json; charset=utf-8" }] },
    ];
  },
};

export default nextConfig;
