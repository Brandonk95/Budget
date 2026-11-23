/* Keel service worker: makes the app installable and lets it open without a connection.
   Network first for everything, so auto-updates show up right away; the cache is only a
   fallback. API calls and the admin UI are never cached. */
const CACHE = "keel-shell-v2";
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

// notifications from Keel (see pb_hooks/lib/push.js)
self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (_) { d = { body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "Keel", {
    body: d.body || "",
    icon: "brand/icon-192.png",
    // the status-bar icon: Android keeps only its shape (alpha), so it's a white sailboat on transparent
    badge: "brand/badge-96.png",
    tag: d.tag || undefined,
    data: { url: d.url || "./" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || "./", self.registration.scope).href;
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((list) => {
    for (const c of list) {
      if (new URL(c.url).origin === location.origin && "focus" in c) return c.focus().then((w) => (w && "navigate" in w ? w.navigate(url) : w));
    }
    return self.clients.openWindow(url);
  }));
});

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_/")) return;

  // skip the browser's HTTP cache too, so a stale copy there can't hide an update
  // (a navigation request can't be re-created with options, but the page is never cached long)
  const net = req.mode === "navigate" ? fetch(req) : fetch(req, { cache: "no-cache" });
  e.respondWith(
    net
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
