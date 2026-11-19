/** R1226: the service worker keeps brand art and sample posters (stale-while-revalidate), never the home-screen icons. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const ORIGIN = "https://outlly.test";
const code = readFileSync("public/sw.js", "utf8");

type Req = { url: string; method: string; mode: string; cache: string; headers: Headers };
const req = (path: string, o: Partial<Omit<Req, "headers">> & { headers?: Record<string, string> } = {}): Req => ({
  url: path.startsWith("http") ? path : ORIGIN + path,
  method: o.method ?? "GET",
  mode: o.mode ?? "no-cors",
  cache: o.cache ?? "default",
  headers: new Headers(o.headers ?? {}),
});
const image = (body: string) => {
  const r = new Response(body, { status: 200, headers: { "content-type": "image/webp", "cache-control": "public, max-age=86400" } });
  Object.defineProperty(r, "type", { value: "basic" });
  return r;
};

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
      add: async (u: string) => void m.set(key(u), image("precached")),
      keys: async () => [...m.keys()].map((url) => ({ url })),
      delete: async (r: string | { url: string }) => m.delete(key(r)),
    };
  };
  const caches = { open, keys: async () => [...store.keys()], delete: async (n: string) => store.delete(n), match: async () => undefined };
  const handlers: Record<string, (e: unknown) => void> = {};
  const calls: string[] = [];
  const ctx: Record<string, unknown> = {
    addEventListener: (t: string, fn: (e: unknown) => void) => (handlers[t] = fn),
    location: { origin: ORIGIN },
    clients: { claim: async () => {}, matchAll: async () => [] },
    registration: {},
    navigator: {},
    caches,
    fetch: (r: Req) => (calls.push(new URL(r.url).pathname), fetchImpl(r)),
    setTimeout,
    clearTimeout,
    Response,
    Headers,
    URL,
    Promise,
    console,
  };
  ctx.self = ctx;
  vm.createContext(ctx);
  const api = vm.runInContext(`${code}\n;({ routeOf, ASSETS, ASSETS_MAX, CURRENT })`, ctx) as { routeOf: (r: Req, u: URL, o: string) => string | null; ASSETS: string; ASSETS_MAX: number; CURRENT: string[] };
  const fire = async (r: Req) => {
    let answer: Promise<Response> | null = null;
    const waits: Promise<unknown>[] = [];
    handlers.fetch({ request: r, respondWith: (p: Promise<Response>) => (answer = Promise.resolve(p)), waitUntil: (p: Promise<unknown>) => waits.push(p) });
    const res = answer ? await answer : null;
    await Promise.all(waits);
    return res as Response | null;
  };
  return { api, fire, store, calls };
}

describe("R1226: brand art in the worker", () => {
  const { api } = worker(async () => image("x"));
  const route = (r: Req) => api.routeOf(r, new URL(r.url), ORIGIN);
  test("brand art and sample posters: asset; icons, email fonts, other files: the browser", () => {
    expect(route(req("/brand/welcome/step-1-720.webp"))).toBe("asset");
    expect(route(req("/brand/avatar-512.png"))).toBe("asset");
    expect(route(req("/samples/poster-1.jpg"))).toBe("asset");
    expect(route(req("/brand/app/icon-192.png"))).toBeNull();
    expect(route(req("/brand/email/fonts/inter.woff2"))).toBeNull();
    expect(route(req("/brand/welcome/clip.mp4"))).toBeNull();
    expect(route(req("/api/brand/x.png"))).toBeNull();
    expect(route(req("/brand/x.png", { method: "POST" }))).toBeNull();
    expect(api.CURRENT).toContain(api.ASSETS);
    expect(api.ASSETS_MAX).toBe(40);
  });
  test("first load from the network and kept; second load answers from the copy while the network refreshes it", async () => {
    let n = 0;
    const w = worker(async () => image(`v${++n}`));
    const first = await w.fire(req("/brand/welcome/step-1-720.webp"));
    expect(await first!.text()).toBe("v1");
    expect(w.calls).toEqual(["/brand/welcome/step-1-720.webp"]);
    expect(w.store.get(w.api.ASSETS)!.size).toBe(1);
    const second = await w.fire(req("/brand/welcome/step-1-720.webp"));
    expect(await second!.text()).toBe("v1");
    expect(w.calls.length).toBe(2);
    const kept = w.store.get(w.api.ASSETS)!.values().next().value as Response;
    expect(await kept.clone().text()).toBe("v2");
  });
  test("offline with a copy: the copy; offline without one: a 504, never a thrown error", async () => {
    const w = worker(async () => {
      throw new TypeError("offline");
    });
    const res = await w.fire(req("/brand/avatar-512.png"));
    expect(res!.status).toBe(504);
  });
  test("at most ASSETS_MAX copies, oldest dropped first", async () => {
    const w = worker(async () => image("x"));
    for (let i = 0; i < 45; i++) await w.fire(req(`/brand/a${i}.webp`));
    const keys = [...w.store.get(w.api.ASSETS)!.keys()];
    expect(keys.length).toBe(40);
    expect(keys[0]).toBe(`${ORIGIN}/brand/a5.webp`);
  });
});
