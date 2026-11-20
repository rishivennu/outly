/**
 * R1249: client-scoped recommendations. An overview read for an agency client (?client=) stores, expires and reads
 * its recommendations under the client's scopeKey, never the workspace's "", so the two lists stay apart.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";

const jar = new Map<string, string>();
mock.module("next/headers", () => ({
  cookies: () => ({ get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined), getAll: () => [], has: (k: string) => jar.has(k), set: () => {}, delete: () => {} }),
  headers: () => new Headers(),
}));
const g = globalThis as unknown as { __r1249User?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__r1249User !== undefined ? g.__r1249User : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let mem: typeof import("../lib/intelligence/memory");
let svc: typeof import("../lib/intelligence/service");
let reco: typeof import("../lib/intelligence/reco");
let core: typeof import("../lib/intelligence/core");
let overviewRoute: typeof import("../app/api/intelligence/overview/route");
let recoRoute: typeof import("../app/api/recommendations/route");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  mem = await import("../lib/intelligence/memory");
  svc = await import("../lib/intelligence/service");
  reco = await import("../lib/intelligence/reco");
  core = await import("../lib/intelligence/core");
  overviewRoute = await import("../app/api/intelligence/overview/route");
  recoRoute = await import("../app/api/recommendations/route");
}, 60_000);
afterAll(() => {
  delete g.__r1249User;
});

const DAY = 864e5;
let n = 0;
const user = () => db.user.create({ data: { name: `S ${++n}`, email: `r1249-${n}-${Date.now()}-${Math.random()}@test.dev`, passwordHash: "x", timezone: "UTC" } });
const asOwner = (u: { id: string; name: string; email: string; createdAt: Date }) => (g.__r1249User = { ...u, role: "owner", joinedAt: u.createdAt, actor: null, scope: null });
const req = (path: string) => new NextRequest(`http://localhost${path}`, { method: "GET", headers: { origin: "http://localhost", host: "localhost" } });
const ctx = { params: {} } as never;

/** The R1239 data set: three recent Instagram videos at 300 views against three older ones at 100, on one account. */
async function seeded() {
  const u = await user();
  const account = await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `ig-r1249-${++n}-${Date.now()}`, username: "@s", accessToken: encrypt("tok"), status: "connected" } });
  const media = await db.media.create({ data: { userId: u.id, originalFilename: "v.mp4", storageKey: `r1249/${++n}-${Date.now()}.mp4`, mimeType: "video/mp4", size: 1, status: "ready" } });
  const mk = async (views: number, daysAgo: number) => {
    const at = new Date(Date.now() - daysAgo * DAY);
    const p = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", publishedAt: at } });
    const t = await db.postTarget.create({ data: { postId: p.id, platform: "instagram", socialAccountId: account.id, platformStatus: "published", publishedAt: at } });
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views, likes: 1 } });
  };
  for (const v of [300, 300, 300]) await mk(v, 3);
  for (const v of [100, 100, 100]) await mk(v, 40);
  await mem.upsertBrandProfile(u.id, "acme", { objective: "awareness", name: "Acme", accountIds: [account.id] });
  return { u, account };
}
const scopes = async (ownerId: string) => (await db.recommendation.findMany({ where: { ownerId }, select: { scopeKey: true } })).map((r) => r.scopeKey).sort();

describe("R1249 service scopeKey", () => {
  test("a client read persists under its scopeKey and not under the workspace's", async () => {
    const { u, account } = await seeded();
    const o = await svc.overview({ id: u.id, scope: null }, { days: 28, objective: "awareness", accountIds: [account.id], scopeKey: "acme" });
    expect(o.recommendations.length).toBe(1);
    expect(o.recommendations[0].scopeKey).toBe("acme");
    expect(await scopes(u.id)).toEqual(["acme"]);
    expect(await reco.listRecommendations(u.id, "")).toEqual([]);
    expect((await reco.listRecommendations(u.id, "acme")).map((r) => r.id)).toEqual([o.recommendations[0].id]);
    // The workspace read stores its own row, and each list still shows only its own scope.
    const w = await svc.overview({ id: u.id, scope: null }, { days: 28, objective: "awareness", accountIds: null });
    expect(w.recommendations[0].scopeKey).toBe("");
    expect(w.recommendations[0].id).not.toBe(o.recommendations[0].id);
    expect(await scopes(u.id)).toEqual(["", "acme"]);
    expect((await reco.listRecommendations(u.id, "")).map((r) => r.id)).toEqual([w.recommendations[0].id]);
  });

  test("scopeKey left out falls back to brandKey, then to the workspace", async () => {
    const { u } = await seeded();
    await svc.overview({ id: u.id, scope: null }, { days: 28, objective: "awareness", accountIds: null });
    expect(await scopes(u.id)).toEqual([""]);
  });

  test("expireStale in one scope never expires the other", async () => {
    const u = await user();
    const signal = (format: string) => ({
      id: `format:instagram:${format}:views`,
      kind: "format_trend" as const,
      direction: "up" as const,
      title: format,
      platform: "instagram",
      format,
      topic: null,
      evidence: { metric: "views" as const, value: 160, baseline: 100, unit: "count" as const, lift: 60, n: 6, baselineN: 6, period: "22 Oct to 20 Nov 2026" },
      confidence: "medium" as const,
      postsAnalyzed: 12,
      examples: ["t1"],
    });
    const drafts = core.recommendationsFrom([signal("video")]).recommendations;
    const period = { from: "2026-10-22T00:00:00.000Z", to: "2026-11-21T00:00:00.000Z" };
    await reco.persistRecommendations(u.id, "", drafts, period, { ask: null });
    await reco.persistRecommendations(u.id, "acme", drafts, period, { ask: null });
    await db.recommendation.updateMany({ where: { ownerId: u.id }, data: { createdAt: new Date(Date.now() - 200 * DAY) } });
    expect(await reco.expireStale(u.id, "acme")).toBe(1);
    const rows = await db.recommendation.findMany({ where: { ownerId: u.id }, select: { scopeKey: true, status: true } });
    expect(rows.find((r) => r.scopeKey === "acme")?.status).toBe("expired");
    expect(rows.find((r) => r.scopeKey === "")?.status).toBe("open");
  });

  test("the posts cache key differs by brandKey and accounts", () => {
    const period = core.periodOf(Date.parse("2026-11-20T00:00:00Z"), 28);
    const keys = [svc.postsCacheKey("u", period, null), svc.postsCacheKey("u", period, null, ""), svc.postsCacheKey("u", period, null, "acme"), svc.postsCacheKey("u", period, ["a"], "acme")];
    expect(new Set(keys).size).toBe(4);
  });
});

describe("R1249 routes", () => {
  test("GET overview ?client= stores under the client; the workspace recommendations list leaves them out, ?scope= shows them", async () => {
    const { u } = await seeded();
    asOwner(u);
    const res = await overviewRoute.GET(req("/api/intelligence/overview?days=28&client=acme"), ctx);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { recommendations: { id: string; scopeKey: string }[]; clientAccounts: number };
    expect(body.clientAccounts).toBe(1);
    expect(body.recommendations.length).toBe(1);
    expect(body.recommendations[0].scopeKey).toBe("acme");
    expect(await scopes(u.id)).toEqual(["acme"]);

    const ws = (await (await recoRoute.GET(req("/api/recommendations"), ctx)).json()) as { recommendations: { id: string }[] };
    expect(ws.recommendations).toEqual([]);
    const cl = (await (await recoRoute.GET(req("/api/recommendations?scope=acme"), ctx)).json()) as { recommendations: { id: string }[] };
    expect(cl.recommendations.map((r) => r.id)).toEqual([body.recommendations[0].id]);
  });

  test("Pip keeps the workspace scope", () => {
    const s = readFileSync("lib/pip/tools-intelligence.ts", "utf8");
    expect(s).toContain("readOnly: true");
    expect(s).not.toContain("scopeKey");
  });
});
