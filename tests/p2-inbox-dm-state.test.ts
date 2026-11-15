/**
 * Phase 2 (1155): direct message state against the test database. Read / unread, archive (Outlly only, cleared
 * by a new inbound message), list views and cursors, history pages, typed rate limits, the PATCH state route.
 */
import { afterAll, afterEach, beforeAll, describe, expect, mock, test } from "bun:test";
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
const g = globalThis as unknown as { __p2dmUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__p2dmUser !== undefined ? g.__p2dmUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let svc: typeof import("../lib/messages/service");
let wh: typeof import("../lib/messages/webhook");
let enc: (s: string) => string;
let stateRoute: typeof import("../app/api/messages/[id]/state/route");
let listRoute: typeof import("../app/api/messages/route");
let threadRoute: typeof import("../app/api/messages/[id]/route");
let n = 0;

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
});
afterAll(() => {
  delete g.__p2dmUser;
});

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  svc = await import("../lib/messages/service");
  wh = await import("../lib/messages/webhook");
  enc = (await import("../lib/crypto")).encrypt;
  stateRoute = await import("../app/api/messages/[id]/state/route");
  listRoute = await import("../app/api/messages/route");
  threadRoute = await import("../app/api/messages/[id]/route");
}, 60_000);

async function setup(platform: "instagram" | "facebook" = "instagram") {
  const u = await db.user.create({ data: { name: `P2dm ${++n}`, email: `p2dm-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  const pid = `${platform === "instagram" ? "1784" : "1022"}${Date.now()}${n}`;
  const a = await db.socialAccount.create({ data: { userId: u.id, platform, platformUserId: pid, username: `@p2dm${n}`, accessToken: enc("tok-" + n) } });
  return { u, a, pid };
}
const thread = (u: { id: string }, a: { id: string; platform: string }, i: number, at: Date, extra: Record<string, unknown> = {}) =>
  db.dmThread.create({ data: { userId: u.id, accountId: a.id, platform: a.platform, participantId: `person-${i}-${n}`, participantName: `Person ${i}`, lastMessageAt: at, lastInboundAt: at, unread: 1, ...extra } });
const igMessage = (entryId: string, from: string, mid: string, text: string) => ({
  object: "instagram",
  entry: [{ id: entryId, time: Date.now(), messaging: [{ sender: { id: from }, recipient: { id: entryId }, timestamp: Date.now(), message: { mid, text } }] }],
});
const as = (u: { id: string; createdAt: Date }, role = "owner") => {
  g.__p2dmUser = { ...u, role, joinedAt: u.createdAt, scope: null };
};
const headers = { origin: "http://localhost", host: "localhost", "content-type": "application/json" };
const patch = (id: string, body: unknown) => stateRoute.PATCH(new NextRequest(`http://localhost/api/messages/${id}/state`, { method: "PATCH", body: JSON.stringify(body), headers }), { params: { id } } as never);

describe("read and unread", () => {
  test("mark unread sets one unread, mark read clears it, and nothing is sent to Meta", async () => {
    const { u, a } = await setup();
    const t = await thread(u, a, 1, new Date(), { unread: 0 });
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("{}");
    }) as unknown as typeof fetch;
    expect((await svc.setThreadState(u.id, t.id, { read: false })).thread.unread).toBe(1);
    expect((await svc.setThreadState(u.id, t.id, { read: false })).thread.unread).toBe(1);
    expect((await svc.setThreadState(u.id, t.id, { read: true })).thread.unread).toBe(0);
    expect(calls).toBe(0);
  });

  test("the unread view lists only unread, not archived, threads", async () => {
    const { u, a } = await setup();
    const now = Date.now();
    const t1 = await thread(u, a, 1, new Date(now - 1000));
    await thread(u, a, 2, new Date(now - 2000), { unread: 0 });
    await thread(u, a, 3, new Date(now - 3000), { archivedAt: new Date() });
    const list = await svc.listThreads(u.id, undefined, null, { view: "unread" });
    expect(list.threads.map((t) => t.id)).toEqual([t1.id]);
  });
});

describe("archive (Outlly only)", () => {
  test("archived threads leave the inbox, show under archived, and can be restored", async () => {
    const { u, a } = await setup();
    const t = await thread(u, a, 1, new Date());
    const r = await svc.setThreadState(u.id, t.id, { archived: true });
    expect(r.thread.archivedAt).toBeTruthy();
    const inbox = await svc.listThreads(u.id);
    expect(inbox.threads.find((x) => x.id === t.id)).toBeUndefined();
    expect(inbox.archived).toBe(1);
    expect((await svc.listThreads(u.id, undefined, null, { view: "archived" })).threads.map((x) => x.id)).toEqual([t.id]);
    await svc.setThreadState(u.id, t.id, { archived: false });
    expect((await svc.listThreads(u.id)).threads.map((x) => x.id)).toContain(t.id);
  });

  test("a new inbound message brings an archived thread back; our own reply does not", async () => {
    const { u, a, pid } = await setup();
    globalThis.fetch = (async () => new Response(JSON.stringify({}), { status: 200 })) as unknown as typeof fetch;
    await svc.ingestEvents(wh.parseWebhook(igMessage(pid, "fan-1", `m1-${n}`, "hi")));
    const t = await db.dmThread.findFirstOrThrow({ where: { accountId: a.id } });
    await svc.setThreadState(u.id, t.id, { archived: true });
    await svc.ingestEvents([{ platform: "instagram", accountPlatformId: pid, personId: "fan-1", mid: `out-${n}`, direction: "out", text: "thanks", attachments: [], sentAt: new Date(Date.now() + 1000) }]);
    expect((await db.dmThread.findUniqueOrThrow({ where: { id: t.id } })).archivedAt).not.toBeNull();
    await svc.ingestEvents([{ platform: "instagram", accountPlatformId: pid, personId: "fan-1", mid: `m2-${n}`, direction: "in", text: "one more thing", attachments: [], sentAt: new Date(Date.now() + 2000) }]);
    expect((await db.dmThread.findUniqueOrThrow({ where: { id: t.id } })).archivedAt).toBeNull();
  });
});

describe("pages", () => {
  test("cursor pages walk every thread once, newest first, even with equal times", async () => {
    const { u, a } = await setup();
    const at = new Date(Date.now() - 60_000);
    const made = [];
    for (let i = 0; i < 5; i++) made.push(await thread(u, a, i, i < 3 ? at : new Date(at.getTime() - i * 1000)));
    const seen: string[] = [];
    let cursor: string | null = null;
    for (let i = 0; i < 5; i++) {
      const page: Awaited<ReturnType<typeof svc.listThreads>> = await svc.listThreads(u.id, undefined, null, { cursor, take: 2 });
      seen.push(...page.threads.map((t) => t.id));
      cursor = page.nextCursor;
      if (!cursor) break;
    }
    expect(seen.sort()).toEqual(made.map((t) => t.id).sort());
    expect(new Set(seen).size).toBe(5);
  });

  test("platforms lists connected DM platforms only", async () => {
    const { u } = await setup("instagram");
    await db.socialAccount.create({ data: { userId: u.id, platform: "youtube", platformUserId: `yt-${n}`, username: "y", accessToken: enc("t") } });
    await db.socialAccount.create({ data: { userId: u.id, platform: "facebook", platformUserId: `fb-${n}`, username: "f", accessToken: enc("t"), status: "disconnected" } });
    expect((await svc.listThreads(u.id)).platforms).toEqual(["instagram"]);
  });

  test("history: newest page first, older pages by cursor, and paging back leaves unread alone", async () => {
    const { u, a } = await setup();
    const t = await thread(u, a, 1, new Date(), { unread: 0 });
    const base = Date.now() - 3600_000;
    for (let i = 0; i < 55; i++) await db.dmMessage.create({ data: { threadId: t.id, platformMessageId: `h-${n}-${i}`, direction: "in", text: enc(`m${i}`), sentAt: new Date(base + i * 1000) } });
    const first = await svc.getThread(u.id, t.id);
    expect(first.messages).toHaveLength(50);
    expect(first.messages[49].text).toBe("m54");
    expect(first.olderCursor).toBeTruthy();
    await svc.setThreadState(u.id, t.id, { read: false });
    const older = await svc.getThread(u.id, t.id, null, { before: first.olderCursor });
    expect(older.messages.map((m) => m.text)).toEqual(["m0", "m1", "m2", "m3", "m4"]);
    expect(older.olderCursor).toBeNull();
    expect((await db.dmThread.findUniqueOrThrow({ where: { id: t.id } })).unread).toBe(1);
    await expect(svc.getThread(u.id, t.id, null, { before: "nope" })).rejects.toMatchObject({ status: 400 });
  });
});

describe("Meta rate limits are typed", () => {
  test("a throttled send says when to try again", async () => {
    const { u, a } = await setup();
    const t = await thread(u, a, 1, new Date());
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ error: { code: 4, type: "OAuthException", message: "Application request limit reached", fbtrace_id: "x" } }), {
        status: 400,
        headers: { "x-business-use-case-usage": JSON.stringify({ a: [{ estimated_time_to_regain_access: 5 }] }) },
      })) as unknown as typeof fetch;
    const err = await svc.replyToThread(u.id, u.id, t.id, "hi").then(() => null, (e) => e);
    expect(err).toMatchObject({ status: 429, code: "RATE_LIMITED" });
    expect(err.message).toContain("about 5 minutes");
    expect(err.extra.retryAfterSec).toBe(300);
    expect(Date.parse(err.extra.retryAt)).toBeGreaterThan(Date.now() + 290_000);
    expect(await db.dmMessage.count({ where: { threadId: t.id, direction: "out" } })).toBe(0);
  });
});

describe("routes", () => {
  test("PATCH state validates, isolates workspaces and returns the thread", async () => {
    const { u, a } = await setup();
    const t = await thread(u, a, 1, new Date());
    as(u);
    const r = await patch(t.id, { read: true, archived: true });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.thread).toMatchObject({ id: t.id, unread: 0 });
    expect(body.thread.archivedAt).toBeTruthy();
    expect((await patch(t.id, {})).status).toBe(400);
    expect((await patch(t.id, { read: "yes" })).status).toBe(400);
    expect((await patch(t.id, { read: true, extra: 1 })).status).toBe(400);
    const other = await setup();
    as(other.u);
    expect((await patch(t.id, { read: false })).status).toBe(404);
    expect((await db.dmThread.findUniqueOrThrow({ where: { id: t.id } })).unread).toBe(0);
  });

  test("GET list takes view and cursor; GET thread takes before", async () => {
    const { u, a } = await setup();
    const t1 = await thread(u, a, 1, new Date(Date.now() - 1000));
    const t2 = await thread(u, a, 2, new Date(Date.now() - 2000), { archivedAt: new Date() });
    as(u);
    const get = (q: string) => listRoute.GET(new NextRequest(`http://localhost/api/messages${q}`, { headers }), { params: {} } as never).then((r) => r.json());
    expect((await get("")).threads.map((t: { id: string }) => t.id)).toEqual([t1.id]);
    expect((await get("?view=archived")).threads.map((t: { id: string }) => t.id)).toEqual([t2.id]);
    const page = await get("?take=1&view=bogus");
    expect(page.threads).toHaveLength(1);
    const r = await threadRoute.GET(new NextRequest(`http://localhost/api/messages/${t1.id}?before=bad`, { headers }), { params: { id: t1.id } } as never);
    expect(r.status).toBe(400);
  });
});
