/**
 * Phase 2 inbox comments: read / unread / archive state (lib/inbox-state.ts, PATCH /api/inbox/state), merged into the
 * live comment list (lib/inbox.ts), and comment notifications (lib/notify-events.ts) that fire once, honour the
 * per-type switch and quiet hours, and only where Inbox can open the comment.
 */
import { afterAll, beforeAll, beforeEach, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";

const jar: Map<string, { value: string; opts: Record<string, unknown> }> = ((globalThis as { __testCookieJar?: Map<string, { value: string; opts: Record<string, unknown> }> }).__testCookieJar ??= new Map());
const cookieApi = {
  get: (n: string) => (jar.has(n) ? { name: n, value: jar.get(n)!.value } : undefined),
  getAll: () => [...jar].map(([name, c]) => ({ name, value: c.value })),
  has: (n: string) => jar.has(n),
  set: (n: string | { name: string; value: string }, v?: string, o?: Record<string, unknown>) => {
    if (typeof n === "object") {
      const { name, value, ...rest } = n as { name: string; value: string };
      jar.set(name, { value, opts: rest });
    } else jar.set(n, { value: v ?? "", opts: o ?? {} });
  },
  delete: (n: string | { name: string }) => jar.delete(typeof n === "object" ? n.name : n),
};
mock.module("next/headers", () => ({ cookies: () => cookieApi, headers: () => new Headers() }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let state: typeof import("../lib/inbox-state");
let inboxMod: typeof import("../lib/inbox");
let events: typeof import("../lib/notify-events");
let createSession: typeof import("../lib/auth").createSession;
let PATCH: typeof import("../app/api/inbox/state/route").PATCH;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  state = await import("../lib/inbox-state");
  inboxMod = await import("../lib/inbox");
  events = await import("../lib/notify-events");
  ({ createSession } = await import("../lib/auth"));
  ({ PATCH } = await import("../app/api/inbox/state/route"));
}, 60_000);

beforeEach(() => jar.clear());
afterAll(() => jar.clear());

let n = 0;
async function fixture(platform: "instagram" | "youtube" | "x" | "facebook" = "instagram") {
  n++;
  const user = await db.user.create({ data: { name: "Cmt", email: `p2cmt-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "a.mp4", storageKey: `p2cmt/${n}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
  const post = await db.post.create({ data: { userId: user.id, mediaId: media.id, status: "published", title: "Shot in Goa" } });
  const acct = await db.socialAccount.create({ data: { userId: user.id, platform, platformUserId: `mock-${platform}-p2-${n}`, username: "@maya", accessToken: encrypt("tok"), status: "connected" } });
  const target = await db.postTarget.create({ data: { postId: post.id, platform, socialAccountId: acct.id, platformStatus: "published", platformPostId: `p2media-${n}`, practice: true, publishedAt: new Date() } });
  return { user, acct, target };
}

const H = { "content-type": "application/json", origin: "http://localhost", host: "localhost" };
const patch = (body: unknown) => PATCH(new NextRequest("http://localhost/api/inbox/state", { method: "PATCH", body: JSON.stringify(body), headers: H }), { params: {} } as never);

describe("stateData", () => {
  const now = new Date("2026-11-15T10:00:00Z");
  test("a new row counts as seen unless it is marked unread", () => {
    expect(state.stateData({ archived: true }, now).create).toEqual({ readAt: now, archivedAt: now });
    expect(state.stateData({ read: false }, now).create).toEqual({ readAt: null, archivedAt: null });
  });
  test("an update only touches what was asked", () => {
    expect(state.stateData({ archived: false }, now).update).toEqual({ archivedAt: null });
    expect(state.stateData({ read: true }, now).update).toEqual({ readAt: now });
  });
  test("the schema refuses an empty change and an oversize batch", () => {
    expect(state.inboxStateSchema.safeParse({ items: [{ accountId: "a", itemId: "c" }] }).success).toBe(false);
    expect(state.inboxStateSchema.safeParse({ items: [], read: true }).success).toBe(false);
    const many = Array.from({ length: 101 }, (_, i) => ({ accountId: "a", itemId: `c${i}` }));
    expect(state.inboxStateSchema.safeParse({ items: many, read: true }).success).toBe(false);
    expect(state.inboxStateSchema.safeParse({ items: many.slice(0, 100), archived: true }).success).toBe(true);
  });
});

describe("setCommentStates / loadCommentStates", () => {
  test("read, unread and archive round-trip per account and comment", async () => {
    const f = await fixture();
    await state.setCommentStates(f.user.id, { items: [{ accountId: f.acct.id, itemId: "c1" }, { accountId: f.acct.id, itemId: "c2" }], read: true });
    await state.setCommentStates(f.user.id, { items: [{ accountId: f.acct.id, itemId: "c2" }], read: false });
    await state.setCommentStates(f.user.id, { items: [{ accountId: f.acct.id, itemId: "c3" }], archived: true });
    const m = await state.loadCommentStates(f.user.id, [f.acct.id]);
    expect(m.get(state.stateKey(f.acct.id, "c1"))).toEqual({ read: "read", archived: false });
    expect(m.get(state.stateKey(f.acct.id, "c2"))).toEqual({ read: "unread", archived: false });
    expect(m.get(state.stateKey(f.acct.id, "c3"))).toEqual({ read: "read", archived: true });
    await state.setCommentStates(f.user.id, { items: [{ accountId: f.acct.id, itemId: "c3" }], archived: false });
    expect((await state.loadCommentStates(f.user.id, [f.acct.id])).get(state.stateKey(f.acct.id, "c3"))).toEqual({ read: "read", archived: false });
  });

  test("a duplicate in one batch is written once", async () => {
    const f = await fixture();
    const out = await state.setCommentStates(f.user.id, { items: [{ accountId: f.acct.id, itemId: "d" }, { accountId: f.acct.id, itemId: "d" }], read: true });
    expect(out).toHaveLength(1);
    expect(await db.inboxItemState.count({ where: { userId: f.user.id } })).toBe(1);
  });

  test("another user's account refuses the whole batch with a 404, and writes nothing", async () => {
    const a = await fixture();
    const b = await fixture();
    await expect(state.setCommentStates(a.user.id, { items: [{ accountId: a.acct.id, itemId: "x" }, { accountId: b.acct.id, itemId: "y" }], read: true })).rejects.toMatchObject({ status: 404 });
    expect(await db.inboxItemState.count({ where: { userId: { in: [a.user.id, b.user.id] } } })).toBe(0);
  });

  test("a scoped member cannot mark comments on an account outside their scope", async () => {
    const f = await fixture();
    await expect(state.setCommentStates(f.user.id, { items: [{ accountId: f.acct.id, itemId: "z" }], read: true }, ["some-other-account"])).rejects.toMatchObject({ status: 404 });
  });

  test("states are per user: the same comment id on another user's row is not read back", async () => {
    const a = await fixture();
    const b = await fixture();
    await state.setCommentStates(a.user.id, { items: [{ accountId: a.acct.id, itemId: "same" }], archived: true });
    expect((await state.loadCommentStates(b.user.id, [a.acct.id])).size).toBe(0);
  });
});

describe("inbox() merges the stored state into the live comments", () => {
  test("every comment carries its account, a reply flag and its state; chips list comment-capable platforms", async () => {
    const f = await fixture();
    const first = await inboxMod.inbox(f.user.id);
    expect(first.comments.length).toBeGreaterThan(0);
    const c = first.comments[0];
    expect(c.accountId).toBe(f.acct.id);
    expect(c.canReply).toBe(true);
    expect(c.read).toBeNull();
    expect(c.archived).toBe(false);
    expect(first.platforms).toEqual(["instagram"]);
    await state.setCommentStates(f.user.id, { items: [{ accountId: f.acct.id, itemId: c.id }], archived: true });
    const again = await inboxMod.inbox(f.user.id);
    const same = again.comments.find((x) => x.id === c.id)!;
    expect(same.archived).toBe(true);
    expect(same.read).toBe("read");
  });

  test("a platform whose API lists no comments is neither a chip nor an error", async () => {
    const f = await fixture("facebook");
    await db.postTarget.update({ where: { id: f.target.id }, data: { practice: false } });
    await db.socialAccount.update({ where: { id: f.acct.id }, data: { platformUserId: `fb-real-${n}` } });
    const out = await inboxMod.inbox(f.user.id);
    expect(out.platforms).toEqual([]);
    expect(out.errors.filter((e) => /not wired up/.test(e.detail ?? ""))).toEqual([]);
  });
});

describe("PATCH /api/inbox/state", () => {
  test("signed out is 401", async () => {
    const res = await patch({ items: [{ accountId: "a", itemId: "b" }], read: true });
    expect(res.status).toBe(401);
  });
  test("the owner marks a batch; a foreign account is 404; a bad body is 400", async () => {
    const f = await fixture();
    const other = await fixture();
    jar.clear();
    await createSession(f.user.id);
    const ok = await patch({ items: [{ accountId: f.acct.id, itemId: "r1" }, { accountId: f.acct.id, itemId: "r2" }], read: true });
    expect(ok.status).toBe(200);
    const body = (await ok.json()) as { states: { itemId: string; read: string }[] };
    expect(body.states.map((s) => s.read)).toEqual(["read", "read"]);
    expect((await patch({ items: [{ accountId: other.acct.id, itemId: "r1" }], archived: true })).status).toBe(404);
    expect((await patch({ items: [{ accountId: f.acct.id, itemId: "r1" }] })).status).toBe(400);
  });
});

describe("comment notifications", () => {
  const ev = (f: { acct: { id: string } }, commentId: string, platform = "instagram") => ({ accountId: f.acct.id, platform, commentId, replyTo: commentId, mediaId: "m1", targetId: `a:${f.acct.id}:m1`, postTitle: "Goa", from: "@priya", text: "Love it" });

  test("once per comment, even when Meta retries it after a newer one", async () => {
    const f = await fixture();
    const t0 = new Date();
    await events.noticeNewComment(f.user.id, ev(f, "k1"), t0);
    await events.noticeNewComment(f.user.id, ev(f, "k2"), new Date(t0.getTime() + 30 * 60_000));
    await db.notice.updateMany({ where: { userId: f.user.id }, data: { readAt: new Date() } });
    await events.noticeNewComment(f.user.id, ev(f, "k1"), new Date(t0.getTime() + 90 * 60_000));
    const rows = await db.notice.findMany({ where: { userId: f.user.id, kind: "new_comment" } });
    expect(rows).toHaveLength(2);
    expect(rows.every((r) => r.readAt)).toBe(true);
  });

  test("the link opens the exact comment in Inbox", async () => {
    const f = await fixture();
    await events.noticeNewComment(f.user.id, ev(f, "deep1"));
    const row = await db.notice.findFirstOrThrow({ where: { userId: f.user.id, kind: "new_comment" } });
    expect(row.href).toBe(`/inbox?comment=deep1&target=${encodeURIComponent(`a:${f.acct.id}:m1`)}`);
  });

  test("Facebook comments do not notify: Inbox has no way to open them", async () => {
    const f = await fixture();
    await events.noticeNewComment(f.user.id, ev(f, "fb1", "facebook"));
    expect(await db.notice.count({ where: { userId: f.user.id } })).toBe(0);
  });

  test("the New comments switch off means no notice", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.user.id }, data: { notifyPrefs: JSON.stringify({ ev: { new_comment: false } }) } });
    await events.noticeNewComment(f.user.id, ev(f, "off1"));
    expect(await db.notice.count({ where: { userId: f.user.id } })).toBe(0);
  });

  test("quiet hours keep the push back but the notice still lands in the bell", async () => {
    const f = await fixture();
    await db.user.update({ where: { id: f.user.id }, data: { timezone: "UTC", notifyPrefs: JSON.stringify({ quiet: { on: true, start: "00:00", end: "23:59", urgent: false } }) } });
    await events.noticeNewComment(f.user.id, ev(f, "q1"), new Date("2026-11-15T12:00:00Z"));
    expect(await db.notice.count({ where: { userId: f.user.id, kind: "new_comment" } })).toBe(1);
    const log = await db.notifyDelivery.findMany({ where: { userId: f.user.id, kind: "new_comment" } });
    expect(log.some((r) => r.reason === "quiet_hours")).toBe(true);
  });
});
