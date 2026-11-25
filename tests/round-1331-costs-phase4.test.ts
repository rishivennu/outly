/**
 * 1331: Infrastructure & Costs, Phase 4 (third-party usage). Razorpay's fee on every captured payment lands in the
 * ledger once (provider-reported, attributed to the payer, idempotent across webhook retries) and X reads are
 * metered by the posts the API returned, never for practice accounts or other platforms.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { razorpayFeeInput } from "../lib/costs/fees-core";
import { FEATURE_LABEL, featureLabel } from "../lib/costs/core";

let db: typeof import("../lib/db").db;
let fees: typeof import("../lib/costs/fees");
let xreads: typeof import("../lib/costs/x-reads");
const read = (p: string) => readFileSync(join(import.meta.dir, "..", p), "utf8");
const U = "u-1331-payer";
const PAY = "pay_T1331aaaaaaaaaa";
const PAY2 = "pay_T1331bbbbbbbbbb";

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  fees = await import("../lib/costs/fees");
  xreads = await import("../lib/costs/x-reads");
  await db.costEvent.deleteMany({ where: { OR: [{ ref: { startsWith: "razorpay:fee:pay_T1331" } }, { userId: U }] } });
});
afterAll(async () => {
  await db.costEvent.deleteMany({ where: { OR: [{ ref: { startsWith: "razorpay:fee:pay_T1331" } }, { userId: U }] } });
  await db.$disconnect();
});

describe("1331 razorpay fee input (pure)", () => {
  const pay = { id: PAY, amount: 49900, currency: "INR", fee: 1178, tax: 180, method: "upi" };

  test("books the fee (already GST-inclusive) as a provider-reported payments cost, keyed on the payment id", () => {
    const o = razorpayFeeInput(pay, U, "checkout");
    expect(o).not.toBeNull();
    expect(o!.provider).toBe("razorpay");
    expect(o!.category).toBe("payments");
    expect(o!.feature).toBe("checkout");
    expect(o!.amountMinor).toBe(1178); // fee, not fee + tax: Razorpay's `fee` already includes the GST it lists as `tax`
    expect(o!.currency).toBe("INR");
    expect(o!.source).toBe("reported");
    expect(o!.ref).toBe(`razorpay:fee:${PAY}`);
    expect(o!.userId).toBe(U);
    expect(o!.units).toBe(1);
    expect(o!.unit).toBe("payment");
    expect(o!.meta).toEqual({ tax: 180, amount: 49900, method: "upi" });
  });

  test("renewals are their own feature; the payer may be unknown", () => {
    const o = razorpayFeeInput(pay, null, "renewal");
    expect(o!.feature).toBe("renewal");
    expect(o!.userId).toBeNull();
  });

  test("nothing without a payment id or before the fee is known", () => {
    expect(razorpayFeeInput(null, U, "checkout")).toBeNull();
    expect(razorpayFeeInput({}, U, "checkout")).toBeNull();
    expect(razorpayFeeInput({ id: PAY }, U, "checkout")).toBeNull(); // authorised, not yet captured: no fee yet
    expect(razorpayFeeInput({ id: PAY, fee: 0 }, U, "checkout")).toBeNull();
    expect(razorpayFeeInput({ id: PAY, fee: "abc" }, U, "checkout")).toBeNull();
    expect(razorpayFeeInput({ id: 42, fee: 100 }, U, "checkout")).toBeNull();
  });

  test("tolerates strings and missing optionals the way webhook JSON arrives", () => {
    const o = razorpayFeeInput({ id: PAY, fee: "236", currency: "" }, U, "checkout");
    expect(o!.amountMinor).toBe(236);
    expect(o!.currency).toBe("INR");
    expect(o!.meta).toEqual({ tax: 0, amount: 0, method: "" });
  });

  test("the dashboard has labels for both fee features", () => {
    expect(FEATURE_LABEL.checkout).toBe("Checkout payments");
    expect(FEATURE_LABEL.renewal).toBe("Auto-renew charges");
    expect(featureLabel("renewal")).toBe("Auto-renew charges");
  });
});

describe("1331 razorpay fee ledger", () => {
  test("a captured payment's fee is booked once; a webhook retry is a no-op", async () => {
    const pay = { id: PAY, amount: 49900, currency: "INR", fee: 1178, tax: 180, method: "card" };
    const ev = await fees.bookRazorpayFee(pay, U, "checkout");
    expect(ev).not.toBeNull();
    expect(ev!.amountMinor).toBe(1178);
    expect(ev!.inrMinor).toBe(1178); // INR at FX 1
    expect(ev!.fxToInr).toBe(1);
    expect(ev!.source).toBe("reported");
    expect(await fees.bookRazorpayFee(pay, U, "checkout")).toBeNull();
    expect(await db.costEvent.count({ where: { ref: `razorpay:fee:${PAY}` } })).toBe(1);
    const row = await db.costEvent.findUnique({ where: { ref: `razorpay:fee:${PAY}` } });
    expect(row!.provider).toBe("razorpay");
    expect(row!.category).toBe("payments");
    expect(row!.feature).toBe("checkout");
    expect(row!.userId).toBe(U);
    expect(JSON.parse(row!.meta)).toEqual({ tax: 180, amount: 49900, method: "card" });
  });

  test("an authorised-only payment books nothing", async () => {
    expect(await fees.bookRazorpayFee({ id: PAY2, amount: 100, currency: "INR" }, U, "renewal")).toBeNull();
    expect(await db.costEvent.count({ where: { ref: `razorpay:fee:${PAY2}` } })).toBe(0);
  });
});

describe("1331 x reads", () => {
  test("other platforms, practice accounts and empty answers are never metered", async () => {
    expect(await xreads.meterXReads(U, "instagram", 50)).toBeNull();
    expect(await xreads.meterXReads(U, "x", 50, true)).toBeNull();
    expect(await xreads.meterXReads(U, "x", 0)).toBeNull();
    expect(await xreads.meterXReads(U, "x", -3)).toBeNull();
  });

  test("posts an X read endpoint returned are booked at the x_read rate against the user", async () => {
    await xreads.meterXReads(U, "x", 7.9);
    const row = await db.costEvent.findFirst({ where: { userId: U, feature: "x-read" }, orderBy: { at: "desc" } });
    expect(row).not.toBeNull();
    expect(row!.provider).toBe("x");
    expect(row!.category).toBe("x");
    expect(row!.units).toBe(7); // whole posts
    expect(row!.unit).toBe("read");
    expect(row!.source).toBe("estimate");
    expect(row!.inrMinor).toBeGreaterThan(0);
  });
});

describe("1331 wiring (source)", () => {
  test("the Razorpay webhook books the fee after order.paid settles the payment, from the same payload", () => {
    const s = read("app/api/billing/webhooks/razorpay/route.ts");
    expect(s).toContain('import { bookRazorpayFee } from "@/lib/costs/fees";');
    expect(s).toContain('if (p && ev.event === "order.paid") await bookRazorpayFee(ev?.payload?.payment?.entity, p.userId, "checkout");');
    expect(s.indexOf("await completePayment(p.id, orderId)")).toBeLessThan(s.indexOf("await bookRazorpayFee("));
  });

  test("subscription.charged books the renewal fee against whoever the payment row names, stray or not", () => {
    const s = read("lib/billing/autorenew.ts");
    expect(s).toContain('import { bookRazorpayFee } from "../costs/fees";');
    expect(s).toContain('const payer = await db.payment.findFirst({ where: { provider: "razorpay", providerRef: pay.id }, select: { userId: true } });');
    expect(s).toContain('await bookRazorpayFee(pay, payer?.userId ?? null, "renewal");');
    expect(s.indexOf("await renewFromCharge(sub.id")).toBeLessThan(s.indexOf("await bookRazorpayFee("));
  });

  test("the inbox meters X comment reads only when the cache missed; the live dashboard meters the posts X returned", () => {
    const inbox = read("lib/inbox.ts");
    expect(inbox).toContain('import { meterXReads } from "./costs/x-reads";');
    expect(inbox).toContain("await meterXReads(userId, l.target.platform, c.length, l.target.practice);");
    expect(inbox.indexOf("cachedComments(l.target.id, () =>")).toBeLessThan(inbox.indexOf("await meterXReads("));
    const live = read("lib/live/index.ts");
    expect(live).toContain('import { meterXReads } from "../costs/x-reads";');
    expect(live).toContain('if (platform === "x") await meterXReads(userId, platform, base.posts.length);');
    expect(live.indexOf("await xDashboard(ctx, days);")).toBeLessThan(live.indexOf("await meterXReads("));
  });

  test("x_read is a metered 1147 category with a rate and a ledger mapping, but never a blocking one", () => {
    const econ = read("lib/subscriptions/economics.ts");
    expect(econ).toMatch(/x_read: 0\.\d+/);
    expect(read("lib/costs/ledger.ts")).toContain('x_read: { provider: "x", category: "x", feature: "x-read", unit: "read" }');
    expect(read("lib/subscriptions/costs.ts")).not.toMatch(/BLOCKING[^\n]*x_read/);
  });
});
