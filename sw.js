// Service worker: cache the app shell so it opens offline. Firestore calls
// always go to the network (never cached). Bump CACHE on every deploy — the
// build step rewrites __BUILD__ with the git SHA.
const BUILD = "__BUILD__";
const CACHE = "bbx-" + BUILD;

const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./js/app.js",
  "./js/firebase.js",
  "./js/firebase-config.js",
  "./js/store.js",
  "./js/stats.js",
  "./js/teams.js",
  "./js/friends.js",
  "./js/meta.js",
  "./js/catalog.js",
  "./data/meta.json",
  "./data/parts.json",
  "./manifest.webmanifest",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  // Never touch Firebase / Google APIs or other cross-origin data calls.
  if (url.origin !== self.location.origin) return;

  // App shell: network-first so deploys land immediately; fall back to
  // cache only when offline.
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req).then((hit) => hit || caches.match("./index.html")))
  );
});
