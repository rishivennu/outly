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

describe("referral free month (1066: the sharer gets it)", () => {
  const verified = async (tag: string, extra: Record<string, unknown> = {}) => {
    const u = await mk(tag, extra);
    return db.user.update({ where: { id: u.id }, data: { emailVerifiedAt: new Date(), emailVerifiedFor: u.email } });
  };
  test("a verified friend's first payment earns the SHARER one Creator month, only once per friend", async () => {
    const owner = await mk("ref-owner");
    const code = await ref.ensureReferralCode(owner.id);
    expect(await ref.ensureReferralCode(owner.id)).toBe(code); // stable
    const buyer = await verified("ref-buyer", { referredById: owner.id });
    await pay(buyer.id, "creator");
    const grants = await db.planGrant.findMany({ where: { userId: owner.id, source: "referral" }, include: { plan: true } });
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatchObject({ status: "active", grantedBy: "system", email: owner.email.toLowerCase() });
    expect(grants[0].plan.slug).toBe("creator");
    // the sharer has no paid plan, so the month starts now
    expect(Math.abs(grants[0].startsAt.getTime() - Date.now())).toBeLessThan(60_000);
    expect(grants[0].endsAt.getTime() - grants[0].startsAt.getTime()).toBe(30 * 86_400_000);
    expect(await db.emailLog.count({ where: { to: owner.email, kind: "referral" } })).toBe(1);
    // the friend earns nothing
    expect(await db.planGrant.count({ where: { userId: buyer.id, source: "referral" } })).toBe(0);
    expect(await db.emailLog.count({ where: { to: buyer.email, kind: "referral" } })).toBe(0);

    // a second payment by the same friend doesn't issue another month
    await pay(buyer.id, "studio");
    expect(await db.planGrant.count({ where: { userId: owner.id, source: "referral" } })).toBe(1);
    const s = await ref.referralSummary(owner.id);
    expect(s.code).toBe(code);
    expect(s.stats.rewarded).toBe(1);
    expect(s.earned.count).toBe(1);
    expect(s.earned.until).toBe(grants[0].endsAt.toISOString());
    expect(s.url).toEndWith(`/signup?ref=${code}`);
    expect(s.history[0].friend).not.toContain(buyer.email); // masked
    expect((await ref.referralSummary(buyer.id)).earned.count).toBe(0);
  });
  test("a paying sharer's month waits for their paid period, and a second friend's month queues after the first", async () => {
    const owner = await mk("ref-q-owner");
    await pay(owner.id, "creator");
    const paidEnd = (await db.subscription.findFirstOrThrow({ where: { userId: owner.id, status: "active", priceMinor: { gt: 0 } } })).currentPeriodEnd;
    const a = await verified("ref-q-a", { referredById: owner.id });
    const b = await verified("ref-q-b", { referredById: owner.id });
    await pay(a.id, "creator");
    await pay(b.id, "pro-manager");
    const [g1, g2] = await db.planGrant.findMany({ where: { userId: owner.id, source: "referral" }, orderBy: { startsAt: "asc" } });
    expect(Math.abs(g1.startsAt.getTime() - paidEnd.getTime())).toBeLessThan(5_000);
    expect(g2.startsAt.getTime()).toBe(g1.endsAt.getTime());
    expect((await ref.referralSummary(owner.id)).earned).toMatchObject({ count: 2, until: g2.endsAt.toISOString() });
  });
  test("an unverified friend's payment waits for their address, then the sharer's month arrives", async () => {
    const owner = await mk("ref-wait-owner");
    const buyer = await mk("ref-wait", { referredById: owner.id });
    await pay(buyer.id, "creator");
    expect(await db.referral.findUnique({ where: { referredId: buyer.id } })).toMatchObject({ status: "paid" });
    expect(await db.planGrant.count({ where: { userId: owner.id, source: "referral" } })).toBe(0);
    await db.user.update({ where: { id: buyer.id }, data: { emailVerifiedAt: new Date(), emailVerifiedFor: buyer.email } });
    await ref.settleReferral(buyer.id);
    await ref.settleReferral(buyer.id); // idempotent
    expect(await db.planGrant.count({ where: { userId: owner.id, source: "referral" } })).toBe(1);
    expect(await db.planGrant.count({ where: { userId: buyer.id, source: "referral" } })).toBe(0);
    expect(await db.referral.findUnique({ where: { referredId: buyer.id } })).toMatchObject({ status: "rewarded" });
  });
});
