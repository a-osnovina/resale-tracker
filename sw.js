// Offline support. Bump VERSION when you change app files so phones pick up the new copy.
const VERSION = "v34";
const CACHE = "resale-tracker-" + VERSION;
const APP_FILES = ["./", "index.html", "logic.js", "manifest.json", "icon.png"];
const LIBRARY_HOSTS = ["cdn.jsdelivr.net", "unpkg.com", "tessdata.projectnaptha.com"];

self.addEventListener("install", function (event) {
  event.waitUntil(caches.open(CACHE).then(function (cache) { return cache.addAll(APP_FILES); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener("activate", function (event) {
  event.waitUntil(
    caches.keys().then(function (keys) {
      return Promise.all(keys.filter(function (k) { return k !== CACHE; }).map(function (k) { return caches.delete(k); }));
    }).then(function () { return self.clients.claim(); })
  );
});

self.addEventListener("fetch", function (event) {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === self.location.origin) {
    // Your own files: use the network when online (so updates show up), the saved copy when offline.
    event.respondWith(
      fetch(req).then(function (res) {
        if (res && res.ok) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
        return res;
      }).catch(function () {
        return caches.match(req).then(function (hit) { return hit || (req.mode === "navigate" ? caches.match("index.html") : Response.error()); });
      })
    );
  } else if (LIBRARY_HOSTS.indexOf(url.hostname) !== -1) {
    // Helper libraries (QR, screenshot reader): saved the first time they are used, then work offline.
    event.respondWith(
      caches.match(req).then(function (hit) {
        if (hit) return hit;
        return fetch(req).then(function (res) {
          if (res && (res.ok || res.type === "opaque")) { const copy = res.clone(); caches.open(CACHE).then(function (c) { c.put(req, copy); }); }
          return res;
        });
      })
    );
  }
});
