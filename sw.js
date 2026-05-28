// Daily Signal service worker
// Strategy:
//   - shell (HTML/CSS/JS, icon, manifest): cache-first (instant, offline-ok).
//   - data/*.json: network-first with cache fallback (always show freshest).
const VERSION = "ds-v1";
const SHELL = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);
  const isData = url.pathname.includes("/data/") && url.pathname.endsWith(".json");

  if (isData) {
    // Network-first for fresh news/trends/archive; fall back to last cached copy offline.
    event.respondWith(
      fetch(req)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
          return response;
        })
        .catch(() => caches.match(req)),
    );
    return;
  }

  // Cache-first for shell; update in background if missing.
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((response) => {
          const copy = response.clone();
          caches.open(VERSION).then((cache) => cache.put(req, copy));
          return response;
        })
        .catch(() => cached);
    }),
  );
});
