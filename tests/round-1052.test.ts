/** 1052: plan grants, Refer & Earn (the friend gets the month), total storage, and the inbox reel preview. */
import { beforeAll, describe, expect, test } from "bun:test";
import { DAY_MS, MB, cleanEmail, fitsStorage, grantEnd, grantState, isPaidSub, pickAccess, restack, rewardWindow, storageFigures } from "../lib/billing/access-core";
import { maskEmail, normalizeReferral, referralLabel, shareUrl } from "../lib/referral-core";
import { aspectOf, instagramMedia, relatedComments, youtubeEmbed, youtubeThumb } from "../lib/inbox-media";
import { can } from "../lib/admin/perms";

const now = new Date("2026-10-29T10:00:00Z");
const day = (n: number) => new Date(now.getTime() + n * DAY_MS);

describe("access sources never cancel each other", () => {
  const free = { sortOrder: 0, slug: "free" };
  const creator = { sortOrder: 1, slug: "creator" };
  const pro = { sortOrder: 3, slug: "pro-manager" };
  test("highest tier wins; on a tie paid beats admin beats referral; then the longest", () => {
    expect(pickAccess([{ plan: creator, source: "paid", endsAt: day(5) }, { plan: pro, source: "admin", endsAt: day(2) }])!.plan.slug).toBe("pro-manager");
    expect(pickAccess([{ plan: creator, source: "referral", endsAt: day(40) }, { plan: creator, source: "paid", endsAt: day(3) }])!.source).toBe("paid");
    expect(pickAccess([{ plan: creator, source: "admin", endsAt: day(3) }, { plan: creator, source: "admin", endsAt: day(9) }])!.endsAt).toEqual(day(9));
    expect(pickAccess([{ plan: free, source: "free", endsAt: null }])!.source).toBe("free");
    expect(pickAccess([])).toBeNull();
  });
  test("beta and referral subscriptions are gifts, not payments", () => {
    expect(isPaidSub({ provider: "razorpay", priceMinor: 49900 })).toBe(true);
    expect(isPaidSub({ provider: "referral", priceMinor: 0 })).toBe(false);
    expect(isPaidSub({ provider: "beta", priceMinor: 49900 })).toBe(false);
  });
});

describe("grant dates", () => {
  test("by days or by end date, never both wrong", () => {
    expect(grantEnd(now, { days: 30 }, now)).toEqual(day(30));
    expect(grantEnd(now, { endsAt: day(10).toISOString() }, now)).toEqual(day(10));
    expect(() => grantEnd(now, { days: 0 }, now)).toThrow(/between 1 day/);
    expect(() => grantEnd(now, { days: 1.5 }, now)).toThrow();
    expect(() => grantEnd(now, { endsAt: day(-1) }, now)).toThrow(/after the start/);
    expect(() => grantEnd(now, { endsAt: "nope" }, now)).toThrow(/isn't a date/);
    expect(() => grantEnd(now, { days: 4000 }, now)).toThrow();
  });
  test("state follows the clock", () => {
    expect(grantState({ status: "active", startsAt: day(1), endsAt: day(5) }, now)).toBe("scheduled");
    expect(grantState({ status: "active", startsAt: day(-1), endsAt: day(5) }, now)).toBe("active");
    expect(grantState({ status: "active", startsAt: day(-9), endsAt: day(-1) }, now)).toBe("expired");
    expect(grantState({ status: "pending", startsAt: now, endsAt: day(5) }, now)).toBe("pending");
    expect(grantState({ status: "revoked", startsAt: now, endsAt: day(5) }, now)).toBe("revoked");
  });
  test("emails are matched exactly, lowercased", () => {
    expect(cleanEmail("  Ravi.K@Gmail.com ")).toBe("ravi.k@gmail.com");
    expect(cleanEmail("not an email")).toBeNull();
    expect(cleanEmail(42)).toBeNull();
  });
});

describe("referral month is stacked after the paid period", () => {
  test("starts when the paid period ends, or now", () => {
    expect(rewardWindow(day(30), now, 30)).toEqual({ startsAt: day(30), endsAt: day(60) });
    expect(rewardWindow(null, now, 30)).toEqual({ startsAt: now, endsAt: day(30) });
    expect(rewardWindow(day(-2), now, 30).startsAt).toEqual(now);
  });
  test("a renewal pushes a month that hasn't started, keeping its length", () => {
    expect(restack({ startsAt: day(30), endsAt: day(60) }, day(60), now)).toEqual({ startsAt: day(60), endsAt: day(90) });
    expect(restack({ startsAt: day(-1), endsAt: day(29) }, day(60), now)).toBeNull(); // already running
    expect(restack({ startsAt: day(70), endsAt: day(100) }, day(60), now)).toBeNull(); // already after
  });
  test("labels, masking, links and config", () => {
    expect(referralLabel({ status: "registered", verified: false })).toBe("Registered");
    expect(referralLabel({ status: "registered", verified: true })).toBe("Awaiting qualifying payment");
    expect(referralLabel({ status: "paid" })).toBe("Payment verified");
    expect(referralLabel({ status: "rewarded", grant: { status: "active", endsAt: day(5) } }, now)).toBe("Reward granted");
    expect(referralLabel({ status: "rewarded", grant: { status: "active", endsAt: day(-5) } }, now)).toBe("Reward expired");
    expect(referralLabel({ status: "rewarded", grant: { status: "revoked", endsAt: day(5) } }, now)).toBe("Referral disqualified");
    expect(referralLabel({ status: "invited" })).toBe("Invited");
    expect(maskEmail("ravi.k@gmail.com")).toBe("ra****@gmail.com");
    expect(maskEmail("a@x.io")).toBe("a****@x.io");
    expect(maskEmail("broken")).toBe("****");
    expect(shareUrl("https://www.outlly.com/", "abc23456")).toBe("https://www.outlly.com/signup?ref=abc23456");
    const c = normalizeReferral({ rewardDays: 9999, rewardPlan: "free", eligiblePlans: ["creator", "free", "nope", "creator"] }, ["creator", "studio"]);
    expect(c).toEqual({ enabled: true, rewardPlan: "creator", rewardDays: 365, eligiblePlans: ["creator"] });
    expect(normalizeReferral({ enabled: false, rewardDays: 0 }).rewardDays).toBe(1);
  });
});

describe("storage", () => {
  test("the meter sentence and the fit check", () => {
    const s = storageFigures(200 * MB, 500);
    expect(s.label).toBe("200 MB used, 300 MB remaining out of 500 MB");
    expect(s).toMatchObject({ over: false, pct: 40, remainingBytes: 300 * MB });
    expect(storageFigures(600 * MB, 500)).toMatchObject({ over: true, remainingBytes: 0, pct: 100 });
    expect(storageFigures(3 * 1024 * MB, 50 * 1024).label).toBe("3 GB used, 47 GB remaining out of 50 GB");
    expect(fitsStorage(450 * MB, 500, 50 * MB)).toBe(true);
    expect(fitsStorage(450 * MB, 500, 50 * MB + 1)).toBe(false);
    expect(fitsStorage(600 * MB, 500, 1)).toBe(false); // over after a downgrade: nothing new
    expect(fitsStorage(10 ** 12, 0, 10 ** 9)).toBe(true); // 0 = no cap
  });
  test("plan cards stay at 5 lines when the storage line is added", async () => {
    const { storageFeatures } = await import("../lib/billing/plans");
    const studio = storageFeatures("studio", ["Everything in Creator", "Multiple workspaces", "Shared media library", "Review links before publish", "Team roles"]);
    expect(studio).toEqual(["Everything in Creator", "50 GB of storage", "Multiple workspaces", "Shared media library", "Team roles and review links"]);
    const pro = storageFeatures("pro-manager", ["Everything in Studio", "Up to 10 connected accounts", "5 team seats, access per account", "Bulk schedule across accounts", "Client reports and spike alerts"]);
    expect(pro).toHaveLength(5);
    expect(pro[1]).toBe("100 GB of storage");
    expect(storageFeatures("creator", ["Everything in Free", "Uploads up to 500 MB"])).toEqual(["Everything in Free", "500 MB of storage"]);
    const custom = ["Whatever an admin wrote"];
    expect(storageFeatures("studio", custom)).toBe(custom); // rewritten lists are left alone
  });
});

describe("admin areas", () => {
  test("plan grants: super and finance; referrals add marketing; support sees neither", () => {
    expect(can("super", "plans")).toBe(true);
    expect(can("finance", "plans")).toBe(true);
    expect(can("marketing", "plans")).toBe(false);
    expect(can("support", "plans")).toBe(false);
    expect(can("marketing", "referrals")).toBe(true);
    expect(can("support", "referrals")).toBe(false);
    expect(can(null, "plans")).toBe(false);
  });
});

describe("inbox reel preview media", () => {
  test("Instagram: a reel plays media_url under its cover; a photo is just the picture", () => {
    const reel = instagramMedia({ media_type: "REELS", media_url: "https://cdn/v.mp4", thumbnail_url: "https://cdn/t.jpg", caption: " Hi \n", timestamp: "2026-10-01T00:00:00Z" }, "@me");
    expect(reel).toMatchObject({ kind: "video", videoUrl: "https://cdn/v.mp4", thumbnailUrl: "https://cdn/t.jpg", caption: "Hi", account: "@me", embedUrl: null });
    const photo = instagramMedia({ media_type: "IMAGE", media_url: "https://cdn/p.jpg" }, null);
    expect(photo).toMatchObject({ kind: "image", videoUrl: null, thumbnailUrl: "https://cdn/p.jpg", caption: null });
  });
  test("YouTube: privacy-enhanced player, no autoplay, and only real video ids", () => {
    const u = youtubeEmbed("dQw4w9WgXcQ")!;
    expect(u.startsWith("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?")).toBe(true);
    expect(u).not.toContain("autoplay");
    expect(youtubeEmbed("../../evil")).toBeNull();
    expect(youtubeThumb({ medium: { url: "m" }, high: { url: "h" } })).toBe("h");
    expect(youtubeThumb(undefined)).toBeNull();
  });
  test("aspect ratio from the file, 9:16 when unknown; related comments in thread order", () => {
    expect(aspectOf({ width: 1080, height: 1920 })).toBeCloseTo(0.5625);
    expect(aspectOf({ width: 1920, height: 1080 })).toBeCloseTo(16 / 9);
    expect(aspectOf({ width: null, height: null })).toBeCloseTo(9 / 16);
    expect(aspectOf(null, 16 / 9)).toBeCloseTo(16 / 9);
    const c = (id: string, targetId: string, at: string) => ({ id, targetId, createdAt: at });
    const all = [c("3", "A", "2026-10-03"), c("x", "B", "2026-10-02"), c("1", "A", "2026-10-01")];
    expect(relatedComments(all, all[0]).map((r) => r.id)).toEqual(["1", "3"]);
  });
});

// ---------------------------------------------------------------- database

let db: typeof import("../lib/db").db;
let access: typeof import("../lib/billing/access");
let ent: typeof import("../lib/billing/entitlements");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  access = await import("../lib/billing/access");
  ent = await import("../lib/billing/entitlements");
  await (await import("../lib/billing/plans")).ensurePlans();
}, 60_000);

const admin = { login: "admin@outlly.test", role: "finance" as const };
const tag = () => `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
const mk = async (name: string, verified = true) => {
  const email = `g-${name}-${tag()}@test.dev`;
  return db.user.create({ data: { name, email, passwordHash: "x", ...(verified ? { emailVerifiedAt: new Date(), emailVerifiedFor: email } : {}) } });
};

describe("database: admin plan grants", () => {
  test("a grant for a verified account is live now and wins over Free", async () => {
    const u = await mk("grant-now");
    const g = await access.createGrant({ email: u.email.toUpperCase(), plan: "studio", days: 14, note: "Partner" }, admin);
    expect(g).toMatchObject({ userId: u.id, status: "active", source: "admin", email: u.email });
    const a = await access.accessFor(u.id);
    expect(a.best).toMatchObject({ source: "admin" });
    expect(a.best!.plan.slug).toBe("studio");
    await expect(access.createGrant({ email: u.email, plan: "creator", days: 5 }, admin)).rejects.toThrow(/already has a live grant/);
    expect(await db.auditLog.count({ where: { action: "grant.create", targetId: g.id, actor: admin.login } })).toBe(1);
  });
  test("an unregistered email waits, then activates on that exact verified address", async () => {
    const email = `g-pending-${tag()}@test.dev`;
    const g = await access.createGrant({ email, plan: "creator", days: 30 }, admin);
    expect(g).toMatchObject({ status: "pending", userId: null, durationDays: 30 });
    // a lookalike address (dots, +tag) must not pick it up
    const other = await db.user.create({ data: { name: "x", email: email.replace("@", "+x@"), passwordHash: "x", emailVerifiedAt: new Date(), emailVerifiedFor: email.replace("@", "+x@") } });
    expect(await access.activatePendingGrants(other.id)).toBe(0);
    const unverified = await db.user.create({ data: { name: "y", email, passwordHash: "x" } });
    expect(await access.activatePendingGrants(unverified.id)).toBe(0);
    await db.user.update({ where: { id: unverified.id }, data: { emailVerifiedAt: new Date(), emailVerifiedFor: email } });
    expect(await access.activatePendingGrants(unverified.id)).toBe(1);
    const live = await db.planGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(live).toMatchObject({ status: "active", userId: unverified.id });
    // the 30 days start on activation, not on the day it was granted
    expect(live.endsAt.getTime() - live.startsAt.getTime()).toBe(30 * DAY_MS);
  });
  test("extend, upgrade, downgrade, revoke: each lands in the audit trail", async () => {
    const u = await mk("grant-edit");
    const g = await access.createGrant({ email: u.email, plan: "creator", days: 10 }, admin);
    const ext = await access.extendGrant(g.id, { days: 5 }, admin);
    expect(ext.endsAt.getTime() - g.endsAt.getTime()).toBe(5 * DAY_MS);
    await access.changeGrant(g.id, { plan: "pro-manager" }, admin);
    await access.changeGrant(g.id, { plan: "studio" }, admin);
    await expect(access.changeGrant(g.id, { plan: "studio" }, admin)).rejects.toThrow(/already/);
    const r = await access.revokeGrant(g.id, "Ended early", admin);
    expect(r).toMatchObject({ status: "revoked", revokeReason: "Ended early", liveKey: null });
    await expect(access.extendGrant(g.id, { days: 5 }, admin)).rejects.toThrow(/revoked/);
    const acts = (await db.auditLog.findMany({ where: { targetId: g.id }, orderBy: { createdAt: "asc" } })).map((a) => a.action);
    expect(acts).toEqual(["grant.create", "grant.extend", "grant.upgrade", "grant.downgrade", "grant.revoke"]);
    expect((await access.accessFor(u.id)).best!.source).toBe("free");
  });
});

describe("database: review fixes", () => {
  test("a pending grant made by length outlives its placeholder end, then gets its full days", async () => {
    const email = `g-late-${tag()}@test.dev`;
    const g = await access.createGrant({ email, plan: "creator", days: 30 }, admin);
    const later = new Date(Date.now() + 45 * DAY_MS);
    await access.expireGrants({ email }, later);
    const held = await db.planGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(held.status).toBe("pending");
    // admins still see it as waiting, and can still change it (no "ended" / "already has a grant" deadlock)
    expect(grantState(held, later)).toBe("pending");
    await access.changeGrant(g.id, { plan: "studio" }, admin, later);
    const u = await db.user.create({ data: { name: "late", email, passwordHash: "x", emailVerifiedAt: later, emailVerifiedFor: email } });
    expect(await access.activatePendingGrants(u.id, later)).toBe(1);
    const live = await db.planGrant.findUniqueOrThrow({ where: { id: g.id } });
    expect(live).toMatchObject({ status: "active", userId: u.id });
    expect(live.startsAt).toEqual(later);
    expect(live.endsAt.getTime() - later.getTime()).toBe(30 * DAY_MS);
  });
  test("a pending grant with a fixed end still expires on that date", async () => {
    const email = `g-fixed-${tag()}@test.dev`;
    const g = await access.createGrant({ email, plan: "creator", endsAt: new Date(Date.now() + 5 * DAY_MS).toISOString() }, admin);
    await access.expireGrants({ email }, new Date(Date.now() + 6 * DAY_MS));
    expect(await db.planGrant.findUniqueOrThrow({ where: { id: g.id } })).toMatchObject({ status: "expired", liveKey: null });
  });

  const referred = async (name: string) => {
    const svc = await import("../lib/billing/service");
    const owner = await mk(`${name}-owner`);
    const u = await mk(name);
    await db.user.update({ where: { id: u.id }, data: { referredById: owner.id } });
    const s = await svc.startCheckout(u.id, "creator");
    await svc.completePayment(s.paymentId, `mock_${s.paymentId}`);
    const g = await db.planGrant.findFirstOrThrow({ where: { userId: u.id, source: "referral" } });
    return { svc, u, owner, paymentId: s.paymentId, g };
  };

  test("a Refer & Earn month can't be extended or re-planned from Grants, only revoked", async () => {
    const { g } = await referred("ref-admin");
    await expect(access.extendGrant(g.id, { days: 5 }, admin)).rejects.toThrow(/Refer & Earn/);
    await expect(access.changeGrant(g.id, { plan: "pro-manager" }, admin)).rejects.toThrow(/Refer & Earn/);
    const r = await access.revokeGrant(g.id, "abuse", admin);
    expect(r).toMatchObject({ status: "revoked", liveKey: null });
  }, 30_000);
  test("a refund made at the gateway ends the month, once", async () => {
    const { svc, u, paymentId } = await referred("ref-gw");
    expect(await svc.markExternalRefund(paymentId, "refund", "re_1")).toBe(true);
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "refunded" });
    expect(await db.planGrant.count({ where: { userId: u.id, source: "referral", status: "active" } })).toBe(0);
    expect(await db.referral.findUnique({ where: { referredId: u.id } })).toMatchObject({ status: "disqualified" });
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(0);
    // the webhook retries: nothing more happens
    expect(await svc.markExternalRefund(paymentId, "refund", "re_1")).toBe(false);
    expect(await db.auditLog.count({ where: { action: "referral.revoke", email: u.email } })).toBe(1);
  }, 30_000);
  test("a chargeback ends the month but leaves the payment for the dispute", async () => {
    const { svc, u, paymentId } = await referred("ref-cb");
    expect(await svc.markExternalRefund(paymentId, "chargeback", "fraud")).toBe(true);
    expect(await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).toMatchObject({ status: "succeeded" });
    expect(await db.planGrant.count({ where: { userId: u.id, source: "referral", status: "active" } })).toBe(0);
    expect((await db.auditLog.findFirstOrThrow({ where: { action: "referral.revoke", email: u.email } })).note).toMatch(/charged back/);
  }, 30_000);
});

describe("database: total storage", () => {
  test("Free holds 50 MB in total; over the limit blocks new uploads but keeps files", async () => {
    const u = await mk("store");
    await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `t/${tag()}`, mimeType: "video/mp4", size: 40 * MB, status: "ready" } });
    await db.media.create({ data: { userId: u.id, originalFilename: "dead.mp4", storageKey: `t/${tag()}`, mimeType: "video/mp4", size: 900 * MB, status: "failed" } });
    const s = await ent.storageUsage(u.id);
    expect(s).toMatchObject({ storageMb: 50, usedBytes: 40 * MB, over: false });
    expect(s.label).toBe("40 MB used, 10 MB remaining out of 50 MB");
    await expect(ent.assertStorage(u.id, 9 * MB)).resolves.toBeTruthy();
    await expect(ent.assertStorage(u.id, 11 * MB)).rejects.toThrow(/10 MB of storage left/);
    // a Creator grant raises the ceiling; when it is revoked the files stay but nothing new fits
    const g = await access.createGrant({ email: u.email, plan: "creator", days: 7 }, admin);
    await db.media.create({ data: { userId: u.id, originalFilename: "b.mp4", storageKey: `t/${tag()}`, mimeType: "video/mp4", size: 100 * MB, status: "ready" } });
    expect((await ent.storageUsage(u.id)).storageMb).toBe(500);
    await access.revokeGrant(g.id, "test", admin);
    const after = await ent.storageUsage(u.id);
    expect(after).toMatchObject({ over: true, usedBytes: 140 * MB });
    await expect(ent.assertStorage(u.id, 1)).rejects.toThrow(/uploads are paused/);
    expect(await db.media.count({ where: { userId: u.id, status: "ready" } })).toBe(2);
  });
});
