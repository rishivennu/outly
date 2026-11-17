import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { config, hostResponse, middleware } from "../middleware";
import { ADMIN_SUBDOMAIN, ALL_PATH_HOSTS, CANONICAL_ORIGIN, PUBLIC_DIRS, REDIRECT_HOSTS, STUDIO_PATHS, WEBHOOK_ROUTES, adminHost, canonicalBase, hostOf, routeHost } from "../lib/hosts";
import { assertSameOrigin } from "../lib/http";

const W = CANONICAL_ORIGIN;
const env = {};
const to = (host: string, path: string, search = "", e: Parameters<typeof routeHost>[3] = env) => {
  const r = routeHost(host, path, search, e);
  return r.kind === "redirect" ? r.to : r.kind;
};

describe("1185 canonical base and host parsing", () => {
  test("APP_URL counts only when it is an https outlly.com URL", () => {
    expect(canonicalBase(undefined)).toBe(W);
    expect(canonicalBase("https://www.outlly.com/")).toBe(W);
    expect(canonicalBase("https://outlly.com")).toBe("https://outlly.com");
    expect(canonicalBase("http://www.outlly.com")).toBe(W);
    expect(canonicalBase("http://localhost:3100")).toBe(W);
    expect(canonicalBase("https://evil.com")).toBe(W);
    expect(canonicalBase("https://outlly.com.evil.com")).toBe(W);
    expect(canonicalBase("https://evil-outlly.com")).toBe(W);
    expect(canonicalBase("not a url")).toBe(W);
  });
  test("hostOf drops port, case and trailing dot", () => {
    expect(hostOf("APP.Outlly.com:443")).toBe("app.outlly.com");
    expect(hostOf("app.outlly.com.")).toBe("app.outlly.com");
    expect(hostOf(null)).toBe("");
  });
});

describe("1185 redirect hosts", () => {
  test("every host lands on its module page at the root", () => {
    const want: Record<string, string> = {
      "app.outlly.com": "/home", "dashboard.outlly.com": "/home", "studio.outlly.com": "/create", "publish.outlly.com": "/content",
      "scheduler.outlly.com": "/calendar", "analytics.outlly.com": "/analytics", "integrations.outlly.com": "/accounts",
      "auth.outlly.com": "/login", "help.outlly.com": "/help", "docs.outlly.com": "/help", "status.outlly.com": "/status",
      "blog.outlly.com": "/blog", "pricing.outlly.com": "/#pricing",
    };
    expect(Object.keys(REDIRECT_HOSTS).sort()).toEqual(Object.keys(want).sort());
    for (const [h, p] of Object.entries(want)) expect(to(h, "/")).toBe(W + p);
  });
  test("every landing and kept page really exists in app/", () => {
    const pages = new Set<string>();
    (function walk(dir: string, url: string) {
      for (const e of readdirSync(dir)) {
        const full = join(dir, e);
        if (!statSync(full).isDirectory()) {
          if (e === "page.tsx") pages.add(url || "/");
          continue;
        }
        if (e === "api" || e.startsWith("_")) continue;
        walk(full, e.startsWith("(") ? url : `${url}/${e}`);
      }
    })("app", "");
    for (const m of Object.values(REDIRECT_HOSTS)) {
      expect(pages.has(m.landing.split("#")[0] || "/")).toBe(true);
      for (const k of m.keep) if (!["/share-target", "/app-share"].includes(k)) expect(pages.has(k)).toBe(true);
    }
  });
  test("the studio list is the one the middleware sign-in wall uses", () => {
    const src = readFileSync("middleware.ts", "utf8");
    expect(src).toContain(`const STUDIO = ${JSON.stringify(STUDIO_PATHS).replace(/","/g, '", "')};`);
  });
  test("studio paths are kept on app and dashboard, sign-in pages too", () => {
    for (const h of ["app.outlly.com", "dashboard.outlly.com"]) {
      for (const p of [...STUDIO_PATHS, "/create/bulk", "/settings/notifications", "/analytics/instagram", "/login", "/signup"]) expect(to(h, p)).toBe(W + p);
      expect(to(h, "/pricing")).toBe(W + "/home");
      expect(to(h, "/homework")).toBe(W + "/home");
    }
  });
  test("a path outside the module goes to the module landing", () => {
    expect(to("studio.outlly.com", "/create/bulk")).toBe(W + "/create/bulk");
    expect(to("studio.outlly.com", "/calendar")).toBe(W + "/create");
    expect(to("publish.outlly.com", "/approvals")).toBe(W + "/approvals");
    expect(to("scheduler.outlly.com", "/x")).toBe(W + "/calendar");
    expect(to("analytics.outlly.com", "/analytics/youtube")).toBe(W + "/analytics/youtube");
    expect(to("integrations.outlly.com", "/billing")).toBe(W + "/accounts");
    expect(to("auth.outlly.com", "/signup")).toBe(W + "/signup");
    expect(to("auth.outlly.com", "/home")).toBe(W + "/login");
    expect(to("docs.outlly.com", "/anything")).toBe(W + "/help");
  });
  test("blog keeps its paths and moves bare slugs under /blog", () => {
    expect(to("blog.outlly.com", "/my-post")).toBe(W + "/blog/my-post");
    expect(to("blog.outlly.com", "/blog/my-post")).toBe(W + "/blog/my-post");
    expect(to("blog.outlly.com", "/category/growth")).toBe(W + "/blog/category/growth");
  });
  test("the query string is kept, before the hash", () => {
    expect(to("app.outlly.com", "/create", "?draft=1&source=twa")).toBe(W + "/create?draft=1&source=twa");
    expect(to("app.outlly.com", "/", "?utm_source=x")).toBe(W + "/home?utm_source=x");
    expect(to("pricing.outlly.com", "/", "?ref=abc")).toBe(W + "/?ref=abc#pricing");
    expect(to("pricing.outlly.com", "/x", "?")).toBe(W + "/#pricing");
  });
  test("targets come from the canonical base, never the Host", () => {
    expect(to("app.outlly.com", "/home", "", { APP_URL: "https://evil.com" })).toBe(W + "/home");
    expect(to("app.outlly.com", "/home", "", { APP_URL: "https://outlly.com" })).toBe("https://outlly.com/home");
    // A path that looks protocol-relative stays a path on the canonical origin.
    expect(to("admin.outlly.com", "//evil.com/x")).toBe(W + "//evil.com/x");
    expect(to("blog.outlly.com", "//evil.com")).toBe(W + "/blog//evil.com");
    for (const h of Object.keys(REDIRECT_HOSTS)) expect(new URL(to(h, "//evil.com/a")).host).toBe("www.outlly.com");
  });
});

describe("1185 passthrough", () => {
  test("www, apex, previews, localhost and look-alikes are unchanged", () => {
    for (const h of ["www.outlly.com", "outlly.com", "localhost", "outly-next15.vercel.app", "evil.com", "app.outlly.com.evil.com", "email.outlly.com", "send.outlly.com", ""]) {
      for (const p of ["/", "/home", "/admin", "/api/x"]) expect(routeHost(h, p, "", env).kind).toBe("pass");
    }
  });
});

describe("1185 admin host", () => {
  test("root goes to /admin on the admin host, admin pages are served there", () => {
    expect(to(ADMIN_SUBDOMAIN, "/", "?a=1")).toBe("https://admin.outlly.com/admin?a=1");
    expect(to(ADMIN_SUBDOMAIN, "/admin")).toBe("serve");
    expect(to(ADMIN_SUBDOMAIN, "/admin/login")).toBe("serve");
    expect(to(ADMIN_SUBDOMAIN, "/admin/tickets/1")).toBe("serve");
  });
  test("any other page goes to the same path on www", () => {
    expect(to(ADMIN_SUBDOMAIN, "/home", "?x=1")).toBe(W + "/home?x=1");
    expect(to(ADMIN_SUBDOMAIN, "/administrator")).toBe(W + "/administrator");
  });
  test("ADMIN_HOST off: www admin stays on www; on: www admin goes to the admin host", () => {
    expect(adminHost({})).toBeNull();
    expect(routeHost("www.outlly.com", "/admin/users", "", {}).kind).toBe("pass");
    const on = { ADMIN_HOST: "admin.outlly.com" };
    expect(to("www.outlly.com", "/admin/users", "?p=2", on)).toBe("https://admin.outlly.com/admin/users?p=2");
    expect(to("outlly.com", "/admin", "", on)).toBe("https://admin.outlly.com/admin");
    expect(routeHost("www.outlly.com", "/administrator", "", on).kind).toBe("pass");
    expect(routeHost("www.outlly.com", "/home", "", on).kind).toBe("pass");
    // Previews and localhost never bounce to production admin.
    expect(routeHost("localhost", "/admin", "", on).kind).toBe("pass");
    expect(routeHost("x.vercel.app", "/admin", "", on).kind).toBe("pass");
    expect(to(ADMIN_SUBDOMAIN, "/admin", "", on)).toBe("serve");
  });
  test("ADMIN_HOST pointing anywhere else is ignored", () => {
    for (const h of ["evil.com", "www.outlly.com", "app.outlly.com", "admin.outlly.com.evil.com"]) {
      expect(adminHost({ ADMIN_HOST: h })).toBeNull();
      expect(routeHost("www.outlly.com", "/admin", "", { ADMIN_HOST: h }).kind).toBe("pass");
    }
    expect(adminHost({ ADMIN_HOST: "Admin.Outlly.com" })).toBe(ADMIN_SUBDOMAIN);
  });
  test("CSRF: a POST from the admin host to the admin host passes, another origin does not", () => {
    const post = (origin: string) =>
      new NextRequest("https://admin.outlly.com/api/admin/users", { method: "POST", headers: { host: "admin.outlly.com", origin } });
    expect(() => assertSameOrigin(post("https://admin.outlly.com"))).not.toThrow();
    expect(() => assertSameOrigin(post("https://evil.com"))).toThrow();
    expect(() => assertSameOrigin(post("https://app.outlly.com"))).toThrow();
  });
});

describe("1185 api and webhooks", () => {
  test("api host: /x is /api/x, /api/x stays, root is a small JSON", () => {
    expect(routeHost("api.outlly.com", "/posts", "", env)).toEqual({ kind: "rewrite", path: "/api/posts" });
    expect(routeHost("api.outlly.com", "/v1/me", "", env)).toEqual({ kind: "rewrite", path: "/api/v1/me" });
    expect(routeHost("api.outlly.com", "/api/posts", "", env).kind).toBe("next");
    expect(routeHost("api.outlly.com", "/api", "", env).kind).toBe("next");
    expect(routeHost("api.outlly.com", "/apix", "", env)).toEqual({ kind: "rewrite", path: "/api/apix" });
    expect(routeHost("api.outlly.com", "/", "", env)).toEqual({ kind: "json", body: { service: "outlly-api", docs: "https://www.outlly.com/help" } });
  });
  test("webhooks host: short names rewrite to real routes, real routes stay, unknown is 404", () => {
    for (const [k, v] of Object.entries(WEBHOOK_ROUTES)) {
      expect(existsSync(join("app", v, "route.ts"))).toBe(true);
      expect(routeHost("webhooks.outlly.com", k, "", env)).toEqual({ kind: "rewrite", path: v });
      expect(routeHost("webhooks.outlly.com", k + "/", "", env)).toEqual({ kind: "rewrite", path: v });
      expect(routeHost("webhooks.outlly.com", v, "", env).kind).toBe("next");
    }
    for (const p of ["/", "/home", "/api/posts", "/api/webhooks", "/meta/x", "/admin"]) expect(routeHost("webhooks.outlly.com", p, "", env).kind).toBe("notFound");
  });
});

describe("1185 static hosts", () => {
  test("files and build assets are served, pages and APIs are 404", () => {
    for (const h of ["media.outlly.com", "cdn.outlly.com"]) {
      for (const p of ["/_next/static/chunks/a.js", "/_next/static/media/f.woff2", "/brand/avatar-512.png", "/brand/icons/x.svg", "/audio/a.mp3", "/sw.js", "/offline.html"]) expect(routeHost(h, p, "", env).kind).toBe("next");
      for (const p of ["/", "/home", "/admin", "/api/files/abc", "/api/files/a.png", "/review/tok.png", "/blog/post", "/_next/image", "/brand/../api/x.png", "/opengraph-image"]) expect(routeHost(h, p, "", env).kind).toBe("notFound");
    }
  });
  test("PUBLIC_DIRS matches the public folder (.well-known stays a www-only answer: app links, TWA)", () => {
    const dirs = readdirSync("public").filter((e) => !e.startsWith(".") && statSync(join("public", e)).isDirectory()).sort();
    expect(routeHost("cdn.outlly.com", "/.well-known/assetlinks.json", "", env).kind).toBe("notFound");
    expect([...PUBLIC_DIRS].sort()).toEqual(dirs);
  });
});

describe("1185 middleware matcher", () => {
  const m = config.matcher[1] as { source: string; has: { type: string; value: string }[] };
  test("the page matcher stays first and unchanged in shape", () => {
    expect(typeof config.matcher[0]).toBe("string");
    expect(new RegExp("^" + config.matcher[0] + "$").test("/api/x")).toBe(false);
  });
  test("api, webhooks and static hosts run the middleware on every path, nothing else does", () => {
    expect(m.source).toBe("/:path*");
    const re = new RegExp("^" + m.has[0].value + "$");
    expect(m.has[0].type).toBe("host");
    for (const h of ALL_PATH_HOSTS) expect(re.test(h)).toBe(true);
    for (const h of ["www.outlly.com", "outlly.com", "admin.outlly.com", "app.outlly.com", "apixoutlly.com", "api.outlly.com.evil.com"]) expect(re.test(h)).toBe(false);
  });
});

describe("1185 middleware", () => {
  const realFetch = globalThis.fetch;
  const hadAdminHost = process.env.ADMIN_HOST;
  beforeAll(() => {
    globalThis.fetch = (async (u: string | URL | Request) => {
      if (String(u instanceof Request ? u.url : u).includes("/api/maintenance")) return Response.json({ maintenance: false, waitlist: false, hide: [] });
      return realFetch(u as Request);
    }) as typeof fetch;
  });
  afterEach(() => {
    if (hadAdminHost === undefined) delete process.env.ADMIN_HOST;
    else process.env.ADMIN_HOST = hadAdminHost;
  });
  afterAll(() => {
    globalThis.fetch = realFetch;
  });
  const call = (url: string, init?: ConstructorParameters<typeof NextRequest>[1]) => middleware(new NextRequest(url, init));

  test("redirect hosts answer 307 to www, query kept", async () => {
    const r = await call("https://app.outlly.com/create?draft=1");
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe(W + "/create?draft=1");
    const b = await call("https://blog.outlly.com/hello");
    expect(b.headers.get("location")).toBe(W + "/blog/hello");
  });
  test("a forged Host header can't pick the target", async () => {
    const r = await call("https://app.outlly.com/home", { headers: { host: "app.outlly.com" } });
    expect(r.headers.get("location")).toBe(W + "/home");
    expect(hostResponse(new NextRequest("https://evil.com/home", { headers: { host: "evil.com" } }))).toBeNull();
  });
  test("admin host: root to /admin, admin pages through the normal pipeline, other pages to www", async () => {
    const root = await call("https://admin.outlly.com/");
    expect(root.status).toBe(307);
    expect(root.headers.get("location")).toBe("https://admin.outlly.com/admin");
    const signedOut = await call("https://admin.outlly.com/admin/users");
    expect(signedOut.status).toBe(307);
    expect(signedOut.headers.get("location")).toBe("https://admin.outlly.com/admin/login?next=%2Fadmin%2Fusers");
    expect(signedOut.headers.get("content-security-policy")).toContain("nonce-");
    const login = await call("https://admin.outlly.com/admin/login");
    expect(login.status).toBe(200);
    expect(login.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(login.headers.get("content-security-policy")).toContain("nonce-");
    const other = await call("https://admin.outlly.com/pricing");
    expect(other.headers.get("location")).toBe(W + "/pricing");
  });
  test("ADMIN_HOST set: www admin pages move to the admin host; unset: they stay", async () => {
    delete process.env.ADMIN_HOST;
    expect((await call("https://www.outlly.com/admin/login")).status).toBe(200);
    process.env.ADMIN_HOST = "admin.outlly.com";
    const r = await call("https://www.outlly.com/admin/users?p=1");
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://admin.outlly.com/admin/users?p=1");
  });
  test("api host rewrites to /api and is noindex, with no studio cookies", async () => {
    const r = await call("https://api.outlly.com/posts?x=1");
    expect(r.headers.get("x-middleware-rewrite")).toBe("https://api.outlly.com/api/posts?x=1");
    expect(r.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect(r.headers.get("set-cookie")).toBeNull();
    const root = await call("https://api.outlly.com/");
    expect(await root.json()).toEqual({ service: "outlly-api", docs: "https://www.outlly.com/help" });
  });
  test("webhooks host rewrites POSTs in place, never redirects", async () => {
    const r = await call("https://webhooks.outlly.com/razorpay", { method: "POST", body: "{}" });
    expect(r.status).toBe(200);
    expect(r.headers.get("location")).toBeNull();
    expect(r.headers.get("x-middleware-rewrite")).toBe("https://webhooks.outlly.com/api/billing/webhooks/razorpay");
    expect((await call("https://webhooks.outlly.com/nope", { method: "POST", body: "{}" })).status).toBe(404);
  });
  test("static hosts: files pass, pages and private media are 404", async () => {
    const f = await call("https://cdn.outlly.com/brand/avatar-512.png");
    expect(f.headers.get("x-middleware-next")).toBe("1");
    expect(f.headers.get("x-robots-tag")).toBe("noindex, nofollow");
    expect((await call("https://media.outlly.com/home")).status).toBe(404);
    expect((await call("https://media.outlly.com/api/files/abc")).status).toBe(404);
  });
  test("www is unchanged", async () => {
    const r = await call("https://www.outlly.com/home");
    expect(r.status).toBe(307);
    expect(r.headers.get("location")).toBe("https://www.outlly.com/login?next=%2Fhome");
  });
});
