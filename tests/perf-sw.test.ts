/** Perf B1: the service worker's app shell (public/sw.js). Runs the real file in a sandbox with fake caches and fetch. */
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://outlly.test";
const code = readFileSync("public/sw.js", "utf8");
const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

type Req = { url: string; method: string; mode: string; cache: string; headers: Headers };
const req = (path: string, o: Partial<Omit<Req, "headers">> & { headers?: Record<string, string> } = {}): Req => ({
  url: path.startsWith("http") ? path : ORIGIN + path,
  method: o.method ?? "GET",
  mode: o.mode ?? "cors",
  cache: o.cache ?? "default",
  headers: new Headers(o.headers ?? {}),
});
/** A same-origin answer as the browser hands it to a worker (type "basic"). */
const basic = (body: string, init: ResponseInit & { redirected?: boolean } = {}) => {
  const r = new Response(body, init);
  Object.defineProperty(r, "type", { value: "basic" });
  if (init.redirected) Object.defineProperty(r, "redirected", { value: true });
  return r;
};
const html = (body = "<p>page</p>", init: ResponseInit & { redirected?: boolean } = {}) => basic(body, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "private, no-store" }, ...init });

function worker(fetchImpl: (r: Req) => Promise<Response>) {
  const store = new Map<string, Map<string, Response>>();
  const key = (r: string | { url: string }) => new URL(typeof r === "string" ? r : r.url, ORIGIN).href;
  const open = async (name: string) => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name)!;
    return {
      match: async (r: string | Req) => m.get(key(r))?.clone(),
      put: async (r: string | Req, res: Response) => {
        m.delete(key(r));
        m.set(key(r), res);
      },
      add: async (u: string) => void m.set(key(u), basic("precached")),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: string | { url: string }) => m.delete(key(r)),
    };
  };
  const caches = {
    open,
    keys: async () => [...store.keys()],
    delete: async (n: string) => store.delete(n),
    match: async (r: string | Req) => {
      for (const m of store.values()) if (m.has(key(r))) return m.get(key(r))!.clone();
      return undefined;
    },
  };
  const handlers: Record<string, (e: unknown) => void> = {};
  const calls: string[] = [];
  let skipped = false;
  const ctx: Record<string, unknown> = {
    addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn),
    location: { origin: ORIGIN },
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: {},
    navigator: {},
    skipWaiting: () => (skipped = true),
    caches,
    fetch: (r: Req) => (calls.push(new URL(r.url).pathname), fetchImpl(r)),
    // NAV_WAIT (2.5 s) runs in 30 ms here, so "the network is late" can be tested quickly.
    setTimeout: (fn: (...a: unknown[]) => void, ms: number, ...a: unknown[]) => setTimeout(fn, Math.min(ms, 30), ...a),
    clearTimeout,
    Response,
    Headers,
    URL,
    Promise,
    console,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  const api = vm.runInContext(`${code}\n;({ routeOf, keepPage, keepStatic, CURRENT, STUDIO, PAGES, STATIC, CACHE, STATIC_MAX, PAGES_MAX, NAV_WAIT })`, ctx) as {
    routeOf: (r: Req, u: URL, o: string) => string | null;
    STUDIO: RegExp;
    PAGES: string;
    STATIC: string;
    CACHE: string;
    CURRENT: string[];
    STATIC_MAX: number;
    PAGES_MAX: number;
    NAV_WAIT: number;
  };
  /** Dispatch a fetch event: the answer (or null when the worker let the browser handle it) and its waitUntil work. */
  const fire = async (r: Req) => {
    let answer: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    handlers.fetch({ request: r, respondWith: (p: Promise<Response>) => (answer = Promise.resolve(p)), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    const res = answer ? await answer : null;
    await Promise.all(waits);
    await new Promise((ok) => setTimeout(ok, 5));
    return res as Response | null;
  };
  const lifecycle = async (t: "install" | "activate") => {
    const waits: Promise<unknown>[] = [];
    handlers[t]({ waitUntil: (p: Promise<unknown>) => waits.push(p) });
    await Promise.all(waits);
  };
  return { api, fire, lifecycle, store, open, calls, skipped: () => skipped };
}

describe("perf B1: what the worker answers", () => {
  const { api } = worker(async () => html());
  const route = (r: Req) => api.routeOf(r, new URL(r.url), ORIGIN);
  test("build files and fonts: cache first", () => {
    expect(route(req("/_next/static/chunks/app/layout-abc.js"))).toBe("static");
    expect(route(req("/_next/static/media/inter-latin.woff2"))).toBe("static");
  });
  test("opening a studio page: the page strategy; anything else of the studio: the browser", () => {
    for (const p of ["/home", "/home?source=pwa", "/create", "/analytics/youtube", "/calendar", "/inbox", "/content", "/approvals", "/settings"]) expect(route(req(p, { mode: "navigate" }))).toBe("page");
    expect(route(req("/home", { mode: "cors", headers: { rsc: "1" } }))).toBeNull();
    expect(route(req("/homework", { mode: "navigate" }))).toBeNull();
  });
  test("never: the website, /api, /admin, other origins, writes, ranges, Authorization, only-if-cached", () => {
    expect(route(req("/", { mode: "navigate" }))).toBeNull();
    expect(route(req("/pricing", { mode: "navigate" }))).toBeNull();
    expect(route(req("/api/home/pulse"))).toBeNull();
    expect(route(req("/admin", { mode: "navigate" }))).toBeNull();
    expect(route(req("https://cdn.example.com/_next/static/x.js"))).toBeNull();
    expect(route(req("/home", { mode: "navigate", method: "POST" }))).toBeNull();
    expect(route(req("/_next/static/media/a.mp4", { headers: { range: "bytes=0-" } }))).toBeNull();
    expect(route(req("/_next/static/x.js", { headers: { authorization: "Bearer x" } }))).toBeNull();
    expect(route(req("/_next/static/x.js", { cache: "only-if-cached", mode: "no-cors" }))).toBeNull();
  });
  test("Billing, Help and invoice PDFs keep their offline copies", () => {
    expect(route(req("/billing", { mode: "navigate" }))).toBe("keep");
    expect(route(req("/help", { mode: "navigate" }))).toBe("keep");
    expect(route(req("/api/billing/invoices/inv_1"))).toBe("keep");
  });
  test("every studio section is covered, and the app-path list knows them all", () => {
    const studio = readdirSync("app/(studio)").filter((d) => statSync(`app/(studio)/${d}`).isDirectory());
    const routes = src("lib/client/routes.ts");
    for (const d of studio) {
      if (d !== "billing") expect(api.STUDIO.test(`/${d}`)).toBe(true);
      expect(routes).toContain(`"${d}"`);
    }
  });
});

describe("perf B1: build files", () => {
  test("first use goes to the network and is kept; the next one never touches it", async () => {
    const w = worker(async () => basic("js", { status: 200, headers: { "cache-control": "public, max-age=31536000, immutable" } }));
    const r = req("/_next/static/chunks/main-1.js");
    expect(await (await w.fire(r))!.text()).toBe("js");
    expect(await (await w.fire(r))!.text()).toBe("js");
    expect(w.calls).toEqual(["/_next/static/chunks/main-1.js"]);
  });
  test("an error or a no-store answer is never kept", async () => {
    let n = 0;
    const w = worker(async () => (n++ ? basic("x", { status: 200, headers: { "cache-control": "no-store" } }) : basic("gone", { status: 404 })));
    await w.fire(req("/_next/static/a.js"));
    await w.fire(req("/_next/static/a.js"));
    await w.fire(req("/_next/static/a.js"));
    expect(w.calls.length).toBe(3);
  });
  test("at most STATIC_MAX kept, the oldest go first", async () => {
    const w = worker(async () => basic("js", { status: 200 }));
    for (let i = 0; i < w.api.STATIC_MAX + 5; i++) await w.fire(req(`/_next/static/c${i}.js`));
    const kept = [...w.store.get(w.api.STATIC)!.keys()];
    expect(kept.length).toBe(w.api.STATIC_MAX);
    expect(kept[0]).toBe(`${ORIGIN}/_next/static/c5.js`);
  });
  test("a network failure still answers with a real response", async () => {
    const w = worker(async () => Promise.reject(new TypeError("offline")));
    const res = await w.fire(req("/_next/static/x.js"));
    expect(res).toBeInstanceOf(Response);
    expect(res!.status).toBe(504);
  });
});

describe("perf B1: studio pages", () => {
  test("online: the network answers and its copy is kept by path, without the query", async () => {
    const w = worker(async () => html("<p>fresh</p>"));
    const res = await w.fire(req("/home?source=pwa", { mode: "navigate" }));
    expect(await res!.text()).toBe("<p>fresh</p>");
    expect([...w.store.get(w.api.PAGES)!.keys()]).toEqual([`${ORIGIN}/home`]);
  });
  test("network down: that page's last copy, else the offline page, never an empty answer", async () => {
    let up = true;
    const w = worker(async () => (up ? html("<p>saved</p>") : Promise.reject(new TypeError("offline"))));
    await w.fire(req("/home", { mode: "navigate" }));
    up = false;
    expect(await (await w.fire(req("/home", { mode: "navigate" })))!.text()).toBe("<p>saved</p>");
    const none = await w.fire(req("/inbox", { mode: "navigate" }));
    expect(none).toBeInstanceOf(Response);
    expect(none!.status).toBe(503);
    expect(await none!.text()).toContain("You are offline.");
  });
  test("network late (past NAV_WAIT): the saved copy; with no copy the slow answer is still waited for", async () => {
    expect(worker(async () => html()).api.NAV_WAIT).toBe(2500);
    let slow = false;
    const w = worker((r) => (slow ? new Promise((ok) => setTimeout(() => ok(html(`<p>late ${new URL(r.url).pathname}</p>`)), 120)) : Promise.resolve(html("<p>saved</p>"))));
    await w.fire(req("/calendar", { mode: "navigate" }));
    slow = true;
    expect(await (await w.fire(req("/calendar", { mode: "navigate" })))!.text()).toBe("<p>saved</p>");
    expect(await (await w.fire(req("/content", { mode: "navigate" })))!.text()).toBe("<p>late /content</p>");
  });
  test("redirects (signed out, maintenance), errors and non-HTML are never kept", async () => {
    const answers = [html("<p>x</p>", { redirected: true }), html("<p>x</p>", { status: 500 }), basic("{}", { status: 200, headers: { "content-type": "application/json" } })];
    const w = worker(async () => answers.shift()!);
    for (const p of ["/home", "/inbox", "/create"]) await w.fire(req(p, { mode: "navigate" }));
    expect(w.store.get(w.api.PAGES)?.size ?? 0).toBe(0);
  });
  test("at most PAGES_MAX copies", async () => {
    const w = worker(async () => html());
    for (let i = 0; i < w.api.PAGES_MAX + 3; i++) await w.fire(req(`/analytics/p${i}`, { mode: "navigate" }));
    expect(w.store.get(w.api.PAGES)!.size).toBe(w.api.PAGES_MAX);
  });
  test("a session ending drops every page copy: /login, an expired session, a sign-out", async () => {
    for (const end of [req("/login", { mode: "navigate" }), req("/api/auth/expired"), req("/api/auth/logout", { method: "POST" }), req("/api/auth/logout-all", { method: "POST" })]) {
      const w = worker(async () => html());
      await w.fire(req("/home", { mode: "navigate" }));
      expect(w.store.get(w.api.PAGES)!.size).toBe(1);
      await w.fire(end);
      expect(w.store.has(w.api.PAGES)).toBe(false);
    }
  });
  test("the sign-out button clears the same cache name", () => {
    const { api } = worker(async () => html());
    expect(src("lib/client/forget-billing.ts")).toContain(`const SW_PAGES_CACHE = "${api.PAGES}";`);
    expect(src("lib/client/forget-billing.ts")).toContain("await caches.delete(SW_PAGES_CACHE);");
  });
});

describe("perf B1: install and update", () => {
  test("install precaches the offline page and the manifest and does not skip waiting (no reload loops)", async () => {
    const w = worker(async () => html());
    await w.lifecycle("install");
    expect([...w.store.get(w.api.CACHE)!.keys()]).toEqual([`${ORIGIN}/offline.html`, `${ORIGIN}/manifest.webmanifest`]);
    expect(w.skipped()).toBe(false);
    expect(code).not.toContain("skipWaiting(");
  });
  test("activate drops every cache of an older version and keeps the shared video", async () => {
    const w = worker(async () => html());
    for (const n of ["outly-offline-v4", "outly-static-v0", "outly-share", "outly-pages-v1", "outly-static-v1"]) await w.open(n);
    await w.lifecycle("activate");
    expect([...w.store.keys()].sort()).toEqual(["outly-pages-v1", "outly-share", "outly-static-v1"]);
    expect(w.api.CURRENT).toEqual(["outly-offline-v5", "outly-static-v1", "outly-pages-v1", "outly-share", "outly-assets-v1"]);
  });
  test("push, share target and the offline page are untouched", () => {
    for (const s of ['addEventListener("push"', 'addEventListener("notificationclick"', 'addEventListener("pushsubscriptionchange"', '"/share-target"', "takeShare(req)", "/offline.html"]) expect(code).toContain(s);
  });
});

describe("perf B1: registered from the head", () => {
  test("the head script registers after load, production only; Connectivity keeps a fallback", async () => {
    const s = src("lib/sw-script.ts");
    expect(s).toContain('navigator.serviceWorker.register("/sw.js")');
    expect(s).toContain('window.addEventListener("load",r,{once:true})');
    expect(s).toContain('process.env.NODE_ENV === "production"');
    const { swScript } = await import("../lib/sw-script");
    expect(swScript).toBe("");
    expect(src("components/shared/Connectivity.tsx")).toContain('navigator.serviceWorker.register("/sw.js")');
  });
});
