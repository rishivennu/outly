/**
 * 1098: Billing & Subscription redesign. The status word (no trial), the next charge, which subscription the
 * page manages, the usage tiles, billing history rows, the payment method (a Razorpay mandate, never a stored
 * card) and source checks on the owner guard, the replace-mandate flow and the new page layout.
 */
import { beforeAll, describe, expect, mock, test } from "bun:test";
import { readFileSync } from "node:fs";
import {
  HISTORY_LABEL,
  RENEWAL_GRACE_MS,
  accountMeter,
  billingStatus,
  cycleLabel,
  describeRazorpayMethod,
  historyRows,
  mandateLabel,
  mandateState,
  meterPct,
  meterText,
  meterTone,
  nextCharge,
  paymentFor,
  pickCurrent,
  showUninvoiced,
  type SubView,
} from "../lib/billing/overview-core";

const now = new Date("2026-11-03T10:00:00Z");
const later = (d: number) => new Date(now.getTime() + d * 86_400_000).toISOString();
const sub = (o: Partial<SubView> = {}): SubView => ({
  planSlug: "creator", planName: "Creator", priceMinor: 49900, currency: "INR", interval: "month", periodEnd: later(20),
  cancelAtPeriodEnd: false, pausedUntil: null, provider: "razorpay", autoRenew: false, gift: false, ...o,
});
const read = (p: string) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");

describe("billingStatus", () => {
  test("paid plan: Active, with Renews or Paid through", () => {
    expect(billingStatus({ current: sub() }, now)).toMatchObject({ key: "active", label: "Active", dateLabel: "Paid through" });
    expect(billingStatus({ current: sub({ autoRenew: true }) }, now).dateLabel).toBe("Renews");
  });
  test("cancelled and paused", () => {
    expect(billingStatus({ current: sub({ cancelAtPeriodEnd: true }) }, now)).toMatchObject({ key: "cancelled", dateLabel: "Ends" });
    expect(billingStatus({ current: sub({ pausedUntil: later(5) }) }, now)).toMatchObject({ key: "paused", date: later(5) });
    // a pause that already ran out is just Active again
    expect(billingStatus({ current: sub({ pausedUntil: later(-1) }) }, now).key).toBe("active");
  });
  test("no trial: a gift or admin grant is Free access", () => {
    expect(billingStatus({ current: sub({ gift: true, priceMinor: 0, provider: "beta" }) }, now)).toMatchObject({ key: "gift", label: "Free access" });
    expect(billingStatus({ current: null, grant: { planName: "Creator", endsAt: later(9) } }, now)).toMatchObject({ key: "gift", date: later(9) });
    for (const k of ["active", "cancelled", "paused", "expired", "renewing", "gift", "free"]) expect(k).not.toMatch(/trial/);
  });
  test("ended plan: Renewal processing within the grace, then Expired", () => {
    const ended = { planName: "Creator", endedAt: new Date(now.getTime() - 3600_000).toISOString(), autoRenew: true };
    expect(billingStatus({ current: null, ended }, now).key).toBe("renewing");
    expect(billingStatus({ current: null, ended: { ...ended, endedAt: new Date(now.getTime() - RENEWAL_GRACE_MS - 1).toISOString() } }, now).key).toBe("expired");
    expect(billingStatus({ current: null, ended: { ...ended, autoRenew: false } }, now)).toMatchObject({ key: "expired", tone: "bad", label: "Expired" });
  });
  test("nothing at all is Free", () => {
    expect(billingStatus({ current: null }, now)).toMatchObject({ key: "free", date: null });
  });
});

describe("nextCharge", () => {
  test("only when auto-renew will really charge", () => {
    expect(nextCharge(sub({ autoRenew: true }), now)).toBe(later(20));
    expect(nextCharge(sub(), now)).toBeNull();
    expect(nextCharge(sub({ autoRenew: true, cancelAtPeriodEnd: true }), now)).toBeNull();
    expect(nextCharge(sub({ autoRenew: true, pausedUntil: later(3) }), now)).toBeNull();
    expect(nextCharge(sub({ autoRenew: true, gift: true }), now)).toBeNull();
    expect(nextCharge(null, now)).toBeNull();
  });
});

describe("pickCurrent", () => {
  const S = (o: { priceMinor: number; provider: string; end: number; paused?: number }) => ({ priceMinor: o.priceMinor, provider: o.provider, currentPeriodEnd: new Date(later(o.end)), pausedUntil: o.paused != null ? new Date(later(o.paused)) : null });
  const paid = (s: { priceMinor: number; provider: string }) => s.priceMinor > 0 && s.provider !== "beta";
  test("a paid plan beats a gift running alongside", () => {
    const g = S({ priceMinor: 0, provider: "beta", end: 30 });
    const p = S({ priceMinor: 49900, provider: "razorpay", end: 10 });
    expect(pickCurrent([g, p], paid, now)).toBe(p);
  });
  test("a lapsed one is not current; a paused one is", () => {
    expect(pickCurrent([S({ priceMinor: 49900, provider: "razorpay", end: -2 })], paid, now)).toBeNull();
    const paused = S({ priceMinor: 49900, provider: "razorpay", end: -2, paused: 10 });
    expect(pickCurrent([paused], paid, now)).toBe(paused);
  });
});

describe("usage meters", () => {
  test("tone: lime, amber from 80%, red when used up (top-ups count)", () => {
    expect(meterTone(1, 10)).toBe("ok");
    expect(meterTone(8, 10)).toBe("warn");
    expect(meterTone(10, 10)).toBe("bad");
    expect(meterTone(10, 10, 5)).toBe("ok");
    expect(meterTone(5, 0)).toBe("none");
  });
  test("pct caps at 100 and is 0 for unlimited", () => {
    expect(meterPct(15, 10)).toBe(100);
    expect(meterPct(5, 10, 10)).toBe(25);
    expect(meterPct(5, 0)).toBe(0);
  });
  test("text", () => {
    expect(meterText({ key: "posts", label: "", used: 12, limit: 30, unit: "posts" })).toBe("12 of 30 posts");
    expect(meterText({ key: "x", label: "", used: 3, limit: 20, extra: 50, unit: "posts" })).toBe("3 of 20 + 50 posts");
    expect(meterText({ key: "posts", label: "", used: 12, limit: 0, unit: "posts" })).toBe("12 posts · unlimited");
    expect(meterText({ key: "scheduled", label: "", used: 4, limit: 0, unit: "in the queue" })).toBe("4 in the queue");
    expect(meterText({ key: "ai", label: "", used: 0, limit: 0, unit: "", locked: true })).toBe("Not included");
    expect(meterText({ key: "storage", label: "", used: 40, limit: 100, unit: "%", display: "2 GB of 5 GB" })).toBe("2 GB of 5 GB");
  });
  test("accounts: total cap, platforms x brands, one per platform", () => {
    const acc = [{ platform: "instagram" }, { platform: "instagram" }, { platform: "youtube" }];
    expect(accountMeter({ platformLimit: 3, brandLimit: 0, extraBrands: 0, accountLimit: 0 }, acc.slice(1)).limit).toBe(3);
    const b = accountMeter({ platformLimit: 4, brandLimit: 2, extraBrands: 1, accountLimit: 0 }, acc);
    expect(b).toMatchObject({ used: 3, limit: 12, perPlatform: 3 });
    expect(b.note).toContain("2 of 4 platforms");
  });
});

describe("billing history", () => {
  const plans = [{ id: "p1", name: "Creator" }];
  test("paymentFor names the plan and cycle", () => {
    expect(paymentFor({ planId: "p1", interval: "year", purpose: "plan" }, plans, "x")).toBe("Creator · Yearly");
    expect(paymentFor({ planId: "p1", interval: "month", purpose: "renewal" }, plans, "x")).toBe("Creator renewal");
    expect(paymentFor({ planId: null, interval: "month", purpose: "topup" }, plans, "x")).toBe("Top-up");
    expect(paymentFor({ planId: "gone", interval: "month", purpose: "plan" }, plans, "Old plan")).toBe("Old plan");
    expect(paymentFor(null, plans, "From invoice")).toBe("From invoice");
  });
  test("invoices plus failures worth knowing about, newest first; a closed checkout stays out", () => {
    const rows = historyRows(
      [
        { number: "OUT-1", description: "Creator", amountMinor: 49900, currency: "INR", issuedAt: new Date(later(-40)), creditNote: null, payment: { status: "succeeded", planId: "p1", interval: "month", purpose: "plan" } },
        { number: "OUT-2", description: "Creator", amountMinor: 49900, currency: "INR", issuedAt: new Date(later(-10)), creditNote: "CN-1", payment: { status: "refunded", planId: "p1", interval: "month", purpose: "renewal" } },
      ],
      [
        { id: "f1", status: "failed", provider: "razorpay", failureReason: "Card declined", createdAt: new Date(later(-2)), amountMinor: 49900, currency: "INR", planId: "p1", interval: "month", purpose: "plan" },
        { id: "f2", status: "failed", provider: "razorpay", failureReason: "Customer left checkout", createdAt: new Date(later(-1)), amountMinor: 49900, currency: "INR", planId: "p1", interval: "month", purpose: "plan" },
        { id: "u1", status: "pending", provider: "youpi", failureReason: null, createdAt: new Date(later(-0.5)), amountMinor: 49900, currency: "INR", planId: "p1", interval: "month", purpose: "plan" },
        { id: "u2", status: "pending", provider: "razorpay", failureReason: null, createdAt: new Date(later(-0.5)), amountMinor: 49900, currency: "INR", planId: "p1", interval: "month", purpose: "plan" },
      ],
      plans,
      now,
    );
    expect(rows.map((r) => r.id)).toEqual(["u1", "f1", "OUT-2", "OUT-1"]);
    expect(rows[1]).toMatchObject({ status: "failed", number: null, note: "Card declined. You weren't charged." });
    expect(rows[2]).toMatchObject({ status: "refunded", creditNote: "CN-1", plan: "Creator renewal" });
    expect(rows[3]).toMatchObject({ status: "paid", plan: "Creator · Monthly" });
    expect(HISTORY_LABEL[rows[0].status]).toBe("Pending");
  });
  test("old failures and stale UPI pendings drop off", () => {
    const base = { provider: "razorpay", failureReason: "x" };
    expect(showUninvoiced({ ...base, status: "failed", createdAt: new Date(later(-61)) }, now)).toBe(false);
    expect(showUninvoiced({ ...base, status: "pending", provider: "youpi", createdAt: new Date(later(-3)) }, now)).toBe(false);
    expect(showUninvoiced({ ...base, status: "succeeded", createdAt: now }, now)).toBe(false);
  });
  test("cycle label", () => {
    expect(cycleLabel("year", 100)).toBe("Yearly");
    expect(cycleLabel("month", 100)).toBe("Monthly");
    expect(cycleLabel("year", 0)).toBe("Free");
    expect(cycleLabel(undefined, 0)).toBe("Free");
  });
});

describe("payment method (gateway facts, never stored)", () => {
  test("describeRazorpayMethod", () => {
    expect(describeRazorpayMethod({ method: "card", card: { network: "Visa", last4: "4242", type: "debit" } })).toEqual({ kind: "card", label: "Visa debit •••• 4242" });
    expect(describeRazorpayMethod({ method: "upi", upi: { vpa: "a@okhdfc" } })?.label).toBe("UPI · a@okhdfc");
    expect(describeRazorpayMethod({ method: "netbanking", bank: "HDFC" })?.label).toBe("Netbanking · HDFC");
    expect(describeRazorpayMethod({ method: "wallet", wallet: "paytm" })?.label).toBe("Wallet · Paytm");
    expect(describeRazorpayMethod(null)).toBeNull();
  });
  test("mandateLabel", () => {
    expect(mandateLabel("upi")).toBe("UPI Autopay");
    expect(mandateLabel("card")).toBe("Card mandate");
    expect(mandateLabel("emandate")).toBe("Bank mandate");
    expect(mandateLabel(null)).toBe("Autopay mandate");
  });
});

describe("source checks", () => {
  test("only the owner changes billing; teammates can't read the method", () => {
    const ar = read("app/api/billing/autorenew/route.ts");
    expect(ar).toContain("if (user.actor) throw new HttpError(403");
    expect(ar).toContain('"OWNER_ONLY"');
    expect(ar).toMatch(/replace: z\.boolean\(\)\.optional\(\) \}\)\.strict\(\)/);
    expect(read("app/api/billing/payment-method/route.ts")).toContain("if (user.actor) throw new HttpError(404");
  });
  test("update method keeps the old mandate until the new one is approved, and can't double charge", () => {
    const a = read("lib/billing/autorenew.ts");
    expect(a).toContain("if (on && opts.replace && s.autoRenew) return replaceMandate(s, userId);");
    expect(a).toContain("replaces: s.providerSubId");
    expect(a).toContain("`${s.id}|${s.currentPeriodEnd.toISOString()}`");
    expect(a).toContain("s.currentPeriodEnd.getTime() !== new Date(at).getTime()");
    expect(a).toMatch(/subscription\.authenticated" \|\| kind === "subscription\.activated"\) && \(await adoptReplacement/);
    expect(a).toContain("deleteMany({ where: { key: replaceKey(sub.id) } })");
  });
  test("the page: header, status, sections in order, no stored cards", () => {
    const v = read("components/billing/BillingView.tsx");
    expect(v).toContain("Billing &amp; Subscription");
    const order = ['id="cur"', 'id="manage-h"', 'id="use-h"', 'id="plans"', "<PaymentMethodCard", "<BillingHistory"].map((k) => v.indexOf(k));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(v).not.toContain("function UsageMeter");
    expect(v).toContain('const CACHE = "outly-billing-history-v2"');
    expect(v).toContain("<UsageExtras onBuy={buyPack} busy={busy} packsOnly />");
    const parts = read("components/billing/BillingParts.tsx");
    expect(parts).toContain('role="progressbar"');
    expect(parts).toContain('aria-busy="true"');
    expect(parts).toContain('role="alert"');
    expect(parts).toMatch(/hidden w-full text-left text-sm sm:table/);
    expect(parts).toContain("h-11");
    expect(parts).not.toMatch(/cardNumber|card_number|cvv/i);
    expect(read("app/(studio)/billing/page.tsx")).not.toContain("invoices={invoices.map");
    expect(read("app/(studio)/billing/loading.tsx")).toContain('shape="billing"');
  });
});

describe("mandateState", () => {
  test("Razorpay's status decides; our flag only when it didn't answer", () => {
    expect(mandateState("created", false)).toBe("pending");
    expect(mandateState("authenticated", false)).toBe("active");
    expect(mandateState("active", true)).toBe("active");
    for (const st of ["pending", "halted", "paused", "cancelled", "completed", "expired"]) expect(mandateState(st, true)).toBe("attention");
    expect(mandateState(undefined, true)).toBe("active");
    expect(mandateState(null, false)).toBe("pending");
  });
});

// ------------------------------------------------------------------ database: mandates never charge twice or get lost

const gw = { cancelled: [] as string[], created: [] as string[] };
const realProviders = require("../lib/billing/providers");
mock.module("../lib/billing/providers", () => ({
  ...realProviders,
  razorpay: {
    ...realProviders.razorpay,
    cancelSubscription: async (_c: unknown, id: string) => void gw.cancelled.push(id),
    createPlan: async () => "plan_t1098",
    createSubscription: async () => {
      const id = `sub_t1098_new_${tag()}`;
      gw.created.push(id);
      return { id, shortUrl: `https://rzp.io/i/${id}` };
    },
  },
}));

let db: typeof import("../lib/db").db;
let svc: typeof import("../lib/billing/service");
let renew: typeof import("../lib/billing/autorenew");
let n = 0;
const tag = () => `${Date.now().toString(36)}${n++}`;
let planId = "";
const DAY = 86_400_000;
const onPlan = async (o: Partial<{ days: number; providerSubId: string; autoRenew: boolean; cancelAtPeriodEnd: boolean; provider: string }> = {}) => {
  const u = await db.user.create({ data: { name: `B ${tag()}`, email: `b1098-${tag()}@test.dev`, passwordHash: "x" } });
  const s = await db.subscription.create({ data: { userId: u.id, planId, status: "active", priceMinor: 100, currency: "INR", interval: "month", provider: o.provider ?? "razorpay", currentPeriodEnd: new Date(Date.now() + (o.days ?? 20) * DAY), providerSubId: o.providerSubId, autoRenew: o.autoRenew ?? false, cancelAtPeriodEnd: o.cancelAtPeriodEnd ?? false } });
  return { u, s };
};
const link = (newId: string, s: { id: string; currentPeriodEnd: Date }) =>
  db.setting.create({ data: { key: renew.replaceKey(newId), value: `${s.id}|${s.currentPeriodEnd.toISOString()}` } });
const approved = (id: string) => renew.onRazorpaySubscription({ event: "subscription.authenticated", payload: { subscription: { entity: { id } } } });
const charged = (id: string, pay: string, notes?: Record<string, string>) =>
  renew.onRazorpaySubscription({ event: "subscription.charged", payload: { subscription: { entity: { id, notes } }, payment: { entity: { id: pay, amount: 100, currency: "INR" } } } });
const row = (id: string) => db.subscription.findUniqueOrThrow({ where: { id } });

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  svc = await import("../lib/billing/service");
  renew = await import("../lib/billing/autorenew");
  planId = (await db.plan.create({ data: { slug: `t1098-${tag()}`, name: "Test 1098", priceMinor: 100, state: "hidden" } })).id;
});

describe("update payment method (replacement mandate)", () => {
  test("approved: the plan moves to the new mandate and the old one is stopped and remembered", async () => {
    const old = `sub_t1098_old_${tag()}`, neu = `sub_t1098_neu_${tag()}`;
    const { s } = await onPlan({ providerSubId: old, autoRenew: true });
    await link(neu, s);
    await approved(neu);
    expect(await row(s.id)).toMatchObject({ providerSubId: neu, autoRenew: true });
    expect(gw.cancelled).toContain(old);
    expect(gw.cancelled).not.toContain(neu);
    expect((await db.setting.findUnique({ where: { key: renew.retiredKey(old) } }))?.value).toBe(s.id);
    expect(await db.setting.findUnique({ where: { key: renew.replaceKey(neu) } })).toBeNull();
  });
  test("cancel after Update: the pending one is stopped, and a late approval can't bring auto-renew back", async () => {
    const old = `sub_t1098_old_${tag()}`, neu = `sub_t1098_neu_${tag()}`;
    const { u, s } = await onPlan({ providerSubId: old, autoRenew: true });
    await link(neu, s);
    await svc.cancelSubscription(u.id);
    expect(gw.cancelled).toEqual(expect.arrayContaining([old, neu]));
    expect(await db.setting.findUnique({ where: { key: renew.replaceKey(neu) } })).toBeNull();
    await approved(neu);
    expect(await row(s.id)).toMatchObject({ cancelAtPeriodEnd: true, autoRenew: false, providerSubId: null });
  });
  test("a link left behind still can't revive a cancelled plan", async () => {
    const neu = `sub_t1098_neu_${tag()}`;
    const { s } = await onPlan({ cancelAtPeriodEnd: true });
    await link(neu, s);
    await approved(neu);
    expect(await row(s.id)).toMatchObject({ cancelAtPeriodEnd: true, autoRenew: false, providerSubId: null });
    expect(gw.cancelled).toContain(neu);
  });
  test("the old mandate renewed first: the new one is dropped (no second charge for the period)", async () => {
    const old = `sub_t1098_old_${tag()}`, neu = `sub_t1098_neu_${tag()}`;
    const { s } = await onPlan({ providerSubId: old, autoRenew: true });
    await link(neu, s);
    await db.subscription.update({ where: { id: s.id }, data: { currentPeriodEnd: new Date(s.currentPeriodEnd.getTime() + 30 * DAY) } });
    await approved(neu);
    expect((await row(s.id)).providerSubId).toBe(old);
    expect(gw.cancelled).toContain(neu);
  });
  test("pressing Update twice leaves one pending replacement, not two", async () => {
    const { u, s } = await onPlan({ providerSubId: `sub_t1098_old_${tag()}`, autoRenew: true });
    const a = await renew.setAutoRenew(u.id, true, { replace: true });
    const b = await renew.setAutoRenew(u.id, true, { replace: true });
    expect(a).toMatchObject({ pending: true, autoRenew: true });
    const first = gw.created.at(-2)!, second = gw.created.at(-1)!;
    expect(b.url).toContain(second);
    expect(gw.cancelled).toContain(first);
    expect(await db.setting.count({ where: { key: { startsWith: "rzp-replace:" }, value: { startsWith: `${s.id}|` } } })).toBe(1);
  });
  test("a lapsed plan can't start a mandate", async () => {
    const { u } = await onPlan({ days: -2 });
    expect(await renew.setAutoRenew(u.id, true).then(() => 0, (e) => e.status)).toBe(404);
  });
});

describe("charges on a stopped mandate are recorded, never lost and never extend the plan", () => {
  test("retired mandate: payment + invoice row, plan and auto-renew untouched", async () => {
    const old = `sub_t1098_old_${tag()}`;
    const { u, s } = await onPlan({ providerSubId: old, autoRenew: true });
    await renew.setAutoRenew(u.id, false);
    const pay = `pay_t1098_${tag()}`;
    await charged(old, pay);
    const p = await db.payment.findFirstOrThrow({ where: { providerRef: pay } });
    expect(p).toMatchObject({ userId: u.id, subscriptionId: s.id, status: "succeeded", purpose: "renewal" });
    expect(await row(s.id)).toMatchObject({ autoRenew: false, currentPeriodEnd: s.currentPeriodEnd });
    await charged(old, pay); // retried webhook
    expect(await db.payment.count({ where: { providerRef: pay } })).toBe(1);
  });
  test("unknown mandate: matched through the notes we put on it", async () => {
    const { u, s } = await onPlan({ autoRenew: false });
    const pay = `pay_t1098_${tag()}`;
    await charged(`sub_t1098_ghost_${tag()}`, pay, { subscriptionId: s.id, userId: u.id });
    expect((await db.payment.findFirstOrThrow({ where: { providerRef: pay } })).subscriptionId).toBe(s.id);
    expect((await row(s.id)).currentPeriodEnd).toEqual(s.currentPeriodEnd);
  });
  test("the current mandate still renews normally", async () => {
    const cur = `sub_t1098_cur_${tag()}`;
    const { s } = await onPlan({ providerSubId: cur, autoRenew: true, days: 1 });
    const r = await renew.renewFromCharge(cur, { id: `pay_t1098_${tag()}`, amount: 100, currency: "INR" });
    expect(r?.stray).toBe(false);
    expect((await row(s.id)).currentPeriodEnd.getTime()).toBeGreaterThan(s.currentPeriodEnd.getTime());
  });
});
