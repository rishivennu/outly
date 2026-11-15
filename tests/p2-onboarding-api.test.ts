/**
 * Phase 2 onboarding over the wire: GET/PATCH /api/me/onboarding against the throwaway test database.
 * Complete, skip, dismiss, revisit (reset), the old-way rule, live connect status, and per-person isolation.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";

const g = globalThis as unknown as { __onbUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__onbUser !== undefined ? g.__onbUser : realGetCurrentUser()) }));
afterAll(() => {
  delete g.__onbUser;
});

let db: typeof import("../lib/db").db;
let route: typeof import("../app/api/me/onboarding/route");

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  route = await import("../app/api/me/onboarding/route");
}, 60_000);

let n = 0;
type U = { id: string; createdAt: Date };
async function signIn(extra: Record<string, unknown> = {}, actor: { id: string; name: string; email: string } | null = null) {
  const user = await db.user.create({ data: { name: "Onb Tester", email: `onb${++n}-${Date.now()}@test.dev`, passwordHash: "x", ...extra } });
  g.__onbUser = { ...user, role: actor ? "manager" : "owner", joinedAt: user.createdAt, actor, scope: null };
  return user as U;
}
const req = (method: string, body?: unknown) =>
  new NextRequest("http://localhost/api/me/onboarding", { method, body: body === undefined ? undefined : JSON.stringify(body), headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" } });
const get = async () => {
  const r = await route.GET(req("GET"), { params: {} } as never);
  return { status: r.status, body: await r.json() };
};
const patch = async (body: unknown) => {
  const r = await route.PATCH(req("PATCH", body), { params: {} } as never);
  return { status: r.status, body: await r.json() };
};
const statusOf = (o: { steps: { id: string; status: string }[] }) => Object.fromEntries(o.steps.map((s) => [s.id, s.status]));

describe("GET /api/me/onboarding", () => {
  test("signed out is refused", async () => {
    g.__onbUser = null;
    expect((await get()).status).toBe(401);
  });
  test("a new account: six steps, opens by itself, every platform listed with how it connects", async () => {
    await signIn();
    const { status, body } = await get();
    expect(status).toBe(200);
    expect(body.onboarding).toMatchObject({ total: 6, done: 0, finished: false, autoOpen: true, next: "welcome" });
    expect(body.onboarding.connect.map((c: { platform: string }) => c.platform).sort()).toEqual(["facebook", "instagram", "linkedin", "threads", "tiktok", "x", "youtube"]);
    // The test harness has no platform keys and no rehearsal mode: nothing pretends to connect.
    for (const c of body.onboarding.connect) expect(c.how === "later" || c.how === "token").toBe(true);
    expect(body.onboarding.connect.find((c: { platform: string }) => c.platform === "instagram").how).toBe("token");
    expect(body.onboarding.profile).toMatchObject({ name: "Onb Tester", niche: null, hasPhoto: false });
  });
  test("live status comes from the accounts table, and real data marks steps done", async () => {
    const u = await signIn({ niche: "Food" });
    await db.socialAccount.create({ data: { userId: u.id, platform: "youtube", platformUserId: `onb-yt-${n}-${Date.now()}`, username: "chef", accessToken: "x", status: "connected" } });
    await db.socialAccount.create({ data: { userId: u.id, platform: "instagram", platformUserId: `onb-ig-${n}-${Date.now()}`, username: "chef.ig", accessToken: "x", status: "needs_reconnect" } });
    await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `onb/${n}.mp4`, mimeType: "video/mp4", size: 1000, status: "ready" } });
    const { body } = await get();
    const c = Object.fromEntries(body.onboarding.connect.map((x: { platform: string; status: string | null }) => [x.platform, x.status]));
    expect(c).toMatchObject({ youtube: "connected", instagram: "needs_reconnect", x: null });
    expect(statusOf(body.onboarding)).toMatchObject({ connect: "done", profile: "done", create: "done", schedule: "todo" });
    expect(body.onboarding.finished).toBe(false);
  });
  test("a practice account does not count as connected", async () => {
    const u = await signIn();
    await db.socialAccount.create({ data: { userId: u.id, platform: "youtube", platformUserId: `mock-onb-${n}-${Date.now()}`, username: "practice", accessToken: "x", status: "connected" } });
    const { body } = await get();
    expect(statusOf(body.onboarding).connect).toBe("todo");
    expect(body.onboarding.connect.find((x: { platform: string }) => x.platform === "youtube")).toMatchObject({ status: "connected", practice: true });
  });
  test("an existing user who connected and posted the old way is finished, never forced through it", async () => {
    const u = await signIn();
    await db.socialAccount.create({ data: { userId: u.id, platform: "x", platformUserId: `onb-x-${n}-${Date.now()}`, username: "old", accessToken: "x", status: "connected" } });
    const media = await db.media.create({ data: { userId: u.id, originalFilename: "b.mp4", storageKey: `onb/b${n}.mp4`, mimeType: "video/mp4", size: 1000, status: "ready" } });
    await db.post.create({ data: { userId: u.id, mediaId: media.id, status: "published" } });
    const { body } = await get();
    expect(body.onboarding).toMatchObject({ finished: true, autoOpen: false });
  });
});

describe("PATCH /api/me/onboarding", () => {
  test("complete and skip steps; skipping the last open one finishes; it is saved on the account", async () => {
    const u = await signIn();
    expect((await patch({ step: "welcome", status: "done" })).body.onboarding).toMatchObject({ autoOpen: false, next: "connect", done: 1 });
    for (const step of ["connect", "profile", "create", "schedule"]) expect((await patch({ step, status: "skipped" })).status).toBe(200);
    const last = await patch({ step: "analytics", status: "skipped" });
    expect(last.body.onboarding).toMatchObject({ finished: true, done: 1, skipped: 5 });
    const saved = JSON.parse((await db.user.findUniqueOrThrow({ where: { id: u.id } })).onboarding!);
    expect(saved.v).toBe(1);
    expect(saved.finishedAt).toBeTruthy();
    // Another device asks the server, not its own storage: still finished.
    expect((await get()).body.onboarding.finished).toBe(true);
  });
  test("dismiss ends it everywhere; reset (Start setup again from Help) brings it back", async () => {
    await signIn();
    expect((await patch({ action: "dismiss" })).body.onboarding).toMatchObject({ finished: true, autoOpen: false });
    const again = (await patch({ action: "reset" })).body.onboarding;
    expect(again).toMatchObject({ finished: false, autoOpen: true, next: "welcome", done: 0, skipped: 0 });
    expect((await patch({ action: "finish" })).body.onboarding.finished).toBe(true);
  });
  test("refuses anything that is not a known step and status or action", async () => {
    await signIn();
    for (const bad of [{}, { step: "billing", status: "done" }, { step: "welcome", status: "todo" }, { action: "delete" }, { step: "welcome", status: "done", action: "finish" }]) {
      const r = await patch(bad);
      expect(r.status).toBe(400);
      expect(r.body.code).toBe("VALIDATION");
    }
  });
  test("a teammate's progress is their own; the owner's record is untouched", async () => {
    const owner = await db.user.create({ data: { name: "Owner", email: `onb-owner-${Date.now()}@test.dev`, passwordHash: "x" } });
    const me = await db.user.create({ data: { name: "Mate", email: `onb-mate-${Date.now()}@test.dev`, passwordHash: "x" } });
    g.__onbUser = { ...owner, role: "manager", joinedAt: me.createdAt, actor: { id: me.id, name: me.name, email: me.email }, scope: null };
    const r = await patch({ step: "welcome", status: "done" });
    expect(r.status).toBe(200);
    expect(r.body.onboarding.total).toBe(4);
    expect(r.body.onboarding.connect).toBeNull();
    expect(r.body.onboarding.profile).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).onboarding).toBeNull();
    expect(JSON.parse((await db.user.findUniqueOrThrow({ where: { id: me.id } })).onboarding!).steps).toEqual({ welcome: "done" });
  });
});
