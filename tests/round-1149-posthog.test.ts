/**
 * 1149 PostHog: track() stays silent without a key, consent or a loaded client; the HogQL is fixed and range-safe;
 * Admin > Analytics is admin-only and never hands the personal key to the browser.
 */
import { afterEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

type Role = "super" | "support" | "marketing";
let admin: { id: string; name: string; login: string; role: Role } | null = null;
const realAuth = await import("../lib/admin/auth");
mock.module("../lib/admin/auth", () => ({ ...realAuth, getAdmin: async () => admin }));

const t = await import("../lib/analytics/track");
const q = await import("../lib/analytics/posthog-query");
const rep = await import("../lib/analytics/posthog-report");
const srv = await import("../lib/analytics/server");
const route = await import("../app/api/admin/analytics/route");

const fakeClient = () => {
  const calls: [string, unknown][] = [];
  const c = { capture: (n: string, p: unknown) => void calls.push([n, p]) } as unknown as import("../lib/analytics/track").AnalyticsClient;
  return { c, calls };
};
const consent = (analytics: boolean) => JSON.stringify({ v: 1, necessary: true, analytics, marketing: false, at: "2026-11-14T00:00:00Z" });

afterEach(() => t.detachAnalytics());

describe("track()", () => {
  test("is a no-op with no client and nothing loading", () => {
    expect(() => t.track("signup_completed", { method: "email" })).not.toThrow();
    const { c, calls } = fakeClient();
    t.attachAnalytics(c);
    expect(calls).toEqual([]); // nothing was held back from before
  });

  test("only allowed with a key, analytics consent, no DNT and off /admin", () => {
    const ok = { key: "phc_x", consent: true, dnt: false, path: "/" };
    expect(t.analyticsAllowed(ok)).toBe(true);
    expect(t.analyticsAllowed({ ...ok, key: "" })).toBe(false);
    expect(t.analyticsAllowed({ ...ok, consent: false })).toBe(false);
    expect(t.analyticsAllowed({ ...ok, dnt: true })).toBe(false);
    expect(t.analyticsAllowed({ ...ok, path: "/admin/analytics" })).toBe(false);
    expect(t.analyticsAllowed({ ...ok, path: "/administer" })).toBe(true);
  });

  test("consent is read from the banner's stored choice", () => {
    expect(t.analyticsConsent(consent(true))).toBe(true);
    expect(t.analyticsConsent(consent(false))).toBe(false);
    expect(t.analyticsConsent(null)).toBe(false);
    expect(t.analyticsConsent("{not json")).toBe(false);
    expect(t.analyticsConsent(JSON.stringify({ v: 2, analytics: true }))).toBe(false);
  });

  test("holds events while loading, then sends them; strips contact details", () => {
    t.analyticsLoading();
    t.track("post_scheduled", { kind: "video", email: "a@b.c", phone: "123", plan: undefined });
    const { c, calls } = fakeClient();
    t.attachAnalytics(c);
    t.track("post_published", { kind: "format" });
    expect(calls).toEqual([
      ["post_scheduled", { kind: "video" }],
      ["post_published", { kind: "format" }],
    ]);
  });

  test("whenAnalyticsReady fires once a client attaches", () => {
    let got = 0;
    t.whenAnalyticsReady(() => got++);
    expect(got).toBe(0);
    t.attachAnalytics(fakeClient().c);
    expect(got).toBe(1);
  });

  test("server capture needs consent; cookie parsing matches the banner", async () => {
    expect(srv.consentFromCookie("amn")).toBe(true);
    expect(srv.consentFromCookie("an")).toBe(true);
    expect(srv.consentFromCookie("mn")).toBe(false);
    expect(srv.consentFromCookie("n")).toBe(false);
    expect(srv.consentFromCookie(undefined)).toBe(false);
    await expect(srv.captureServer({ distinctId: "u1", event: "subscription_activated", consent: false })).resolves.toBeUndefined();
  });
});

describe("HogQL", () => {
  test("range is whitelisted", () => {
    expect(q.parseRange("7")).toBe(7);
    expect(q.parseRange("90")).toBe(90);
    expect(q.parseRange("30")).toBe(30);
    expect(q.parseRange("1; DROP")).toBe(30);
    expect(q.parseRange(null)).toBe(30);
    expect(q.QUERIES.daily(999 as never)).toContain("INTERVAL 30 DAY");
  });

  test("queries are the expected HogQL", () => {
    expect(q.QUERIES.daily(7)).toBe("SELECT toDate(timestamp) AS day, count() AS pageviews, count(DISTINCT person_id) AS visitors FROM events WHERE event = '$pageview' AND timestamp >= now() - INTERVAL 7 DAY GROUP BY day ORDER BY day ASC");
    expect(q.QUERIES.signups(90)).toContain("event = 'signup_completed' AND timestamp >= now() - INTERVAL 90 DAY");
    expect(q.QUERIES.pages(30)).toContain("properties.$pathname AS path");
    expect(q.QUERIES.pages(30)).toEndWith("LIMIT 10");
    expect(q.QUERIES.referrers(30)).toContain("properties.$referring_domain");
    expect(q.QUERIES.countries(30)).toContain("properties.$geoip_country_name");
    const f = q.QUERIES.funnel(30);
    for (const e of ["signup_completed", "trial_started", "subscription_activated"]) expect(f).toContain(`'${e}'`);
    expect(f).toContain("properties.$pathname = '/'");
    expect(f).toContain("countIf(s1 AND s2 AND s3 AND s4)");
  });

  test("daily rows fill every day; funnel computes conversion", () => {
    const now = new Date("2026-11-14T10:00:00Z");
    const d = q.parseDaily([["2026-11-13", 5, 3]], 7, now);
    expect(d).toHaveLength(7);
    expect(d[0].day).toBe("2026-11-08");
    expect(d[6]).toEqual({ day: "2026-11-14", pageviews: 0, visitors: 0 });
    expect(d[5]).toEqual({ day: "2026-11-13", pageviews: 5, visitors: 3 });
    const f = q.parseFunnel([[100, 20, 5, 1]]);
    expect(f.map((s) => s.count)).toEqual([100, 20, 5, 1]);
    expect(f[1].rate).toBeCloseTo(0.2);
    expect(f[3].rate).toBeCloseTo(0.2);
    expect(q.parseFunnel([]).every((s) => s.count === 0)).toBe(true);
    expect(q.parseReferrers([["$direct", 4]])[0].domain).toBe("Direct or unknown");
  });
});

describe("Admin > Analytics API", () => {
  const SECRET = "phx_test_personal_key_never_leaks";
  const get = (days = "30") => route.GET(new NextRequest(`http://localhost/api/admin/analytics?days=${days}`, { headers: { origin: "http://localhost", host: "localhost" } }), { params: Promise.resolve({}) } as never);
  const realFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = realFetch;
    delete process.env.POSTHOG_PERSONAL_API_KEY;
  });

  test("rejects signed-out and non-admin roles", async () => {
    admin = null;
    expect((await get()).status).toBe(401);
    admin = { id: "a1", name: "Sam", login: "sam", role: "support" };
    expect((await get()).status).toBe(403);
  });

  test("not connected without the personal key, names the missing variable", async () => {
    admin = { id: "a1", name: "Mo", login: "mo", role: "marketing" };
    const r = await get();
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.connected).toBe(false);
    expect(j.missing).toEqual(["POSTHOG_PERSONAL_API_KEY"]);
    expect(j.projectUrl).toBe("https://us.posthog.com/project/735656");
  });

  test("queries PostHog server-side and never returns the key", async () => {
    admin = { id: "a1", name: "Ash", login: "ash", role: "super" };
    process.env.POSTHOG_PERSONAL_API_KEY = SECRET;
    const seen: { url: string; auth: string; body: { query: { kind: string; query: string } } }[] = [];
    globalThis.fetch = (async (url: string, init: RequestInit) => {
      seen.push({ url, auth: new Headers(init.headers).get("authorization") ?? "", body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ results: [] }), { status: 200 });
    }) as typeof fetch;
    const r = await get("7");
    const text = await r.text();
    expect(text).not.toContain(SECRET);
    const j = JSON.parse(text);
    expect(j.connected).toBe(true);
    expect(j.days).toBe(7);
    expect(j.daily.ok).toBe(true);
    expect(j.daily.data).toHaveLength(7);
    expect(j.pages).toEqual({ ok: true, data: [] });
    expect(seen).toHaveLength(6);
    expect(seen[0].url).toBe("https://us.posthog.com/api/projects/735656/query/");
    expect(seen[0].auth).toBe(`Bearer ${SECRET}`);
    expect(seen[0].body.query.kind).toBe("HogQLQuery");
  });

  test("API errors become plain copy per panel", async () => {
    const cfg = { ...rep.posthogServerConfig({ POSTHOG_PERSONAL_API_KEY: "k" } as never), projectId: "999001" };
    const refused = (async () => new Response("no", { status: 401 })) as unknown as typeof fetch;
    const report = await rep.analyticsReport(90, cfg, refused);
    if (!report.connected) throw new Error("expected connected");
    expect(report.daily.ok).toBe(false);
    if (!report.daily.ok) expect(report.daily.error).toContain("refused the personal API key");
    const slow = (async () => {
      throw Object.assign(new Error("t"), { name: "TimeoutError" });
    }) as unknown as typeof fetch;
    await expect(rep.runHogQL("SELECT 1", cfg, slow)).rejects.toThrow("longer than 8 seconds");
  });
});

describe("server render", () => {
  test("the provider never reads window behind a navigator check (Node 21+ has navigator, not window)", async () => {
    const src = await Bun.file("components/analytics/PostHogProvider.tsx").text();
    expect(src).not.toMatch(/typeof navigator\s*!==\s*"undefined"\s*&&\s*dntOn/);
    expect(src).toMatch(/typeof window\s*!==\s*"undefined"\s*&&\s*dntOn\(\)/);
  });
});
