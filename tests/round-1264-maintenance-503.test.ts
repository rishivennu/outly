import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { SignJWT } from "jose";
import { __resetFlags, middleware } from "../middleware";
import { retryAfterSeconds, wantsHtml, wrapHeaders } from "../lib/maintenance/respond";

// R1264: maintenance mode answers strangers with 503 + Retry-After, so search engines never index the maintenance copy.

describe("wantsHtml", () => {
  test("browser navigations and bare clients get the page", () => {
    expect(wantsHtml("GET", "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8")).toBe(true);
    expect(wantsHtml("GET", "text/html,application/xhtml+xml")).toBe(true);
    expect(wantsHtml("GET", "TEXT/HTML")).toBe(true);
    expect(wantsHtml("GET", "*/*")).toBe(true);
    expect(wantsHtml("HEAD", "*/*")).toBe(true);
    expect(wantsHtml("GET", null)).toBe(true);
    expect(wantsHtml("GET", undefined)).toBe(true);
    expect(wantsHtml("GET", "")).toBe(true);
    expect(wantsHtml("GET", "   ")).toBe(true);
  });
  test("API-ish fetches and non-GET methods do not", () => {
    expect(wantsHtml("GET", "application/json")).toBe(false);
    expect(wantsHtml("GET", "text/x-component")).toBe(false);
    expect(wantsHtml("POST", "text/html")).toBe(false);
    expect(wantsHtml("PUT", "")).toBe(false);
  });
});

describe("retryAfterSeconds", () => {
  const now = Date.parse("2026-11-20T10:00:00Z");
  const at = (s: number) => new Date(now + s * 1000).toISOString();
  test("missing, invalid or past: 300", () => {
    expect(retryAfterSeconds(undefined, now)).toBe(300);
    expect(retryAfterSeconds(null, now)).toBe(300);
    expect(retryAfterSeconds("", now)).toBe(300);
    expect(retryAfterSeconds("not a date", now)).toBe(300);
    expect(retryAfterSeconds(at(-10), now)).toBe(300);
    expect(retryAfterSeconds(at(0), now)).toBe(300);
  });
  test("clamped to [60, 3600]", () => {
    expect(retryAfterSeconds(at(5), now)).toBe(60);
    expect(retryAfterSeconds(at(60), now)).toBe(60);
    expect(retryAfterSeconds(at(900), now)).toBe(900);
    expect(retryAfterSeconds(at(3600), now)).toBe(3600);
    expect(retryAfterSeconds(at(86_400), now)).toBe(3600);
  });
  test("whole seconds, rounded up", () => {
    expect(retryAfterSeconds(new Date(now + 120_400).toISOString(), now)).toBe(121);
  });
  test("defaults to the real clock", () => {
    expect(retryAfterSeconds(new Date(Date.now() + 600_000).toISOString())).toBeGreaterThanOrEqual(599);
  });
});

describe("wrapHeaders", () => {
  test("drops framing, hop-by-hop and cookies; keeps the rest; sets retry-after and no-store", () => {
    const inner = new Headers({
      "content-type": "text/html; charset=utf-8",
      "content-encoding": "gzip",
      "content-length": "1234",
      "transfer-encoding": "chunked",
      connection: "keep-alive",
      "keep-alive": "timeout=5",
      "cache-control": "private, no-cache",
      "content-security-policy": "script-src 'nonce-abc'",
      "x-robots-tag": "noindex, nofollow",
    });
    inner.append("set-cookie", "oly_did=1; Path=/");
    inner.append("set-cookie", "outlly_wl=1; Path=/");
    const out = wrapHeaders(inner, 120);
    expect(out.get("content-type")).toBe("text/html; charset=utf-8");
    expect(out.get("content-security-policy")).toBe("script-src 'nonce-abc'");
    expect(out.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(out.get("retry-after")).toBe("120");
    expect(out.get("cache-control")).toBe("no-store");
    for (const h of ["content-encoding", "content-length", "transfer-encoding", "connection", "keep-alive", "set-cookie"]) expect(out.has(h)).toBe(false);
    expect(out.getSetCookie()).toEqual([]);
    expect(inner.get("content-length")).toBe("1234"); // the inner headers are not mutated
  });
});

describe("middleware: maintenance on", () => {
  const realFetch = globalThis.fetch;
  const HTML = "<!doctype html><html><body><h1>Back soon</h1></body></html>";
  const endsAt = () => new Date(Date.now() + 900_000).toISOString();
  let pageFetches = 0;
  let pageMode: "ok" | "throw" | "500" | "redirect" = "ok";
  let seenHeaders: Headers | null = null;

  beforeEach(() => {
    __resetFlags();
    pageFetches = 0;
    pageMode = "ok";
    seenHeaders = null;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const u = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
      if (u.pathname === "/api/maintenance") {
        return new Response(JSON.stringify({ maintenance: true, waitlist: false, hide: [], endsAt: endsAt() }), { headers: { "content-type": "application/json" } });
      }
      if (u.pathname === "/maintenance") {
        pageFetches++;
        seenHeaders = new Headers(init?.headers);
        if (pageMode === "throw") throw new Error("network down");
        if (pageMode === "500") return new Response("boom", { status: 500, headers: { "content-type": "text/html" } });
        if (pageMode === "redirect") return new Response(null, { status: 307, headers: { location: "/" } });
        const h = new Headers({ "content-type": "text/html; charset=utf-8", "content-security-policy": "script-src 'nonce-inner'" });
        h.append("set-cookie", "oly_did=inner-device; Path=/");
        return new Response(HTML, { headers: h });
      }
      return new Response("unexpected", { status: 599 });
    }) as unknown as typeof fetch;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
    __resetFlags();
  });

  const req = (path: string, headers: Record<string, string> = {}, method = "GET") =>
    new NextRequest(new URL(path, "http://localhost:3100"), { method, headers });

  test("a stranger's page view: 503, Retry-After from endsAt, the page body, no inner cookies", async () => {
    const res = await middleware(req("/changelog-x", { accept: "text/html,application/xhtml+xml", "accept-language": "en-IN", "user-agent": "Googlebot", cookie: "secret=1" }));
    expect(res.status).toBe(503);
    const ra = Number(res.headers.get("retry-after"));
    expect(ra).toBeGreaterThanOrEqual(890);
    expect(ra).toBeLessThanOrEqual(900);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(await res.text()).toBe(HTML);
    // The page keeps the policy whose nonce its HTML carries.
    expect(res.headers.get("content-security-policy")).toBe("script-src 'nonce-inner'");
    expect(res.headers.getSetCookie().some((c) => c.includes("inner-device"))).toBe(false);
    // Only accept-language and user-agent go to the inner fetch (never the visitor's cookies).
    expect(seenHeaders?.get("accept-language")).toBe("en-IN");
    expect(seenHeaders?.get("user-agent")).toBe("Googlebot");
    expect(seenHeaders?.has("cookie")).toBe(false);
  });

  test("the page is fetched once per 30 s on an instance", async () => {
    const a = await middleware(req("/"));
    const b = await middleware(req("/help-x"));
    expect(a.status).toBe(503);
    expect(b.status).toBe(503);
    expect(await b.text()).toBe(HTML);
    expect(pageFetches).toBe(1);
  });

  test("HEAD: 503 with no body", async () => {
    const res = await middleware(req("/", { accept: "*/*" }, "HEAD"));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(await res.text()).toBe("");
  });

  for (const mode of ["throw", "500", "redirect"] as const) {
    test(`page fetch ${mode}: falls back to the plain rewrite`, async () => {
      pageMode = mode;
      const res = await middleware(req("/", { accept: "text/html" }));
      expect(res.status).toBe(200);
      expect(res.headers.get("x-middleware-rewrite") ?? "").toContain("/maintenance");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  }

  test("a JSON fetch from a stranger: 503 JSON with Retry-After", async () => {
    const res = await middleware(req("/", { accept: "application/json" }));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).not.toBeNull();
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(await res.json()).toEqual({ error: "maintenance" });
    expect(pageFetches).toBe(0);
  });

  test("maintenance-open paths are untouched", async () => {
    const res = await middleware(req("/login", { accept: "text/html" }));
    expect(res.status).toBe(200);
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(pageFetches).toBe(0);
  });

  test("a signed-in member is untouched", async () => {
    const token = await new SignJWT({ sub: "u1" })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET ?? ""));
    const res = await middleware(req("/home", { accept: "text/html", cookie: `studio_session=${token}` }));
    expect(res.status).toBe(200);
    expect(res.headers.get("retry-after")).toBeNull();
    expect(res.headers.get("x-middleware-rewrite")).toBeNull();
    expect(pageFetches).toBe(0);
    const m = await middleware(req("/maintenance", { accept: "text/html", cookie: `studio_session=${token}` }));
    expect(m.status).toBe(307);
    expect(m.headers.get("location")).toContain("/home");
  });
});
