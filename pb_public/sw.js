/* Keel service worker: makes the app installable and lets it open without a connection.
   Network first for everything, so auto-updates show up right away; the cache is only a
   fallback. API calls and the admin UI are never cached. */
const CACHE = "keel-shell-v1";
const SHELL = [
  "./",
  "index.html",
  "styles.css",
  "app.js",
  "manifest.json",
  "vendor/pocketbase.umd.js",
  "vendor/inter.woff2",
  "brand/favicon-32.png",
  "brand/icon-192.png",
  "brand/logo-mark.png",
  "brand/logo.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_/")) return;

  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok && res.type === "basic") {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req.mode === "navigate" ? "index.html" : req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req.mode === "navigate" ? "index.html" : req, { ignoreSearch: true })
        .then((hit) => hit || caches.match("index.html"))),
  );
});
