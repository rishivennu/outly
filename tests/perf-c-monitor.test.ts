/**
 * Perf workstream C: the startup beacon's pure helpers, the /api/perf schema and route against the throwaway
 * database, the admin percentiles, and the structural rules (no PII, no zod on the client, one beacon per load).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { analyticsAllowed, cleanPath, clsScore, deviceClass, inpScore, ms, netClass, parseTiming } from "../lib/perf/collect";
import { byVersion, fmtMetric, percentile, stat, summarize, type PerfRow } from "../lib/perf/aggregate";
import { parsePerf, perfSchema, PerfTooLarge } from "../lib/perf/schema";
import { PERF_MAX_BYTES } from "../lib/perf/sample";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __perfUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__perfUser !== undefined ? g.__perfUser : realGetCurrentUser()) }));

const root = join(import.meta.dir, "..");
const src = (p: string) => readFileSync(join(root, p), "utf8");

let db: typeof import("../lib/db").db;
let perfRoute: typeof import("../app/api/perf/route");
let store: typeof import("../lib/perf/store");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  perfRoute = await import("../app/api/perf/route");
  store = await import("../lib/perf/store");
}, 60_000);
afterAll(() => {
  delete g.__perfUser;
});

let seq = 0;
const sample = (over: Record<string, unknown> = {}) => ({
  id: `load-${Date.now()}-${++seq}`,
  path: "/home",
  cold: true,
  installed: false,
  version: "abc1234",
  ttfb: 420,
  fcp: 810,
  lcp: 1200,
  cls: 12,
  hydrate: 1900,
  content: 1300,
  mwMs: 40,
  userMs: 15,
  cfgMs: 3,
  ...over,
});

describe("perf schema (C2/C4)", () => {
  test("accepts a real sample and keeps only known fields", () => {
    const s = parsePerf(JSON.stringify(sample({ inp: null, flags: "hit", device: "cpu8;mem4", net: "4g;rtt100" })));
    expect(s.path).toBe("/home");
    expect(s.cls).toBe(12);
  });
  test("rejects an oversize body before parsing it", () => {
    const big = JSON.stringify(sample({ path: "/home", pad: "x".repeat(PERF_MAX_BYTES) }));
    expect(() => parsePerf(big)).toThrow(PerfTooLarge);
    // bytes, not characters: 700 three-byte characters are over 2 KB
    expect(() => parsePerf(JSON.stringify({ x: "\u0905".repeat(700) }))).toThrow(PerfTooLarge);
  });
  test("rejects unknown keys, PII-shaped fields and bad values", () => {
    const bad = [
      sample({ email: "a@b.c" }),
      sample({ userId: "u1" }),
      sample({ ttfb: -1 }),
      sample({ ttfb: 12.5 }),
      sample({ fcp: 10_000_000 }),
      sample({ path: "/home?token=abc" }),
      sample({ path: "https://evil.example/" }),
      sample({ flags: "pwned" }),
      sample({ id: "x" }),
      sample({ cold: "yes" }),
      sample({ device: "Mozilla/5.0 (iPhone)" }),
    ];
    for (const b of bad) expect(perfSchema.safeParse(b).success).toBe(false);
    expect(() => parsePerf("{nope")).toThrow(SyntaxError);
  });
});

describe("collector helpers (C1)", () => {
  test("ms rounds and drops junk", () => {
    expect(ms(12.6)).toBe(13);
    expect(ms(-1)).toBeNull();
    expect(ms(NaN)).toBeNull();
    expect(ms(undefined)).toBeNull();
    expect(ms(500_000)).toBeNull();
  });
  test("paths lose query, hash and record ids", () => {
    expect(cleanPath("/home?x=1#y")).toBe("/home");
    expect(cleanPath("/content/clx1abc2def3ghi4jkl")).toBe("/content/:id");
    expect(cleanPath("/posts/123/edit")).toBe("/posts/:id/edit");
    expect(cleanPath("/settings/notification-settings")).toBe("/settings/notification-settings");
    expect(cleanPath("/x/3f2b8c1e-1234-4abc-9def-0123456789ab")).toBe("/x/:id");
    expect(cleanPath("/" + "a".repeat(300)).length).toBeLessThanOrEqual(100);
    for (const p of ["/home", "/content/clx1abc2def3ghi4jkl", "/a b/<script>"]) expect(perfSchema.shape.path.safeParse(cleanPath(p)).success).toBe(true);
  });
  test("CLS uses the worst session window, not the sum of everything", () => {
    expect(clsScore([])).toBe(0);
    // window 1: 0.1 + 0.2 (gap < 1 s); window 2 starts after a 2 s gap
    expect(clsScore([{ startTime: 100, value: 0.1 }, { startTime: 600, value: 0.2 }, { startTime: 2600, value: 0.05 }])).toBeCloseTo(0.3);
    // a window is capped at 5 s even with no gap
    const steady = Array.from({ length: 12 }, (_, i) => ({ startTime: i * 900, value: 0.1 }));
    expect(clsScore(steady)).toBeCloseTo(0.6);
  });
  test("INP is the worst interaction, one outlier ignored per 50", () => {
    expect(inpScore(new Map())).toBeNull();
    expect(inpScore(new Map([[1, 80], [2, 240], [3, 120]]))).toBe(240);
    const many = new Map(Array.from({ length: 60 }, (_, i) => [i + 1, i === 0 ? 900 : 100 + i] as [number, number]));
    expect(inpScore(many)).toBe(159);
  });
  test("x-timing meta parses, junk is skipped", () => {
    expect(parseTiming("user=12;cfg=3")).toEqual({ user: 12, cfg: 3 });
    expect(parseTiming("user=abc;=4;cfg=-1;pulse=7.5")).toEqual({ pulse: 7.5 });
    expect(parseTiming(null)).toEqual({});
  });
  test("device and network are coarse buckets", () => {
    expect(deviceClass(6, 4)).toBe("cpu6;mem4");
    expect(deviceClass(20, 16)).toBe("cpu16;mem8");
    expect(deviceClass(3, 0.25)).toBe("cpu4;mem0.5");
    expect(deviceClass(undefined, undefined)).toBeUndefined();
    expect(netClass({ effectiveType: "4g", rtt: 150, saveData: true })).toBe("4g;rtt200;save");
    expect(netClass(undefined)).toBeUndefined();
    for (const d of [deviceClass(6, 4)!, deviceClass(3, 0.25)!]) expect(perfSchema.shape.device.safeParse(d).success).toBe(true);
    expect(perfSchema.shape.net.safeParse(netClass({ effectiveType: "slow-2g", rtt: 3000 })).success).toBe(true);
  });
  test("analytics consent reads the CookieConsent shape; no answer means no", () => {
    expect(analyticsAllowed(JSON.stringify({ v: 1, necessary: true, analytics: true, marketing: false, at: "" }))).toBe(true);
    expect(analyticsAllowed(JSON.stringify({ v: 1, necessary: true, analytics: false, marketing: true, at: "" }))).toBe(false);
    expect(analyticsAllowed(null)).toBe(false);
    expect(analyticsAllowed("{broken")).toBe(false);
  });
});

describe("percentiles (C3/C4)", () => {
  test("nearest rank on known data", () => {
    const v = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(v, 50)).toBe(50);
    expect(percentile(v, 75)).toBe(75);
    expect(percentile(v, 95)).toBe(95);
    expect(percentile([7], 95)).toBe(7);
    expect(percentile([], 50)).toBeNull();
    expect(percentile([10, 20, 30, 40], 50)).toBe(20);
    expect(percentile([10, 20, 30, 40], 75)).toBe(30);
    expect(percentile([10, 20, 30, 40], 95)).toBe(40);
  });
  test("stat sorts and ignores missing values", () => {
    expect(stat([300, null, 100, undefined, 200])).toEqual({ n: 3, p50: 200, p75: 300, p95: 300 });
    expect(stat([])).toEqual({ n: 0, p50: null, p75: null, p95: null });
  });
  const row = (over: Partial<PerfRow>): PerfRow => ({ at: new Date(), cold: false, installed: false, version: "v1", ttfb: null, fcp: null, lcp: null, cls: null, inp: null, hydrate: null, content: null, mwMs: null, userMs: null, cfgMs: null, ...over });
  test("segments split cold/warm and installed/browser, and the window filter applies", () => {
    const old = new Date(Date.now() - 3 * 86_400_000);
    const rows = [row({ cold: true, installed: true, ttfb: 1000 }), row({ cold: true, ttfb: 800 }), row({ ttfb: 200 }), row({ ttfb: 5000, at: old })];
    const all = summarize(rows);
    expect(all.samples).toEqual({ all: 4, cold: 2, warm: 2, installed: 1, browser: 3 });
    expect(all.metrics.ttfb.cold.p50).toBe(800);
    expect(all.metrics.ttfb.warm.p95).toBe(5000);
    const day = summarize(rows, new Date(Date.now() - 86_400_000));
    expect(day.samples.all).toBe(3);
    expect(day.metrics.ttfb.all).toEqual({ n: 3, p50: 800, p75: 1000, p95: 1000 });
    expect(day.metrics.lcp.all.n).toBe(0);
  });
  test("per version, newest release first", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 10, 15, h));
    const v = byVersion([row({ version: "old", at: t(1), fcp: 2000 }), row({ version: "new", at: t(5), fcp: 700 }), row({ version: "old", at: t(2), fcp: 1800 }), row({ version: "new", at: t(6), fcp: 900 })]);
    expect(v.map((x) => x.version)).toEqual(["new", "old"]);
    expect(v[0].samples).toBe(2);
    expect(v[0].p75.fcp).toBe(900);
    expect(v[1].first.toISOString()).toBe(t(1).toISOString());
  });
  test("formatting", () => {
    expect(fmtMetric("ttfb", 840)).toBe("840 ms");
    expect(fmtMetric("lcp", 1240)).toBe("1.24 s");
    expect(fmtMetric("cls", 92)).toBe("0.092");
    expect(fmtMetric("fcp", null)).toBe("-");
  });
});

describe("POST /api/perf (C2)", () => {
  let n = 0;
  async function signIn() {
    n++;
    const user = await db.user.create({ data: { name: "Perf", email: `perf${n}-${Date.now()}@test.dev`, passwordHash: "x", timezone: "UTC" } });
    g.__perfUser = { ...user, role: "owner", scope: null, joinedAt: user.createdAt };
    return user;
  }
  const post = (body: string, headers: Record<string, string> = {}) =>
    perfRoute.POST(new NextRequest("http://localhost/api/perf", { method: "POST", body, headers: { origin: "http://localhost", host: "localhost", "content-type": "text/plain;charset=UTF-8", ...headers } }), { params: {} } as never);

  test("stores one anonymous row per load id", async () => {
    const user = await signIn();
    const s = sample({ device: "cpu8;mem4", net: "4g;rtt100", flags: "timeout" });
    expect((await post(JSON.stringify(s))).status).toBe(204);
    expect((await post(JSON.stringify(s))).status).toBe(204); // a retried beacon is not a second load
    const rows = await db.perfSample.findMany({ where: { id: s.id } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ path: "/home", cold: true, ttfb: 420, cls: 12, mwMs: 40, flags: "timeout", device: "cpu8;mem4", version: "abc1234" });
    expect(JSON.stringify(rows[0])).not.toContain(user.id);
    expect(JSON.stringify(rows[0])).not.toContain(user.email);
  });
  test("without a client version the server's build is used", async () => {
    await signIn();
    const s = sample({ version: undefined });
    expect((await post(JSON.stringify(s))).status).toBe(204);
    expect((await db.perfSample.findUnique({ where: { id: s.id } }))?.version).toBeTruthy();
  });
  test("refuses oversize, invalid, cross-site and signed-out requests", async () => {
    await signIn();
    expect((await post(JSON.stringify(sample({ x: "y".repeat(3000) })))).status).toBe(413);
    expect((await post("{}", { "content-length": "99999" })).status).toBe(413);
    expect((await post(JSON.stringify(sample({ email: "a@b.c" })))).status).toBe(400);
    expect((await post("not json")).status).toBe(400);
    expect((await post(JSON.stringify(sample()), { origin: "https://evil.example" })).status).toBe(403);
    g.__perfUser = null;
    expect((await post(JSON.stringify(sample()))).status).toBe(401);
  });
  test("cleanup drops rows past 30 days, runs about 1 write in 50", async () => {
    const oldId = `old-${Date.now()}`;
    await db.perfSample.create({ data: { id: oldId, at: new Date(Date.now() - 31 * 86_400_000), path: "/home", cold: true, installed: false, version: "v0" } });
    const keep = sample();
    await store.savePerf(parsePerf(JSON.stringify(keep)), () => 0.5);
    expect(await db.perfSample.findUnique({ where: { id: oldId } })).not.toBeNull();
    await store.savePerf(parsePerf(JSON.stringify(sample())), () => 0.001);
    expect(await db.perfSample.findUnique({ where: { id: oldId } })).toBeNull();
    expect(await db.perfSample.findUnique({ where: { id: keep.id } })).not.toBeNull();
  });
  test("perfRows reads the window for the admin page", async () => {
    const rows = await store.perfRows(new Date(Date.now() - 86_400_000));
    expect(rows.length).toBeGreaterThan(0);
    expect(Object.keys(rows[0])).not.toContain("path");
  });
});

describe("structure", () => {
  const beacon = src("components/shell/PerfBeacon.tsx");
  test("the beacon is a client component that sends once, by beacon, without zod or the consent banner", () => {
    expect(beacon.startsWith('"use client"')).toBe(true);
    expect(beacon).toContain('navigator.sendBeacon("/api/perf"');
    expect(beacon).toMatch(/if \(sent\) return;\s+sent = true;/);
    expect(beacon).toContain('"pagehide"');
    expect(beacon).toContain("SEND_AFTER_MS = 10_000");
    expect(beacon).not.toMatch(/from "zod"|lib\/perf\/schema|CookieConsent"/);
    expect(beacon).toContain("doNotTrack");
    // the consent key the beacon reads is the one the banner writes
    const key = /CONSENT_KEY = "([^"]+)"/;
    expect(beacon.match(key)?.[1]).toBe(src("components/shared/CookieConsent.tsx").match(key)?.[1]);
    // device and network only with consent
    expect(beacon).toMatch(/device: consent \?/);
    expect(beacon).toMatch(/net: consent \?/);
  });
  test("nothing personal is collected or stored", () => {
    for (const f of ["components/shell/PerfBeacon.tsx", "app/api/perf/route.ts", "lib/perf/store.ts"]) {
      const s = src(f);
      expect(s).not.toMatch(/clientIp|x-forwarded-for|x-real-ip|userAgent|user-agent|\.email|user\.id/);
    }
    const model = src("prisma/schema.prisma").match(/model PerfSample \{[\s\S]*?\n\}/)?.[0] ?? "";
    expect(model).toContain("@@index([at])");
    expect(model).not.toMatch(/userId|email|\bip\b|agent/i);
  });
  test("schema model is in both prisma files", () => {
    const pick = (f: string) => src(f).match(/model PerfSample \{[\s\S]*?\n\}/)?.[0]?.replace(/\r/g, "");
    expect(pick("prisma/schema.prisma")).toBeTruthy();
    expect(pick("prisma/schema.template.prisma")).toBe(pick("prisma/schema.prisma"));
  });
  test("route is POST only behind route() with a rate limit; admin page is guarded and listed", () => {
    const r = src("app/api/perf/route.ts");
    expect(r).toMatch(/export const POST = route\(/);
    expect(r).toMatch(/limit: \[\d+, 60_000\]/);
    expect(r).not.toMatch(/export (const|async function) (GET|PUT|DELETE|PATCH)/);
    expect(r).not.toContain("auth: false");
    const page = src("app/admin/(panel)/perf/page.tsx");
    expect(page).toContain('await requireAdmin("site")');
    expect(page).not.toContain('"use client"');
    expect(src("components/admin/AdminShell.tsx")).toContain('href: "/admin/perf"');
  });
});
