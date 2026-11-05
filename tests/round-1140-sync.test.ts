/**
 * 1140 background metric sync: history fills itself in from the sweeper, inside a budget, and a platform
 * that asks us to slow down is left alone instead of being hammered. Nothing is invented: a metric the
 * platform did not return is never written, and a snapshot is only kept once a day per account.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let sync: typeof import("../lib/analytics/sync");
let keys: typeof import("../lib/social/keys");
let enc: (s: string) => string;
let n = 0;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  keys?.__setKeys(undefined);
});

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  sync = await import("../lib/analytics/sync");
  keys = await import("../lib/social/keys");
  enc = (await import("../lib/crypto")).encrypt;
}, 60_000);

function stubFetch(handler: (url: string) => Response): { urls: string[] } {
  const urls: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input instanceof Request ? input.url : input);
    urls.push(url);
    return handler(url);
  }) as typeof fetch;
  return { urls };
}
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });
const igMetrics = (views: number) =>
  ok({ data: [{ name: "views", total_value: { value: views } }, { name: "likes", total_value: { value: 10 } }, { name: "comments", total_value: { value: 2 } }, { name: "shares", total_value: { value: 1 } }, { name: "saved", total_value: { value: 4 } }] });

async function fixture(o: { platform?: string; practice?: boolean; publishedDaysAgo?: number } = {}) {
  const platform = o.platform ?? "instagram";
  const u = await db.user.create({ data: { name: `S ${++n}`, email: `r1140-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: u.id, storageKey: `sample/${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const acct = await db.socialAccount.create({
    data: { userId: u.id, platform, platformUserId: o.practice ? `mock-${platform}-${++n}` : `real-${platform}-${++n}`, username: "me", accessToken: enc("tok-secret"), status: "connected" },
  });
  const p = await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published", title: "Clip" } });
  const t = await db.postTarget.create({
    data: {
      postId: p.id,
      platform,
      socialAccountId: acct.id,
      platformStatus: "published",
      platformPostId: `pp-${n}`,
      platformUrl: `https://example.com/p/${n}`,
      practice: !!o.practice,
      publishedAt: new Date(Date.now() - (o.publishedDaysAgo ?? 1) * 864e5),
    },
  });
  return { u, acct, t };
}

describe("what the sweeper asks about", () => {
  test("a recent post's numbers become stored history, and the sync time is recorded", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const { acct, t } = await fixture();
    stubFetch(() => igMetrics(1000));

    const r = await sync.syncMetrics({ accountIds: [acct.id] });
    expect(r.accounts).toBe(1);
    expect(r.targets).toBe(1);
    expect(r.synced).toBe(1);

    const sum = await db.targetMetric.aggregate({ where: { targetId: t.id }, _sum: { views: true, saves: true } });
    expect(sum._sum.views).toBe(1000);
    // 1140 added saves: Instagram reports them, so they are stored like the rest.
    expect(sum._sum.saves).toBe(4);
    const times = await sync.syncTimes([acct.id]);
    expect(times[acct.id].lastSyncAt).toBeTruthy();
    expect(times[acct.id].lastError).toBeNull();
  });

  test("a target synced a moment ago is not asked again in the next sweep", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const { acct } = await fixture();
    stubFetch(() => igMetrics(500));
    await sync.syncMetrics({ accountIds: [acct.id] });
    const again = await sync.syncMetrics({ accountIds: [acct.id] });
    expect(again.targets).toBe(0);
  });

  test("a post older than the recent window is left alone", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const { acct, t } = await fixture({ publishedDaysAgo: sync.RECENT_DAYS + 5 });
    stubFetch(() => igMetrics(100));
    const r = await sync.syncMetrics({ accountIds: [acct.id] });
    expect(r.targets).toBe(0);
    expect(r.synced).toBe(0);
    // The daily account snapshot still runs: it is what follower growth is drawn from.
    expect(await db.targetMetric.count({ where: { targetId: t.id } })).toBe(0);
  });

  test("practice accounts and platforms with no reader are never asked", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const practice = await fixture({ practice: true });
    const unsupported = await fixture({ platform: "linkedin" });
    const f = stubFetch(() => igMetrics(100));
    const r = await sync.syncMetrics({ accountIds: [practice.acct.id, unsupported.acct.id] });
    expect(r.accounts).toBe(0);
    expect(f.urls).toHaveLength(0);
  });

  test("no budget means no calls at all", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const { acct } = await fixture();
    const f = stubFetch(() => igMetrics(100));
    const r = await sync.syncMetrics({ accountIds: [acct.id], budgetMs: 0 });
    expect(r.accounts).toBe(0);
    expect(f.urls).toHaveLength(0);
  });

  test("a platform that asks us to slow down is put in cooldown and skipped next time", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const { acct } = await fixture();
    const f = stubFetch(() => new Response(JSON.stringify({ error: { message: "rate limited", code: 4 } }), { status: 429, headers: { "content-type": "application/json" } }));
    const r = await sync.syncMetrics({ accountIds: [acct.id] });
    expect(r.cooled + r.failed).toBeGreaterThan(0);
    const state = await db.accountSyncState.findUnique({ where: { accountId: acct.id } });
    expect(state?.cooldownUntil).toBeTruthy();
    expect(state?.lastSyncAt ?? null).toBeNull();

    const calls = f.urls.length;
    const again = await sync.syncMetrics({ accountIds: [acct.id] });
    expect(again.accounts).toBe(0);
    expect(f.urls).toHaveLength(calls);
  });
});

describe("daily account snapshots", () => {
  test("one row per account per day, and only the days that were actually captured", async () => {
    const { acct } = await fixture();
    await db.accountSnapshot.create({ data: { accountId: acct.id, day: "2026-11-01", followers: 100, posts: 10, views: null } });
    await db.accountSnapshot.create({ data: { accountId: acct.id, day: "2026-11-03", followers: 130, posts: 11, views: null } });
    let clashed = false;
    try {
      await db.accountSnapshot.create({ data: { accountId: acct.id, day: "2026-11-01", followers: 999 } });
    } catch {
      clashed = true;
    }
    expect(clashed).toBe(true);

    const rows = await sync.accountHistory([acct.id], "2026-11-01T00:00:00.000Z", "2026-11-04T00:00:00.000Z");
    expect(rows.map((r) => r.day)).toEqual(["2026-11-01", "2026-11-03"]);
    // A total the platform did not give stays null rather than reading as zero.
    expect(rows[0].views).toBeNull();

    const outside = await sync.accountHistory([acct.id], "2026-11-02T00:00:00.000Z", "2026-11-03T00:00:00.000Z");
    expect(outside).toHaveLength(0);
  });

  test("no accounts means no query and no rows", async () => {
    expect(await sync.accountHistory([], "2026-11-01", "2026-11-04")).toEqual([]);
    expect(await sync.syncTimes([])).toEqual({});
  });
});

describe("the sweeper calls it exactly once", () => {
  test("one line in the minute sweep, and it cannot take the sweep down", async () => {
    const src = (await import("node:fs")).readFileSync("app/api/cron/sweep/route.ts", "utf8");
    const hits = src.match(/syncMetrics/g) ?? [];
    expect(hits).toHaveLength(1);
    expect(src).toContain("@/lib/analytics/sync");
    expect(src).toMatch(/syncMetrics\(\{[^)]*\}\)[\s\S]{0,80}\.catch\(/);
  });
});
