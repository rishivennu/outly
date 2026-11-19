/**
 * R1236: the intelligence service and read model against the throwaway database. Which destinations count
 * (published, real, not removed; archived posts keep their numbers), tenant isolation, like-with-like groups,
 * the cache key per window and scope, and the overview route's input checks.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { periodOf } from "../lib/intelligence/core";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __intelUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__intelUser !== undefined ? g.__intelUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let svc: typeof import("../lib/intelligence/service");
let mem: typeof import("../lib/intelligence/memory");
let api: typeof import("../app/api/intelligence/overview/route");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  svc = await import("../lib/intelligence/service");
  mem = await import("../lib/intelligence/memory");
  api = await import("../app/api/intelligence/overview/route");
}, 60_000);
afterAll(() => {
  delete g.__intelUser;
});

const DAY = 864e5;
const ago = (d: number) => new Date(Date.now() - d * DAY);
let n = 0;

async function workspace(tag: string) {
  n++;
  const user = await db.user.create({ data: { name: `Intel ${tag}`, email: `r1236-${tag}-${n}-${Date.now()}@test.dev`, passwordHash: "x", timezone: "UTC", niche: "Travel" } });
  const account = await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `ig-${tag}-${n}-${Date.now()}`, username: "@me", accessToken: encrypt("tok"), status: "connected" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "v.mp4", storageKey: `intel/${n}-${Date.now()}.mp4`, mimeType: "video/mp4", size: 100, status: "ready" } });
  /** One published destination with its numbers, written the way the sync job writes them (increments). */
  async function target(o: { views: number; daysAgo?: number; format?: string; platform?: string; status?: string; practice?: boolean; removed?: boolean; archived?: boolean; topic?: string; story?: string }) {
    const at = ago(o.daysAgo ?? 3);
    const post = await db.post.create({
      data: {
        userId: user.id,
        mediaId: media.id,
        title: `P${++n}`,
        story: o.story ?? "A day in Goa. The rest of the tale.",
        status: "published",
        format: o.format ?? "video",
        publishedAt: at,
        archivedAt: o.archived ? new Date() : null,
      },
    });
    const t = await db.postTarget.create({
      data: {
        postId: post.id,
        platform: o.platform ?? "instagram",
        socialAccountId: account.id,
        platformStatus: o.status ?? "published",
        practice: o.practice ?? false,
        removedAt: o.removed ? new Date() : null,
        publishedAt: at,
      },
    });
    // Two increments, so the service has to add them up rather than read one row.
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: at, views: Math.floor(o.views / 2), likes: 2, comments: 1, shares: 1, saves: 1 } });
    await db.targetMetric.create({ data: { targetId: t.id, capturedAt: new Date(at.getTime() + 3600e3), views: Math.ceil(o.views / 2), likes: 2, comments: 1, shares: 0, saves: 0 } });
    if (o.topic) {
      const item = await mem.ensureItemForPost(user.id, post.id, { origin: "backfill" });
      await db.contentItem.update({ where: { id: item!.item.id }, data: { topic: o.topic } });
    }
    return { post, target: t };
  }
  return { user: { id: user.id, scope: null as string[] | null }, account, target };
}

describe("R1236 loadPostRecords", () => {
  test("only published real destinations, archived kept, numbers summed", async () => {
    const w = await workspace("rows");
    await w.target({ views: 100 });
    await w.target({ views: 200, archived: true });
    await w.target({ views: 300, practice: true });
    await w.target({ views: 400, removed: true });
    await w.target({ views: 500, status: "pending" });
    await w.target({ views: 600, daysAgo: 400 });

    const rows = await svc.loadPostRecords(w.user, { days: 28, accountIds: null });
    expect(rows.length).toBe(2);
    expect(rows.map((r) => r.metrics.views).sort((a, b) => (a ?? 0) - (b ?? 0))).toEqual([100, 200]);
    expect(rows[0].platform).toBe("instagram");
    expect(rows[0].format).toBe("video");
    expect(rows[0].metrics.likes).toBe(4);
    expect(rows[0].metrics.shares).toBe(1);
  });
  test("a platform that reports no saves leaves saves absent, never 0", async () => {
    const w = await workspace("yt");
    await w.target({ views: 50, platform: "youtube" });
    const rows = await svc.loadPostRecords(w.user, { days: 28, accountIds: null });
    expect(rows.length).toBe(1);
    expect(rows[0].metrics.views).toBe(50);
    expect("saves" in rows[0].metrics).toBe(false);
  });
  test("one workspace never sees another's posts", async () => {
    const [a, b] = [await workspace("iso-a"), await workspace("iso-b")];
    await a.target({ views: 111 });
    await b.target({ views: 222 });
    const rows = await svc.loadPostRecords(a.user, { days: 28, accountIds: null });
    expect(rows.length).toBe(1);
    expect(rows[0].metrics.views).toBe(111);
    expect(await svc.loadPostRecords({ id: "nobody", scope: null }, { days: 28, accountIds: null })).toEqual([]);
  });
  test("an account scope outside the workspace returns nothing", async () => {
    const w = await workspace("scope");
    await w.target({ views: 77 });
    expect(await svc.loadPostRecords(w.user, { days: 28, accountIds: [] })).toEqual([]);
    expect((await svc.loadPostRecords(w.user, { days: 28, accountIds: [w.account.id] })).length).toBe(1);
  });
  test("the cache key names the window, the scope and the brand", () => {
    const p7 = periodOf(Date.UTC(2026, 10, 20), 7);
    const p28 = periodOf(Date.UTC(2026, 10, 20), 28);
    const k = (p: typeof p7, ids: string[] | null, brand?: string) => svc.postsCacheKey("u1", p, ids, brand);
    expect(k(p7, null)).not.toBe(k(p28, null));
    expect(k(p7, null)).not.toBe(k(p7, ["a"]));
    expect(k(p7, ["a", "b"])).toBe(k(p7, ["b", "a"]));
    expect(k(p7, null)).not.toBe(k(p7, null, ""));
    expect(k(p7, null).startsWith("intel:posts:u1:")).toBe(true);
  });
});

describe("R1236 overview", () => {
  test("like-with-like groups, the brand objective and recommendation drafts from measured lifts", async () => {
    const w = await workspace("ov");
    await mem.upsertBrandProfile(w.user.id, "", { objective: "awareness", name: "Goa Diaries" });
    for (const v of [200, 200, 200]) await w.target({ views: v, daysAgo: 5, topic: "Beaches" });
    for (const v of [100, 100, 100]) await w.target({ views: v, daysAgo: 40 });
    for (const v of [10, 10]) await w.target({ views: v, daysAgo: 5, format: "carousel" });

    const o = await svc.overview(w.user, { days: 28, accountIds: null });
    expect(o.objective).toBe("awareness");
    expect(o.posts).toBe(5);
    expect(o.postsAnalyzed).toBe(8);
    expect(o.period.days).toBe(28);
    expect(o.previous.to).toBe(o.period.from);
    const keys = o.formats.map((f) => `${f.platform}|${f.format}`);
    expect(keys).toEqual(["instagram|video", "instagram|carousel"]);
    expect(o.formats[0].status).toBe("ok");
    expect(o.formats[0].metrics.find((m) => m.metric === "views")?.median).toBe(200);
    expect(o.formats[1].status).toBe("insufficient");
    expect(o.working.length).toBeGreaterThan(0);
    expect(o.working[0].evidence).toMatchObject({ metric: "views", value: 200, baseline: 100, lift: 100 });
    expect(o.recommendations.length).toBeGreaterThan(0);
    expect(o.recommendations[0].platform).toBe("instagram");
    expect(o.recommendationsReason).toBeNull();
    expect(o.topics.find((t) => t.topic === "Beaches")?.n).toBe(3);
    expect(Date.parse(o.generatedAt)).toBeGreaterThan(0);
  });
  test("no posts: empty lists, engagement by default and a reason instead of invented advice", async () => {
    const w = await workspace("empty");
    const o = await svc.overview(w.user, { days: 7, accountIds: null });
    expect(o.objective).toBe("engagement");
    expect(o.posts).toBe(0);
    expect(o.formats).toEqual([]);
    expect(o.working).toEqual([]);
    expect(o.attention).toEqual([]);
    expect(o.recommendations).toEqual([]);
    expect(o.recommendationsReason).toContain("Not enough data yet");
  });
  test("?objective overrides the saved one without saving it", async () => {
    const w = await workspace("obj");
    await mem.upsertBrandProfile(w.user.id, "", { objective: "awareness" });
    const o = await svc.overview(w.user, { days: 7, objective: "community", accountIds: null });
    expect(o.objective).toBe("community");
    expect((await mem.getBrandProfile(w.user.id))?.objective).toBe("awareness");
  });
});

describe("R1236 GET /api/intelligence/overview", () => {
  const get = (qs: string) => api.GET(new NextRequest(`http://localhost/api/intelligence/overview${qs}`, { headers: { origin: "http://localhost", host: "localhost" } }), { params: {} } as never);

  test("signed out is 401, bad days and bad objective are 400, a good window is 200 and never cached", async () => {
    const w = await workspace("api");
    await w.target({ views: 42 });
    g.__intelUser = null;
    expect((await get("")).status).toBe(401);
    const me = await db.user.findUnique({ where: { id: w.user.id } });
    g.__intelUser = { ...me, role: "owner", scope: null, joinedAt: me!.createdAt, actor: null };

    expect((await get("?days=13")).status).toBe(400);
    expect((await get("?days=abc")).status).toBe(400);
    expect((await get("?objective=fame")).status).toBe(400);
    const res = await get("?days=28");
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("private, no-store");
    const body = (await res.json()) as { posts: number; objective: string; period: { days: number } };
    expect(body.posts).toBe(1);
    expect(body.objective).toBe("engagement");
    expect(body.period.days).toBe(28);
    const dflt = await get("");
    expect(((await dflt.json()) as { period: { days: number } }).period.days).toBe(28);
  });
});
