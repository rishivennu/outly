/**
 * Phase 2 review fixes (p2-fix-misc): the calendar's account summary respects a member's scope (8), a range over
 * the cap says it was cut short (9), a unique clash on comment state is retried (10), a moved post never fires at
 * its old time (11), and unscheduling gives back the slot of the period it was booked in (12).
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (k: string) => jar.has(k),
  set: (k: string, v?: string, o?: Record<string, unknown>) => void jar.set(k, { value: v ?? "", opts: o ?? {} }),
  delete: (k: string) => jar.delete(k),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));
const g = globalThis as unknown as { __fixUser?: unknown; __queueBackend?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__fixUser !== undefined ? g.__fixUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let calRoute: typeof import("../app/api/calendar/route");
let cancel: typeof import("../app/api/posts/[id]/cancel/route");
let state: typeof import("../lib/inbox-state");
let handlers: typeof import("../lib/queue/handlers");
let del: typeof import("../lib/posts/delete");
let periodKey: typeof import("../lib/billing/entitlements").periodKey;
let jobs: { name: string; data: unknown }[] = [];
let previousBackend: unknown;

beforeAll(async () => {
  previousBackend = g.__queueBackend;
  g.__queueBackend = { add: async (name: string, data: unknown) => void jobs.push({ name, data }) };
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  calRoute = await import("../app/api/calendar/route");
  cancel = await import("../app/api/posts/[id]/cancel/route");
  state = await import("../lib/inbox-state");
  handlers = await import("../lib/queue/handlers");
  del = await import("../lib/posts/delete");
  ({ periodKey } = await import("../lib/billing/entitlements"));
}, 60_000);
afterAll(() => {
  delete g.__fixUser;
  g.__queueBackend = previousBackend;
});

let n = 0;
async function studio(platforms: string[] = ["instagram"]) {
  n++;
  const user = await db.user.create({ data: { name: "Fix", email: `fixmisc${n}-${Date.now()}@test.dev`, passwordHash: "x", timezone: "UTC" } });
  const accounts = [];
  for (const platform of platforms)
    accounts.push(await db.socialAccount.create({ data: { userId: user.id, platform, platformUserId: `fm-${platform}-${n}-${Date.now()}`, username: "u", accessToken: encrypt("tok"), status: "connected" } }));
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "v.mp4", storageKey: `fixmisc/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1000, duration: 20, width: 1080, height: 1920, status: "ready" } });
  return { user, accounts, media };
}
const as = (user: { id: string; createdAt: Date }, scope: string[] | null = null) => (g.__fixUser = { ...user, role: "owner", scope, joinedAt: user.createdAt });
const req = (method: string, path: string) => new NextRequest(`http://localhost${path}`, { method, headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" } });
const day = (d: number, h = 10) => new Date(Date.UTC(2031, 0, d, h));
const range = (from: Date, to: Date) => calRoute.GET(req("GET", `/api/calendar?list=range&from=${from.toISOString()}&to=${to.toISOString()}`), { params: {} } as never);

describe("8: calendar accounts follow the member's scope", () => {
  test("a scoped member gets only their accounts; the owner gets all", async () => {
    const s = await studio(["instagram", "youtube"]);
    const [ig, yt] = s.accounts;
    as(s.user, [ig.id]);
    const scoped = await (await range(day(1, 0), day(8, 0))).json();
    expect(scoped.accounts.map((a: { id: string }) => a.id)).toEqual([ig.id]);
    const up = await (await calRoute.GET(req("GET", "/api/calendar?list=upcoming"), { params: {} } as never)).json();
    expect(up.accounts.map((a: { id: string }) => a.id)).toEqual([ig.id]);
    as(s.user);
    const all = await (await range(day(1, 0), day(8, 0))).json();
    expect(all.accounts.map((a: { id: string }) => a.id).sort()).toEqual([ig.id, yt.id].sort());
  });
});

describe("9: a range over the cap says so", () => {
  test("401 posts: the first 400 and truncated; 400 posts: all and not truncated", async () => {
    const s = await studio();
    const ig = s.accounts[0];
    const at = (i: number) => new Date(+day(10, 0) + i * 60_000);
    await db.post.createMany({ data: Array.from({ length: 401 }, (_, i) => ({ id: `fm9-${n}-${i}`, userId: s.user.id, mediaId: s.media.id, title: `p${i}`, status: "scheduled", scheduledAt: at(i) })) });
    await db.postTarget.createMany({ data: Array.from({ length: 401 }, (_, i) => ({ postId: `fm9-${n}-${i}`, platform: "instagram", socialAccountId: ig.id })) });
    as(s.user);
    const cut = await (await range(day(9, 0), day(16, 0))).json();
    expect(cut.posts).toHaveLength(400);
    expect(cut.truncated).toBe(true);
    await db.post.delete({ where: { id: `fm9-${n}-400` } });
    const whole = await (await range(day(9, 0), day(16, 0))).json();
    expect(whole.posts).toHaveLength(400);
    expect(whole.truncated).toBe(false);
  }, 60_000);
});

/** Puts db.$transaction back exactly as it was (own property or inherited). */
function keep(d: { $transaction: unknown }) {
  const own = Object.getOwnPropertyDescriptor(d, "$transaction");
  return () => (own ? Object.defineProperty(d, "$transaction", own) : delete (d as { $transaction?: unknown }).$transaction);
}

describe("10: comment state survives a unique clash", () => {
  test("a P2002 from a racing create is retried once and the write lands", async () => {
    const s = await studio();
    const ig = s.accounts[0];
    const real = db.$transaction.bind(db);
    let calls = 0;
    const d = db as unknown as { $transaction: unknown };
    const restore = keep(d);
    d.$transaction = (...args: unknown[]) => {
      calls++;
      if (calls === 1) return Promise.reject(Object.assign(new Error("Unique constraint failed"), { code: "P2002" }));
      return (real as (...a: unknown[]) => unknown)(...args);
    };
    try {
      const rows = await state.setCommentStates(s.user.id, { items: [{ accountId: ig.id, itemId: "c1" }], archived: true });
      expect(calls).toBe(2);
      expect(rows).toEqual([{ accountId: ig.id, itemId: "c1", read: "read", archived: true }]);
    } finally {
      restore();
    }
    expect(typeof db.$transaction).toBe("function");
  });
  test("any other error is not retried", async () => {
    const s = await studio();
    const real = db.$transaction.bind(db);
    let calls = 0;
    const d = db as unknown as { $transaction: unknown };
    const restore = keep(d);
    d.$transaction = () => (calls++, Promise.reject(Object.assign(new Error("boom"), { code: "P1001" })));
    try {
      await expect(state.setCommentStates(s.user.id, { items: [{ accountId: s.accounts[0].id, itemId: "c2" }], read: true })).rejects.toThrow("boom");
      expect(calls).toBe(1);
    } finally {
      restore();
    }
    expect(db.$transaction).toBeDefined();
    void real;
  });
  test("two writes of the same new comment at once both succeed and leave one row", async () => {
    const s = await studio();
    const ig = s.accounts[0];
    const item = { items: [{ accountId: ig.id, itemId: "same" }], read: true };
    await Promise.all([state.setCommentStates(s.user.id, item), state.setCommentStates(s.user.id, item)]);
    expect(await db.inboxItemState.count({ where: { userId: s.user.id, itemId: "same" } })).toBe(1);
  });
});

describe("11: a moved post never fires at its old time", () => {
  test("the old job finds the post booked later and leaves it alone; the new one sends it once", async () => {
    const s = await studio();
    const post = await db.post.create({
      data: { userId: s.user.id, mediaId: s.media.id, title: "moved", status: "scheduled", scheduledAt: new Date(Date.now() + 3 * 3600_000), launchedAt: new Date(), targets: { create: [{ platform: "instagram", socialAccountId: s.accounts[0].id, platformStatus: "pending" }] } },
    });
    jobs = [];
    await handlers.runJob("SCHEDULED_POST", { postId: post.id });
    const still = await db.post.findUniqueOrThrow({ where: { id: post.id }, include: { targets: true } });
    expect(still.status).toBe("scheduled");
    expect(still.targets[0].platformStatus).toBe("pending");
    expect(jobs.filter((j) => j.name === "SOCIAL_UPLOAD")).toHaveLength(0);
    // Its new time comes: that job sends it, and a late duplicate does nothing.
    await db.post.update({ where: { id: post.id }, data: { scheduledAt: new Date(Date.now() - 1000) } });
    await handlers.runJob("SCHEDULED_POST", { postId: post.id });
    await handlers.runJob("SCHEDULED_POST", { postId: post.id });
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("publishing");
    expect(jobs.filter((j) => j.name === "SOCIAL_UPLOAD")).toHaveLength(1);
  });
  test("a cancelled post's waiting job bows out", async () => {
    const s = await studio();
    const post = await db.post.create({ data: { userId: s.user.id, mediaId: s.media.id, title: "off", status: "draft", scheduledAt: null, targets: { create: [{ platform: "instagram", socialAccountId: s.accounts[0].id, platformStatus: "pending" }] } } });
    jobs = [];
    await handlers.runJob("SCHEDULED_POST", { postId: post.id });
    expect((await db.post.findUniqueOrThrow({ where: { id: post.id } })).status).toBe("draft");
    expect(jobs).toHaveLength(0);
  });
});

describe("12: unscheduling gives back the slot of the period it was booked in", () => {
  const earlier = new Date(Date.now() - 45 * 864e5);
  async function booked() {
    const s = await studio();
    const post = await db.post.create({
      data: { userId: s.user.id, mediaId: s.media.id, title: "booked", status: "scheduled", scheduledAt: new Date(Date.now() + 864e5), launchedAt: earlier, targets: { create: [{ platform: "instagram", socialAccountId: s.accounts[0].id, platformStatus: "pending" }] } },
    });
    await db.featureUse.create({ data: { userId: s.user.id, feature: "post", period: periodKey("month", earlier), ref: post.id } });
    return { ...s, post };
  }
  test("cancel releases a slot charged in an earlier month", async () => {
    const { user, post } = await booked();
    as(user);
    const r = await cancel.POST(req("POST", `/api/posts/${post.id}/cancel`), { params: { id: post.id } } as never);
    expect(r.status).toBe(200);
    expect((await r.json()).post).toMatchObject({ status: "draft", scheduledAt: null });
    expect(await db.featureUse.count({ where: { userId: user.id, feature: "post", ref: post.id } })).toBe(0);
  });
  test("only the newest charge goes back; an earlier attempt stays history", async () => {
    const { user, post } = await booked();
    const older = new Date(+earlier - 60 * 864e5);
    await db.featureUse.create({ data: { userId: user.id, feature: "post", period: periodKey("month", older), ref: post.id, createdAt: older } });
    expect(await del.releasePostSlot(user.id, post.id, new Date(), { booked: true })).toBe(1);
    const left = await db.featureUse.findMany({ where: { userId: user.id, feature: "post", ref: post.id } });
    expect(left.map((x) => x.period)).toEqual([periodKey("month", older)]);
  });
  test("delete (not booked) still leaves earlier periods alone", async () => {
    const { user, post } = await booked();
    expect(await del.releasePostSlot(user.id, post.id)).toBe(0);
    expect(await db.featureUse.count({ where: { userId: user.id, feature: "post", ref: post.id } })).toBe(1);
  });
});
