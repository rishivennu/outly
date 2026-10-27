/* Outlly offline helper. Network-first everywhere; keeps copies of Billing, Help and invoice PDFs
   so they still open without a connection. Never caches API writes, admin pages or other users' data. */
const CACHE = "outly-offline-v2";
const KEEP = [/^\/billing\/?$/, /^\/help\/?$/, /^\/api\/billing\/invoices\/[\w-]+$/];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html"])).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE && k !== "outly-share").map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
const SHARE = "outly-share";
/** Share sheet (manifest share_target): keep the video for Create to pick up, then open Create. */
async function takeShare(req) {
  const form = await req.formData();
  const file = form.getAll("media").find((m) => typeof m !== "string" && m.size > 0);
  const story = ["title", "text", "url"].map((k) => String(form.get(k) || "").trim()).filter(Boolean).filter((s, i, a) => a.indexOf(s) === i).join("\n").slice(0, 600);
  const to = new URL("/create", location.origin);
  if (story) to.searchParams.set("text", story);
  if (file) {
    const c = await caches.open(SHARE);
    await c.put("/__shared-media", new Response(file, { headers: { "content-type": file.type || "video/mp4", "x-name": encodeURIComponent(file.name || "shared-video.mp4") } }));
    to.searchParams.set("shared", "1");
  }
  return Response.redirect(to.href, 303);
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method === "POST" && new URL(req.url).pathname === "/share-target") {
    e.respondWith(takeShare(req).catch(() => Response.redirect("/create?shared=missed", 303)));
    return;
  }
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
