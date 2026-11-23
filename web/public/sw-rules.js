// The routing rules of the service worker, kept apart from the worker so they can be tested.
// Loaded by sw.js with importScripts, and by the unit tests with require. Plain ES5 on purpose: no build step.
(function (root, factory) {
  var api = factory();
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.SwRules = api;
})(typeof self !== "undefined" ? self : this, function () {
  // Bump this when sw.js or these rules change: the browser then installs the new worker and the app offers "Update available".
  var VERSION = "2";
  var PREFIX = "bench-";

  /** The names of the caches of one version. */
  function cacheNames(version) {
    return { assets: PREFIX + "assets-" + version, pages: PREFIX + "pages-" + version };
  }

  /** Every cache of ours that does not belong to `version` (to be deleted when a new worker takes over). */
  function staleCaches(all, version) {
    var keep = cacheNames(version);
    return all.filter(function (n) {
      return n.indexOf(PREFIX) === 0 && n !== keep.assets && n !== keep.pages;
    });
  }

  // Files that never change under their address (hashed build files, fonts, brand pictures): cache first.
  var ASSET_PREFIXES = ["/_next/static/", "/card-fonts/", "/card-library/", "/brand/"];
  // Never touched by the worker: sign-in and data calls, the worker itself, the manifest, big optional downloads.
  var NEVER_PREFIXES = ["/api/", "/ocr/", "/_next/data/", "/_next/image"];
  var NEVER_EXACT = ["/sw.js", "/sw-rules.js", "/manifest.webmanifest"];

  /**
   * What to do with a request:
   *   "asset"   cache first (static files, fonts)
   *   "page"    network first, a copy of a signed-in screen for when the connection drops
   *   "offline" the offline page itself (precached)
   *   "ignore"  not the worker's business (everything else, including every public card page)
   * `req` is { url, method, mode, origin } where origin is the worker's own origin.
   */
  function classify(req) {
    if (req.method !== "GET") return "ignore";
    var u;
    try {
      u = new URL(req.url);
    } catch (e) {
      return "ignore";
    }
    if (u.origin !== req.origin) return "ignore";
    var p = u.pathname;
    if (NEVER_EXACT.indexOf(p) !== -1) return "ignore";
    for (var i = 0; i < NEVER_PREFIXES.length; i++) if (p.indexOf(NEVER_PREFIXES[i]) === 0) return "ignore";
    // The app's own data requests of the page router carry these markers: they hold personal data and are never kept.
    if (u.searchParams.has("_rsc")) return "ignore";
    for (var j = 0; j < ASSET_PREFIXES.length; j++) if (p.indexOf(ASSET_PREFIXES[j]) === 0) return "asset";
    if (req.mode === "navigate") {
      if (p === "/offline") return "offline";
      // A public card page (/c/...) always goes straight to the network: it must work with no script and no worker.
      if (p === "/app" || p.indexOf("/app/") === 0) return p.indexOf("/app/preview/") === 0 ? "ignore" : "page";
    }
    return "ignore";
  }

  /** A response worth keeping: a plain success, not a redirect to the sign-in page, not marked private by the server. */
  function cacheable(res) {
    if (!res || res.status !== 200 || res.redirected || res.type === "opaque" || res.type === "opaqueredirect") return false;
    var cc = (res.headers && res.headers.get && res.headers.get("Cache-Control")) || "";
    return !/no-store/i.test(cc);
  }

  /** True for the message the app sends to a waiting worker to take over now. */
  function isSkipWaiting(data) {
    return !!data && data.type === "SKIP_WAITING";
  }

  /** True for the message sent at sign-out: delete everything kept. */
  function isClear(data) {
    return !!data && data.type === "CLEAR";
  }

  return { VERSION: VERSION, PREFIX: PREFIX, OFFLINE_URL: "/offline", cacheNames: cacheNames, staleCaches: staleCaches, classify: classify, cacheable: cacheable, isSkipWaiting: isSkipWaiting, isClear: isClear };
});
