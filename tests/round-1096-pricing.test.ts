/**
 * 1096: the November 2026 pricing. Plan rules (platforms, brands, X posts, history, perks), top-up packs,
 * price tests and the Van Westendorp survey, renewal reminders and auto-renew charges, voice memory, and the
 * admin preset with its undo. The preset is never applied by a migration, only by an admin; this file
 * applies it and undoes it, and checks the undo leaves every plan exactly as it was.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { analyticsRanges, analyticsWindow, brandsBlock, fairUseCrossed, hasPerk, isMultiAccount, parsePerks, perkBlock, platformsBlock, serializePerks } from "../lib/billing/plan-rules";
import { TOPUP_DEFAULT, normalizeTopups, packBlock, packExpiry, packPrice } from "../lib/billing/topups-core";
import { assignVariant, experimentResults, hash32, keepStructure, normalizeExperiments, priceVariant, surveyProblem, vanWestendorp } from "../lib/billing/experiments-core";
import { reminderDue, reminderKey, renewedEnd } from "../lib/billing/renewal-core";
import { addSamples, cleanSample, parseVoice, voicePrompt } from "../lib/ai/voice-core";
import { priceFor } from "../lib/billing/cycle";
import { planFeatures } from "../lib/billing/money";

// revalidatePath needs a Next request; outside one it throws. Everything else in next/cache stays real.
const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

const DAY = 86_400_000;
const now = new Date("2026-11-02T10:00:00Z");
const at = (days: number) => new Date(now.getTime() + days * DAY);

describe("plan rules", () => {
  test("perks: empty or unreadable means every perk, never fewer", () => {
    expect(parsePerks(null)).toBeNull();
    expect(parsePerks("")).toBeNull();
    expect(parsePerks("{bad")).toBeNull();
    expect(parsePerks('["approvals","nope","approvals"]')).toEqual(["approvals"]);
    expect(parsePerks([])).toEqual([]);
    expect(serializePerks(null)).toBe("");
    expect(serializePerks(["csv-export", "x", "csv-export"])).toBe('["csv-export"]');
    expect(hasPerk({ perks: null }, "approvals")).toBe(true);
    expect(hasPerk({ perks: [] }, "approvals")).toBe(false);
    expect(perkBlock({ perks: ["csv-export"], planName: "Starter" }, "approvals")).toMatch(/isn't part of Starter/);
    expect(perkBlock({ perks: null, planName: "Agency" }, "approvals")).toBeNull();
  });
  test("any 3 platforms; reconnecting one in use is fine", () => {
    const free = { platformLimit: 3, planName: "Free" };
    expect(platformsBlock(free, ["instagram", "youtube"], "x")).toBeNull();
    expect(platformsBlock(free, ["instagram", "youtube", "x"], "tiktok")).toMatch(/up to 3 platforms.*Instagram, YouTube, X/);
    expect(platformsBlock(free, ["instagram", "youtube", "x"], "youtube")).toBeNull();
    expect(platformsBlock({ platformLimit: 0, planName: "Creator" }, ["a", "b", "c", "d"], "e")).toBeNull();
  });
  test("brands are accounts per platform, packs add room", () => {
    expect(brandsBlock({ brandLimit: 1, planName: "Starter" }, 0, "instagram")).toBeNull();
    expect(brandsBlock({ brandLimit: 1, planName: "Starter" }, 1, "instagram")).toMatch(/1 brand, so 1 Instagram account\./);
    expect(brandsBlock({ brandLimit: 1, extraBrands: 1, planName: "Starter" }, 1, "instagram")).toBeNull();
    expect(brandsBlock({ brandLimit: 0, planName: "Old" }, 9, "x")).toBeNull();
    expect(isMultiAccount({ accountLimit: 0, brandLimit: 1 })).toBe(false);
    expect(isMultiAccount({ accountLimit: 0, brandLimit: 1, extraBrands: 1 })).toBe(true);
    expect(isMultiAccount({ accountLimit: 10 })).toBe(true);
  });
  test("analytics history is capped by plan, 90 days by default, 730 at most", () => {
    expect(analyticsWindow({ analyticsDays: 30 }, 90)).toEqual({ days: 30, maxDays: 30, capped: true });
    expect(analyticsWindow({ analyticsDays: 0 }, 30)).toEqual({ days: 30, maxDays: 90, capped: false });
    expect(analyticsWindow({ analyticsDays: 99_999 }, 5000).maxDays).toBe(730);
    expect(analyticsWindow({ analyticsDays: 365 }, NaN).days).toBe(30);
    expect(analyticsWindow({ analyticsDays: 365 }, 1).days).toBe(7);
    expect(analyticsRanges(90)).toEqual([7, 30, 90]);
    expect(analyticsRanges(730)).toEqual([7, 30, 90, 180, 365, 730]);
  });
  test("fair use alerts once, when the line is crossed", () => {
    expect(fairUseCrossed(300, 299, 300)).toBe(true);
    expect(fairUseCrossed(300, 300, 301)).toBe(false);
    expect(fairUseCrossed(0, 5, 6)).toBe(false);
  });
  test("a card never states the account count twice", () => {
    const f = planFeatures({ features: ["10 accounts, 5 team seats", "Up to 8 connected accounts", "Client reports"], accountLimit: 10 });
    expect(f[0]).toBe("Up to 10 connected accounts");
    expect(f.filter((x) => /\baccounts?\b/i.test(x))).toHaveLength(1);
    expect(f).toContain("5 team seats");
  });
  test("an exact yearly price per currency wins over scaling", () => {
    const p = { priceMinor: 79900, currency: "INR", interval: "month", yearlyMinor: 799000, prices: { USD: 1500 }, yearlyPrices: { USD: 15000 } };
    expect(priceFor(p, "INR", "year", 2)).toMatchObject({ priceMinor: 799000, currency: "INR", interval: "year" });
    expect(priceFor(p, "USD", "year", 2)).toMatchObject({ priceMinor: 15000, currency: "USD", converted: false });
    expect(priceFor({ ...p, yearlyPrices: {} }, "USD", "year", 2).priceMinor).toBeGreaterThan(0);
    expect(priceFor(p, "USD", "month", 2).priceMinor).toBe(1500);
  });
});

describe("top-up packs", () => {
  test("defaults are off; bad packs are dropped, ids unique, numbers clamped", () => {
    expect(normalizeTopups(undefined)).toEqual(TOPUP_DEFAULT);
    const c = normalizeTopups({ enabled: true, packs: [{ id: "ai-5", kind: "ai", units: 5, priceMinor: 5 }, { id: "ai-5", kind: "ai", units: 9 }, { id: "BAD ID", kind: "ai" }, { id: "zz", kind: "nope" }, { id: "x-1", kind: "x", units: 1, prices: { USD: 100, XYZ: 5, EUR: -1 } }] });
    expect(c.enabled).toBe(true);
    expect(c.packs.map((p) => p.id)).toEqual(["ai-5", "x-1"]);
    expect(c.packs[0].priceMinor).toBe(9900); // under the 100 minimum -> default
    expect(c.packs[0].days).toBe(90);
    expect(c.packs[1].prices).toEqual({ USD: 100 });
  });
  test("who can buy what", () => {
    const on = { ...TOPUP_DEFAULT, enabled: true };
    const ai = on.packs.find((p) => p.id === "ai-20")!;
    const brand = on.packs.find((p) => p.id === "brand-1")!;
    expect(packBlock(TOPUP_DEFAULT, ai, "creator", true)).toMatch(/aren't on sale/);
    expect(packBlock(on, undefined, "creator", true)).toMatch(/isn't on sale/);
    expect(packBlock(on, brand, "creator", true)).toMatch(/different plan/);
    expect(packBlock(on, brand, "pro-manager", true)).toBeNull();
    expect(packBlock(on, ai, "free", false)).toMatch(/paid plans/);
    expect(packBlock({ ...on, paidOnly: false }, ai, "free", false)).toBeNull();
    expect(packPrice(ai, "INR").priceMinor).toBe(9900);
    expect(packPrice(ai, "USD")).toMatchObject({ priceMinor: 200, currency: "USD" });
    expect(packExpiry({ days: 30 }, now)).toEqual(at(30));
  });
});

describe("price tests", () => {
  const variants = [{ id: "a", priceMinor: 29900, weight: 50 }, { id: "b", priceMinor: 39900, weight: 50 }];
  test("a person always sees the same price; the split is close to the weights", () => {
    expect(hash32("abc")).toBe(hash32("abc"));
    expect(assignVariant("u1", "t", variants)).toEqual(assignVariant("u1", "t", variants));
    let a = 0;
    for (let i = 0; i < 4000; i++) if (assignVariant(`user-${i}`, "t", variants)!.id === "a") a++;
    expect(a / 4000).toBeGreaterThan(0.46);
    expect(a / 4000).toBeLessThan(0.54);
    expect(assignVariant("u1", "t", [{ id: "a", weight: 0 }, { id: "b", weight: 1 }])!.id).toBe("b");
    expect(assignVariant("u1", "t", [])).toBeNull();
  });
  test("saved config is cleaned; a test needs two variants to run", () => {
    expect(normalizeExperiments({ price: { enabled: true, variants: [{ id: "a", priceMinor: 100 }] } }).price.enabled).toBe(false);
    const c = normalizeExperiments({ price: { enabled: true, name: "t1", plan: "starter", currency: "inr", variants: [{ id: "a", priceMinor: 100 }, { id: "a", priceMinor: 200 }, { id: "b", priceMinor: 300 }, { id: "c", priceMinor: -1 }] } });
    expect(c.price).toMatchObject({ enabled: true, currency: "INR" });
    expect(c.price.variants.map((v) => v.id)).toEqual(["a", "b"]);
    expect(priceVariant(c, "starter", "u1", "INR")).toMatchObject({ experiment: "t1" });
    expect(priceVariant(c, "creator", "u1", "INR")).toBeNull();
    expect(priceVariant(c, "starter", "u1", "USD")).toBeNull();
    expect(priceVariant(normalizeExperiments({}), "starter", "u1", "INR")).toBeNull();
  });
  test("results: conversion, revenue per visitor and a z-test against the first variant", () => {
    const r = experimentResults([
      { variant: "a", exposures: 1000, checkouts: 60, paid: 20, revenueMinor: 20 * 29900 },
      { variant: "b", exposures: 1000, checkouts: 90, paid: 50, revenueMinor: 50 * 39900 },
      { variant: "c", exposures: 1000, checkouts: 60, paid: 22, revenueMinor: 22 * 34900 },
    ]);
    expect(r[0]).toMatchObject({ rate: 0.02, z: 0, significant: false });
    expect(r[1].z).toBeGreaterThan(3);
    expect(r[1].significant).toBe(true);
    expect(r[2].significant).toBe(false);
    expect(r[1].revenuePerVisitor).toBe(1995);
    expect(experimentResults([{ variant: "a", exposures: 0, checkouts: 0, paid: 0, revenueMinor: 0 }])[0].rate).toBe(0);
  });
  test("survey answers must climb; Van Westendorp finds the range", () => {
    expect(surveyProblem({ tooCheap: 100, cheap: 200, expensive: 300, tooExpensive: 400 })).toBeNull();
    expect(surveyProblem({ tooCheap: 100, cheap: 100, expensive: 300, tooExpensive: 400 })).toMatch(/higher/);
    expect(surveyProblem({ tooCheap: NaN, cheap: 100, expensive: 300, tooExpensive: 400 })).toMatch(/Enter a price/);
    expect(vanWestendorp([])).toEqual({ n: 0, opp: null, ipp: null, pmc: null, pme: null });
    const answers = Array.from({ length: 40 }, (_, i) => ({ tooCheap: 5000 + (i % 10) * 1000, cheap: 15000 + (i % 8) * 2000, expensive: 40000 + (i % 9) * 3000, tooExpensive: 70000 + (i % 7) * 5000 }));
    const v = vanWestendorp([...answers, { tooCheap: 9, cheap: 1, expensive: 2, tooExpensive: 3 }]);
    expect(v.n).toBe(40); // the nonsense answer is ignored
    for (const k of ["opp", "ipp", "pmc", "pme"] as const) expect(v[k]).not.toBeNull();
    expect(v.pmc!).toBeLessThan(v.pme!);
    expect(v.opp!).toBeGreaterThanOrEqual(v.pmc!);
    expect(v.opp!).toBeLessThanOrEqual(v.pme!);
  });
  test("the decision rule: free-to-paid >= 4% and churn <= 6%", () => {
    expect(keepStructure({ freeToPaid60: 0.04, churn: 0.06 })).toBe(true);
    expect(keepStructure({ freeToPaid60: 0.039, churn: 0.01 })).toBe(false);
    expect(keepStructure({ freeToPaid60: 0.08, churn: 0.061 })).toBe(false);
  });
});

describe("renewals", () => {
  const sub = (end: Date, o: Partial<{ autoRenew: boolean; remindedFor: string | null; status: string; cancelAtPeriodEnd: boolean }> = {}) => ({ status: "active", autoRenew: false, currentPeriodEnd: end, remindedFor: null, ...o });
  test("without auto-renew: 7 days, then 1 day, each once", () => {
    const end = at(5);
    expect(reminderDue(sub(end), now)).toBe("7d");
    expect(reminderDue(sub(end, { remindedFor: reminderKey(end, "7d") }), now)).toBeNull();
    const soon = new Date(now.getTime() + 12 * 3_600_000);
    expect(reminderDue(sub(soon, { remindedFor: reminderKey(soon, "7d") }), now)).toBe("1d");
    expect(reminderDue(sub(soon, { remindedFor: reminderKey(soon, "1d") }), now)).toBeNull();
    expect(reminderDue(sub(soon), now)).toBe("1d"); // first seen inside a day: the 1-day one only
    expect(reminderDue(sub(at(10)), now)).toBeNull();
    // a renewed period gets its own reminders
    expect(reminderDue(sub(at(5), { remindedFor: reminderKey(at(-25), "1d") }), now)).toBe("7d");
  });
  test("with auto-renew: one heads-up 3 days before the charge", () => {
    expect(reminderDue(sub(at(5), { autoRenew: true }), now)).toBeNull();
    expect(reminderDue(sub(at(2), { autoRenew: true }), now)).toBe("charge-3d");
    expect(reminderDue(sub(at(2), { autoRenew: true, remindedFor: reminderKey(at(2), "charge-3d") }), now)).toBeNull();
  });
  test("no reminder when cancelling, cancelled or already over", () => {
    expect(reminderDue(sub(at(2), { cancelAtPeriodEnd: true }), now)).toBeNull();
    expect(reminderDue(sub(at(2), { status: "canceled" }), now)).toBeNull();
    expect(reminderDue(sub(at(-1)), now)).toBeNull();
  });
  test("a late charge continues the old period; a long-lapsed one starts today", () => {
    const end = new Date("2026-11-20T00:00:00Z");
    expect(renewedEnd(end, "month", now).toISOString()).toBe("2026-12-20T00:00:00.000Z");
    expect(renewedEnd(end, "year", now).toISOString()).toBe("2027-11-20T00:00:00.000Z");
    const late = new Date("2026-10-30T10:00:00Z"); // 3 days ago, inside the 7-day grace
    expect(renewedEnd(late, "month", now).toISOString()).toBe("2026-11-30T10:00:00.000Z");
    const lapsed = new Date("2026-10-01T00:00:00Z");
    expect(renewedEnd(lapsed, "month", now).toISOString()).toBe("2026-12-02T10:00:00.000Z");
  });
});

describe("voice memory (pure)", () => {
  test("samples are cleaned, deduplicated and capped, newest first", () => {
    expect(cleanSample("Big news @brand.io   today https://x.co/abc ok")).toBe("Big news today ok");
    const a = "This is my first real caption, honestly.";
    const b = "Second caption here, with a little more to say.";
    expect(addSamples([], ["short", a])).toEqual([a]);
    expect(addSamples([a], [b, a.toUpperCase()])).toEqual([b, a.toUpperCase()]); // a repeat keeps its newest wording, once
    const many = Array.from({ length: 12 }, (_, i) => `Caption number ${i} that is long enough to keep`);
    expect(addSamples([], many)).toHaveLength(8);
    expect(addSamples([], many)[0]).toBe(many[0]);
  });
  test("one caption is not a voice; two make a style note", () => {
    expect(voicePrompt(["one caption that is long enough"])).toBe("");
    const p = voicePrompt(["first caption that is long enough", 'second """quoted""" caption long enough']);
    expect(p).toContain("own voice");
    expect(p).toContain("Never copy a line");
    expect(p).not.toContain('"""quoted"""');
    expect(parseVoice("{nope").samples).toEqual([]);
    expect(parseVoice(JSON.stringify({ on: false, samples: ["a", 3] }))).toEqual({ on: false, samples: ["a"], updatedAt: null });
  });
});

// ------------------------------------------------------------------ database

let db: typeof import("../lib/db").db;
let ent: typeof import("../lib/billing/entitlements");
let plans: typeof import("../lib/billing/plans");
let svc: typeof import("../lib/billing/service");
let topups: typeof import("../lib/billing/topups");
let renew: typeof import("../lib/billing/autorenew");
let preset: typeof import("../lib/billing/pricing-preset");
let lab: typeof import("../lib/billing/pricing-lab");
let voice: typeof import("../lib/ai/voice");
let settings: typeof import("../lib/settings");
const actor = { login: "admin@outlly.test", role: "finance" } as const;
let n = 0;
const tag = () => `${Date.now().toString(36)}${n++}`;
const mkUser = async (createdAt?: Date) => db.user.create({ data: { name: `P ${tag()}`, email: `p1096-${tag()}@test.dev`, passwordHash: "x", ...(createdAt ? { createdAt } : {}) } });
let xPlan: { id: string };
let openPlan: { id: string };
const onPlan = async (planId: string, o: Partial<{ provider: string; days: number; priceMinor: number; providerSubId: string; autoRenew: boolean }> = {}) => {
  const u = await mkUser();
  const s = await db.subscription.create({ data: { userId: u.id, planId, status: "active", priceMinor: o.priceMinor ?? 100, currency: "INR", interval: "month", provider: o.provider ?? "mock", currentPeriodEnd: new Date(Date.now() + (o.days ?? 20) * DAY), providerSubId: o.providerSubId, autoRenew: o.autoRenew ?? false } });
  return { u, s };
};
const status = async (p: Promise<unknown>) => p.then(() => 0, (e) => (e as { status?: number; extra?: { feature?: string } }));

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  ent = await import("../lib/billing/entitlements");
  plans = await import("../lib/billing/plans");
  svc = await import("../lib/billing/service");
  topups = await import("../lib/billing/topups");
  renew = await import("../lib/billing/autorenew");
  preset = await import("../lib/billing/pricing-preset");
  lab = await import("../lib/billing/pricing-lab");
  voice = await import("../lib/ai/voice");
  settings = await import("../lib/settings");
  await plans.ensurePlans();
  xPlan = await db.plan.create({ data: { slug: `t1096-x-${tag()}`, name: "Test X", priceMinor: 100, state: "hidden", xPostLimit: 2, brandLimit: 1, perks: '["weekly-digest"]' } });
  openPlan = await db.plan.create({ data: { slug: `t1096-open-${tag()}`, name: "Test Open", priceMinor: 100, state: "hidden" } });
});

afterAll(async () => {
  await settings.saveConfig("topups", { enabled: false });
});

describe("X posts and top-up credit", () => {
  test("monthly X allowance, retries are free, a pack pays past it and is given back on release", async () => {
    const { u } = await onPlan(xPlan.id);
    const ids = ["a", "b"].map((r) => `${u.id}-${r}`);
    expect((await ent.spendXPosts(u.id, ids)).fresh).toBe(true);
    expect((await ent.spendXPosts(u.id, [ids[0]])).fresh).toBe(false); // already counted this month
    const full = await status(ent.spendXPosts(u.id, [`${u.id}-c`]));
    expect(full).toMatchObject({ status: 402, extra: { feature: "x" } });
    expect((await ent.xPostUsage(u.id)).left).toBe(0);

    const pack = await db.topUp.create({ data: { userId: u.id, kind: "x", pack: "x-100", units: 1, remaining: 1, expiresAt: new Date(Date.now() + 10 * DAY) } });
    expect((await ent.xPostUsage(u.id)).left).toBe(1);
    // two destinations, one credit: the first goes through on the pack, the second fails, and both are undone
    expect(await status(ent.spendXPosts(u.id, [`${u.id}-c`, `${u.id}-d`]))).toMatchObject({ status: 402 });
    expect((await db.topUp.findUniqueOrThrow({ where: { id: pack.id } })).remaining).toBe(1);
    const held = await ent.spendXPosts(u.id, [`${u.id}-c`]);
    expect(held.fresh).toBe(true);
    expect((await db.topUp.findUniqueOrThrow({ where: { id: pack.id } })).remaining).toBe(0);
    expect((await db.featureUse.findFirstOrThrow({ where: { userId: u.id, ref: `${u.id}-c` } })).topUpId).toBe(pack.id);
    await held.release();
    expect((await db.topUp.findUniqueOrThrow({ where: { id: pack.id } })).remaining).toBe(1);
    expect(await db.featureUse.count({ where: { userId: u.id, ref: `${u.id}-c` } })).toBe(0);
  });
  test("a failed X launch gives its slot back, pack unit included; a new X target on a booked post is charged", async () => {
    const { u } = await onPlan(xPlan.id);
    expect((await ent.spendXPosts(u.id, [`${u.id}-t1`, `${u.id}-t2`])).fresh).toBe(true);
    const pack = await db.topUp.create({ data: { userId: u.id, kind: "x", pack: "x-100", units: 1, remaining: 1, expiresAt: new Date(Date.now() + 10 * DAY) } });
    // X added later to an already-booked post is its own ref, so it is charged (on the pack, the plan is full)
    expect((await ent.spendXPosts(u.id, [`${u.id}-t1`, `${u.id}-t3`])).fresh).toBe(true);
    expect((await db.topUp.findUniqueOrThrow({ where: { id: pack.id } })).remaining).toBe(0);
    await ent.releaseXPost(`${u.id}-t3`); // that target failed for good
    expect((await db.topUp.findUniqueOrThrow({ where: { id: pack.id } })).remaining).toBe(1);
    await ent.releaseXPost(`${u.id}-t3`); // a second failure report refunds nothing more
    expect((await db.topUp.findUniqueOrThrow({ where: { id: pack.id } })).remaining).toBe(1);
    await ent.releaseXPost(`${u.id}-t1`); // a plan slot comes back too
    expect((await ent.xPostUsage(u.id)).used).toBe(1);
    await ent.releaseXPost("no-such-target"); // never throws
  });
  test("plans without an X limit never count", async () => {
    const { u } = await onPlan(openPlan.id);
    expect((await ent.spendXPosts(u.id, ["p1", "p2", "p3"])).fresh).toBe(false);
    expect(await db.featureUse.count({ where: { userId: u.id } })).toBe(0);
  });
  test("racing for the last units: never more than the pack holds", async () => {
    const u = await mkUser();
    const t = await db.topUp.create({ data: { userId: u.id, kind: "ai", pack: "ai-20", units: 3, remaining: 3, expiresAt: new Date(Date.now() + DAY) } });
    const got = await Promise.all(Array.from({ length: 6 }, () => topups.consumeCredit(u.id, "ai")));
    expect(got.filter(Boolean)).toHaveLength(3);
    expect(await topups.creditsLeft(u.id, "ai")).toBe(0);
    for (let i = 0; i < 5; i++) await topups.refundCredit(t.id);
    expect((await db.topUp.findUniqueOrThrow({ where: { id: t.id } })).remaining).toBe(3);
    // an expired pack is never spent
    await db.topUp.create({ data: { userId: u.id, kind: "x", pack: "x-100", units: 5, remaining: 5, expiresAt: new Date(Date.now() - 1000) } });
    expect(await topups.consumeCredit(u.id, "x")).toBeNull();
  });
  test("brand and seat packs widen the plan while they last", async () => {
    const { u } = await onPlan(xPlan.id);
    const before = await ent.entitlements(u.id);
    expect(before).toMatchObject({ brandLimit: 1, extraBrands: 0, perks: ["weekly-digest"] });
    await db.topUp.create({ data: { userId: u.id, kind: "brand", pack: "brand-1", units: 1, remaining: 1, expiresAt: new Date(Date.now() + DAY) } });
    await db.topUp.create({ data: { userId: u.id, kind: "seat", pack: "seat-1", units: 2, remaining: 2, expiresAt: new Date(Date.now() + DAY) } });
    const after = await ent.entitlements(u.id);
    expect(after.extraBrands).toBe(1);
    expect(after.seats).toBe(before.seats + 2);
  });
  test("perks are checked against the plan", async () => {
    const { u } = await onPlan(xPlan.id);
    expect((await ent.assertPerk(u.id, "weekly-digest")).planName).toBe("Test X");
    expect(await status(ent.assertPerk(u.id, "approvals"))).toMatchObject({ status: 402, extra: { feature: "perk" } });
    const { u: open } = await onPlan(openPlan.id);
    expect((await ent.assertPerk(open.id, "approvals")).perks).toBeNull(); // a plan made before 1096 keeps everything
  });
});

describe("buying a pack", () => {
  test("off by default; paid plans only; one payment makes exactly one pack", async () => {
    const { u, s } = await onPlan(xPlan.id);
    expect(await status(svc.startTopUp(u.id, "x-100"))).toMatchObject({ status: 409 });
    await settings.saveConfig("topups", { enabled: true });
    const free = await mkUser();
    expect(await status(svc.startTopUp(free.id, "x-100"))).toMatchObject({ status: 409 });
    expect(await status(svc.startTopUp(u.id, "seat-1"))).toMatchObject({ status: 409 }); // Agency-only pack

    const start = await svc.startTopUp(u.id, "x-100");
    expect((await svc.startTopUp(u.id, "x-100")).paymentId).toBe(start.paymentId); // double click reuses it
    const pay = await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(pay).toMatchObject({ purpose: "topup", amountMinor: 19900, currency: "INR", subscriptionId: null });
    await svc.completePayment(start.paymentId, `mock_${start.paymentId}`);
    await svc.completePayment(start.paymentId, `mock_${start.paymentId}`);
    const packs = await db.topUp.findMany({ where: { userId: u.id } });
    expect(packs).toHaveLength(1);
    expect(packs[0]).toMatchObject({ kind: "x", units: 100, remaining: 100, paymentId: start.paymentId });
    expect((await ent.xPostUsage(u.id)).left).toBe(102);
    // the plan itself is untouched
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).currentPeriodEnd).toEqual(s.currentPeriodEnd);
    await topups.refundTopUp(start.paymentId);
    expect(await topups.creditsLeft(u.id, "x")).toBe(0);
  });
});

describe("auto-renew", () => {
  test("mock gateway turns on at once; cancelling turns it off", async () => {
    const { u, s } = await onPlan(xPlan.id);
    expect(await renew.setAutoRenew(u.id, true)).toEqual({ autoRenew: true });
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).providerSubId).toBe(`mock_sub_${s.id}`);
    await svc.cancelSubscription(u.id);
    expect(await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ autoRenew: false, providerSubId: null, cancelAtPeriodEnd: true });
  });
  test("pausing stops auto-renew too", async () => {
    const { u, s } = await onPlan(xPlan.id, { autoRenew: true, providerSubId: `mock_sub_p_${tag()}` });
    await svc.pauseSubscription(u.id, 1);
    expect(await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ autoRenew: false, providerSubId: null });
  });
  test("a gift plan can't auto-renew", async () => {
    const { u } = await onPlan(xPlan.id, { provider: "beta" });
    expect(await status(renew.setAutoRenew(u.id, true))).toMatchObject({ status: 404 });
  });
  test("one charge renews once, however often the webhook retries", async () => {
    const subId = `sub_t1096_${tag()}`;
    const { s } = await onPlan(xPlan.id, { provider: "razorpay", days: 2, providerSubId: subId, autoRenew: true });
    const charge = { id: `pay_t1096_${tag()}`, amount: 100, currency: "INR" };
    const first = await renew.renewFromCharge(subId, charge);
    expect(first).not.toBeNull();
    expect(first!.currentPeriodEnd).toEqual(renewedEnd(s.currentPeriodEnd, "month"));
    expect(await renew.renewFromCharge(subId, charge)).toBeNull();
    await renew.onRazorpaySubscription({ event: "subscription.charged", payload: { subscription: { entity: { id: subId } }, payment: { entity: { id: charge.id, amount: 100, currency: "INR" } } } });
    expect(await db.payment.count({ where: { providerRef: charge.id } })).toBe(1);
    expect((await db.payment.findFirstOrThrow({ where: { providerRef: charge.id } })).purpose).toBe("renewal");
    expect((await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).currentPeriodEnd).toEqual(first!.currentPeriodEnd);
    await renew.onRazorpaySubscription({ event: "subscription.cancelled", payload: { subscription: { entity: { id: subId } } } });
    expect(await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ autoRenew: false, providerSubId: null });
  });
  test("renewal reminders go once per step", async () => {
    const { s } = await onPlan(xPlan.id, { days: 5 });
    const { s: gift } = await onPlan(xPlan.id, { days: 5, provider: "referral" });
    const first = await renew.sendRenewalReminders();
    expect(first.sent).toBeGreaterThanOrEqual(1);
    const row = await db.subscription.findUniqueOrThrow({ where: { id: s.id } });
    expect(row.remindedFor).toBe(reminderKey(row.currentPeriodEnd, "7d"));
    expect((await db.subscription.findUniqueOrThrow({ where: { id: gift.id } })).remindedFor).toBeNull();
    expect((await renew.sendRenewalReminders()).sent).toBe(0);
  });
});

describe("voice memory", () => {
  const caps = ["Shipped the new studio tour today, come say hi.", "Three things I learned editing 40 reels this month."];
  test("recorded only on plans with the perk, and only while it's on", async () => {
    const { u: no } = await onPlan(xPlan.id);
    await voice.recordVoice(no.id, caps);
    expect((await voice.getVoice(no.id)).samples).toEqual([]);
    expect(await voice.voiceFor(no.id)).toBe("");

    const { u } = await onPlan(openPlan.id);
    await voice.recordVoice(u.id, [caps[0]]);
    expect(await voice.voiceFor(u.id)).toBe(""); // one sample isn't a voice yet
    await voice.recordVoice(u.id, [caps[1], null, ""]);
    expect((await voice.getVoice(u.id)).samples).toEqual([caps[1], caps[0]]);
    expect(await voice.voiceFor(u.id)).toContain(caps[0]);
    await voice.setVoiceOn(u.id, false);
    expect(await voice.voiceFor(u.id)).toBe("");
    await voice.recordVoice(u.id, ["A brand new caption that should not be kept."]);
    expect((await voice.getVoice(u.id)).samples).toEqual([]);
    expect((await voice.voiceStatus(u.id))).toMatchObject({ perk: true, on: false, samples: 0 });
  });
});

describe("pricing lab", () => {
  test("decision metrics count real conversions inside 60 days", async () => {
    const joined = new Date(Date.now() - 90 * DAY);
    const conv = await mkUser(joined);
    const late = await mkUser(joined);
    await mkUser(joined);
    await db.payment.create({ data: { userId: conv.id, amountMinor: 79900, currency: "INR", provider: "mock", status: "succeeded", createdAt: new Date(joined.getTime() + 10 * DAY) } });
    await db.payment.create({ data: { userId: late.id, amountMinor: 79900, currency: "INR", provider: "mock", status: "succeeded", createdAt: new Date(joined.getTime() + 70 * DAY) } });
    await db.payment.create({ data: { userId: late.id, amountMinor: 19900, currency: "INR", provider: "mock", status: "succeeded", purpose: "topup", createdAt: new Date(joined.getTime() + 5 * DAY) } });
    const m = await lab.decisionMetrics();
    expect(m.cohort).toBeGreaterThanOrEqual(3);
    expect(m.converted).toBeGreaterThanOrEqual(1);
    expect(m.converted).toBeLessThan(m.cohort);
    expect(m.freeToPaid60).toBeGreaterThan(0);
    expect(m.churn).toBeGreaterThanOrEqual(0);
    expect(typeof m.keep).toBe("boolean");
    expect(m.enoughData).toBe(false);
  });
  test("survey and cancel reports", async () => {
    const survey = `test-${tag()}`;
    for (let i = 0; i < 3; i++) {
      const u = await mkUser();
      await db.surveyResponse.create({ data: { userId: u.id, survey, planSlug: "creator", currency: "INR", answers: JSON.stringify({ tooCheap: 10000 + i * 1000, cheap: 30000 + i * 1000, expensive: 90000 + i * 1000, tooExpensive: 150000 + i * 1000 }) } });
    }
    const r = await lab.surveyReport(survey);
    expect(r.total).toBe(3);
    expect(r.groups).toHaveLength(1);
    expect(r.groups[0]).toMatchObject({ plan: "creator", currency: "INR", n: 3 });
    const u = await mkUser();
    await db.cancelFeedback.create({ data: { userId: u.id, planSlug: "creator", reason: "too-expensive", interview: true, contact: u.email } });
    const c = await lab.cancelReport();
    expect(c.counts.find((x) => x.reason === "too-expensive")!.count).toBeGreaterThanOrEqual(1);
    expect(c.recent.some((x) => x.email === u.email && x.interview)).toBe(true);
  });
});

describe("the November 2026 preset", () => {
  const FIELDS = ["name", "priceMinor", "yearlyMinor", "prices", "yearlyPrices", "state", "highlight", "sortOrder", "postLimit", "postPeriod", "xPostLimit", "captionVideos", "analyticsDays", "brandLimit", "platformLimit", "seats", "storageMb", "perks", "features"] as const;
  const snap = async () => Object.fromEntries((await db.plan.findMany({ orderBy: { slug: "asc" } })).map((p) => [p.slug, Object.fromEntries(FIELDS.map((f) => [f, p[f]]))]));
  test("nothing changes until an admin applies it; undo puts every plan back", async () => {
    const before = await snap();
    expect(before.starter).toBeUndefined();
    const beta = (await settings.getConfig("beta")).enabled;
    const studio = await db.plan.findUniqueOrThrow({ where: { slug: "studio" } });
    const { u, s } = await onPlan(studio.id, { priceMinor: studio.priceMinor });

    const r = await preset.applyPricingPreset(actor, { endBeta: true });
    expect(r.changed).toEqual(["free", "starter", "creator", "pro-manager"]);
    const p = Object.fromEntries((await db.plan.findMany()).map((x) => [x.slug, x]));
    expect(p.starter).toMatchObject({ priceMinor: 29900, brandLimit: 1, xPostLimit: 30, state: "available" });
    expect(p.free).toMatchObject({ platformLimit: 3, postLimit: 3, postPeriod: "week", analyticsDays: 30, perks: "[]" });
    expect(p.creator).toMatchObject({ priceMinor: 79900, fairUsePosts: 300, highlight: true });
    expect(p["pro-manager"]).toMatchObject({ name: "Agency", priceMinor: 249900, seats: 5 });
    expect(JSON.parse(p.starter.yearlyPrices)).toEqual({ USD: 7000, EUR: 7000, GBP: 6000 });
    expect(p.studio.state).toBe("hidden");
    expect(Object.values(p).filter((x) => x.highlight).map((x) => x.slug)).toEqual(["creator"]);
    expect((await settings.getConfig("beta")).enabled).toBe(false);
    // the person on Studio keeps it, at their price
    expect(await db.subscription.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ planId: studio.id, priceMinor: studio.priceMinor, status: "active" });
    expect((await ent.entitlements(u.id)).planSlug).toBe("studio");
    expect((await plans.listPlans()).map((x: { slug: string }) => x.slug)).not.toContain("studio");
    expect(await preset.presetBackup()).not.toBeNull();
    // a second Apply would overwrite the undo point with the preset itself, so it is refused
    expect(await status(preset.applyPricingPreset(actor, {}))).toMatchObject({ status: 409, code: "PRESET_APPLIED" });
    expect(await preset.presetBackup()).not.toBeNull();

    const undo = await preset.undoPricingPreset(actor);
    expect(undo.restored).toContain("starter");
    expect(await snap()).toEqual(before);
    expect((await settings.getConfig("beta")).enabled).toBe(beta);
    expect(await preset.presetBackup()).toBeNull();
    expect((await preset.undoPricingPreset(actor)).restored).toEqual([]);
  });
});

describe("connect errors name the cap that was hit", () => {
  test("platforms, brands, or the account total", async () => {
    const { connectReason } = await import("../lib/social/connect-reason");
    const { HttpError } = await import("../lib/http");
    expect(connectReason(new HttpError(402, "x", "PLAN_LIMIT", { feature: "platforms" }))).toBe("platform_limit");
    expect(connectReason(new HttpError(402, "x", "PLAN_LIMIT", { feature: "brands" }))).toBe("brand_limit");
    expect(connectReason(new HttpError(402, "x", "PLAN_LIMIT", { feature: "accounts" }))).toBe("account_limit");
    expect(connectReason(new HttpError(402, "x", "PLAN_LIMIT"))).toBe("account_limit");
  });
});
