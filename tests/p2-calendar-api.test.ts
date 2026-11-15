/**
 * P2 calendar read route (GET /api/calendar) against the throwaway database: only the window asked for, only the
 * signed-in studio's posts, cursor pages for upcoming and undated drafts, no tokens in the account summary.
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
const g = globalThis as unknown as { __calUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__calUser !== undefined ? g.__calUser : realGetCurrentUser()) }));

let db: typeof import("../lib/db").db;
let encrypt: typeof import("../lib/crypto").encrypt;
let calRoute: typeof import("../app/api/calendar/route");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ({ encrypt } = await import("../lib/crypto"));
  calRoute = await import("../app/api/calendar/route");
}, 60_000);
afterAll(() => {
  delete g.__calUser;
});

let n = 0;
async function studio() {
  n++;
  const user = await db.user.create({ data: { name: "Cal", email: `cal${n}-${Date.now()}@test.dev`, passwordHash: "x", timezone: "UTC" } });
  const ig = await db.socialAccount.create({ data: { userId: user.id, platform: "instagram", platformUserId: `ig-${n}-${Date.now()}`, username: "u", accessToken: encrypt("tok"), refreshToken: null, tokenExpiresAt: new Date(Date.now() + 2 * 864e5), status: "connected" } });
  const media = await db.media.create({ data: { userId: user.id, originalFilename: "v.mp4", storageKey: `cal/${Date.now()}-${Math.random()}.mp4`, mimeType: "video/mp4", size: 1000, duration: 20, width: 1080, height: 1920, status: "ready" } });
  const mk = (title: string, data: Record<string, unknown>) =>
    db.post.create({ data: { userId: user.id, mediaId: media.id, title, status: "scheduled", ...data, targets: { create: [{ platform: "instagram", socialAccountId: ig.id }] } } });
  return { user, ig, mk };
}
const as = (user: { id: string; createdAt: Date }) => (g.__calUser = { ...user, role: "owner", scope: null, joinedAt: user.createdAt });
const get = (qs: string) => calRoute.GET(new NextRequest(`http://localhost/api/calendar?${qs}`, { headers: { origin: "http://localhost", host: "localhost" } }), { params: {} } as never);
const day = (d: number, h = 10) => new Date(Date.UTC(2030, 0, d, h));

describe("GET /api/calendar", () => {
  test("a range returns only what is placed in it, and only this studio's", async () => {
    const a = await studio();
    const b = await studio();
    await a.mk("in", { scheduledAt: day(7) });
    await a.mk("out", { scheduledAt: day(20) });
    await a.mk("published-in", { status: "published", scheduledAt: null, publishedAt: day(8) });
    await a.mk("undated", { status: "draft", scheduledAt: null });
    await b.mk("someone else", { scheduledAt: day(7) });
    as(a.user);
    const r = await get(`list=range&from=${day(6, 0).toISOString()}&to=${day(13, 0).toISOString()}`);
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.posts.map((p: { title: string }) => p.title).sort()).toEqual(["in", "published-in"]);
    expect(body.posts[0].accountIds).toBeDefined();
    expect(typeof body.posts[0].slideCount).toBe("number");
    // The account summary never carries tokens; with no refresh token its expiry is a real deadline.
    expect(body.accounts).toHaveLength(1);
    expect(JSON.stringify(body.accounts)).not.toContain("tok");
    expect(body.accounts[0].expiresAt).not.toBeNull();
  });
  test("refuses a range over six weeks or a broken one", async () => {
    const a = await studio();
    as(a.user);
    expect((await get(`list=range&from=${day(1).toISOString()}&to=${new Date(Date.UTC(2030, 2, 1)).toISOString()}`)).status).toBe(400);
    expect((await get(`list=range&from=nope&to=${day(2).toISOString()}`)).status).toBe(400);
    expect((await get(`list=range&from=${day(3).toISOString()}&to=${day(2).toISOString()}`)).status).toBe(400);
  });
  test("upcoming pages with a cursor, soonest first; a foreign cursor pages nothing", async () => {
    const a = await studio();
    const b = await studio();
    for (let i = 1; i <= 23; i++) await a.mk(`u${String(i).padStart(2, "0")}`, { scheduledAt: day(i) });
    await a.mk("done", { status: "published", scheduledAt: day(2), publishedAt: day(2) });
    const theirs = await b.mk("theirs", { scheduledAt: day(5) });
    as(a.user);
    const p1 = await (await get("list=upcoming")).json();
    expect(p1.posts).toHaveLength(20);
    expect(p1.posts[0].title).toBe("u01");
    expect(p1.nextCursor).toBe(p1.posts[19].id);
    const p2 = await (await get(`list=upcoming&cursor=${p1.nextCursor}`)).json();
    expect(p2.posts.map((p: { title: string }) => p.title)).toEqual(["u21", "u22", "u23"]);
    expect(p2.nextCursor).toBeNull();
    const foreign = await (await get(`list=upcoming&cursor=${theirs.id}`)).json();
    expect(foreign.posts).toEqual([]);
    expect((await get("list=upcoming&take=500")).status).toBe(400);
  });
  test("drafts with no date come as their own list, never in a range", async () => {
    const a = await studio();
    for (let i = 0; i < 10; i++) await a.mk(`d${i}`, { status: "draft", scheduledAt: null });
    await a.mk("dated draft", { status: "draft", scheduledAt: day(4) });
    as(a.user);
    const d1 = await (await get("list=drafts")).json();
    expect(d1.posts).toHaveLength(8);
    expect(d1.posts.every((p: { scheduledAt: string | null; status: string }) => p.status === "draft" && !p.scheduledAt)).toBe(true);
    const d2 = await (await get(`list=drafts&cursor=${d1.nextCursor}`)).json();
    expect(d2.posts).toHaveLength(2);
    const range = await (await get(`list=range&from=${day(1, 0).toISOString()}&to=${day(8, 0).toISOString()}`)).json();
    expect(range.posts.map((p: { title: string }) => p.title)).toEqual(["dated draft"]);
  });
  test("signed out gets a 401", async () => {
    g.__calUser = null;
    expect((await get("list=upcoming")).status).toBe(401);
  });
});
