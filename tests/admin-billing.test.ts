/**
 * Admin console + billing + support: money formatting, roles, encrypted gateway settings,
 * the whole mock payment lifecycle (checkout -> invoice -> email -> cancel -> refund),
 * the bot's escalation signals and ticket prioritisation.
 */
import { beforeAll, describe, expect, test } from "bun:test";
import { formatMoney, priceLabel } from "../lib/billing/money";
import { can } from "../lib/admin/perms";

let db: typeof import("../lib/db").db;
let svc: typeof import("../lib/billing/service");
let plans: typeof import("../lib/billing/plans");
let settings: typeof import("../lib/settings");
let bot: typeof import("../lib/support/bot");
let tickets: typeof import("../lib/support/tickets");
let auth: typeof import("../lib/admin/auth");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  svc = await import("../lib/billing/service");
  plans = await import("../lib/billing/plans");
  settings = await import("../lib/settings");
  bot = await import("../lib/support/bot");
  tickets = await import("../lib/support/tickets");
  auth = await import("../lib/admin/auth");
  await plans.ensurePlans();
});

const mkUser = async (tag: string) => db.user.create({ data: { name: `Bill ${tag}`, email: `bill-${tag}-${Date.now()}@test.dev`, passwordHash: "x" } });

describe("money + roles", () => {
  test("formats minor units per currency", () => {
    expect(formatMoney(49900, "INR")).toBe("₹499");
    expect(formatMoney(1999, "USD")).toBe("$19.99");
    expect(priceLabel({ priceMinor: 0, currency: "INR", interval: "month", state: "available" })).toBe("Free");
    expect(priceLabel({ priceMinor: 49900, currency: "INR", interval: "year", state: "available" })).toBe("₹499/yr");
    expect(priceLabel({ priceMinor: 49900, currency: "INR", interval: "month", state: "soon" })).toBe("Coming soon");
  });
  test("role matrix", () => {
    expect(can("super", "integrations")).toBe(true);
    expect(can("finance", "pricing")).toBe(true);
    expect(can("finance", "tickets")).toBe(false);
    expect(can("support", "payments")).toBe(false);
    expect(can("support", "faq")).toBe(true);
    expect(can(null, "overview")).toBe(false);
  });
});

describe("admin login", () => {
  test("default super admin is admin / 1214, wrong PIN rejected", async () => {
    expect(await auth.verifyAdminLogin("admin", "1214")).toMatchObject({ role: "super" });
    expect(await auth.verifyAdminLogin("admin", "1215")).toBeNull();
    expect(await auth.verifyAdminLogin("nobody", "1214")).toBeNull();
  });
});

describe("gateway settings", () => {
  test("secrets are encrypted at rest and blank keeps the saved value", async () => {
    await settings.saveConfig("payments", { provider: "stripe", stripe: { secretKey: "sk_test_SECRET123" } });
    const raw = await db.setting.findMany();
    expect(JSON.stringify(raw)).not.toContain("sk_test_SECRET123");
    await settings.saveConfig("payments", { stripe: { secretKey: "" } });
    expect((await settings.getConfig("payments")).stripe.secretKey).toBe("sk_test_SECRET123");
    // back to mock so checkout tests never call Stripe
    await settings.saveConfig("payments", { provider: "mock", stripe: { secretKey: null } });
    expect((await svc.activeGateway()).provider).toBe("mock");
  });
});

describe("mock payment lifecycle", () => {
  test("checkout -> success -> invoice + email, idempotent, cancel/resume, refund", async () => {
    const u = await mkUser("life");
    const start = await svc.startCheckout(u.id, "creator");
    expect(start.kind).toBe("redirect");
    if (start.kind === "redirect") expect(start.url).toContain("/billing/checkout?p=");
    // a double click reuses the pending payment
    const again = await svc.startCheckout(u.id, "creator");
    expect(again.paymentId).toBe(start.paymentId);

    const { invoice } = await svc.completePayment(start.paymentId, "mock_ref_1");
    expect(invoice?.number).toMatch(/^OUT-\d{4}-\d+/);
    const second = await svc.completePayment(start.paymentId, "mock_ref_1");
    expect(second.invoice?.number).toBe(invoice!.number);
    expect(await db.invoice.count({ where: { userId: u.id } })).toBe(1);
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(1);
    expect(await db.emailLog.count({ where: { to: u.email, kind: "invoice" } })).toBe(1);

    await expect(svc.startCheckout(u.id, "creator")).rejects.toThrow(/already on/i);

    await svc.cancelSubscription(u.id);
    expect((await db.subscription.findFirst({ where: { userId: u.id, status: "active" } }))?.cancelAtPeriodEnd).toBe(true);
    await svc.resumeSubscription(u.id);
    expect((await db.subscription.findFirst({ where: { userId: u.id, status: "active" } }))?.cancelAtPeriodEnd).toBe(false);

    await svc.refundPayment(start.paymentId, "Tester", "duplicate");
    expect((await db.payment.findUnique({ where: { id: start.paymentId } }))?.status).toBe("refunded");
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(0);
    expect(await db.emailLog.count({ where: { to: u.email, subject: { startsWith: "Refund" } } })).toBe(1);
    await expect(svc.refundPayment(start.paymentId, "Tester", "")).rejects.toThrow(/only a paid/i);
  });

  test("failed payment is recorded and raises an admin alert; free plan can't be bought", async () => {
    const u = await mkUser("fail");
    const s = await svc.startCheckout(u.id, "studio");
    await svc.failPayment(s.paymentId, "Your card was declined.");
    expect((await db.payment.findUnique({ where: { id: s.paymentId } }))?.status).toBe("failed");
    expect(await db.adminEvent.count({ where: { kind: "payment_failed", title: { contains: u.name } } })).toBe(1);
    await expect(svc.startCheckout(u.id, "free")).rejects.toThrow(/free/i);
  });

  test("cancel-at-period-end expires lazily", async () => {
    const u = await mkUser("exp");
    const s = await svc.startCheckout(u.id, "creator");
    await svc.completePayment(s.paymentId);
    await svc.cancelSubscription(u.id);
    await db.subscription.updateMany({ where: { userId: u.id }, data: { currentPeriodEnd: new Date(Date.now() - 1000) } });
    await svc.expireSubscriptions(u.id);
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(0);
  });

  test("a price edit only affects new checkouts", async () => {
    const plan = await db.plan.update({ where: { slug: "studio" }, data: { priceMinor: 199900 } });
    const u = await mkUser("price");
    const s = await svc.startCheckout(u.id, "studio");
    expect((await db.payment.findUnique({ where: { id: s.paymentId } }))?.amountMinor).toBe(199900);
    expect((await plans.listPlans()).find((p) => p.slug === "studio")?.priceMinor).toBe(plan.priceMinor);
  });
});

describe("support bot + tickets", () => {
  test("answers known questions, admits unknown ones, hands off on request", async () => {
    const good = await bot.answer("how do I cancel my subscription");
    expect(good.confident).toBe(true);
    expect(good.answer.toLowerCase()).toContain("cancel");
    const bad = await bot.answer("zxqv blorp wibble");
    expect(bad.confident).toBe(false);
    expect((await bot.answer("can I talk to a human please")).wantsHuman).toBe(true);
    const hi = await bot.answer("किसी इंसान से बात करनी है", [], "hi");
    expect(hi.wantsHuman).toBe(true);
    expect(hi.answer).toMatch(/[\u0900-\u097F]/);
  });

  test("bot failure raises an urgent ticket for money issues, emails the customer, dedupes", async () => {
    const email = `tix-${Date.now()}@test.dev`;
    const transcript = [{ role: "user" as const, text: "I was charged twice for creator" }, { role: "bot" as const, text: "not sure" }];
    const r = await tickets.raiseTicket({ email, transcript, reason: "bot_failed" });
    expect(r.ticket.priority).toBe("urgent");
    expect(r.ticket.ref).toMatch(/^T-/);
    expect(await db.emailLog.count({ where: { to: email, kind: "ticket_opened" } })).toBe(1);
    const dup = await tickets.raiseTicket({ email, transcript, reason: "bot_failed" });
    expect(dup.duplicate).toBe(true);
    expect(dup.ticket.ref).toBe(r.ticket.ref);
  });
});
