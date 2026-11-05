/* Outlly offline helper. Keeps copies of Billing, Help and invoice PDFs so they still open without a
   connection, and receives the share sheet. Never caches API writes, admin pages or other users' data.
   1041: every other page load goes straight to the browser. Proxying them turned any brief network
   failure into "This site can't be reached / ERR_FAILED" on iPhone (no saved copy of /home, and iOS
   drops the offline page from storage), where the browser on its own would simply have loaded it. */
const CACHE = "outly-offline-v4";
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

/* Signed out here, or a session the server no longer accepts (signed out everywhere, password changed):
   drop the offline copies of Billing and its invoice PDFs at once. The browser does this on the sign-out
   button too (lib/client/forget-billing.ts), but a revoked session only ever lands on /login, and the next
   person on a shared device must not be able to open them with the network off. */
const PRIVATE = /^\/(billing\/?|api\/billing\/invoices\/[\w-]+)$/;
async function forgetPrivate() {
  const c = await caches.open(CACHE);
  for (const req of await c.keys()) if (PRIVATE.test(new URL(req.url).pathname)) await c.delete(req);
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
  if (url.pathname === "/login" || url.pathname === "/api/auth/expired") e.waitUntil(forgetPrivate().catch(() => {}));
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

/* 1118: Web Push. The server sends a short JSON (lib/push/webpush.ts payloadOf): t title, b body, h path to
   open, g tag (a newer push with the same tag replaces the older one), i notice id, n unread count. Every push
   shows a notification, always: iOS stops delivering to a Home Screen app whose pushes stay silent.
   1136: c picture (the sender's photo, else the platform's mark), p platform name, r what a typed reply
   answers ({k:"dm",t} or {k:"cm",t,c}), w who that reply goes to.
   1141: q = 1 keeps the notification on screen until it is acted on, a = [{action,title,href}] buttons whose
   tap opens href inside Outlly. */
const ICON = "/brand/app/icon-192.png";
const BADGE = "/brand/app/badge-96.png";
const safePath = (h) => (typeof h === "string" && /^\/(?![/\\])/.test(h) ? h : "/home");
/* Our own files, or a profile photo on https. Anything else falls back to the app icon. */
const safePic = (u) => (typeof u === "string" && u.length <= 600 && (/^\/brand\/[\w./-]+$/.test(u) || /^https:\/\/[^\s"<>]+$/.test(u)) ? u : ICON);
const tell = (msg) => self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((cs) => cs.forEach((c) => c.postMessage(msg)));
function badge(n) {
  if (typeof n !== "number" || !("setAppBadge" in self.navigator)) return Promise.resolve();
  return (n > 0 ? self.navigator.setAppBadge(n) : self.navigator.clearAppBadge()).catch(() => {});
}

/* The buttons. "reply" asks for text where the browser offers it (Chrome on Android); everywhere else,
   including every iPhone, the same button simply opens the conversation, which is the honest fallback.
   Browsers draw at most two, so the reply button is kept first and the server already sends no more. */
const REPLY = "outlly:reply";
function buttons(d) {
  const out = [];
  if (d.r && typeof d.r === "object" && typeof d.r.t === "string")
    // A browser without inline replies ignores type and placeholder and draws a plain button instead.
    out.push({ action: REPLY, title: "Reply", type: "text", placeholder: d.w ? `Reply to ${d.w}` : "Write a reply" });
  for (const a of Array.isArray(d.a) ? d.a : []) {
    if (!a || typeof a.action !== "string" || typeof a.title !== "string" || !a.title) continue;
    out.push({ action: `go:${a.action}`, title: a.title.slice(0, 24) });
  }
  return out.slice(0, 2);
}

/* Where each button goes, kept on the notification so a tap after the page was closed still knows. */
function links(d) {
  const out = {};
  for (const a of Array.isArray(d.a) ? d.a : []) if (a && typeof a.action === "string") out[`go:${a.action}`] = safePath(a.href);
  return out;
}

self.addEventListener("push", (e) => {
  let d = {};
  try {
    d = e.data ? e.data.json() : {};
  } catch (_) {
    try {
      d = { b: e.data.text() };
    } catch (_) {}
  }
  const opts = {
    body: d.b || "You have a new update in Outlly.",
    icon: safePic(d.c),
    badge: BADGE,
    timestamp: d.s || Date.now(),
    data: { h: safePath(d.h), i: d.i || "", r: d.r || null, p: d.p || "", links: links(d) },
    lang: "en",
  };
  if (d.g) (opts.tag = d.g), (opts.renotify = true);
  /* q: something is being watched (a post going out), so it must not slip away unnoticed. */
  if (d.q === 1) opts.requireInteraction = true;
  const acts = buttons(d);
  if (acts.length) opts.actions = acts;
  e.waitUntil(Promise.all([self.registration.showNotification(d.t || "Outlly", opts), badge(d.n), tell({ type: "outlly:notice" })]));
});

/* A tap opens the page the notice is about: an Outlly window already open is reused (focused, then sent
   there), otherwise a new one opens. A signed-out session lands on sign-in, which returns to this page. */

/* A reply typed into the notification. The server decides whether it may be sent and sends it; this only
   reports back what the platform answered. Nothing says "Sent" until the server says the platform took it. */
async function sendReply(d, text) {
  const body = d.r.k === "cm" ? { k: "cm", t: d.r.t, c: d.r.c, text } : { k: "dm", t: d.r.t, text };
  let out = null;
  try {
    const res = await fetch("/api/push/reply", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    out = await res.json().catch(() => null);
    if (!res.ok) throw new Error((out && out.error) || "not sent");
  } catch (err) {
    await self.registration.showNotification("Reply not sent", {
      body: (out && out.error) || "Outlly could not send that just now. Open the conversation to try again.",
      icon: ICON,
      badge: BADGE,
      tag: `reply-failed:${d.r.t}`,
      data: { h: safePath(d.h) },
      lang: "en",
    });
    return;
  }
  await self.registration.showNotification("Reply sent", { body: text.slice(0, 120), icon: ICON, badge: BADGE, tag: `reply-sent:${d.r.t}`, data: { h: safePath((out && out.href) || d.h) }, lang: "en" });
  await tell({ type: "outlly:notice" });
}

self.addEventListener("notificationclick", (e) => {
  const d = e.notification.data || {};
  /* The reply box: the notification stays while the text goes out, then says what really happened. */
  if (e.action === REPLY && d.r && typeof e.reply === "string" && e.reply.trim()) {
    e.notification.close();
    e.waitUntil(sendReply(d, e.reply.trim().slice(0, 1000)));
    return;
  }
  e.notification.close();
  /* A button with no typed text (iPhone, or a plain action button) opens where it points. */
  const path = safePath((d.links && d.links[e.action]) || d.h);
  const url = new URL(path, self.location.origin).href;
  e.waitUntil(
    (async () => {
      if (d.i)
        fetch("/api/notices", { method: "PATCH", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ ids: [d.i] }) })
          .then(() => tell({ type: "outlly:notice" }))
          .catch(() => {});
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const mine = all.filter((c) => new URL(c.url).origin === self.location.origin && !new URL(c.url).pathname.startsWith("/admin"));
      const at = (c) => {
        const u = new URL(c.url);
        return u.pathname + u.search;
      };
      const hit = mine.find((c) => at(c) === path) || mine.find((c) => c.focused) || mine[0];
      if (!hit) return self.clients.openWindow(url);
      const w = await hit.focus().catch(() => hit);
      if (at(hit) === path) return;
      // navigate() only works on a page this worker controls; otherwise the page routes itself.
      try {
        if (await (w || hit).navigate(url)) return;
      } catch (_) {}
      (w || hit).postMessage({ type: "outlly:open", href: path });
    })(),
  );
});

/* The browser replaced the subscription by itself: subscribe again with the same key and tell the server,
   which recognises the device by its old endpoint (app/api/push/renew). */
self.addEventListener("pushsubscriptionchange", (e) => {
  e.waitUntil(
    (async () => {
      const old = e.oldSubscription;
      let sub = e.newSubscription;
      const key = old && old.options && old.options.applicationServerKey;
      if (!sub && key) sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      if (!sub || !old) return;
      await fetch("/api/push/renew", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ old: old.endpoint, sub: sub.toJSON() }) });
    })().catch(() => {}),
  );
});
