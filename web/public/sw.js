// The service worker: it makes the app open fast and, with no connection, show the offline page and the saved QR codes.
// Hand written, no library. The routing rules are in sw-rules.js. Rules of the road:
//   - public card pages (/c/...) are never touched, so they keep working with no script;
//   - nothing from the API is ever kept; the one personal thing stored, the owner's own QR codes, lives in the page's
//     IndexedDB (see src/lib/pwa/store.ts) and is deleted at sign-out together with every cache here;
//   - a new version waits until the person taps "Update available" (SKIP_WAITING), so a page is never swapped under them.
/* global importScripts, SwRules, self, caches, fetch, Response */
importScripts("/sw-rules.js");

var names = SwRules.cacheNames(SwRules.VERSION);

self.addEventListener("install", function (event) {
  // The offline page is kept from the start so it is there the first time the connection drops.
  event.waitUntil(
    caches.open(names.pages).then(function (cache) {
      return cache.add(new Request(SwRules.OFFLINE_URL, { cache: "reload" })).catch(function () {});
    }),
  );
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches
      .keys()
      .then(function (all) {
        return Promise.all(SwRules.staleCaches(all, SwRules.VERSION).map(function (n) { return caches.delete(n); }));
      })
      .then(function () { return self.clients.claim(); }),
  );
});

self.addEventListener("message", function (event) {
  if (SwRules.isSkipWaiting(event.data)) self.skipWaiting();
  if (SwRules.isClear(event.data)) {
    event.waitUntil(caches.keys().then(function (all) { return Promise.all(all.filter(function (n) { return n.indexOf(SwRules.PREFIX) === 0; }).map(function (n) { return caches.delete(n); })); }));
  }
});

function assetFirst(request) {
  return caches.open(names.assets).then(function (cache) {
    return cache.match(request).then(function (hit) {
      if (hit) return hit;
      return fetch(request).then(function (res) {
        if (SwRules.cacheable(res)) cache.put(request, res.clone());
        return res;
      });
    });
  });
}

function pageNetworkFirst(request) {
  return fetch(request)
    .then(function (res) {
      if (SwRules.cacheable(res)) {
        var copy = res.clone();
        caches.open(names.pages).then(function (cache) { cache.put(request, copy); });
      }
      return res;
    })
    .catch(function () {
      return caches.open(names.pages).then(function (cache) {
        return cache.match(request).then(function (hit) {
          return hit || cache.match(SwRules.OFFLINE_URL).then(function (off) { return off || new Response("Offline", { status: 503, headers: { "Content-Type": "text/plain" } }); });
        });
      });
    });
}

function offlinePage(request) {
  return caches.open(names.pages).then(function (cache) {
    return cache.match(SwRules.OFFLINE_URL).then(function (hit) {
      return hit || fetch(request);
    });
  });
}

self.addEventListener("fetch", function (event) {
  var request = event.request;
  var kind = SwRules.classify({ url: request.url, method: request.method, mode: request.mode, origin: self.location.origin });
  if (kind === "asset") event.respondWith(assetFirst(request));
  else if (kind === "page") event.respondWith(pageNetworkFirst(request));
  else if (kind === "offline") event.respondWith(fetch(request).catch(function () { return offlinePage(request); }));
});

// Browser notifications (Web Push). The server sends a small JSON message: { title, body, url, tag, kind }. Only a path on
// this site is ever opened, so a message can never send the person to another address.
function safePath(url) {
  if (typeof url !== "string" || url.charAt(0) !== "/" || url.charAt(1) === "/") return "/app";
  return url;
}

self.addEventListener("push", function (event) {
  var data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (e) {
    data = { body: event.data ? event.data.text() : "" };
  }
  var options = {
    body: typeof data.body === "string" ? data.body : "",
    tag: typeof data.tag === "string" ? data.tag : undefined,
    icon: "/brand/icon-192.png",
    badge: "/brand/icon-192.png",
    data: { url: safePath(data.url) },
  };
  event.waitUntil(self.registration.showNotification(typeof data.title === "string" && data.title ? data.title : self.location.hostname, options));
});

self.addEventListener("notificationclick", function (event) {
  event.notification.close();
  var target = new URL(safePath(event.notification.data && event.notification.data.url), self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(function (list) {
      for (var i = 0; i < list.length; i++) {
        var c = list[i];
        if (c.url.indexOf(self.location.origin) === 0 && "focus" in c) {
          return c.focus().then(function (focused) { return focused && "navigate" in focused ? focused.navigate(target) : undefined; });
        }
      }
      return self.clients.openWindow ? self.clients.openWindow(target) : undefined;
    }),
  );
});
