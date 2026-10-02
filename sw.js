// Service worker: cache the app shell so it opens offline. Firestore calls
// always go to the network (never cached). Bump CACHE on every deploy — the
// build step rewrites __BUILD__ with the git SHA.
const BUILD = "__BUILD__";
const CACHE = "bbx-" + BUILD;
// Part photos live in their own cache that survives deploys, so ~120 images
// aren't re-downloaded every time the app updates.
const PARTS_CACHE = "bbx-parts-v1";

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
  "./js/challonge.js",
  "./js/sharecard.js",
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
      await Promise.all(keys.filter((k) => k !== CACHE && k !== PARTS_CACHE).map((k) => caches.delete(k)));
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

  // Part photos: stale-while-revalidate — serve the cached copy instantly and
  // refresh it in the background (a replaced photo shows on the next view).
  if (url.pathname.includes("/assets/parts/")) {
    e.respondWith(
      caches.open(PARTS_CACHE).then(async (c) => {
        const hit = await c.match(req, { ignoreSearch: true });
        const net = fetch(req)
          .then((res) => { if (res && res.ok) c.put(req, res.clone()); return res; });
        if (hit) { e.waitUntil(net.catch(() => {})); return hit; }
        return net;
      })
    );
    return;
  }

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
      .catch(() => caches.match(req).then((hit) =>
        // only page navigations fall back to the app shell — an image or
        // script must fail as itself, not receive HTML
        hit || (req.mode === "navigate" ? caches.match("./index.html") : Response.error())))
  );
});
