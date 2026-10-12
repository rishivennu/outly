/** Plan limits, team seats and the referral free month, against the throwaway test database. */
import { beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let svc: typeof import("../lib/billing/service");
let ent: typeof import("../lib/billing/entitlements");
let ref: typeof import("../lib/referral");
let team: typeof import("../lib/team/service");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  svc = await import("../lib/billing/service");
  ent = await import("../lib/billing/entitlements");
  ref = await import("../lib/referral");
  team = await import("../lib/team/service");
  await (await import("../lib/billing/plans")).ensurePlans();
}, 60_000);

const mk = (tag: string, extra: Record<string, unknown> = {}) => db.user.create({ data: { name: `R ${tag}`, email: `r-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.dev`, passwordHash: "x", ...extra } });
const pay = async (userId: string, slug: string) => {
  const s = await svc.startCheckout(userId, slug);
  return svc.completePayment(s.paymentId, `mock_${s.paymentId}`);
};

describe("plan limits", () => {
  test("pure checks", () => {
    expect(() => ent.checkPostLimit({ postLimit: 10, planName: "Free" }, 9)).not.toThrow();
    expect(() => ent.checkPostLimit({ postLimit: 10, planName: "Free" }, 10)).toThrow(/all 10 posts/);
    expect(() => ent.checkPostLimit({ postLimit: 0, planName: "Studio" }, 9999)).not.toThrow();
    expect(() => ent.checkSeats({ seats: 0, planName: "Free" }, 0)).toThrow(/doesn't include team seats/);
    expect(() => ent.checkSeats({ seats: 2, planName: "Studio" }, 1)).not.toThrow();
    expect(() => ent.checkSeats({ seats: 2, planName: "Studio" }, 2)).toThrow(/all taken/);
  });
  test("free plan's monthly cap counts launched posts, not drafts", async () => {
    await db.plan.update({ where: { slug: "free" }, data: { postLimit: 2 } });
    try {
      const u = await mk("cap");
      const m = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `cap/${u.id}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
      const post = (title: string, status: string) => db.post.create({ data: { userId: u.id, mediaId: m.id, title, status } });
      await post("draft", "draft");
      await post("one", "published");
      expect((await ent.postUsage(u.id)).left).toBe(1);
      await ent.assertCanPost(u.id);
      await post("two", "scheduled");
      await expect(ent.assertCanPost(u.id)).rejects.toThrow(/Upgrade/);
    } finally {
      await db.plan.update({ where: { slug: "free" }, data: { postLimit: 0 } });
    }
  });
  test("AI captions can be switched off per plan", async () => {
    const u = await mk("ai");
    await db.plan.update({ where: { slug: "free" }, data: { aiCaptions: false } });
    try {
      await expect(ent.assertAiCaptions(u.id)).rejects.toThrow(/aren't part of/);
    } finally {
      await db.plan.update({ where: { slug: "free" }, data: { aiCaptions: true } });
    }
  });
});

describe("team seats", () => {
  test("invites respect the owner's seats and can't target yourself", async () => {
    const owner = await mk("owner");
    await db.plan.update({ where: { slug: "studio" }, data: { seats: 1 } });
    await expect(team.invite(owner, "a@test.dev", "editor")).rejects.toThrow(/seat/i);
    await pay(owner.id, "studio");
    await expect(team.invite(owner, owner.email, "editor")).rejects.toThrow(/That's you/);
    const r = await team.invite(owner, "Helper@Test.dev", "editor");
    expect(r.url).toContain("/team/accept?token=");
    // re-inviting the same person refreshes the link instead of using a second seat
    await team.invite(owner, "helper@test.dev", "manager");
    await expect(team.invite(owner, "other@test.dev", "editor")).rejects.toThrow(/all taken/);
    const t = await team.teamFor(owner.id);
    expect(t.seats).toMatchObject({ used: 1, total: 1 });
    expect(t.members[0]).toMatchObject({ email: "helper@test.dev", role: "manager", status: "invited" });
    const token = r.url.split("token=")[1];
    expect(await team.inviteByToken(token)).toBeNull(); // the first link was replaced
  });
});

describe("referral free month", () => {
  test("the referrer gets a month when their friend first pays, only once", async () => {
    const friend0 = await mk("ref-owner");
    const code = await ref.ensureReferralCode(friend0.id);
    expect(await ref.ensureReferralCode(friend0.id)).toBe(code); // stable
    const buyer = await mk("ref-buyer", { referredById: friend0.id });
    await pay(buyer.id, "creator");
    const gift = await db.subscription.findFirst({ where: { userId: friend0.id, status: "active" }, include: { plan: true } });
    expect(gift).toMatchObject({ provider: "referral", priceMinor: 0, cancelAtPeriodEnd: true });
    expect(gift!.plan.slug).toBe("creator");
    expect(await db.emailLog.count({ where: { to: friend0.email, kind: "referral" } })).toBe(1);

    // a second payment by the same friend doesn't stack another month
    const end = gift!.currentPeriodEnd.getTime();
    await pay(buyer.id, "studio");
    const after = await db.subscription.findFirst({ where: { userId: friend0.id, status: "active" } });
    expect(after!.currentPeriodEnd.getTime()).toBe(end);
    const s = await ref.referralSummary(friend0.id);
    expect(s).toMatchObject({ code, joined: 1, rewarded: 1 });
    expect(s.url).toEndWith(`/r/${code}`);
  });
  test("a paying referrer has their current plan extended by a month", async () => {
    const owner = await mk("ref-paid");
    await pay(owner.id, "creator");
    const before = (await db.subscription.findFirstOrThrow({ where: { userId: owner.id, status: "active" } })).currentPeriodEnd;
    const buyer = await mk("ref-buyer2", { referredById: owner.id });
    await pay(buyer.id, "creator");
    const after = (await db.subscription.findFirstOrThrow({ where: { userId: owner.id, status: "active" } })).currentPeriodEnd;
    const days = (after.getTime() - before.getTime()) / 864e5;
    expect(days).toBeGreaterThanOrEqual(28);
    expect(days).toBeLessThanOrEqual(31);
  });
});
