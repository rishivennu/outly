/* Outlly offline helper. Keeps copies of Billing, Help and invoice PDFs so they still open without a
   connection, and receives the share sheet. Never caches API writes, admin pages or other users' data.
   1041: every other page load goes straight to the browser. Proxying them turned any brief network
   failure into "This site can't be reached / ERR_FAILED" on iPhone (no saved copy of /home, and iOS
   drops the offline page from storage), where the browser on its own would simply have loaded it. */
const CACHE = "outly-offline-v3";
const KEEP = [/^\/billing\/?$/, /^\/help\/?$/, /^\/api\/billing\/invoices\/[\w-]+$/];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(["/offline.html"])).catch(() => {}).then(() => self.skipWaiting()));
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

function offline() {
  return new Response(
    '<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><title>Offline</title><body style="font:16px system-ui;background:#0c0c0e;color:#f6f4ee;display:grid;place-items:center;min-height:100dvh;margin:0;text-align:center"><div><p>You are offline.</p><button onclick="location.reload()" style="font:inherit;min-height:44px;padding:0 20px;border-radius:999px;border:0;background:#c8f04a;color:#111">Try again</button></div>',
    { status: 503, headers: { "content-type": "text/html; charset=utf-8" } },
  );
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
  if (!KEEP.some((r) => r.test(url.pathname))) return; // the browser loads it, exactly as with no worker
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(url.pathname, copy));
        }
        return res;
      })
      // Always answer with a real response: an empty answer is what shows as ERR_FAILED.
      .catch(async () => (await caches.match(url.pathname)) || (await caches.match("/offline.html")) || offline()),
  );
});
