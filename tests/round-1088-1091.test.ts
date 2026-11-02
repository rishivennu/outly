/**
 * 11-02 (1088-1091): reel analytics, delete that stops scheduled posts, the DM composer, the paged library.
 *  - insights: per-user cache keys, "not available" labelling, honest practice/unavailable states, snapshot deltas
 *  - delete: scheduled targets are cancelled, duplicates share one answer, in-flight is refused, a failed
 *    platform delete keeps the post, editors can't delete on platforms
 *  - DMs: our own Instagram side recognised by username, direction by the other person's id, replyBlock,
 *    one send per clientId
 *  - library: stable cursor pages, other workspaces' cursors give nothing, counts from groupBy
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let ins: typeof import("../lib/insights/post");
let core: typeof import("../lib/insights/post-core");
let del: typeof import("../lib/posts/delete");
let lib: typeof import("../lib/posts/library");
let meta: typeof import("../lib/messages/meta");
let svc: typeof import("../lib/messages/service");
let keys: typeof import("../lib/social/keys");
let cache: typeof import("../lib/cache");
let enc: (s: string) => string;
let n = 0;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  keys?.__setKeys(undefined);
});

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ins = await import("../lib/insights/post");
  core = await import("../lib/insights/post-core");
  del = await import("../lib/posts/delete");
  lib = await import("../lib/posts/library");
  meta = await import("../lib/messages/meta");
  svc = await import("../lib/messages/service");
  keys = await import("../lib/social/keys");
  cache = await import("../lib/cache");
  enc = (await import("../lib/crypto")).encrypt;
}, 60_000);

type Calls = { url: string; method: string; body?: string }[];
function stubFetch(handler: (url: string, init: RequestInit) => Response): Calls {
  const calls: Calls = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = String(input instanceof Request ? input.url : input);
    calls.push({ url, method: (init.method ?? "GET").toUpperCase(), body: typeof init.body === "string" ? init.body : undefined });
    return handler(url, init);
  }) as typeof fetch;
  return calls;
}
const ok = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { "content-type": "application/json" } });

async function user() {
  return db.user.create({ data: { name: `R ${++n}`, email: `r1088-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function post(userId: string, platform: string, o: { status?: string; target?: string; real?: boolean; practice?: boolean; postStatus?: string; acctStatus?: string } = {}) {
  const media = await db.media.create({ data: { userId, storageKey: `sample/${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const acct = await db.socialAccount.create({
    data: { userId, platform, platformUserId: o.real ? `real-${platform}-${++n}` : `mock-${platform}-${++n}`, username: "@me", accessToken: enc("tok-secret"), status: o.acctStatus ?? "connected" },
  });
  const p = await db.post.create({ data: { userId, mediaId: media.id, status: o.postStatus ?? "published", title: "Clip" } });
  const live = (o.status ?? "published") === "published";
  const t = await db.postTarget.create({
    data: {
      postId: p.id,
      platform,
      socialAccountId: acct.id,
      platformStatus: o.status ?? "published",
      platformPostId: live ? `pp-${n}` : null,
      platformUrl: live ? `https://example.com/p/${n}` : null,
      practice: !!o.practice,
      publishedAt: live ? new Date() : null,
    },
  });
  return { p, t, acct, media };
}

/* ------------------------------------------------------------------ 1088 insights */

describe("1088 reel analytics", () => {
  test("Instagram: live numbers, engagement rate, the rest labelled not available, token never in the result", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p, t } = await post(u.id, "instagram", { real: true });
    const calls = stubFetch(() =>
      ok({ data: [{ name: "views", total_value: { value: 1000 } }, { name: "reach", total_value: { value: 500 } }, { name: "likes", total_value: { value: 40 } }, { name: "comments", total_value: { value: 5 } }, { name: "shares", total_value: { value: 3 } }, { name: "saved", total_value: { value: 2 } }] }),
    );
    const r = await ins.postInsights(u.id, p.id);
    const tg = r.targets.find((x) => x.targetId === t.id)!;
    expect(tg.status).toBe("live");
    expect(tg.metrics.views).toBe(1000);
    expect(tg.metrics.engagementRate).toBeCloseTo((50 / 500) * 100, 5); // a percentage
    expect(tg.unavailable).toContain("impressions");
    expect(JSON.stringify(r)).not.toContain("tok-secret");
    expect(calls).toHaveLength(1);
    // Cached for the next caller: no second platform call.
    const again = await ins.postInsights(u.id, p.id);
    expect(again.cached).toBe(true);
    expect(calls).toHaveLength(1);
    // The live total became a stored increment, so cards and Analytics agree.
    const sum = await db.targetMetric.aggregate({ where: { targetId: t.id }, _sum: { views: true } });
    expect(sum._sum.views).toBe(1000);
    cache.invalidate(`insights:${u.id}:${p.id}`);
  });

  test("another user asking for the same post id gets nothing of it (cache key is per user)", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const a = await user();
    const b = await user();
    const { p } = await post(a.id, "instagram", { real: true });
    stubFetch(() => ok({ data: [{ name: "views", total_value: { value: 7 } }] }));
    await ins.postInsights(a.id, p.id);
    const theirs = await ins.postInsights(b.id, p.id);
    expect(theirs.targets).toHaveLength(0);
  });

  test("practice and unsupported platforms are said plainly, with no fake numbers", async () => {
    const u = await user();
    const calls = stubFetch(() => ok({}));
    const pr = await post(u.id, "instagram", { practice: true });
    const r = await ins.postInsights(u.id, pr.p.id);
    expect(r.targets[0].status).toBe("practice");
    expect(Object.keys(r.targets[0].metrics ?? {})).toHaveLength(0);
    const x = await post(u.id, "x", { real: true });
    const rx = await ins.postInsights(u.id, x.p.id);
    expect(rx.targets[0].status).toBe("unavailable");
    expect(calls).toHaveLength(0);
  });

  test("an expired token reads as reconnect, not as zero views", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p } = await post(u.id, "instagram", { real: true });
    stubFetch(() => new Response(JSON.stringify({ error: { code: 190, message: "Invalid OAuth access token" } }), { status: 400 }));
    const r = await ins.postInsights(u.id, p.id);
    expect(r.targets[0]).toMatchObject({ status: "error", code: "AUTH_EXPIRED" });
    expect(r.targets[0].metrics?.views).toBeUndefined();
  });

  test("engagement rate needs a denominator", () => {
    expect(core.engagementRate({ likes: 5 }, "reach")).toBeNull();
    expect(core.engagementRate({ likes: 5, comments: 5, reach: 100 }, "reach")).toBeCloseTo(10, 5);
  });
});

/* ------------------------------------------------------------------ 1089 delete */

describe("1089 delete", () => {
  test("a scheduled post: its waiting targets are cancelled, the post is gone, nothing is left for a worker", async () => {
    const u = await user();
    const { p, t } = await post(u.id, "youtube", { status: "queued", postStatus: "scheduled" });
    const calls = stubFetch(() => ok({}));
    const r = await del.deletePost({ id: u.id }, p.id, { platforms: false, appOnlyAck: false });
    expect(r).toMatchObject({ ok: true, local: "deleted", stopped: 1 });
    expect(await db.post.count({ where: { id: p.id } })).toBe(0);
    expect(await db.postTarget.count({ where: { id: t.id } })).toBe(0);
    expect(calls).toHaveLength(0);
  });

  test("two deletes at once share one answer; a later one is already_gone, not an error", async () => {
    const u = await user();
    const { p } = await post(u.id, "youtube", { status: "pending", postStatus: "scheduled" });
    const [a, b] = await Promise.all([del.deletePost({ id: u.id }, p.id, { platforms: false, appOnlyAck: false }), del.deletePost({ id: u.id }, p.id, { platforms: false, appOnlyAck: false })]);
    expect(a).toBe(b);
    expect((await del.deletePost({ id: u.id }, p.id, { platforms: false, appOnlyAck: false })).local).toBe("already_gone");
  });

  test("another workspace can't delete it", async () => {
    const u = await user();
    const other = await user();
    const { p } = await post(u.id, "youtube", { status: "queued", postStatus: "scheduled" });
    expect((await del.deletePost({ id: other.id }, p.id, { platforms: false, appOnlyAck: false })).local).toBe("already_gone");
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: p.id } })).platformStatus).toBe("queued");
  });

  test("a platform still processing it: refused with IN_FLIGHT, post kept", async () => {
    const u = await user();
    const { p } = await post(u.id, "youtube", { status: "processing", postStatus: "publishing" });
    await expect(del.deletePost({ id: u.id }, p.id, { platforms: false, appOnlyAck: false })).rejects.toMatchObject({ status: 409, code: "IN_FLIGHT" });
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
  });

  test("a failed platform delete keeps the post in Outlly", async () => {
    keys.__setKeys({ x: { clientId: "cid", clientSecret: "sec" } } as never);
    const u = await user();
    const { p } = await post(u.id, "x", { real: true });
    stubFetch(() => new Response("{}", { status: 403 }));
    await expect(del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: false })).rejects.toMatchObject({ status: 409, code: "REMOVE_FAILED" });
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
  });

  test("Instagram can't be deleted by API: needs the creator's acknowledgement, then reports manual", async () => {
    const u = await user();
    const { p } = await post(u.id, "instagram", { real: true });
    stubFetch(() => ok({}));
    await expect(del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: false })).rejects.toMatchObject({ code: "APP_ONLY_LIVE" });
    const r = await del.deletePost({ id: u.id }, p.id, { platforms: true, appOnlyAck: true });
    expect(r.remote).toEqual([expect.objectContaining({ platform: "instagram", outcome: "manual" })]);
  });

  test("editors can't delete on the platforms", async () => {
    const u = await user();
    const { p } = await post(u.id, "youtube", { real: true });
    await expect(del.deletePost({ id: u.id, role: "editor" }, p.id, { platforms: true, appOnlyAck: true })).rejects.toMatchObject({ status: 403 });
    expect(await db.post.count({ where: { id: p.id } })).toBe(1);
  });
});

/* ------------------------------------------------------------------ 1090 DMs */

describe("1090 direct message composer", () => {
  test("Instagram lists our side under another id: we still recognise ourselves by username", () => {
    const c = {
      id: "c1",
      participants: { data: [{ id: "app-scoped-999", username: "MyShop" }, { id: "igsid-1", username: "asha" }] },
      messages: { data: [{ id: "m1", from: { id: "igsid-1" }, message: "hi" }] },
    };
    const t = meta.mapConversation(c, "1784-user-id", "@myshop")!;
    expect(t.participantId).toBe("igsid-1");
    expect(t.participantHandle).toBe("@asha");
  });

  test("backfill decides direction by the other person's id, so the reply window opens", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const a = await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `1784${Date.now()}`, username: "@myshop", accessToken: enc("t") } });
    const now = new Date(Date.now() - 60_000).toISOString();
    stubFetch((url) =>
      url.includes("/conversations")
        ? ok({
            data: [
              {
                id: "c9",
                participants: { data: [{ id: "self-other-id", username: "myshop" }, { id: "igsid-7", username: "neha" }] },
                messages: {
                  data: [
                    { id: "x2", created_time: now, message: "thanks", from: { id: "self-other-id" } },
                    { id: "x1", created_time: new Date(Date.now() - 120_000).toISOString(), message: "price?", from: { id: "igsid-7" } },
                  ],
                },
              },
            ],
          })
        : ok({}),
    );
    await svc.syncAccount(a);
    const t = await db.dmThread.findFirstOrThrow({ where: { accountId: a.id } });
    expect(t.participantId).toBe("igsid-7");
    const msgs = await db.dmMessage.findMany({ where: { threadId: t.id }, orderBy: { sentAt: "asc" } });
    expect(msgs.map((m) => m.direction)).toEqual(["in", "out"]);
    const view = (await svc.listThreads(u.id)).threads.find((x) => x.id === t.id)!;
    expect(view.canReply).toBe(true);
    expect(view.replyBlock).toBeNull();
  });

  test("replyBlock says why the composer is locked", () => {
    const now = Date.now();
    expect(svc.replyBlockFor({ platform: "instagram", practice: true, lastInboundAt: new Date(now - 60_000), account: { status: "connected" } }, now)).toBeNull();
    expect(svc.replyBlockFor({ platform: "instagram", practice: true, lastInboundAt: new Date(now - 25 * 3600_000), account: { status: "connected" } }, now)?.code).toBe("WINDOW_CLOSED");
    expect(svc.replyBlockFor({ platform: "instagram", practice: true, lastInboundAt: null, account: { status: "connected" } }, now)?.code).toBe("WINDOW_CLOSED");
    expect(svc.replyBlockFor({ platform: "facebook", practice: false, lastInboundAt: new Date(now), account: { status: "needs_reconnect" } }, now)?.code).toBe("NOT_CONNECTED");
  });

  test("one send per clientId: repeats share the first attempt; a failure can be retried", async () => {
    let runs = 0;
    const key = `k-${Date.now()}`;
    const job = () => {
      runs++;
      return new Promise<string>((r) => setTimeout(() => r("sent"), 10));
    };
    const a = svc.sendOnce(key, job);
    const b = svc.sendOnce(key, job);
    expect(b.duplicate).toBe(true);
    expect(await a.p).toBe("sent");
    expect(await b.p).toBe("sent");
    expect(runs).toBe(1);

    const k2 = `${key}-f`;
    const f = svc.sendOnce(k2, () => Promise.reject(new Error("meta down")));
    await expect(f.p).rejects.toThrow("meta down");
    await Promise.resolve();
    const retry = svc.sendOnce(k2, () => Promise.resolve("ok"));
    expect(retry.duplicate).toBe(false);
    expect(await retry.p).toBe("ok");
  });

  test("the reply route sends once for a repeated clientId and never twice to Meta", async () => {
    const u = await user();
    const a = await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `1784r${Date.now()}`, username: "@shop", accessToken: enc("t") } });
    const t = await db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: "instagram", participantId: "p-r", lastMessageAt: new Date(), lastInboundAt: new Date() } });
    const calls = stubFetch(() => ok({ message_id: `mid-${Date.now()}` }));
    const send = () => svc.sendOnce(`${u.id}:${t.id}:client-abc-123`, () => svc.replyToThread(u.id, u.id, t.id, "hello"));
    const [x, y] = [send(), send()];
    await Promise.all([x.p, y.p]);
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(await db.dmMessage.count({ where: { threadId: t.id, direction: "out" } })).toBe(1);
  });
});

/* ------------------------------------------------------------------ 1091 library */

describe("1091 paged library", () => {
  test("cursor pages never skip or repeat, counts match, a foreign cursor gives nothing", async () => {
    const u = await user();
    const media = await db.media.create({ data: { userId: u.id, storageKey: "sample/l.mp4", originalFilename: "l.mp4", mimeType: "video/mp4", size: 1, status: "ready" } });
    const same = new Date();
    const total = lib.LIBRARY_PAGE + 7;
    // Many share one updatedAt on purpose: the id tie-break has to keep the order stable.
    for (let i = 0; i < total; i++)
      await db.post.create({ data: { userId: u.id, mediaId: media.id, status: i % 3 === 0 ? "draft" : i % 3 === 1 ? "scheduled" : "failed", title: `P${i}`, updatedAt: i < 20 ? same : new Date(Date.now() - i * 1000) } });
    const first = await lib.libraryPage({ id: u.id, scope: null }, null, undefined, {});
    expect(first.posts).toHaveLength(lib.LIBRARY_PAGE);
    expect(first.nextCursor).toBeTruthy();
    const second = await lib.libraryPage({ id: u.id, scope: null }, first.nextCursor, undefined, {});
    expect(second.posts).toHaveLength(7);
    expect(second.nextCursor).toBeNull();
    const ids = [...first.posts, ...second.posts].map((p) => p.id);
    expect(new Set(ids).size).toBe(total);
    const counts = await lib.libraryCounts({ id: u.id, scope: null }, {});
    expect(counts.all).toBe(total);
    expect(counts.draft + counts.scheduled + counts.failed).toBe(total);
    const other = await user();
    expect((await lib.libraryPage({ id: other.id, scope: null }, first.nextCursor, undefined, {})).posts).toHaveLength(0);
  });

  test("views are summed only for the posts on the page", async () => {
    const u = await user();
    const { p, t } = await post(u.id, "youtube", { real: true });
    await db.targetMetric.create({ data: { targetId: t.id, views: 120 } });
    await db.targetMetric.create({ data: { targetId: t.id, views: 30 } });
    const page = await lib.libraryPage({ id: u.id, scope: null }, null, undefined, {});
    expect(page.views[p.id]).toBe(150);
  });
});

/* ------------------------------------------------------------------ review fixes (11-02) */

describe("1088-1091 review fixes", () => {
  test("a platform correcting views downwards brings the stored total down too", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p, t } = await post(u.id, "instagram", { real: true });
    await db.targetMetric.create({ data: { targetId: t.id, views: 500, likes: 9, capturedAt: new Date(Date.now() - 3_600_000) } });
    stubFetch(() => ok({ data: [{ name: "views", total_value: { value: 450 } }, { name: "reach", total_value: { value: 300 } }] }));
    await ins.postInsights(u.id, p.id, { fresh: true });
    const sum = await db.targetMetric.aggregate({ where: { targetId: t.id }, _sum: { views: true, likes: true } });
    expect(sum._sum.views).toBe(450);
    expect(sum._sum.likes).toBe(9); // not in this answer: kept, not zeroed
    cache.invalidate(`insights:${u.id}:${p.id}`);
  });

  test("the engagement note names only what was divided", () => {
    expect(core.engagementNote({ likes: 4, comments: 1, reach: 50, engagementRate: 10 }, "reach")).toBe("Engagement rate = likes and comments divided by reach.");
    expect(core.engagementNote({ likes: 4, reach: 50 }, "reach")).toBeNull();
  });

  test("a backfilled message without a sender is skipped and does not open the reply window", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const a = await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `1785${Date.now()}`, username: "@myshop", accessToken: enc("t") } });
    stubFetch((url) =>
      url.includes("/conversations")
        ? ok({
            data: [
              {
                id: "c10",
                participants: { data: [{ id: "self-x", username: "myshop" }, { id: "igsid-8", username: "ravi" }] },
                messages: { data: [{ id: "y1", created_time: new Date(Date.now() - 60_000).toISOString(), message: "who sent me?" }] },
              },
            ],
          })
        : ok({}),
    );
    const r = await svc.syncAccount(a);
    expect(r.stored).toBe(0);
    const t = await db.dmThread.findFirst({ where: { accountId: a.id } });
    if (t) {
      expect(t.lastInboundAt).toBeNull();
      expect(await db.dmMessage.count({ where: { threadId: t.id } })).toBe(0);
    }
  });

  test("a tab pages through its own posts only; Failed includes partial", async () => {
    const u = await user();
    const media = await db.media.create({ data: { userId: u.id, storageKey: "sample/s.mp4", originalFilename: "s.mp4", mimeType: "video/mp4", size: 1, status: "ready" } });
    // Scheduled posts are the OLDEST, so the first "All" page would not contain them.
    for (let i = 0; i < 5; i++) await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "scheduled", title: `S${i}`, updatedAt: new Date(Date.now() - 86_400_000 - i) } });
    for (let i = 0; i < lib.LIBRARY_PAGE + 2; i++) await db.post.create({ data: { userId: u.id, mediaId: media.id, status: i % 2 ? "failed" : "partial", title: `F${i}` } });
    const me = { id: u.id, scope: null };
    expect((await lib.libraryPage(me, null, undefined, {})).posts.some((p) => p.status === "scheduled")).toBe(false);
    const sch = await lib.libraryPage(me, null, undefined, {}, "scheduled");
    expect(sch.posts.map((p) => p.status)).toEqual(Array(5).fill("scheduled"));
    expect(sch.nextCursor).toBeNull();
    const f1 = await lib.libraryPage(me, null, undefined, {}, "failed");
    expect(f1.posts).toHaveLength(lib.LIBRARY_PAGE);
    const f2 = await lib.libraryPage(me, f1.nextCursor, undefined, {}, "failed");
    expect(f2.posts).toHaveLength(2);
    expect(new Set([...f1.posts, ...f2.posts].map((p) => p.status))).toEqual(new Set(["failed", "partial"]));
    expect(lib.isLibraryStatus("published")).toBe(true);
    expect(lib.isLibraryStatus("all")).toBe(false);
  });
});
