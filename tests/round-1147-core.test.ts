/**
 * 1147 subs-core: the margin engine, first-time / returning / legacy pricing through real checkout, the offer
 * ledger (refund, chargeback, renewals, webhook retries), pause cap, and the monthly cost budget.
 * The policy ships off: the first block proves checkout behaves exactly as before with it off.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { DEFAULT_ECONOMICS as E, budgetMinor, costMinor, feeInrMinor, floorMinor, marginFor, netRevenueInrMinor, typicalCostInrMinor, yearlyFromMonthly } from "../lib/subscriptions/economics";

const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

let db: typeof import("../lib/db").db;
let svc: typeof import("../lib/billing/service");
let renew: typeof import("../lib/billing/autorenew");
let policy: typeof import("../lib/subscriptions/policy");
let elig: typeof import("../lib/subscriptions/eligibility");
let costs: typeof import("../lib/subscriptions/costs");
let keys: typeof import("../lib/subscriptions/keys");
let n = 0;
const DAY = 86_400_000;

beforeAll(async () => {
  ({ db } = await import("../lib/db"));
  svc = await import("../lib/billing/service");
  renew = await import("../lib/billing/autorenew");
  policy = await import("../lib/subscriptions/policy");
  elig = await import("../lib/subscriptions/eligibility");
  costs = await import("../lib/subscriptions/costs");
  keys = await import("../lib/subscriptions/keys");
  // Test files share one database: start from the shipped policy, whatever an earlier file saved.
  await db.setting.deleteMany({ where: { key: { in: [policy.POLICY_KEY, policy.POLICY_PREV_KEY, policy.ECONOMICS_KEY] } } });
  policy.clearPolicyCache();
  await (await import("../lib/billing/plans")).ensurePlans();
  // The returning (live) prices from the SPEC table; seeds differ, so set them here.
  await db.plan.update({ where: { slug: "creator" }, data: { priceMinor: 97900, currency: "INR", prices: "{}", yearlyPrices: "{}" } });
  await db.plan.update({ where: { slug: "pro-manager" }, data: { priceMinor: 347900, currency: "INR", prices: "{}", yearlyPrices: "{}" } });
}, 60_000);

async function user(email?: string) {
  n++;
  return db.user.create({ data: { name: `C ${n}`, email: email ?? `r1147c-${n}-${Date.now()}@test.dev`, passwordHash: "x" } });
}
async function setPolicy(patch: Record<string, unknown>) {
  const value = JSON.stringify({ ...(await policy.getPolicy()), ...patch });
  await db.setting.upsert({ where: { key: policy.POLICY_KEY }, create: { key: policy.POLICY_KEY, value }, update: { value } });
  policy.clearPolicyCache();
}
async function buy(userId: string, plan = "creator", opts: { deviceId?: string } = {}) {
  const s = await svc.startCheckout(userId, plan, "INR", "month", null, opts);
  await svc.completePayment(s.paymentId, `mock_${s.paymentId}`);
  return db.payment.findUniqueOrThrow({ where: { id: s.paymentId }, include: { subscription: true } });
}
const status = (p: Promise<unknown>) => p.then(() => ({ status: 0, code: "" }), (e) => ({ status: e.status, code: e.code }));

describe("economics (pure)", () => {
  test("60% floor: INR creator ~767.93, starter ~259.42; yearly is 12x; ceil to a whole unit", () => {
    expect(floorMinor({ plan: "creator", currency: "INR", interval: "month", econ: E })).toBe(76800);
    expect(floorMinor({ plan: "starter", currency: "INR", interval: "month", econ: E })).toBe(26000);
    expect(floorMinor({ plan: "creator", currency: "INR", interval: "year", econ: E })).toBeGreaterThanOrEqual(76793 * 12);
    expect(floorMinor({ plan: "creator", currency: "USD", interval: "month", econ: E }) % 100).toBe(0);
  });
  test("margins match the SPEC table", () => {
    const m = (plan: string, priceMinor: number, currency = "INR") => marginFor({ priceMinor, currency, interval: "month", costMinorInr: typicalCostInrMinor(plan, E), econ: E }).margin;
    expect(m("creator", 97900)).toBeCloseTo(0.68, 2);
    expect(m("creator", 79900)).toBeCloseTo(0.61, 2);
    expect(m("starter", 27900)).toBeCloseTo(0.624, 3); // the SPEC table rounds this up to 63%; still over 60%
    expect(m("pro-manager", 279900)).toBeCloseTo(0.61, 2);
    expect(m("creator", 1700, "USD")).toBeCloseTo(0.78, 2);
    expect(m("pro-manager", 2700, "USD")).toBeCloseTo(0.61, 2);
  });
  test("net revenue strips GST only for INR; fees 4.41% / 7.9%; budget ~289 INR for creator 979", () => {
    expect(netRevenueInrMinor({ priceMinor: 118000, currency: "INR", econ: E })).toBe(100000);
    expect(netRevenueInrMinor({ priceMinor: 1000, currency: "USD", econ: E })).toBe(94710);
    expect(feeInrMinor({ priceMinor: 100000, currency: "INR", econ: E })).toBe(4410);
    expect(feeInrMinor({ priceMinor: 1000, currency: "USD", econ: E })).toBe(Math.round(94710 * 0.079));
    expect(budgetMinor({ priceMinor: 97900, currency: "INR", econ: E }) / 100).toBeCloseTo(288.7, 0);
    expect(budgetMinor({ priceMinor: 0, currency: "INR", econ: E })).toBe(0);
  });
  test("yearly intro is max(10x monthly, its floor); unknown cost categories cost nothing", () => {
    expect(yearlyFromMonthly({ plan: "creator", currency: "INR", monthlyMinor: 79900, econ: E })).toBe(Math.max(799000, floorMinor({ plan: "creator", currency: "INR", interval: "year", econ: E })));
    expect(costMinor("ai", -5, E)).toBe(0);
  });
});

describe("policy off (default): identical to before", () => {
  test("ships disabled; quote is policy_off at the live price; checkout writes no tier", async () => {
    expect(policy.DEFAULT_POLICY.enabled).toBe(false);
    expect((await policy.getPolicy()).enabled).toBe(false);
    const u = await user();
    const q = await elig.quote({ userId: u.id, planSlug: "creator", currency: "INR" });
    expect(q).toMatchObject({ tier: "legacy", reason: "policy_off", priceMinor: 97900 });
    const p = await buy(u.id);
    expect(p).toMatchObject({ amountMinor: 97900, priceTier: null, meta: null, status: "succeeded" });
    expect(p.subscription).toMatchObject({ priceTier: "legacy", policyVersion: null, priceMinor: 97900 });
    expect(await costs.recordCost({ userId: u.id, category: "ai", units: 1000 })).toBeNull();
    expect(await costs.assertBudget(u.id, "ai")).toBeUndefined();
    expect((await costs.budgetState(u.id)).applies).toBe(false);
    // The ledger still learns, so this person is "returning" once the policy is switched on.
    const k = keys.hashKey("email", u.email);
    expect((await db.offerLedger.findUnique({ where: { kind_keyHash: { kind: "email", keyHash: k } } }))?.firstPaidAt).toBeTruthy();
  });
  test("pause keeps the 1-3 month range", async () => {
    const u = await user();
    await buy(u.id);
    expect(await status(svc.pauseSubscription(u.id, 3))).toMatchObject({ status: 0 });
  });
});

describe("policy on", () => {
  test("refuses an intro price under its 60% floor, accepts a valid one", async () => {
    const bad = await policy.savePolicy({ enabled: true, intro: { ...(await policy.getPolicy()).intro, creator: { INR: 50000, USD: 1000, EUR: 1000, GBP: 800 } } }, "admin-test");
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.errors.some((e) => e.field.includes("creator"))).toBe(true);
    const good = await policy.savePolicy({ enabled: true }, "admin-test");
    expect(good.ok).toBe(true);
    policy.clearPolicyCache();
    expect((await policy.getPolicy()).enabled).toBe(true);
  });

  test("first-time pays intro, the tier is snapshotted, an upgrade without a lapse keeps intro", async () => {
    await setPolicy({ enabled: true });
    const u = await user();
    const q = await elig.quote({ userId: u.id, planSlug: "creator", currency: "INR" });
    expect(q).toMatchObject({ tier: "intro", reason: "first_time", priceMinor: 79900, standardMinor: 97900, label: "First-time subscriber offer" });
    expect(q.marginTypical).toBeGreaterThanOrEqual(0.6);
    const p = await buy(u.id, "creator", { deviceId: "dev-intro-1" });
    expect(p).toMatchObject({ amountMinor: 79900, priceTier: "intro" });
    expect(JSON.parse(p.meta!)).toMatchObject({ subs: { tier: "intro" }, ledger: { device: keys.hashKey("device", "dev-intro-1") }, price: { listMinor: 97900 } });
    expect(p.subscription).toMatchObject({ priceTier: "intro", priceMinor: 79900 });
    expect(p.subscription!.policyVersion).toBeTruthy();
    const up = await elig.quote({ userId: u.id, planSlug: "pro-manager", currency: "INR" });
    expect(up).toMatchObject({ tier: "intro", priceMinor: 279900 });
    // Editing the policy later never re-prices the live subscription.
    await setPolicy({ intro: { ...(await policy.getPolicy()).intro, creator: { INR: 89900, USD: 1000, EUR: 1000, GBP: 800 } } });
    expect((await db.subscription.findUniqueOrThrow({ where: { id: p.subscriptionId! } })).priceMinor).toBe(79900);
    await setPolicy({ intro: policy.DEFAULT_POLICY.intro });
  });

  test("after a lapse longer than graceDays the price is standard; within grace it stays intro", async () => {
    const u = await user();
    const p = await buy(u.id);
    await db.subscription.update({ where: { id: p.subscriptionId! }, data: { status: "canceled", cancelAtPeriodEnd: true, currentPeriodEnd: new Date(Date.now() - 3 * DAY) } });
    expect(await elig.quote({ userId: u.id, planSlug: "creator", currency: "INR" })).toMatchObject({ tier: "intro" });
    await db.subscription.update({ where: { id: p.subscriptionId! }, data: { currentPeriodEnd: new Date(Date.now() - 10 * DAY) } });
    const q = await elig.quote({ userId: u.id, planSlug: "creator", currency: "INR" });
    expect(q).toMatchObject({ tier: "standard", reason: "returning", priceMinor: 97900 });
    const again = await buy(u.id);
    expect(again).toMatchObject({ amountMinor: 97900, priceTier: "standard" });
    expect(again.subscription?.priceTier).toBe("standard");
  });

  test("a new account with the same Gmail inbox, or the same device, is returning", async () => {
    const a = await user(`jo.ann+one${n}@gmail.com`);
    await buy(a.id, "creator", { deviceId: "dev-shared-9" });
    const b = await user(`joann+two${n - 1}@googlemail.com`);
    expect(await elig.quote({ userId: b.id, planSlug: "creator", currency: "INR" })).toMatchObject({ tier: "standard", reason: "returning" });
    const c = await user();
    expect(await elig.quote({ userId: c.id, planSlug: "creator", currency: "INR", deviceId: "dev-shared-9" })).toMatchObject({ tier: "standard" });
    expect(await elig.quote({ userId: c.id, planSlug: "creator", currency: "INR", deviceId: "dev-other" })).toMatchObject({ tier: "intro" });
  });

  test("risk flags: deny_offer -> standard, verify -> needs_verification; legacy subscribers keep their price", async () => {
    const d = await user();
    await db.riskFlag.create({ data: { userId: d.id, score: 80, level: "high", action: "deny_offer" } });
    expect(await elig.quote({ userId: d.id, planSlug: "creator", currency: "INR" })).toMatchObject({ tier: "standard", reason: "risk_denied", priceMinor: 97900 });
    const v = await user();
    await db.riskFlag.create({ data: { userId: v.id, score: 50, level: "medium", action: "verify" } });
    expect(await elig.quote({ userId: v.id, planSlug: "creator", currency: "INR" })).toMatchObject({ tier: "standard", reason: "needs_verification" });
    const l = await user();
    const sub = await db.subscription.create({ data: { userId: l.id, planId: (await db.plan.findUniqueOrThrow({ where: { slug: "creator" } })).id, status: "active", priceMinor: 49900, currency: "INR", interval: "month", provider: "mock", currentPeriodEnd: new Date(Date.now() + 20 * DAY) } });
    expect(sub.priceTier).toBe("legacy");
    expect(await elig.quote({ userId: l.id, planSlug: "pro-manager", currency: "INR" })).toMatchObject({ tier: "legacy", reason: "legacy" });
  });

  test("completePayment twice is one ledger write; refund keeps the offer used; chargeback flags once", async () => {
    const u = await user();
    const s = await svc.startCheckout(u.id, "creator", "INR", "month", null, { deviceId: "dev-refund" });
    await svc.completePayment(s.paymentId, `mock_${s.paymentId}`);
    await svc.completePayment(s.paymentId, `mock_${s.paymentId}`);
    const rows = await db.offerLedger.findMany({ where: { userId: u.id } });
    expect(rows.map((r) => r.kind).sort()).toEqual(["device", "email"]);
    await svc.refundPayment(s.paymentId, "admin-test", "test");
    const after = await db.offerLedger.findMany({ where: { userId: u.id } });
    expect(after.every((r) => r.firstPaidAt)).toBe(true);
    expect(await elig.quote({ userId: u.id, planSlug: "creator", currency: "INR" })).toMatchObject({ tier: "standard", reason: "returning" });
    const w = await user();
    const p = await buy(w.id);
    await svc.markExternalRefund(p.id, "chargeback", "fraud");
    await svc.markExternalRefund(p.id, "chargeback", "fraud");
    const flags = await db.riskFlag.findMany({ where: { userId: w.id } });
    expect(flags).toHaveLength(1);
    expect(flags[0]).toMatchObject({ level: "medium", action: "verify" });
  });

  test("a renewal keeps the tier and is idempotent on providerRef", async () => {
    const u = await user();
    const p = await buy(u.id);
    await db.subscription.update({ where: { id: p.subscriptionId! }, data: { providerSubId: `sub_t1147_${n}`, autoRenew: true } });
    const charge = { id: `pay_t1147_${n}`, amount: 79900, currency: "INR", paymentKey: `upi:renew${n}@okbank` };
    const r1 = await renew.renewFromCharge(`sub_t1147_${n}`, charge);
    const r2 = await renew.renewFromCharge(`sub_t1147_${n}`, charge);
    expect(r1?.paymentId).toBeTruthy();
    expect(r2).toBeNull();
    const pays = await db.payment.findMany({ where: { userId: u.id, purpose: "renewal" } });
    expect(pays).toHaveLength(1);
    expect(pays[0].priceTier).toBe("intro");
    expect(await db.offerLedger.findUnique({ where: { kind_keyHash: { kind: "payment", keyHash: keys.hashKey("payment", charge.paymentKey) } } })).toMatchObject({ userId: u.id });
  });

  test("pause is capped at maxPauseMonths", async () => {
    const u = await user();
    await buy(u.id);
    expect(await status(svc.pauseSubscription(u.id, 2))).toMatchObject({ status: 400, code: "PAUSE_TOO_LONG" });
    expect(await status(svc.pauseSubscription(u.id, 1))).toMatchObject({ status: 0 });
  });

  test("monthly cost budget: meter, warn, block costly features only, alert mode never blocks", async () => {
    const u = await user();
    await buy(u.id);
    const s0 = await costs.budgetState(u.id);
    expect(s0).toMatchObject({ applies: true, mode: "enforce", blocked: false });
    expect(s0.budgetMinor).toBe(budgetMinor({ priceMinor: 79900, currency: "INR", econ: await policy.getEconomics() }));
    expect(await status(costs.assertBudget(u.id, "ai"))).toMatchObject({ status: 0 });
    const perAi = costMinor("ai", 1, await policy.getEconomics());
    expect(perAi).toBeGreaterThan(0);
    await costs.recordCost({ userId: u.id, category: "ai", units: Math.ceil(s0.budgetMinor / perAi) + 1 });
    const s1 = await costs.budgetState(u.id);
    expect(s1.blocked).toBe(true);
    expect(s1.pct).toBeGreaterThanOrEqual(100);
    expect(await status(costs.assertBudget(u.id, "ai"))).toMatchObject({ status: 402, code: "BUDGET_REACHED" });
    expect(await status(costs.assertBudget(u.id, "transcription"))).toMatchObject({ status: 402 });
    expect(await status(costs.assertBudget(u.id, "storage"))).toMatchObject({ status: 0 });
    await setPolicy({ budget: { mode: "alert", warnPct: 80 } });
    expect(await status(costs.assertBudget(u.id, "ai"))).toMatchObject({ status: 0 });
    await setPolicy({ budget: { mode: "enforce", warnPct: 80 } });
    const free = await user();
    expect(await status(costs.assertBudget(free.id, "ai"))).toMatchObject({ status: 0 });
  });
});

describe("verifier 1147 guards", () => {
  test("risk weights: IP evidence alone, even with a burst, can never reach verify; defaults are accepted", async () => {
    const before = await policy.getPolicy();
    for (const ipCap of [45, 30]) {
      const r = await policy.savePolicy({ risk: { ...before.risk, ipCap } }, "admin-test");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.field === "risk.ipCap" && e.code === "risk")).toBe(true);
    }
    const flip = await policy.savePolicy({ risk: { ...before.risk, high: 30, medium: 40 } }, "admin-test");
    expect(flip.ok).toBe(false);
    expect((await policy.savePolicy({ risk: policy.DEFAULT_POLICY.risk }, "admin-test")).ok).toBe(true);
    policy.clearPolicyCache();
  });

  test("rates that push a price under its floor are refused in the library and nothing is saved", async () => {
    const before = JSON.stringify(await policy.getEconomics());
    const r = await policy.saveEconomics({ typicalCost: { creator: 5000 } } as never, "admin-test");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.length > 0 && r.errors.every((e) => e.code === "below_floor")).toBe(true);
    policy.clearPolicyCache();
    expect(JSON.stringify(await policy.getEconomics())).toBe(before);
  });

  test("with the policy on, a returning price under its floor is refused", async () => {
    await db.plan.update({ where: { slug: "creator" }, data: { priceMinor: 50000 } });
    try {
      const r = await policy.savePolicy({ enabled: true }, "admin-test");
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.some((e) => e.field === "standard.creator.INR" && e.code === "below_floor")).toBe(true);
    } finally {
      await db.plan.update({ where: { slug: "creator" }, data: { priceMinor: 97900 } });
      policy.clearPolicyCache();
    }
  });
});
