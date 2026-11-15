/**
 * Phase 2 posts server against the test database: clientKey dedupe, draft conflicts (409 draft_conflict),
 * booking guards (409 schedule_conflict, 422 platform_limit) on PATCH, launch and bulk, the GET check dry run,
 * Unschedule through the cancel route, and sending a failed post again.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import * as realProfiles from "../lib/profiles";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

const g = globalThis as unknown as { __p2postsUser?: unknown; __queueBackend?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__p2postsUser !== undefined ? g.__p2postsUser : realGetCurrentUser()) }));
// Review fix 5: lets a test make another device's save land between a route's read and its write (pinTargets runs in that gap).
const h = globalThis as unknown as { __p2beforePin?: () => Promise<void> };
const realPin = realProfiles.pinTargets;
mock.module("../lib/profiles", () => ({
  ...realProfiles,
  pinTargets: async (...a: Parameters<typeof realPin>) => {
    const hook = h.__p2beforePin;
    delete h.__p2beforePin;
    if (hook) await hook();
    return realPin(...a);
  },
}));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let posts: typeof import("../app/api/posts/route");
let one: typeof import("../app/api/posts/[id]/route");
let check: typeof import("../app/api/posts/[id]/check/route");
let cancel: typeof import("../app/api/posts/[id]/cancel/route");
let launch: typeof import("../app/api/posts/[id]/launch/route");
let bulk: typeof import("../app/api/posts/bulk/route");
let jobs: { name: string; data: unknown }[] = [];
let previousBackend: unknown;

beforeAll(async () => {
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown) => void jobs.push({ name, data }) };
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  posts = await import("../app/api/posts/route");
  one = await import("../app/api/posts/[id]/route");
  check = await import("../app/api/posts/[id]/check/route");
  cancel = await import("../app/api/posts/[id]/cancel/route");
  launch = await import("../app/api/posts/[id]/launch/route");
  bulk = await import("../app/api/posts/bulk/route");
}, 60_000);
afterAll(() => {
  delete g.__p2postsUser;
  g.__queueBackend = previousBackend;
});

let n = 0;
async function creator(opts: { platforms?: ("instagram" | "x" | "youtube")[]; duration?: number } = {}) {
  n++;
  const user = await db.user.create({ data: { name: "P2", email: `p2posts${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `p2/${n}.mp4`, mimeType: "video/mp4", size: 1000, duration: opts.duration ?? 10, width: 1080, height: 1920, status: "ready" } });
  const accounts: Record<string, { id: string }> = {};
  // Practice accounts: launch accepts them and the media rules are MockPublisher's (no platform keys in tests).
  for (const platform of opts.platforms ?? ["instagram"])
    accounts[platform] = await db.socialAccount.create({ data: { userId: user.id, platform, platformUserId: `mock-${platform}-${n}`, username: "me", accessToken: encrypt("tok"), status: "connected" } });
  g.__p2postsUser = { ...user, role: "owner", joinedAt: user.createdAt, actor: null, scope: null };
  return { user, media, accounts };
}
async function draft(userId: string, mediaId: string, platforms: string[] = ["instagram"], extra: Record<string, unknown> = {}) {
  return db.post.create({ data: { userId, mediaId, title: "Mine", ...extra, targets: { create: platforms.map((platform) => ({ platform, caption: "hello" })) } }, include: { targets: true } });
}
const req = (method: string, path: string, body?: unknown) =>
  new NextRequest(`http://localhost${path}`, { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" } });
const ctx = (id: string) => ({ params: { id } });
const inHours = (h: number) => new Date(Date.now() + h * 3600_000).toISOString();

describe("POST /api/posts clientKey", () => {
  test("the same clientKey twice makes one draft, answers deduped, and keeps the retry's newer words", async () => {
    const { user, media } = await creator();
    const body = { mediaId: media.id, title: "Offline", targets: [{ platform: "instagram", caption: "hi" }], clientKey: "dev_abc-123" };
    const r1 = await posts.POST(req("POST", "/api/posts", body), ctx(""));
    expect(r1.status).toBe(200);
    const j1 = await r1.json();
    expect(j1.deduped).toBeUndefined();
    const r2 = await posts.POST(req("POST", "/api/posts", { ...body, title: "Retry" }), ctx(""));
    expect(r2.status).toBe(200);
    const j2 = await r2.json();
    // Review fix 2: the first answer was lost and the user kept typing; the retry's words are what is stored.
    expect(j2).toMatchObject({ deduped: true, post: { id: j1.post.id, title: "Retry" } });
    expect(await db.post.count({ where: { userId: user.id } })).toBe(1);
    const r3 = await (await posts.POST(req("POST", "/api/posts", { ...body, title: "Retry", targets: [{ platform: "instagram", caption: "typed offline" }] }), ctx(""))).json();
    expect(r3.deduped).toBe(true);
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: j1.post.id } })).caption).toBe("typed offline");
    expect(await db.post.count({ where: { userId: user.id } })).toBe(1);
  });
  test("a draft deleted elsewhere: PATCH is 404, and the same clientKey creates it again", async () => {
    const { user, media } = await creator();
    const body = { mediaId: media.id, title: "Mine", targets: [{ platform: "instagram", caption: "hi" }], clientKey: "dev_gone-1" };
    const first = await (await posts.POST(req("POST", "/api/posts", body), ctx(""))).json();
    await db.post.delete({ where: { id: first.post.id } });
    const patch = await one.PATCH(req("PATCH", `/api/posts/${first.post.id}`, { baseUpdatedAt: first.post.updatedAt, title: "Mine" }), ctx(first.post.id));
    expect(patch.status).toBe(404);
    const again = await (await posts.POST(req("POST", "/api/posts", body), ctx(""))).json();
    expect(again.deduped).toBeUndefined();
    expect(again.post.id).not.toBe(first.post.id);
    expect(await db.post.count({ where: { userId: user.id } })).toBe(1);
  });
  test("no clientKey: every save without a postId is a new draft (unchanged)", async () => {
    const { user, media } = await creator();
    const body = { mediaId: media.id, targets: [{ platform: "instagram", caption: "hi" }] };
    await posts.POST(req("POST", "/api/posts", body), ctx(""));
    await posts.POST(req("POST", "/api/posts", body), ctx(""));
    expect(await db.post.count({ where: { userId: user.id } })).toBe(2);
  });
  test("a bad clientKey is refused; another person's key never matches", async () => {
    const a = await creator();
    expect((await posts.POST(req("POST", "/api/posts", { mediaId: a.media.id, targets: [], clientKey: "bad key!" }), ctx(""))).status).toBe(400);
    await posts.POST(req("POST", "/api/posts", { mediaId: a.media.id, targets: [], clientKey: "shared-key" }), ctx(""));
    const b = await creator();
    const r = await (await posts.POST(req("POST", "/api/posts", { mediaId: b.media.id, targets: [], clientKey: "shared-key" }), ctx(""))).json();
    expect(r.deduped).toBeUndefined();
    expect(await db.post.count({ where: { userId: b.user.id } })).toBe(1);
  });
});

describe("draft conflicts", () => {
  test("PATCH on an older copy that differs: 409 draft_conflict with the stored version, nothing changes", async () => {
    const { user, media } = await creator();
    const p = await draft(user.id, media.id);
    const base = new Date(p.updatedAt.getTime() - 5000).toISOString();
    const r = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { baseUpdatedAt: base, targets: [{ platform: "instagram", caption: "from my phone" }] }), ctx(p.id));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.code).toBe("draft_conflict");
    expect(j.server).toMatchObject({ id: p.id, title: "Mine", updatedAt: p.updatedAt.toISOString(), targets: [{ platform: "instagram", caption: "hello", enabled: true }] });
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: p.id } })).caption).toBe("hello");
  });
  test("PATCH on the current copy saves and returns the new updatedAt; no base behaves as before", async () => {
    const { user, media } = await creator();
    const p = await draft(user.id, media.id);
    const r = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { baseUpdatedAt: p.updatedAt.toISOString(), title: "New", story: "s", hook: "h" }), ctx(p.id));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.post).toMatchObject({ title: "New", story: "s", hook: "h" });
    expect(new Date(j.updatedAt).getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
    const old = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { title: "Again" }), ctx(p.id));
    expect(old.status).toBe(200);
  });
  test("POST save with a stale base that differs: 409; repeating what is stored: saved", async () => {
    const { user, media } = await creator();
    const p = await draft(user.id, media.id);
    const base = new Date(p.updatedAt.getTime() - 5000).toISOString();
    const save = (caption: string) => posts.POST(req("POST", "/api/posts", { postId: p.id, mediaId: media.id, title: "Mine", baseUpdatedAt: base, targets: [{ platform: "instagram", caption }] }), ctx(""));
    expect((await save("changed")).status).toBe(409);
    expect((await save("hello")).status).toBe(200);
  });
});

describe("draft conflicts: the write is conditional", () => {
  const theirsLands = (postId: string, data: Record<string, unknown>) => {
    h.__p2beforePin = async () => {
      await Bun.sleep(5);
      await db.post.update({ where: { id: postId }, data });
    };
  };
  test("PATCH: another device saves between the check and the write: 409, nothing of this one written", async () => {
    const { user, media, accounts } = await creator();
    const p = await draft(user.id, media.id);
    theirsLands(p.id, { title: "Theirs" });
    const r = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { baseUpdatedAt: p.updatedAt.toISOString(), title: "Mine 2", targets: [{ platform: "instagram", accountId: accounts.instagram.id, caption: "from my phone" }] }), ctx(p.id));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.code).toBe("draft_conflict");
    expect(j.server).toMatchObject({ id: p.id, title: "Theirs" });
    const stored = await db.post.findUniqueOrThrow({ where: { id: p.id }, include: { targets: true } });
    expect(stored.title).toBe("Theirs");
    expect(stored.targets[0].caption).toBe("hello");
  });
  test("POST save: the same race is a 409 too; without a base it saves as before", async () => {
    const { user, media } = await creator();
    const p = await draft(user.id, media.id);
    theirsLands(p.id, { story: "theirs" });
    const body = { postId: p.id, mediaId: media.id, title: "Mine", targets: [{ platform: "instagram", caption: "mine" }] };
    const r = await posts.POST(req("POST", "/api/posts", { ...body, baseUpdatedAt: p.updatedAt.toISOString() }), ctx(""));
    expect(r.status).toBe(409);
    expect((await r.json()).server).toMatchObject({ story: "theirs" });
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: p.id } })).caption).toBe("hello");
    theirsLands(p.id, { story: "theirs again" });
    expect((await posts.POST(req("POST", "/api/posts", body), ctx(""))).status).toBe(200);
  });
  test("saves in a row, each on the base the last one returned, never conflict", async () => {
    const { user, media } = await creator();
    const p = await draft(user.id, media.id);
    let base = p.updatedAt.toISOString();
    for (const caption of ["one", "two", "three"]) {
      const sync = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { baseUpdatedAt: base, title: "Mine", targets: [{ platform: "instagram", caption }] }), ctx(p.id));
      expect(sync.status).toBe(200);
      base = (await sync.json()).updatedAt;
      const save = await posts.POST(req("POST", "/api/posts", { postId: p.id, mediaId: media.id, title: "Mine", baseUpdatedAt: base, targets: [{ platform: "instagram", caption: `${caption}!` }] }), ctx(""));
      expect(save.status).toBe(200);
      base = (await save.json()).post.updatedAt;
    }
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: p.id } })).caption).toBe("three!");
  });
});

describe("booking guards", () => {
  test("same media to the same account within 10 minutes: 409 schedule_conflict listing the other post", async () => {
    const { user, media, accounts } = await creator();
    const at = new Date(Date.now() + 5 * 3600_000);
    const other = await db.post.create({ data: { userId: user.id, mediaId: media.id, title: "Booked", status: "scheduled", scheduledAt: new Date(at.getTime() + 5 * 60_000), targets: { create: [{ platform: "instagram", socialAccountId: accounts.instagram.id }] } } });
    const p = await draft(user.id, media.id);
    const r = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { scheduledAt: at.toISOString() }), ctx(p.id));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.code).toBe("schedule_conflict");
    expect(j.conflicts).toEqual([{ postId: other.id, title: "Booked", scheduledAt: other.scheduledAt!.toISOString(), platform: "instagram" }]);
    expect((await db.post.findUniqueOrThrow({ where: { id: p.id } })).scheduledAt).toBeNull();
    // launch with that time is refused the same way, and nothing is booked
    const l = await launch.POST(req("POST", `/api/posts/${p.id}/launch`, { mode: "schedule", scheduledAt: at.toISOString(), confirmed: true }), ctx(p.id));
    expect(l.status).toBe(409);
    expect((await db.post.findUniqueOrThrow({ where: { id: p.id } })).status).toBe("draft");
    // 20 minutes later is fine
    const ok = await launch.POST(req("POST", `/api/posts/${p.id}/launch`, { mode: "schedule", scheduledAt: new Date(at.getTime() + 20 * 60_000).toISOString(), confirmed: true }), ctx(p.id));
    expect(ok.status).toBe(202);
  });
  test("over a platform cap: 422 platform_limit with the platform; fixing the caption in the same PATCH passes", async () => {
    const { user, media } = await creator({ platforms: ["x"] });
    const p = await draft(user.id, media.id, ["x"]);
    await db.postTarget.updateMany({ where: { postId: p.id }, data: { caption: "a".repeat(300) } });
    const r = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { scheduledAt: inHours(3) }), ctx(p.id));
    expect(r.status).toBe(422);
    expect(await r.json()).toMatchObject({ code: "platform_limit", platform: "x" });
    const fixed = await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { scheduledAt: inHours(3), targets: [{ platform: "x", caption: "short" }] }), ctx(p.id));
    expect(fixed.status).toBe(200);
  });
  test("a video longer than the platform takes: 422", async () => {
    const { user, media } = await creator({ platforms: ["x"], duration: 200 });
    const p = await draft(user.id, media.id, ["x"]);
    const r = await launch.POST(req("POST", `/api/posts/${p.id}/launch`, { mode: "schedule", scheduledAt: inHours(2), confirmed: true }), ctx(p.id));
    expect(r.status).toBe(422);
    expect((await r.json()).code).toBe("platform_limit");
  });
  test("GET check is a dry run of the same rules", async () => {
    const { user, media } = await creator({ platforms: ["x"] });
    const p = await draft(user.id, media.id, ["x"]);
    const good = await (await check.GET(req("GET", `/api/posts/${p.id}/check?at=${encodeURIComponent(inHours(4))}`), ctx(p.id))).json();
    expect(good).toMatchObject({ ok: true, issues: [] });
    await db.postTarget.updateMany({ where: { postId: p.id }, data: { caption: "a".repeat(300) } });
    const bad = await (await check.GET(req("GET", `/api/posts/${p.id}/check?at=${encodeURIComponent(new Date(Date.now() + 1000).toISOString())}`), ctx(p.id))).json();
    expect(bad.ok).toBe(false);
    expect(bad.issues.map((i: { code: string }) => i.code).sort()).toEqual(["platform_limit", "too_soon"]);
    expect((await check.GET(req("GET", `/api/posts/${p.id}/check?at=nope`), ctx(p.id))).status).toBe(400);
    expect((await db.post.findUniqueOrThrow({ where: { id: p.id } })).scheduledAt).toBeNull();
    await creator(); // someone else
    expect((await check.GET(req("GET", `/api/posts/${p.id}/check?at=${encodeURIComponent(inHours(4))}`), ctx(p.id))).status).toBe(404);
  });
  test("bulk: a video already booked on that account nearby stops the batch before anything is created", async () => {
    const { user, media, accounts } = await creator();
    const at = new Date(Date.now() + 6 * 3600_000);
    await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "scheduled", scheduledAt: at, targets: { create: [{ platform: "instagram", socialAccountId: accounts.instagram.id }] } } });
    const before = await db.post.count({ where: { userId: user.id } });
    const r = await bulk.POST(req("POST", "/api/posts/bulk", { platforms: ["instagram"], items: [{ mediaId: media.id, caption: "c", scheduledAt: new Date(at.getTime() + 60_000).toISOString() }] }), ctx(""));
    expect(r.status).toBe(409);
    const j = await r.json();
    expect(j.code).toBe("schedule_conflict");
    expect(j.error).toStartWith("Video 1: ");
    expect(await db.post.count({ where: { userId: user.id } })).toBe(before);
  });
});

describe("unschedule and send again", () => {
  test("cancel on a booked post takes it off the schedule and back to a draft", async () => {
    const { user, media } = await creator();
    const p = await draft(user.id, media.id);
    expect((await launch.POST(req("POST", `/api/posts/${p.id}/launch`, { mode: "schedule", scheduledAt: inHours(5), confirmed: true }), ctx(p.id))).status).toBe(202);
    const r = await cancel.POST(req("POST", `/api/posts/${p.id}/cancel`, {}), ctx(p.id));
    expect(r.status).toBe(200);
    const j = await r.json();
    expect(j.post).toMatchObject({ id: p.id, status: "draft", scheduledAt: null });
    // and it can be booked again
    expect((await launch.POST(req("POST", `/api/posts/${p.id}/launch`, { mode: "schedule", scheduledAt: inHours(6), confirmed: true }), ctx(p.id))).status).toBe(202);
  });
  test("cancel on a draft still says nothing is on its way (unchanged)", async () => {
    const { user, media } = await creator();
    const p = await draft(user.id, media.id);
    expect((await cancel.POST(req("POST", `/api/posts/${p.id}/cancel`, {}), ctx(p.id))).status).toBe(409);
  });
  test("a failed destination keeps its error until it is sent again through launch", async () => {
    const { user, media, accounts } = await creator({ platforms: ["instagram", "x"] });
    const p = await db.post.create({
      data: {
        userId: user.id,
        mediaId: media.id,
        status: "partial",
        launchedAt: new Date(),
        targets: {
          create: [
            { platform: "instagram", socialAccountId: accounts.instagram.id, platformStatus: "failed", errorCode: "NETWORK", errorMessage: "timeout" },
            { platform: "x", socialAccountId: accounts.x.id, platformStatus: "published", platformPostId: "1", caption: "hi" },
          ],
        },
      },
    });
    const view = await (await one.GET(req("GET", `/api/posts/${p.id}`), ctx(p.id))).json();
    expect(view.post.targets.find((t: { platform: string }) => t.platform === "instagram")).toMatchObject({ status: "failed", errorCode: "NETWORK", errorDetail: "timeout" });
    await one.PATCH(req("PATCH", `/api/posts/${p.id}`, { title: "Fixed title" }), ctx(p.id));
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: p.id, platform: "instagram" } })).errorCode).toBe("NETWORK");
    jobs = [];
    expect((await launch.POST(req("POST", `/api/posts/${p.id}/launch`, { mode: "now", confirmed: true }), ctx(p.id))).status).toBe(202);
    const ig = await db.postTarget.findFirstOrThrow({ where: { postId: p.id, platform: "instagram" } });
    expect(ig).toMatchObject({ platformStatus: "queued", errorCode: null });
    expect((await db.postTarget.findFirstOrThrow({ where: { postId: p.id, platform: "x" } })).platformStatus).toBe("published");
    expect(jobs.filter((j) => j.name === "SOCIAL_UPLOAD")).toHaveLength(1);
  });
});
