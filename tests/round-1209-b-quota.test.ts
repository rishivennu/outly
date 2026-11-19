/**
 * R1209 B: the monthly upload allowance (free) and storage capacity (paid). Deleting never refunds the monthly
 * counter, the next cycle starts by itself, paid deletes free space, drafts are kept, every finished upload counts
 * once, reservations can't overshoot, a bucket failure leaves the file counted, and staff changes are audited.
 */
import { afterAll, describe, expect, mock, test } from "bun:test";
import * as realStorage from "../lib/storage";
import type { StorageDriver } from "../lib/storage";
import { db } from "../lib/db";
import { MB, anchoredWindow, calendarWindow, cycleWindow, fmtBytes, monthlyFigures, resolvePolicy, roomLeft, storageFiguresOf, usageState } from "../lib/storage/quota-core";
import { QuotaError, legacyMeter, recordUpload, reserveUpload, storageUsageFor } from "../lib/storage/quota";
import { closeUsageCycles, deleteDraftWithMedia, purgeMedia, purgeTrash, restoreMedia, trashMedia, trashOrphanMedia } from "../lib/storage/lifecycle";
import { adjustQuota } from "../lib/admin/storage";

// The same switch round-1193 uses, so whichever mock of lib/storage is installed last behaves the same.
const g = globalThis as unknown as { __r1193Storage?: StorageDriver };
const proxied = new Proxy(realStorage.storage, { get: (t, k) => Reflect.get(g.__r1193Storage ?? t, k) });
mock.module("../lib/storage", () => ({ ...realStorage, storage: proxied }));
let failRemove = false;
const removed: string[] = [];
const fake = {
  remove: async (key: string) => {
    if (failRemove) throw new Error("bucket says no");
    removed.push(key);
  },
} as unknown as StorageDriver;
g.__r1193Storage = fake;
afterAll(() => {
  if (g.__r1193Storage === fake) g.__r1193Storage = undefined;
});

const GB = 1024 * MB;
const DAY = 86_400_000;
const tag = () => `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

async function account(o: { priceMinor: number; uploadMonthlyMb?: number | null; storageMb?: number; quotaPolicy?: string; cycleAnchor?: string; maxUploadMb?: number; daysOld?: number }) {
  const t = tag();
  const now = new Date();
  const user = await db.user.create({ data: { name: "Quota", email: `q-${t}@test.dev`, passwordHash: "x", createdAt: new Date(now.getTime() - (o.daysOld ?? 10) * DAY) } });
  const plan = await db.plan.create({
    data: {
      slug: `q1209-${t}`, name: o.priceMinor > 0 ? "Creator" : "Free", priceMinor: o.priceMinor, state: "hidden", sortOrder: 50,
      uploadMonthlyMb: o.uploadMonthlyMb === undefined ? 2048 : o.uploadMonthlyMb, storageMb: o.storageMb ?? 0, quotaPolicy: o.quotaPolicy ?? "auto", cycleAnchor: o.cycleAnchor ?? "signup", maxUploadMb: o.maxUploadMb ?? 0,
    },
  });
  const sub = await db.subscription.create({
    data: { userId: user.id, planId: plan.id, status: "active", priceMinor: o.priceMinor, currency: "INR", interval: "month", provider: o.priceMinor > 0 ? "mock" : "beta", currentPeriodStart: new Date(now.getTime() - 5 * DAY), currentPeriodEnd: new Date(now.getTime() + 25 * DAY), createdAt: new Date(now.getTime() - 5 * DAY) },
  });
  return { user, plan, sub };
}

const mediaRow = (userId: string, bytes: number, o: { status?: string; createdAt?: Date } = {}) =>
  db.media.create({ data: { userId, originalFilename: "clip.mp4", storageKey: `q1209/${tag()}.mp4`, mimeType: "video/mp4", size: Math.min(bytes, 2_147_483_647), sizeBytes: BigInt(bytes), status: o.status ?? "ready", ...(o.createdAt ? { createdAt: o.createdAt } : {}) } });

/** reserve + finish one upload the way the media routes do. */
async function upload(userId: string, bytes: number, now = new Date()) {
  const m = await reserveUpload(userId, bytes, (tx) => tx.media.create({ data: { userId, originalFilename: "clip.mp4", storageKey: `q1209/${tag()}.mp4`, mimeType: "video/mp4", size: Math.min(bytes, 2_147_483_647), sizeBytes: BigInt(bytes), status: "uploading" } }), now);
  await db.media.update({ where: { id: m.id }, data: { status: "ready" } });
  await recordUpload(m, bytes, now);
  return m;
}

async function refused(p: Promise<unknown>) {
  try {
    await p;
  } catch (e) {
    return e as QuotaError;
  }
  throw new Error("expected the upload to be refused");
}

describe("pure rules", () => {
  test("auto policy: free counts uploads per cycle, paid counts what is stored", () => {
    expect(resolvePolicy("auto", false)).toBe("monthly");
    expect(resolvePolicy("auto", true)).toBe("storage");
    expect(resolvePolicy("both", false)).toBe("both");
    expect(resolvePolicy("nonsense", true)).toBe("storage");
  });
  test("signup cycles roll monthly and clamp to the month's last day", () => {
    const w = anchoredWindow(new Date("2026-01-31T08:00:00Z"), new Date("2026-02-28T09:00:00Z"));
    expect(w.start.toISOString()).toBe("2026-02-28T08:00:00.000Z");
    expect(w.end.toISOString()).toBe("2026-03-31T08:00:00.000Z");
    const c = calendarWindow(new Date("2026-11-19T10:00:00Z"));
    expect(c.start.toISOString()).toBe("2026-10-31T18:30:00.000Z");
  });
  test("an upgrade mid-cycle keeps the cycle start, so the counter is not reset", () => {
    const signupAt = new Date("2026-10-05T00:00:00Z");
    const subscribedAt = new Date("2026-11-15T00:00:00Z");
    const w = cycleWindow({ anchor: "billing", signupAt, subscribedAt, periodStart: subscribedAt, previous: "signup", now: new Date("2026-11-16T00:00:00Z") });
    expect(w.start.toISOString()).toBe("2026-11-05T00:00:00.000Z");
    const later = cycleWindow({ anchor: "billing", signupAt, subscribedAt, periodStart: new Date("2026-12-15T00:00:00Z"), previous: "signup", now: new Date("2026-12-16T00:00:00Z") });
    expect(later.start.toISOString()).toBe("2026-12-15T00:00:00.000Z");
  });
  test("states, room and figures", () => {
    const w = anchoredWindow(new Date("2026-10-01T00:00:00Z"), new Date("2026-11-02T00:00:00Z"));
    const m = monthlyFigures(1.5 * GB, 0, 2 * GB, w);
    expect(m.remainingBytes).toBe(0.5 * GB);
    expect(usageState(m, null)).toBe("normal");
    expect(usageState(monthlyFigures(1.7 * GB, 0, 2 * GB, w), null)).toBe("warning");
    expect(usageState(monthlyFigures(1.95 * GB, 0, 2 * GB, w), null)).toBe("critical");
    expect(usageState(monthlyFigures(2 * GB, 0, 2 * GB, w), null)).toBe("full");
    const s = storageFiguresOf(40 * GB, 0, 50 * GB, 0);
    expect(s.availableBytes).toBe(10 * GB);
    expect(roomLeft(m, s)).toBe(0.5 * GB);
    expect(roomLeft(null, null)).toBe(Infinity);
    expect(fmtBytes(1.5 * GB)).toBe("1.5 GB");
  });
});

describe("free: the monthly upload allowance", () => {
  test("uploads adding up to the 2 GB allowance use it up (the server caps one file at 500 MB); the next upload is refused with quota_monthly", async () => {
    const { user } = await account({ priceMinor: 0 });
    for (let i = 0; i < 4; i++) await upload(user.id, 500 * MB);
    await upload(user.id, 48 * MB);
    const u = await storageUsageFor(user.id);
    expect(u.policy).toBe("monthly");
    expect(u.monthly!.usedBytes).toBe(2 * GB);
    expect(u.state).toBe("full");
    expect(u.canUpload).toBe(false);
    const e = await refused(upload(user.id, 10 * MB));
    expect(e).toBeInstanceOf(QuotaError);
    expect(e.status).toBe(413);
    expect(e.code).toBe("quota_monthly");
    expect(e.message).not.toMatch(/[\u2013\u2014]/);
    expect((e.extra as { usage: { state: string } }).usage.state).toBe("full");
  });

  test("deleting files gives nothing back this cycle; the next cycle starts fresh and the files are still there", async () => {
    const { user } = await account({ priceMinor: 0 });
    const a = await upload(user.id, 500 * MB);
    for (let i = 0; i < 3; i++) await upload(user.id, 500 * MB);
    await upload(user.id, 48 * MB);
    await trashMedia(user.id, a.id);
    const p = await purgeMedia(user.id, a.id);
    expect(p.freedBytes).toBe(500 * MB);
    expect(p.refunded).toBe(false);
    const after = await storageUsageFor(user.id);
    expect(after.monthly!.usedBytes).toBe(2 * GB);
    expect((await refused(upload(user.id, MB))).code).toBe("quota_monthly");

    const next = new Date(new Date(after.monthly!.resetAt).getTime() + 60_000);
    const fresh = await storageUsageFor(user.id, next);
    expect(fresh.monthly!.usedBytes).toBe(0);
    expect(fresh.canUpload).toBe(true);
    expect(await db.media.count({ where: { userId: user.id } })).toBe(4);
    await upload(user.id, 100 * MB, next);
    expect((await storageUsageFor(user.id, next)).monthly!.usedBytes).toBe(100 * MB);
  });

  test("a retried complete counts the upload once", async () => {
    const { user } = await account({ priceMinor: 0 });
    const m = await upload(user.id, 300 * MB);
    expect(await recordUpload(m, 300 * MB)).toBe(false);
    expect(await recordUpload(m, 300 * MB)).toBe(false);
    expect(await db.uploadLedger.count({ where: { mediaId: m.id } })).toBe(1);
    expect((await storageUsageFor(user.id)).monthly!.usedBytes).toBe(300 * MB);
  });

  test("uploads started together can't both take the last room", async () => {
    const { user } = await account({ priceMinor: 0, uploadMonthlyMb: 100 });
    const tries = await Promise.allSettled([60, 60, 60].map(() => upload(user.id, 60 * MB)));
    expect(tries.filter((t) => t.status === "fulfilled").length).toBe(1);
    expect((await storageUsageFor(user.id)).monthly!.usedBytes).toBe(60 * MB);
  });

  test("a failed upload releases its reservation and never counts", async () => {
    const { user } = await account({ priceMinor: 0, uploadMonthlyMb: 100 });
    const m = await reserveUpload(user.id, 90 * MB, (tx) => tx.media.create({ data: { userId: user.id, originalFilename: "x.mp4", storageKey: `q1209/${tag()}.mp4`, mimeType: "video/mp4", size: 90 * MB, sizeBytes: BigInt(90 * MB), status: "uploading" } }));
    expect((await refused(upload(user.id, 20 * MB))).code).toBe("quota_monthly");
    await db.media.update({ where: { id: m.id }, data: { status: "failed" } });
    const u = await storageUsageFor(user.id);
    expect(u.monthly!.reservedBytes).toBe(0);
    expect(u.monthly!.usedBytes).toBe(0);
    await upload(user.id, 20 * MB);
  });

  test("a file over the plan's per-file cap is file_too_big", async () => {
    const { user } = await account({ priceMinor: 0, maxUploadMb: 50 });
    expect((await refused(upload(user.id, 60 * MB))).code).toBe("file_too_big");
  });

  test("closing a cycle writes one history row, even when run twice", async () => {
    const { user } = await account({ priceMinor: 0, daysOld: 45 });
    const w = (await storageUsageFor(user.id)).monthly!;
    const inPrev = new Date(new Date(w.startedAt).getTime() - 2 * DAY);
    await upload(user.id, 40 * MB, inPrev);
    expect(await closeUsageCycles(new Date(), { userIds: [user.id] })).toBe(1);
    expect(await closeUsageCycles(new Date(), { userIds: [user.id] })).toBe(0);
    const rows = await db.usageCycle.findMany({ where: { userId: user.id } });
    expect(rows.length).toBe(1);
    expect(Number(rows[0]!.uploadedBytes)).toBe(40 * MB);
    expect(Number(rows[0]!.allowanceBytes)).toBe(2048 * MB);
  });
});

describe("paid: storage capacity", () => {
  test("deleting for good frees space at once and says so", async () => {
    const { user } = await account({ priceMinor: 49900, storageMb: 1024 });
    const a = await upload(user.id, 450 * MB);
    await upload(user.id, 450 * MB);
    expect((await refused(upload(user.id, 300 * MB))).code).toBe("quota_storage");
    await trashMedia(user.id, a.id);
    expect((await storageUsageFor(user.id)).storage!.trashBytes).toBe(450 * MB);
    expect((await refused(upload(user.id, 300 * MB))).code).toBe("quota_storage");
    const p = await purgeMedia(user.id, a.id);
    expect(p).toMatchObject({ ok: true, alreadyGone: false, freedBytes: 450 * MB, refunded: true });
    expect((await purgeMedia(user.id, a.id)).freedBytes).toBe(0);
    await upload(user.id, 300 * MB);
    expect((await storageUsageFor(user.id)).storage!.usedBytes).toBe(750 * MB);
  });

  test("Trash can be restored, and a file a draft uses can't be trashed", async () => {
    const { user } = await account({ priceMinor: 49900, storageMb: 1024 });
    const a = await mediaRow(user.id, 10 * MB);
    await trashMedia(user.id, a.id);
    expect(await restoreMedia(user.id, a.id)).toEqual({ ok: true, status: "active" });
    expect((await db.media.findUnique({ where: { id: a.id } }))!.deletedAt).toBeNull();
    await db.post.create({ data: { userId: user.id, mediaId: a.id, status: "draft" } });
    await expect(trashMedia(user.id, a.id)).rejects.toMatchObject({ status: 409, code: "in_use" });
  });

  test("a lower plan limit keeps every file and only blocks new uploads", async () => {
    const { user, plan } = await account({ priceMinor: 49900, storageMb: 1024 });
    await upload(user.id, 350 * MB);
    await upload(user.id, 350 * MB);
    await db.plan.update({ where: { id: plan.id }, data: { storageMb: 500 } });
    const u = await storageUsageFor(user.id);
    expect(u.state).toBe("full");
    expect(await db.media.count({ where: { userId: user.id } })).toBe(2);
    expect((await refused(upload(user.id, MB))).code).toBe("quota_storage");
  });

  test("legacy meter follows the limit that binds", async () => {
    const free = await account({ priceMinor: 0 });
    await upload(free.user.id, 500 * MB);
    const lm = legacyMeter(await storageUsageFor(free.user.id));
    expect(lm.kind).toBe("monthly");
    expect(lm.limitBytes).toBe(2 * GB);
    expect(lm.label).toContain("monthly upload allowance");
    const paid = await account({ priceMinor: 49900, storageMb: 2048 });
    await upload(paid.user.id, 500 * MB);
    await upload(paid.user.id, 500 * MB);
    const pm = legacyMeter(await storageUsageFor(paid.user.id));
    expect(pm).toMatchObject({ kind: "storage", limitBytes: 2 * GB, remainingBytes: 1048 * MB, over: false });
  });
});

describe("drafts and their media", () => {
  test("the retention job keeps drafts, trashes only unused old files, and purges old Trash", async () => {
    const { user } = await account({ priceMinor: 0, daysOld: 400 });
    const old = new Date(Date.now() - 200 * DAY);
    const drafted = await mediaRow(user.id, 5 * MB, { createdAt: old });
    const loose = await mediaRow(user.id, 5 * MB, { createdAt: old });
    const post = await db.post.create({ data: { userId: user.id, mediaId: drafted.id, status: "draft", updatedAt: old } });
    await trashOrphanMedia();
    expect(await db.post.findUnique({ where: { id: post.id } })).not.toBeNull();
    expect((await db.media.findUnique({ where: { id: drafted.id } }))!.deletedAt).toBeNull();
    expect((await db.media.findUnique({ where: { id: loose.id } }))!.deletedAt).not.toBeNull();
    await purgeTrash(new Date(Date.now() + 31 * DAY));
    expect(await db.media.findUnique({ where: { id: loose.id } })).toBeNull();
  });

  test("Delete draft and media: paid frees space, free does not get the allowance back", async () => {
    const paid = await account({ priceMinor: 49900, storageMb: 4096 });
    const pm = await upload(paid.user.id, 200 * MB);
    const pp = await db.post.create({ data: { userId: paid.user.id, mediaId: pm.id, status: "draft" } });
    const r = await deleteDraftWithMedia(paid.user, pp.id);
    expect(r).toMatchObject({ freedBytes: 200 * MB, refunded: true, media: { deleted: 1, kept: 0 } });
    expect(await db.post.findUnique({ where: { id: pp.id } })).toBeNull();
    expect((await storageUsageFor(paid.user.id)).storage!.usedBytes).toBe(0);

    const free = await account({ priceMinor: 0 });
    const fm = await upload(free.user.id, 200 * MB);
    const fp = await db.post.create({ data: { userId: free.user.id, mediaId: fm.id, status: "draft" } });
    const f = await deleteDraftWithMedia(free.user, fp.id);
    expect(f).toMatchObject({ freedBytes: 200 * MB, refunded: false });
    expect((await storageUsageFor(free.user.id)).monthly!.usedBytes).toBe(200 * MB);
  });

  test("a bucket failure deletes the draft but keeps the file counted until the sweeper removes it", async () => {
    const { user } = await account({ priceMinor: 49900, storageMb: 4096 });
    const m = await upload(user.id, 50 * MB);
    const p = await db.post.create({ data: { userId: user.id, mediaId: m.id, status: "draft" } });
    failRemove = true;
    let r: Awaited<ReturnType<typeof deleteDraftWithMedia>>;
    try {
      r = await deleteDraftWithMedia(user, p.id);
    } finally {
      failRemove = false;
    }
    // No draft is left pointing at a video the sweeper is about to delete, and no space is claimed back yet.
    expect(await db.post.findUnique({ where: { id: p.id } })).toBeNull();
    expect(r.freedBytes).toBe(0);
    expect(r.refunded).toBe(false);
    expect((r as { pendingBytes: number }).pendingBytes).toBe(50 * MB);
    expect(await db.storageCleanup.count({ where: { mediaId: m.id, doneAt: null, purpose: "media" } })).toBe(1);
    expect(await db.media.findUnique({ where: { id: m.id } })).not.toBeNull();
    expect((await storageUsageFor(user.id)).storage!.usedBytes).toBe(50 * MB);
    // The sweeper gets the file out, then the row goes and the space is free.
    const { runCleanups } = await import("../lib/account-cleanup");
    await runCleanups({ now: new Date(Date.now() + 7 * 86_400_000), limit: 500 });
    expect(await db.storageCleanup.count({ where: { mediaId: m.id, doneAt: null } })).toBe(0);
    expect(await db.media.findUnique({ where: { id: m.id } })).toBeNull();
    expect((await storageUsageFor(user.id)).storage!.usedBytes).toBe(0);
    // A second delete of the same draft frees nothing twice.
    expect((await deleteDraftWithMedia(user, p.id)).freedBytes).toBe(0);
  });

  test("a post that has gone out keeps its video", async () => {
    const { user } = await account({ priceMinor: 49900, storageMb: 4096 });
    const m = await mediaRow(user.id, 5 * MB);
    const p = await db.post.create({ data: { userId: user.id, mediaId: m.id, status: "published" } });
    await expect(deleteDraftWithMedia(user, p.id)).rejects.toMatchObject({ status: 409, code: "published" });
    expect(await db.media.findUnique({ where: { id: m.id } })).not.toBeNull();
  });
});

describe("staff changes", () => {
  test("extra allowance and a cycle reset are recorded and audited", async () => {
    const { user } = await account({ priceMinor: 0, uploadMonthlyMb: 100 });
    await upload(user.id, 100 * MB);
    const actor = { login: "staff-1209", role: "super" };
    const x = await adjustQuota({ userId: user.id, action: "extra", mb: 50, note: "creator event" }, actor);
    expect(x.usage.monthly!.allowanceBytes).toBe(150 * MB);
    expect(x.usage.canUpload).toBe(true);
    const r = await adjustQuota({ userId: user.id, action: "reset", note: "support ticket" }, actor);
    expect(r.usage.monthly!.usedBytes).toBe(0);
    await expect(adjustQuota({ userId: user.id, action: "reset", note: "again" }, actor)).rejects.toMatchObject({ status: 409 });
    const logs = await db.auditLog.findMany({ where: { email: user.email, targetType: "storage" } });
    expect(logs.map((l) => l.action).sort()).toEqual(["storage.extra_allowance", "storage.reset_cycle"]);
    expect(await db.uploadLedger.count({ where: { userId: user.id } })).toBe(1);
  });
});

describe("wiring", () => {
  const read = (p: string) => require("node:fs").readFileSync(new URL(`../${p}`, import.meta.url), "utf8") as string;
  test("Start Over Delete must say what happens to the media", () => {
    const r = read("app/api/posts/[id]/route.ts");
    expect(r).toContain('"keep"');
    expect(r).toContain("deleteDraftWithMedia");
  });
  test("a new or renewed subscription records where its cycle starts", () => {
    expect(read("lib/billing/service.ts")).toContain("currentPeriodStart: now");
    expect(read("lib/billing/autorenew.ts")).toContain("currentPeriodStart:");
  });
  test("Settings has a Storage tab, and the new screens follow the copy rules", () => {
    expect(read("components/settings/SettingsView.tsx")).toContain("<StorageManager />");
    for (const f of ["components/settings/StorageManager.tsx", "components/billing/QuotaCard.tsx", "components/admin/users/StoragePanel.tsx"]) {
      const s = read(f);
      expect(s).not.toMatch(/[\u2013\u2014]/);
      expect(s).not.toContain("transition-all");
      expect(s).not.toMatch(/(^|[\s"'`])hover:/);
    }
  });
});
