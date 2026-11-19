/**
 * R1219: post lifecycle and cross-platform sync. A post's lifecycle (archived, deleted, needs_verification, ...) is
 * kept apart from its publishing status and from each platform's status; a platform's "not found" is never taken
 * as a delete until a second check CONFIRM_MS later agrees; archive hides a post from the active views without
 * touching the platforms or its numbers; the library gets the matching tabs and a Sync now.
 */
import { afterEach, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { CONFIRM_MS, lifecycleOf, nextVerify } from "../lib/posts/lifecycle";

const src = (p: string) => readFileSync(p, "utf8").replace(/\r\n/g, "\n");

describe("lifecycleOf: one answer from three kinds of state", () => {
  const live = { status: "published", platformPostId: "1" };
  test("publishing states pass through; archived and deleted win over them", () => {
    expect(lifecycleOf({ status: "draft", targets: [] })).toBe("draft");
    expect(lifecycleOf({ status: "scheduled", targets: [{ status: "pending" }] })).toBe("scheduled");
    expect(lifecycleOf({ status: "publishing", targets: [{ status: "queued" }, { status: "pending" }] })).toBe("queued");
    expect(lifecycleOf({ status: "publishing", targets: [{ status: "uploading" }, { status: "queued" }] })).toBe("uploading");
    expect(lifecycleOf({ status: "publishing", targets: [{ status: "processing" }] })).toBe("publishing");
    expect(lifecycleOf({ status: "published", targets: [live] })).toBe("published");
    expect(lifecycleOf({ status: "partial", targets: [live, { status: "failed" }] })).toBe("failed");
    expect(lifecycleOf({ status: "published", archivedAt: new Date(), targets: [live] })).toBe("archived");
    expect(lifecycleOf({ status: "published", targets: [{ ...live, removeMode: "deleted" }] })).toBe("deleted");
    // One copy gone, one still up: not deleted.
    expect(lifecycleOf({ status: "published", targets: [{ ...live, removeMode: "deleted" }, live] })).toBe("published");
  });
  test("a flagged copy makes the post needs_verification; a disconnected one makes it unavailable", () => {
    expect(lifecycleOf({ status: "published", targets: [live, { ...live, verifyState: "needs_verification" }] })).toBe("needs_verification");
    expect(lifecycleOf({ status: "published", targets: [{ ...live, verifyState: "unavailable" }] })).toBe("unavailable");
    // A copy already recorded as deleted can't be "needing verification".
    expect(lifecycleOf({ status: "published", targets: [{ ...live, removeMode: "deleted", verifyState: "needs_verification" }, live] })).toBe("published");
  });
});

describe("nextVerify: two misses, CONFIRM_MS apart, before anything is called deleted", () => {
  const t0 = new Date("2026-11-19T10:00:00Z");
  const row = { platformUrl: "https://x/1", removeMode: null, verifyState: null, missingSince: null };
  test("first miss flags, never deletes", () => {
    const d = nextVerify(row, "missing", t0);
    expect(d).toEqual({ verifyState: "needs_verification", missingSince: t0, lastSyncError: "NOT_FOUND" });
  });
  test("a second miss too soon still only flags; after CONFIRM_MS it records the delete and keeps the URL", () => {
    const flagged = { ...row, verifyState: "needs_verification", missingSince: t0 };
    const soon = nextVerify(flagged, "missing", new Date(t0.getTime() + CONFIRM_MS - 1000));
    expect(soon.verifyState).toBe("needs_verification");
    expect(soon.missingSince).toEqual(t0);
    expect(soon.confirmedGone).toBeUndefined();
    const t1 = new Date(t0.getTime() + CONFIRM_MS);
    const done = nextVerify(flagged, "missing", t1);
    expect(done).toMatchObject({ removeMode: "deleted", removedVia: "platform", removedAt: t1, lastUrl: "https://x/1", platformUrl: null, verifyState: null, lastVerifiedAt: t1, confirmedGone: true });
  });
  test("seen again clears the flag; errors only note a code; already deleted changes nothing", () => {
    const flagged = { ...row, verifyState: "needs_verification", missingSince: t0 };
    expect(nextVerify(flagged, "live", t0)).toEqual({ verifyState: null, missingSince: null, lastVerifiedAt: t0, lastSyncError: null });
    expect(nextVerify(flagged, { error: "RATE_LIMITED" }, t0)).toEqual({ lastSyncError: "RATE_LIMITED" });
    expect(nextVerify(row, "unavailable", t0)).toEqual({ verifyState: "unavailable", lastSyncError: "NOT_CONNECTED" });
    expect(nextVerify(row, "unsupported", t0)).toEqual({});
    expect(nextVerify({ ...row, removeMode: "deleted" }, "missing", new Date(t0.getTime() + 2 * CONFIRM_MS))).toEqual({});
  });
});

let db: typeof import("../lib/db").db;
let rec: typeof import("../lib/posts/reconcile");
let lib: typeof import("../lib/posts/library");
let arc: typeof import("../lib/posts/archive");
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
  rec = await import("../lib/posts/reconcile");
  lib = await import("../lib/posts/library");
  arc = await import("../lib/posts/archive");
  keys = await import("../lib/social/keys");
  enc = (await import("../lib/crypto")).encrypt;
}, 60_000);

const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const gone = () => json({ error: { message: "Unsupported get request. Object with ID '1' does not exist", type: "IGApiException", code: 100, error_subcode: 33, fbtrace_id: "x" } }, 400);
function stubFetch(handler: (url: string) => Response) {
  globalThis.fetch = (async (input: RequestInfo | URL) => handler(String(input instanceof Request ? input.url : input))) as typeof fetch;
}
async function user() {
  return db.user.create({ data: { name: `L ${++n}`, email: `r1219-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function igPost(userId: string) {
  const media = await db.media.create({ data: { userId, storageKey: `sample/l${n}.mp4`, originalFilename: "a.mp4", mimeType: "video/mp4", size: 10, status: "ready" } });
  const acct = await db.socialAccount.create({ data: { userId, platform: "instagram", platformUserId: `real-ig-${++n}`, username: "@me", accessToken: enc("tok-secret"), status: "connected" } });
  const p = await db.post.create({ data: { userId, mediaId: media.id, status: "published", title: "Reel", launchedAt: new Date(), publishedAt: new Date() } });
  const t = await db.postTarget.create({
    data: { postId: p.id, platform: "instagram", socialAccountId: acct.id, platformStatus: "published", platformPostId: `1790${n}`, platformUrl: `https://www.instagram.com/reel/x${n}/`, publishedAt: new Date() },
  });
  return { p, t, acct };
}

describe("reconcile against Instagram (the dev database)", () => {
  test("one 'does not exist' flags the post; a second one CONFIRM_MS later records the delete, keeps the numbers and the URL, writes the history", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p, t, acct } = await igPost(u.id);
    await db.targetMetric.create({ data: { targetId: t.id, views: 120, likes: 3 } });
    stubFetch((url) => (url.includes("/me?") ? json({ id: acct.platformUserId }) : gone()));
    const t0 = new Date();
    const first = await rec.reconcilePost(u.id, p.id, t0);
    expect(first).toMatchObject({ checked: 1, missing: 1, deleted: 0 });
    let row = await db.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.verifyState).toBe("needs_verification");
    expect(row.removeMode).toBeNull();
    expect(row.platformUrl).toContain("instagram.com");
    expect((await lib.libraryCounts({ id: u.id, scope: null }, {})).needs_verification).toBe(1);

    // Too soon: still only flagged.
    const again = await rec.reconcilePost(u.id, p.id, new Date(t0.getTime() + 60_000));
    expect(again).toMatchObject({ missing: 1, deleted: 0 });

    const t1 = new Date(t0.getTime() + CONFIRM_MS + 1000);
    const second = await rec.reconcilePost(u.id, p.id, t1);
    expect(second).toMatchObject({ checked: 1, deleted: 1, missing: 0 });
    row = await db.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.removeMode).toBe("deleted");
    expect(row.removedVia).toBe("platform");
    expect(row.platformUrl).toBeNull();
    expect(row.lastUrl).toContain("instagram.com");
    expect(row.verifyState).toBeNull();
    expect(await db.targetMetric.count({ where: { targetId: t.id } })).toBe(1); // numbers kept
    expect(await db.post.count({ where: { id: p.id } })).toBe(1); // the record stays
    const note = await db.postNote.findFirst({ where: { postId: p.id, kind: "sync" } });
    expect(note?.body).toContain("checked twice");
    const c = await lib.libraryCounts({ id: u.id, scope: null }, {});
    expect(c).toMatchObject({ deleted: 1, needs_verification: 0, published: 0, all: 0 });
    const tab = await lib.libraryPage({ id: u.id, scope: null }, null, 48, {}, "deleted");
    expect(tab.posts.map((x) => x.id)).toEqual([p.id]);
    expect(tab.posts[0].lifecycle).toBe("deleted");
    expect(tab.posts[0].targets[0].lastUrl).toContain("instagram.com");
    expect((await lib.libraryPage({ id: u.id, scope: null }, null, 48, {}, null)).posts).toEqual([]);
  });

  test("still there: the flag clears and lastVerifiedAt is set; a rate limit changes nothing but the code", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p, t } = await igPost(u.id);
    await db.postTarget.update({ where: { id: t.id }, data: { verifyState: "needs_verification", missingSince: new Date() } });
    stubFetch(() => json({ error: { message: "slow down", code: 4 } }, 429));
    expect(await rec.reconcilePost(u.id, p.id)).toMatchObject({ errors: 1, live: 0, missing: 0 });
    let row = await db.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.verifyState).toBe("needs_verification");
    stubFetch(() => json({ id: "1" }));
    expect(await rec.reconcilePost(u.id, p.id)).toMatchObject({ live: 1 });
    row = await db.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.verifyState).toBeNull();
    expect(row.missingSince).toBeNull();
    expect(row.lastVerifiedAt).not.toBeNull();
  });

  test("a disconnected account is 'unavailable', never a delete; Sync now has a per-workspace cooldown", async () => {
    keys.__setKeys({ instagram: { clientId: "c", clientSecret: "s" } } as never);
    const u = await user();
    const { p, t, acct } = await igPost(u.id);
    await db.socialAccount.update({ where: { id: acct.id }, data: { status: "needs_reconnect" } });
    stubFetch(() => gone());
    rec.resetReconcileCooldown(u.id);
    const r = await rec.reconcileUser(u.id);
    expect(r).toMatchObject({ unavailable: 1, deleted: 0, missing: 0 });
    expect((await db.postTarget.findUniqueOrThrow({ where: { id: t.id } })).verifyState).toBe("unavailable");
    expect(await rec.reconcileUser(u.id)).toMatchObject({ checked: 0 });
    expect((await rec.reconcileUser(u.id)).cooldownMs).toBeGreaterThan(0);
    const tab = await lib.libraryPage({ id: u.id, scope: null }, null, 48, {}, null);
    expect(tab.posts[0]?.id).toBe(p.id);
    expect(tab.posts[0]?.lifecycle).toBe("unavailable");
  });
});

describe("archive: out of the active views, platforms and numbers untouched", () => {
  test("archive hides from All, Published and the calendar; the Archived tab lists it; unarchive restores", async () => {
    const u = await user();
    const { p, t } = await igPost(u.id);
    const me = { id: u.id, scope: null };
    expect((await lib.libraryCounts(me, {})).published).toBe(1);
    const v = await arc.setArchived(u.id, p.id, true);
    expect(v.lifecycle).toBe("archived");
    expect(v.archivedAt).not.toBeNull();
    const c = await lib.libraryCounts(me, {});
    expect(c).toMatchObject({ all: 0, published: 0, archived: 1 });
    expect((await lib.libraryPage(me, null, 48, {}, "archived")).posts.map((x) => x.id)).toEqual([p.id]);
    expect((await lib.libraryPage(me, null, 48, {}, "published")).posts).toEqual([]);
    // The calendar's where (lib/calendar/load.ts scoped()) leaves it out: same clause, run here without a request scope.
    expect(await db.post.count({ where: { AND: [{ userId: u.id, archivedAt: null }, {}, { OR: [{ scheduledAt: { not: null } }, { publishedAt: { not: null } }] }] } })).toBe(0);
    // Nothing on the platform side changed.
    const row = await db.postTarget.findUniqueOrThrow({ where: { id: t.id } });
    expect(row.removeMode).toBeNull();
    expect(row.platformStatus).toBe("published");
    const back = await arc.setArchived(u.id, p.id, false);
    expect(back.lifecycle).toBe("published");
    expect((await lib.libraryCounts(me, {})).published).toBe(1);
  });
  test("a booked post can't be archived (it would still go out, unseen)", async () => {
    const u = await user();
    const { p } = await igPost(u.id);
    await db.post.update({ where: { id: p.id }, data: { status: "scheduled", scheduledAt: new Date(Date.now() + 36e5) } });
    await expect(arc.setArchived(u.id, p.id, true)).rejects.toMatchObject({ status: 409, code: "IN_FLIGHT" });
  });
});

describe("wiring", () => {
  test("schema (both files) carries the lifecycle columns", () => {
    for (const f of ["prisma/schema.prisma", "prisma/schema.template.prisma"]) {
      const s = src(f);
      expect(s).toContain("archivedAt  DateTime?");
      expect(s).toContain("@@index([userId, archivedAt])");
      for (const col of ["verifyState", "missingSince", "lastVerifiedAt", "lastSyncError", "removedVia", "lastUrl"]) expect(s).toContain(`  ${col}`);
    }
  });
  test("the background metrics sync records sightings and misses through the same rules", () => {
    const s = src("lib/analytics/sync.ts");
    expect(s).toContain('if (ins.code === "GONE") await applyVerify(t, "missing", now).catch(() => {});');
    expect(s).toContain('await applyVerify(t, "live", now).catch(() => {});');
    expect(s).not.toContain("data: { metricsCheckedAt: now }");
  });
  test("Outlly-side takedowns say so (removedVia) and keep the last URL", () => {
    const s = src("lib/social/remove.ts");
    expect(s).toContain('removeMode: "deleted", removedVia: "outlly", lastUrl: t.platformUrl, platformUrl: null');
    expect(s).toContain('removedVia: "platform", lastUrl: t?.platformUrl ?? null');
  });
  test("library tabs, badges and Sync now; the delete dialog offers archive as the middle way", () => {
    const l = src("components/content/ContentLibrary.tsx");
    for (const id of ["needs_verification", "archived", "deleted"]) expect(l).toContain(`{ id: "${id}", label:`);
    expect(l).toContain('api<{ sync: ReconcileSummary }>("/api/content/sync", { method: "POST" })');
    expect(l).toContain("export function syncSummary(");
    expect(l).toContain("Outlly will check again before calling");
    const b = src("components/shared/StatusBadge.tsx");
    expect(b).toContain('needs_verification: { label: "Needs verification"');
    const s = src("components/posts/PostSheet.tsx");
    expect(s).toContain("Archive: hide it here, keep it live and keep its numbers");
    expect(s).toContain('setConfirm("everywhere")');
    expect(s).toContain("Delete from my studio only");
    expect(s).toContain("/archive`, { method: \"POST\", json: { archived } }");
    expect(s).toContain("Check now");
    expect(s).toContain("Deleted on ${name} itself. Its numbers here are kept");
    for (const r of ["app/api/posts/[id]/archive/route.ts", "app/api/posts/[id]/sync/route.ts", "app/api/content/sync/route.ts"]) expect(src(r)).toContain("export const POST = route(");
  });
  test("active views leave archived posts out", () => {
    expect(src("lib/calendar/load.ts")).toContain("{ userId: user.id, archivedAt: null }");
    expect(src("app/api/posts/route.ts").split("archivedAt: null").length - 1).toBe(2);
    expect(src("app/(studio)/home/page.tsx")).toContain('status: "draft", archivedAt: null');
    expect(src("lib/posts/library.ts")).toContain("AND: [statusWhere(status), ...searchWhere(q)]");
  });
});
