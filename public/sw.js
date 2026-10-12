/* Outlly offline helper. Network-first everywhere; keeps copies of Billing, Help and invoice PDFs
   so they still open without a connection. Never caches API writes, admin pages or other users' data. */
const CACHE = "outly-offline-v1";
const KEEP = [/^\/billing\/?$/, /^\/help\/?$/, /^\/api\/billing\/invoices\/[\w-]+$/];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== location.origin || url.pathname.startsWith("/admin") || url.pathname.startsWith("/_next/webpack-hmr")) return;
  const keep = KEEP.some((r) => r.test(url.pathname));
  if (req.mode !== "navigate" && !keep) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (keep && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname, copy));
        }
        return res;
      })
      .catch(async () => (await caches.match(url.pathname)) || (req.mode === "navigate" ? caches.match("/offline.html") : Response.error())),
  );
});
