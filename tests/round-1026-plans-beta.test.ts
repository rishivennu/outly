/**
 * 10-26: plan limits (weekly posts, upload size, inbox replies, AI-caption videos, burn-in) and the beta
 * program (one-time codes, atomic redeem). Runs against the throwaway test database.
 */
import { beforeAll, describe, expect, test } from "bun:test";

let db: typeof import("../lib/db").db;
let ent: typeof import("../lib/billing/entitlements");
let beta: typeof import("../lib/beta");
let settings: typeof import("../lib/settings");
let n = 0;
let limitedPlanId = "";

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  ent = await import("../lib/billing/entitlements");
  beta = await import("../lib/beta");
  settings = await import("../lib/settings");
  // A plan of our own, so nothing here depends on what the Free plan is set to.
  const p = await db.plan.upsert({
    where: { slug: "t1026-limited" },
    create: { slug: "t1026-limited", name: "Limited", priceMinor: 0, postLimit: 3, postPeriod: "week", maxUploadMb: 50, replyLimit: 2, captionVideos: 2, burnCaptions: false, aiCaptions: true, state: "hidden" },
    update: {},
  });
  limitedPlanId = p.id;
  await db.plan.upsert({ where: { slug: "t1026-creator" }, create: { slug: "t1026-creator", name: "Creator T", priceMinor: 49900, state: "hidden" }, update: {} });
}, 60_000);

const mk = async (limited = true) => {
  const u = await db.user.create({ data: { name: `Lim ${++n}`, email: `lim-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
  if (limited)
    await db.subscription.create({ data: { userId: u.id, planId: limitedPlanId, status: "active", priceMinor: 0, currency: "INR", interval: "month", provider: "test", currentPeriodEnd: new Date(Date.now() + 30 * 864e5) } });
  return u;
};
const status = async (p: Promise<unknown>) => {
  try {
    await p;
    return 0;
  } catch (e) {
    return (e as { status?: number }).status ?? -1;
  }
};

describe("usage windows", () => {
  test("weekStart is Monday 00:00 UTC", () => {
    expect(ent.weekStart(new Date("2026-10-28T15:00:00Z")).toISOString()).toBe("2026-10-26T00:00:00.000Z"); // Wednesday
    expect(ent.weekStart(new Date("2026-10-26T00:00:00Z")).toISOString()).toBe("2026-10-26T00:00:00.000Z"); // Monday itself
    expect(ent.weekStart(new Date("2026-11-01T23:59:00Z")).toISOString()).toBe("2026-10-26T00:00:00.000Z"); // Sunday
  });
  test("periodKey uses ISO weeks, including across the new year", () => {
    expect(ent.periodKey("week", new Date("2026-10-26T10:00:00Z"))).toBe("2026-W44");
    expect(ent.periodKey("week", new Date("2026-01-01T10:00:00Z"))).toBe("2026-W01"); // a Thursday
    expect(ent.periodKey("week", new Date("2027-01-01T10:00:00Z"))).toBe("2026-W53"); // a Friday: still 2026's last week
    expect(ent.periodKey("month", new Date("2026-03-09T10:00:00Z"))).toBe("2026-03");
  });
  test("checkPostLimit says week or month and offers the upgrade", () => {
    try {
      ent.checkPostLimit({ postLimit: 3, planName: "Free", postPeriod: "week" }, 3);
      throw new Error("should have thrown");
    } catch (e) {
      const err = e as { status: number; code: string; message: string; extra?: { feature: string } };
      expect(err.status).toBe(402);
      expect(err.code).toBe("PLAN_LIMIT");
      expect(err.message).toContain("this week");
      expect(err.message).toContain("Upgrade to post more");
      expect(err.extra?.feature).toBe("posts");
    }
    expect(() => ent.checkPostLimit({ postLimit: 3, planName: "Free", postPeriod: "week" }, 2)).not.toThrow();
    expect(() => ent.checkPostLimit({ postLimit: 0, planName: "Pro", postPeriod: "week" }, 999)).not.toThrow();
  });
});

describe("plan limits", () => {
  test("uploads over the plan cap are a 402 upgrade, not a 413", async () => {
    const u = await mk();
    expect(await status(ent.assertUploadSize(u.id, 49 * 1024 * 1024))).toBe(0);
    expect(await status(ent.assertUploadSize(u.id, 51 * 1024 * 1024))).toBe(402);
  });
  test("the 4th post in a week is refused", async () => {
    const u = await mk();
    const m = await db.media.create({ data: { userId: u.id, originalFilename: "a.mp4", storageKey: `lim/${u.id}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    await db.post.create({ data: { userId: u.id, mediaId: m.id, status: "draft", title: "drafts are free" } });
    for (let i = 0; i < 2; i++) await db.post.create({ data: { userId: u.id, mediaId: m.id, status: "scheduled", launchedAt: new Date(), title: `p${i}` } });
    // last week's post doesn't count against this week
    await db.post.create({ data: { userId: u.id, mediaId: m.id, status: "published", launchedAt: new Date(ent.weekStart().getTime() - 864e5), title: "old" } });
    expect((await ent.postUsage(u.id)).left).toBe(1);
    expect(await status(ent.assertCanPost(u.id))).toBe(0);
    await db.post.create({ data: { userId: u.id, mediaId: m.id, status: "scheduled", launchedAt: new Date(), title: "p3" } });
    expect(await status(ent.assertCanPost(u.id))).toBe(402);
  });
  test("inbox replies stop at the weekly limit", async () => {
    const u = await mk();
    await ent.assertCanReply(u.id);
    await ent.recordUse(u.id, "reply", "c1");
    await ent.recordUse(u.id, "reply", "c2");
    expect(await status(ent.assertCanReply(u.id))).toBe(402);
  });
  test("AI captions count videos, not calls: the same video passes again, a third one is refused", async () => {
    const u = await mk();
    await ent.assertCaptionVideo(u.id, "a.mp4:120");
    await ent.assertCaptionVideo(u.id, "a.mp4:120"); // second chunk of the same video
    await ent.assertCaptionVideo(u.id, "b.mp4:300");
    expect((await ent.captionUsage(u.id)).used).toBe(2);
    expect(await status(ent.assertCaptionVideo(u.id, "c.mp4:90"))).toBe(402);
    expect(await status(ent.assertCaptionVideo(u.id, "a.mp4:120"))).toBe(0); // already counted
  });
  test("burning captions is paid-only", async () => {
    const limited = await mk();
    expect(await status(ent.assertBurnCaptions(limited.id))).toBe(402);
  });
  const posts = async (userId: string, k: number) => {
    const m = await db.media.create({ data: { userId, originalFilename: "s.mp4", storageKey: `lim/s-${userId}-${Date.now()}.mp4`, mimeType: "video/mp4", size: 10, status: "ready" } });
    return Promise.all(Array.from({ length: k }, (_, i) => db.post.create({ data: { userId, mediaId: m.id, status: "draft", title: `s${i}` } })));
  };
  test("post slots: deleting a sent post doesn't give the slot back, and a retry of the same post is free", async () => {
    const u = await mk();
    const [a, b, c, d] = await posts(u.id, 4);
    for (const p of [a, b, c]) expect((await ent.spendPost(u.id, p.id)).fresh).toBe(true);
    expect((await ent.spendPost(u.id, a.id)).fresh).toBe(false); // same post, same week: no new cost
    await db.post.deleteMany({ where: { id: { in: [a.id, b.id, c.id] } } });
    expect((await ent.postUsage(u.id)).left).toBe(0);
    expect(await status(ent.spendPost(u.id, d.id))).toBe(402);
  });
  test("post slots: five launches at once with one slot left never overshoot", async () => {
    const u = await mk();
    const ps = await posts(u.id, 7);
    for (const p of ps.slice(0, 2)) await ent.spendPost(u.id, p.id);
    const res = await Promise.all(ps.slice(2).map((p) => status(ent.spendPost(u.id, p.id))));
    expect(res.filter((r) => r === 0).length).toBeLessThanOrEqual(1);
    expect(res.every((r) => r === 0 || r === 402)).toBe(true);
    expect(await db.featureUse.count({ where: { userId: u.id, feature: "post" } })).toBeLessThanOrEqual(3);
    // once the race is over, the slot (if nobody got it) is still there to take
    if (!res.includes(0)) expect((await ent.spendPost(u.id, ps[2].id)).fresh).toBe(true);
    expect(await status(ent.spendPost(u.id, (await posts(u.id, 1))[0].id))).toBe(402);
  });
  test("post slots: a failed post sent again next week costs a slot there", async () => {
    const u = await mk();
    const [a] = await posts(u.id, 1);
    await ent.spendPost(u.id, a.id);
    const next = new Date(ent.weekStart().getTime() + 7 * 864e5 + 3600_000);
    expect((await ent.spendPost(u.id, a.id, next)).fresh).toBe(true);
  });
  test("reply slots: parallel replies at the last slot never overshoot, and release() hands it back", async () => {
    const u = await mk(); // replyLimit 2
    const one = await ent.reserveReply(u.id, "r1");
    expect(one.left).toBe(1);
    const res = await Promise.all(["r2", "r3", "r4"].map((r) => status(ent.reserveReply(u.id, r))));
    expect(res.filter((r) => r === 0).length).toBeLessThanOrEqual(1);
    expect(await db.featureUse.count({ where: { userId: u.id, feature: "reply" } })).toBeLessThanOrEqual(2);
    if (!res.includes(0)) await ent.reserveReply(u.id, "r4b");
    expect(await status(ent.reserveReply(u.id, "r4c"))).toBe(402);
    await one.release();
    expect(await status(ent.reserveReply(u.id, "r5"))).toBe(0);
  });
  test("caption audio is metered by the server: one reused ref can't stretch past the monthly chunk budget", async () => {
    const u = await mk(); // captionVideos 2
    const budget = 2 * ent.CHUNKS_PER_CAPTION_VIDEO;
    for (let i = 0; i < budget; i++) await ent.assertCaptionVideo(u.id, "same-ref");
    expect(await status(ent.assertCaptionVideo(u.id, "same-ref"))).toBe(402);
  });
});

describe("beta codes", () => {
  test("codes avoid look-alike characters and normalise from sloppy input", () => {
    for (let i = 0; i < 50; i++) expect(beta.makeBetaCode()).toMatch(/^BETA-[A-HJKMNP-Z2-9]{4}-[A-HJKMNP-Z2-9]{4}$/);
    expect(beta.normalizeCode(" beta abcd efgh ")).toBe("BETA-ABCD-EFGH");
    expect(beta.normalizeCode("abcd-efgh")).toBe("BETA-ABCD-EFGH");
  });
  test("the first members get a code until the limit, then nobody", async () => {
    await settings.saveConfig("beta", { enabled: true, limit: (await beta.issuedCount()) + 1, planSlug: "t1026-creator", months: 3 });
    const a = await mk(false);
    const b = await mk(false);
    expect(await beta.issueBetaCodeOnSignup(a.id)).not.toBeNull();
    expect(await beta.issueBetaCodeOnSignup(b.id)).toBeNull();
    expect(await beta.issueBetaCodeOnSignup(a.id)).toBeNull(); // never two codes for one person
  });
  test("redeem gives the plan for N months, once; a double submit can't redeem twice", async () => {
    await settings.saveConfig("beta", { enabled: true, limit: (await beta.issuedCount()) + 1, planSlug: "t1026-creator", months: 3 });
    const u = await mk(false);
    const code = (await beta.issueBetaCodeOnSignup(u.id))!.code;
    const results = await Promise.allSettled([beta.redeemBetaCode(u.id, code), beta.redeemBetaCode(u.id, code)]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const subs = await db.subscription.findMany({ where: { userId: u.id, status: "active", provider: "beta" } });
    expect(subs).toHaveLength(1);
    const months = (subs[0].currentPeriodEnd.getTime() - Date.now()) / (30.4 * 864e5);
    expect(months).toBeGreaterThan(2.8);
    expect(months).toBeLessThan(3.2);
    expect(subs[0].cancelAtPeriodEnd).toBe(true);
    expect((await ent.entitlements(u.id)).planSlug).toBe("t1026-creator");
  });
  test("someone else's code, a revoked code and an unknown code are refused", async () => {
    await settings.saveConfig("beta", { enabled: true, limit: (await beta.issuedCount()) + 1, planSlug: "t1026-creator", months: 3 });
    const owner = await mk(false);
    const other = await mk(false);
    const c = (await beta.issueBetaCodeOnSignup(owner.id))!;
    expect(await status(beta.redeemBetaCode(other.id, c.code))).toBe(403);
    await beta.revokeBetaCode(c.id);
    expect(await status(beta.redeemBetaCode(owner.id, c.code))).toBe(404);
    expect(await status(beta.redeemBetaCode(owner.id, "BETA-ZZZZ-ZZZZ"))).toBe(404);
  });
  test("a manual code works for anyone, once", async () => {
    await settings.saveConfig("beta", { enabled: true, limit: 0, planSlug: "t1026-creator", months: 1 });
    const c = (await beta.makeManualCode("giveaway"))!;
    const a = await mk(false);
    const b = await mk(false);
    expect(await status(beta.redeemBetaCode(a.id, c.code.toLowerCase()))).toBe(0);
    expect(await status(beta.redeemBetaCode(b.id, c.code))).toBe(409);
  });
  test("switched off: no codes on signup", async () => {
    await settings.saveConfig("beta", { enabled: false, limit: 1000, planSlug: "t1026-creator", months: 3 });
    expect(await beta.issueBetaCodeOnSignup((await mk(false)).id)).toBeNull();
    expect(await status(beta.makeManualCode("off"))).toBe(409);
    expect(await status(beta.backfillBetaCodes())).toBe(409);
    await settings.saveConfig("beta", { enabled: true, limit: 0, planSlug: "creator", months: 3 });
  });
});

describe("forgot password", () => {
  test("a reset code sets a new password, can't be used to sign in, and signs other devices out", async () => {
    const { issueCode, verifyCode } = await import("../lib/otp/service");
    const { setPassword, signIn } = await import("../lib/auth-provider");
    const { hashPassword } = await import("../lib/auth");
    const email = `reset-${Date.now()}@test.dev`;
    const u = await db.user.create({ data: { name: "Reset Me", email, passwordHash: await hashPassword("old-password-1") } });
    let sent = "";
    const channel = { id: "email" as const, send: async (_to: string, code: string, ctx: { purpose?: string }) => ((sent = `${ctx.purpose}:${code}`), { ok: true }) };
    await issueCode(email, "reset", channel);
    const [purpose, code] = sent.split(":");
    expect(purpose).toBe("reset");
    expect(code).toMatch(/^\d{6}$/);
    expect(await status(verifyCode(email, code, "login"))).toBe(401); // a reset code is not a sign-in code
    const ok = await verifyCode(email, code, "reset");
    expect(ok.id).toBe(u.id);
    expect(await status(verifyCode(email, code, "reset"))).toBe(401); // single use
    const before = (await db.user.findUnique({ where: { id: u.id } }))!.tokenVersion;
    await setPassword(u.id, "brand-new-password-2");
    expect((await db.user.findUnique({ where: { id: u.id } }))!.tokenVersion).toBe(before + 1);
    expect((await signIn(email, "brand-new-password-2")).id).toBe(u.id);
    expect(await status(signIn(email, "old-password-1"))).toBe(401);
  });
});
