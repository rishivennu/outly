import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { NextRequest } from "next/server";
import { config, middleware, noIndex } from "../middleware";
import robots from "../app/robots";

// 1143: Search Console said "Indexed, though blocked by robots.txt" for /home. A robots.txt block keeps Google from
// reading the page, not from indexing its URL. The fix: let Google crawl the private pages and answer noindex.
const realFetch = globalThis.fetch;
const realNow = Date.now;
const hadAppUrl = process.env.APP_URL;
let waitlist = true;
let skew = 0;

async function hit(path: string, on: boolean) {
  waitlist = on;
  skew += 60_000;
  Date.now = () => realNow() + skew;
  const res = await middleware(new NextRequest(new URL(path, "http://localhost:3100")));
  return { status: res.status, robots: res.headers.get("x-robots-tag") };
}

beforeAll(() => {
  if (!process.env.APP_URL) process.env.APP_URL = "http://localhost:3100";
  globalThis.fetch = (async (u: string | URL | Request) => {
    if (String(u instanceof Request ? u.url : u).includes("/api/maintenance")) return new Response(JSON.stringify({ maintenance: false, waitlist, hide: [] }), { headers: { "content-type": "application/json" } });
    return realFetch(u as Request);
  }) as typeof fetch;
});
afterAll(async () => {
  await hit("/", false);
  Date.now = realNow;
  globalThis.fetch = realFetch;
  if (hadAppUrl === undefined) delete process.env.APP_URL;
});

describe("1143 indexing", () => {
  test("robots.txt blocks only the API, so Google can read the noindex on app pages", () => {
    const rules = [robots().rules].flat();
    expect(rules[0].disallow).toEqual(["/api/"]);
    expect(String(rules[0].disallow)).not.toContain("/home");
  });

  test("public pages stay indexable", () => {
    for (const p of ["/", "/privacy", "/terms", "/help", "/contact", "/waitlist"]) expect(noIndex(p)).toBe(false);
    // prefixes match whole segments only
    expect(noIndex("/homework")).toBe(false);
    expect(noIndex("/register")).toBe(false);
  });

  test("app, sign-in, admin and link-credential pages are noindex", () => {
    for (const p of ["/home", "/create", "/billing/checkout", "/login", "/signup", "/admin", "/admin/login", "/review/abc", "/r/xyz", "/team/accept", "/unsubscribe", "/app-auth"]) expect(noIndex(p)).toBe(true);
  });

  test("the noindex header rides on redirects too, waitlist on or off", async () => {
    for (const on of [true, false]) {
      const home = await hit("/home", on);
      expect(home.status).toBe(307);
      expect(home.robots).toBe("noindex, nofollow");
      expect((await hit("/signup", on)).robots).toBe("noindex, nofollow");
      expect((await hit("/login", on)).robots).toBe("noindex, nofollow");
    }
    expect((await hit("/admin", false)).robots).toBe("noindex, nofollow");
  });

  test("the landing page and the public pages never get the header", async () => {
    for (const p of ["/", "/help", "/contact", "/privacy", "/waitlist"]) expect((await hit(p, true)).robots).toBeNull();
  });

  test("share images (no file extension) skip the middleware, so waitlist mode can't redirect them", () => {
    const m = new RegExp("^" + config.matcher[0] + "$");
    expect(m.test("/opengraph-image-pwu6ef")).toBe(false);
    expect(m.test("/twitter-image")).toBe(false);
    for (const p of ["/", "/home", "/login", "/waitlist", "/help"]) expect(m.test(p)).toBe(true);
  });
});
