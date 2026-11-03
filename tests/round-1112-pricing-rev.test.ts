/**
 * 1112: the revised November 2026 pricing (unit economics). Per-plan AI request caps (day and month), X off on
 * Free (xPostLimit -1), 4 audio minutes per captioned video, and the revision preset on top of the first one,
 * with an Undo that puts back exactly the plans and packs it replaced.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { packBlock, normalizeTopups } from "../lib/billing/topups-core";

// revalidatePath needs a Next request; outside one it throws. Everything else in next/cache stays real.
const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

const DAY = 86_400_000;
let db: typeof import("../lib/db").db;
let ent: typeof import("../lib/billing/entitlements");
let plans: typeof import("../lib/billing/plans");
let preset: typeof import("../lib/billing/pricing-preset");
let quota: typeof import("../lib/ai-quota");
let settings: typeof import("../lib/settings");
const actor = { login: "admin@outlly.test", role: "finance" } as const;
let n = 0;
const tag = () => `${Date.now().toString(36)}${n++}`;
const mkUser = async () => db.user.create({ data: { name: `R ${tag()}`, email: `r1112-${tag()}@test.dev`, passwordHash: "x" } });
const onPlan = async (planId: string) => {
  const u = await mkUser();
  await db.subscription.create({ data: { userId: u.id, planId, status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
  return u;
};
const status = async (p: Promise<unknown>) => p.then(() => 0, (e) => e as { status?: number; code?: string; extra?: { feature?: string } });

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  ent = await import("../lib/billing/entitlements");
  plans = await import("../lib/billing/plans");
  preset = await import("../lib/billing/pricing-preset");
  quota = await import("../lib/ai-quota");
  settings = await import("../lib/settings");
  await plans.ensurePlans();
});

afterAll(async () => {
  await settings.saveConfig("topups", { enabled: false });
});

describe("1112 plan rules", () => {
  test("captions meter 4 audio minutes per allowed video", () => {
    expect(ent.CHUNKS_PER_CAPTION_VIDEO).toBe(4);
  });

  test("a plan without X can't post to X, and an X pack isn't sold to it", async () => {
    const noX = await db.plan.create({ data: { slug: `t1112-nox-${tag()}`, name: "No X", priceMinor: 100, state: "hidden", xPostLimit: -1 } });
    const u = await onPlan(noX.id);
    expect(await status(ent.spendXPosts(u.id, [`${u.id}-a`]))).toMatchObject({ status: 402, extra: { feature: "x" } });
    expect(await status(ent.spendXPosts(u.id, []))).toBe(0); // nothing to X, nothing to check
    expect((await ent.xPostUsage(u.id)).left).toBe(0);
    expect(() => ent.checkX({ xPostLimit: -1, planName: "Free" })).toThrow(/isn't part of Free/);
    expect(() => ent.checkX({ xPostLimit: 0, planName: "Open" })).not.toThrow();
    const cfg = normalizeTopups({ enabled: true, paidOnly: false, packs: [{ id: "x-50", kind: "x", units: 50, priceMinor: 44900 }] });
    expect(packBlock(cfg, cfg.packs[0], noX.slug, true, { xPostLimit: -1, captionVideos: 0, aiCaptions: true, brandLimit: 0 })).toMatch(/doesn't post to X/);
  });

  test("AI requests: the plan's daily cap replaces the server default", async () => {
    const p = await db.plan.create({ data: { slug: `t1112-day-${tag()}`, name: "Day", priceMinor: 100, state: "hidden", aiDaily: 2 } });
    const u = await onPlan(p.id);
    await quota.chargeAi(u.id);
    await quota.chargeAi(u.id);
    expect(await status(quota.chargeAi(u.id))).toMatchObject({ status: 429, code: "AI_QUOTA" });
    expect(await status(quota.chargeAi(u.id))).toMatchObject({ status: 429, code: "AI_QUOTA" });
    expect((await quota.aiQuota(u.id)).limit).toBe(2);
  });

  test("AI requests: calls refused by the daily cap don't eat the monthly allowance", async () => {
    const p = await db.plan.create({ data: { slug: `t1112-both-${tag()}`, name: "Both", priceMinor: 100, state: "hidden", aiMonthly: 5, aiDaily: 2 } });
    const u = await onPlan(p.id);
    const d1 = new Date("2026-11-02T10:00:00Z");
    await quota.chargeAi(u.id, "ai", d1);
    await quota.chargeAi(u.id, "ai", d1);
    for (let i = 0; i < 4; i++) expect(await status(quota.chargeAi(u.id, "ai", d1))).toMatchObject({ status: 429 });
    expect(await quota.aiQuota(u.id, "ai", d1)).toMatchObject({ used: 2, monthUsed: 2 });
    // next day: 3 of the month's 5 are still there
    const d2 = new Date("2026-11-03T10:00:00Z");
    await quota.chargeAi(u.id, "ai", d2);
    await quota.chargeAi(u.id, "ai", d2);
    expect(await quota.aiQuota(u.id, "ai", d2)).toMatchObject({ monthUsed: 4, left: 0 });
  });

  test("AI requests: the monthly cap sums every day of the month and gives a refused call back", async () => {
    const p = await db.plan.create({ data: { slug: `t1112-month-${tag()}`, name: "Month", priceMinor: 100, state: "hidden", aiMonthly: 3, aiDaily: 10 } });
    const u = await onPlan(p.id);
    const d1 = new Date("2026-11-02T10:00:00Z");
    const d2 = new Date("2026-11-05T10:00:00Z");
    await quota.chargeAi(u.id, "ai", d1);
    await quota.chargeAi(u.id, "ai", d1);
    await quota.chargeAi(u.id, "ai", d2);
    const over = await status(quota.chargeAi(u.id, "ai", d2));
    expect(over).toMatchObject({ status: 402, code: "PLAN_LIMIT", extra: { feature: "ai" } });
    expect((await db.aiUsage.findUniqueOrThrow({ where: { userId_day_kind: { userId: u.id, day: "2026-11-05", kind: "ai" } } })).count).toBe(1);
    const q = await quota.aiQuota(u.id, "ai", d2);
    expect(q).toMatchObject({ monthUsed: 3, monthLimit: 3, left: 0 });
    // a new month starts fresh
    expect((await quota.chargeAi(u.id, "ai", new Date("2026-12-01T00:30:00Z"))).used).toBe(1);
  });

  test("support chat keeps its own daily cap, not the plan's", async () => {
    const p = await db.plan.create({ data: { slug: `t1112-sup-${tag()}`, name: "Sup", priceMinor: 100, state: "hidden", aiMonthly: 1, aiDaily: 1 } });
    const u = await onPlan(p.id);
    await quota.chargeAi(u.id, "support");
    await quota.chargeAi(u.id, "support");
    expect((await quota.aiQuota(u.id, "support")).monthLimit).toBe(0);
  });
});

describe("1112 revision preset", () => {
  const snap = async () => Object.fromEntries((await db.plan.findMany({ orderBy: { slug: "asc" } })).map(({ updatedAt: _u, ...r }) => [r.slug, r]));

  test("refused until the first preset is applied", async () => {
    expect(await preset.presetBackup()).toBeNull();
    expect(await status(preset.applyPricingRevision(actor))).toMatchObject({ status: 409, code: "PRESET_MISSING" });
  });

  test("applies the new prices, caps and packs; undo puts back exactly what it replaced", async () => {
    await preset.applyPricingPreset(actor, {});
    await settings.saveConfig("topups", { enabled: true, paidOnly: true } as never);
    const before = await snap();
    const packsBefore = normalizeTopups(await settings.getConfig("topups"));

    const r = await preset.applyPricingRevision(actor);
    expect(r.changed).toEqual(["free", "starter", "creator", "pro-manager"]);
    const p = Object.fromEntries((await db.plan.findMany()).map((x) => [x.slug, x]));
    expect(p.free).toMatchObject({ priceMinor: 0, xPostLimit: -1, captionVideos: 3, aiMonthly: 15, aiDaily: 5, platformLimit: 3 });
    expect(p.starter).toMatchObject({ priceMinor: 37900, yearlyMinor: 379000, postLimit: 45, xPostLimit: 15, captionVideos: 25, aiMonthly: 60, aiDaily: 10, storageMb: 5120 });
    expect(p.creator).toMatchObject({ priceMinor: 97900, postLimit: 150, xPostLimit: 40, captionVideos: 60, aiMonthly: 200, aiDaily: 25, fairUsePosts: 0, highlight: true });
    expect(p["pro-manager"]).toMatchObject({ priceMinor: 347900, postLimit: 600, xPostLimit: 150, captionVideos: 200, aiMonthly: 600, aiDaily: 60, seats: 5 });
    expect(JSON.parse(p.starter.prices)).toEqual({ USD: 800, EUR: 800, GBP: 700 });
    expect(JSON.parse(p["pro-manager"].yearlyPrices)).toEqual({ USD: 43000, EUR: 43000, GBP: 36000 });
    const t = normalizeTopups(await settings.getConfig("topups"));
    expect(t.enabled).toBe(true); // the admin's switches stay
    expect(t.packs.map((x) => [x.id, x.units, x.priceMinor])).toEqual([["ai-20", 20, 14900], ["x-50", 50, 44900], ["brand-1", 1, 44900], ["seat-1", 1, 22900]]);
    for (const x of preset.PRICING_2026_11_R2) for (const line of x.data.features) expect(line).not.toMatch(/AI videos|unlimited/i);

    // the public plan carries the caps; the Free entitlement turns X off
    const pub = (await plans.listPlans()).find((x: { slug: string }) => x.slug === "starter")!;
    expect(pub).toMatchObject({ aiMonthly: 60, aiDaily: 10 });

    // one apply at a time, and the first preset can't be undone underneath it
    expect(await status(preset.applyPricingRevision(actor))).toMatchObject({ status: 409, code: "PRESET_APPLIED" });
    expect(await status(preset.undoPricingPreset(actor))).toMatchObject({ status: 409, code: "REVISION_APPLIED" });

    const undo = await preset.undoPricingRevision(actor);
    expect(undo.restored.sort()).toEqual(["creator", "free", "pro-manager", "starter"]);
    expect(await snap()).toEqual(before);
    expect(normalizeTopups(await settings.getConfig("topups"))).toEqual(packsBefore);
    expect(await preset.revisionBackup()).toBeNull();
    expect((await preset.undoPricingRevision(actor)).restored).toEqual([]);
    await preset.undoPricingPreset(actor);
    expect(await preset.presetBackup()).toBeNull();
  });
});
