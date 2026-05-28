// Daily Signal service worker
// Strategy:
//   - shell (HTML/CSS/JS, icon, manifest): cache-first (instant, offline-ok).
//   - data/*.json: network-first with cache fallback (always show freshest).
const VERSION = "ds-v8"; // bumped: refresh + mark-all-read + read-time + keybinds + skeleton
const SHELL = ["./", "./index.html", "./app.js", "./styles.css", "./manifest.json", "./icon.svg"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(VERSION).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

// Best-effort: when periodic background sync is allowed, refetch news.json
// and notify the user if new article ids have appeared since last check.
self.addEventListener("periodicsync", (event) => {
  if (event.tag !== "news-poll") return;
  event.waitUntil(checkForNewItems());
});

async function checkForNewItems() {
  try {
    const fresh = await fetch("data/news.json", { cache: "no-store" });
    if (!fresh.ok) return;
    const payload = await fresh.clone().json();
    const cache = await caches.open(VERSION);
    cache.put("data/news.json", fresh);
    const ids = (payload.articles || []).map((a) => a.id);
    const prevRes = await caches.match("notify-seen");
    let prev = [];
    if (prevRes) {
      try {
        prev = await prevRes.json();
      } catch {
        prev = [];
      }
    }
    const prevSet = new Set(prev);
    const newOnes = ids.filter((id) => !prevSet.has(id));
    if (prev.length && newOnes.length) {
      const sample = (payload.articles || []).find((a) => newOnes.includes(a.id));
      await self.registration.showNotification(`Daily Signal · ${newOnes.length} new`, {
        body: sample?.title?.slice(0, 120) || "Fresh stories are in.",
        icon: "icon.svg",
        tag: "daily-signal-new",
      });
    }
    await cache.put("notify-seen", new Response(JSON.stringify(ids), { headers: { "content-type": "application/json" } }));
  } catch {
    // network or storage issue — best effort only
  }
}

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(self.clients.openWindow("./"));
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
