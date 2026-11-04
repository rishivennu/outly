/**
 * Pre-launch audit: billing, subscriptions and payments.
 *
 * The rules under test, end to end against the test database with Razorpay faked at the fetch level:
 * - a plan is only ever granted from gateway-verified data (a signed checkout callback or a signed webhook);
 * - every one of those paths is idempotent and order-independent (retries, duplicates, failed-then-paid);
 * - the simulated gateway never sells a plan on a production deploy;
 * - plan limits are enforced on the server, not only hidden in the UI;
 * - offers apply once per person, never past their end, and never stack with the founding discount;
 * - invoice numbers are unique and sequential, and money stays in integer minor units.
 */
import { afterAll, beforeAll, describe, expect, mock, test } from "bun:test";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import * as realAuth from "../lib/auth";
import { INVOICE_NUMBER_RE, totalsFor, linesFor } from "../lib/billing/invoice-core";
import { offerPrice, bestOffer } from "../lib/campaign-core";
import { foundingPrice, MIN_CHARGE_MINOR } from "../lib/founding-config";

// revalidatePath needs a Next request; outside one it throws. Everything else in next/cache stays real.
const realCache = require("next/cache");
mock.module("next/cache", () => ({ ...realCache, revalidatePath: () => {}, revalidateTag: () => {} }));

const g = globalThis as unknown as { __billUser?: unknown };
const realGetCurrentUser = realAuth.getCurrentUser;
mock.module("../lib/auth", () => ({ ...realAuth, getCurrentUser: async () => (g.__billUser !== undefined ? g.__billUser : realGetCurrentUser()) }));

const KEY_SECRET = "rzp-key-secret-audit-0123456789";
const WEBHOOK_SECRET = "rzp-webhook-secret-audit-0123456789";
const realFetch = globalThis.fetch;
/** Orders the fake Razorpay has created, so a webhook can quote a real one. */
const orders = new Map<string, { amount: number; currency: string; notes: Record<string, string> }>();
let orderN = 0;

let db: typeof import("../lib/db").db;
let svc: typeof import("../lib/billing/service");
let settings: typeof import("../lib/settings");
let providers: typeof import("../lib/billing/providers");
let ent: typeof import("../lib/billing/entitlements");
let hook: typeof import("../app/api/billing/webhooks/razorpay/route");
let verifyRoute: typeof import("../app/api/billing/razorpay/verify/route");
let cancelRoute: typeof import("../app/api/billing/cancel/route");

beforeAll(async () => {
  db = (await import("../lib/db")).db;
  svc = await import("../lib/billing/service");
  settings = await import("../lib/settings");
  providers = await import("../lib/billing/providers");
  ent = await import("../lib/billing/entitlements");
  hook = await import("../app/api/billing/webhooks/razorpay/route");
  verifyRoute = await import("../app/api/billing/razorpay/verify/route");
  cancelRoute = await import("../app/api/billing/cancel/route");
  await (await import("../lib/billing/plans")).ensurePlans();
  await settings.saveConfig("payments", { provider: "razorpay", mode: "test", razorpay: { keyId: "rzp_test_audit", keySecret: KEY_SECRET, webhookSecret: WEBHOOK_SECRET } });
  installRzpFake();
}, 60_000);

/** The fake Razorpay, reinstalled by any test that replaced globalThis.fetch with its own. */
function installRzpFake(extra?: (url: string, init: any) => Promise<Response | null>) {
  globalThis.fetch = (async (input: any, init: any = {}) => {
    const url = String(input);
    const own = extra ? await extra(url, init) : null;
    if (own) return own;
    if (!url.startsWith("https://api.razorpay.com/")) return realFetch(input, init);
    const body = init?.body ? JSON.parse(init.body) : {};
    if (url.endsWith("/v1/orders") && init?.method === "POST") {
      const id = `order_audit${++orderN}`;
      orders.set(id, { amount: body.amount, currency: body.currency, notes: body.notes ?? {} });
      return Response.json({ id, amount: body.amount, currency: body.currency, status: "created" }, { status: 200 });
    }
    if (url.endsWith("/v1/customers") && init?.method === "POST") return Response.json({ id: "cust_audit1" }, { status: 200 });
    if (/\/v1\/customers\/[^/]+\/tokens$/.test(url)) return Response.json({ items: [] }, { status: 200 });
    if (/\/v1\/payments\//.test(url)) return Response.json({ id: "pay_audit", method: "card" }, { status: 200 });
    return Response.json({ error: { description: `unexpected ${url}` } }, { status: 404 });
  }) as typeof fetch;
}

afterAll(async () => {
  globalThis.fetch = realFetch;
  delete g.__billUser;
  await settings.saveConfig("payments", { provider: "mock", mode: "test" });
});

let n = 0;
const mkUser = async (tag: string) => db.user.create({ data: { name: `Pay ${tag}`, email: `pay-${tag}-${++n}-${Date.now()}@test.dev`, passwordHash: "x" } });
const asOwner = (u: { id: string }) => { g.__billUser = { ...u, actor: null, role: "owner", joinedAt: new Date(), scope: null }; };

const sign = (raw: string) => createHmac("sha256", WEBHOOK_SECRET).update(raw).digest("hex");
const hookReq = (raw: string, sig: string | null) =>
  new NextRequest("http://localhost/api/billing/webhooks/razorpay", { method: "POST", body: raw, headers: { "content-type": "application/json", ...(sig ? { "x-razorpay-signature": sig } : {}) } });
const send = (ev: unknown, opts: { sig?: string | null } = {}) => {
  const raw = JSON.stringify(ev);
  return hook.POST(hookReq(raw, opts.sig === undefined ? sign(raw) : opts.sig));
};
/** The order.paid event Razorpay really sends: the order entity, and the payment entity that paid it. */
const orderPaid = (orderId: string, payId = `pay_${orderId}`) => {
  const o = orders.get(orderId);
  return { event: "order.paid", payload: { order: { entity: { id: orderId, amount: o?.amount, currency: o?.currency, notes: o?.notes ?? {} } }, payment: { entity: { id: payId, order_id: orderId, amount: o?.amount, currency: o?.currency, notes: o?.notes ?? {} } } } };
};

const counts = async (userId: string) => ({
  active: await db.subscription.count({ where: { userId, status: "active" } }),
  invoices: await db.invoice.count({ where: { userId } }),
});

/** A razorpay checkout ready to be paid, with its order id. */
async function started(tag: string, plan = "creator") {
  const u = await mkUser(tag);
  const start = await svc.startCheckout(u.id, plan);
  if (start.kind !== "razorpay") throw new Error(`expected a razorpay checkout, got ${start.kind}`);
  return { u, paymentId: start.paymentId, orderId: start.orderId };
}

// ------------------------------------------------------------------ the simulated gateway in production

describe("mock gateway on a production deploy", () => {
  test("NODE_ENV=production refuses to sell a plan through the simulated gateway, unless ALLOW_MOCK_PAYMENTS=true", async () => {
    await settings.saveConfig("payments", { provider: "mock" });
    const u = await mkUser("prod");
    const probe = join(import.meta.dir, "helpers", "prod-mock-probe.ts");
    const run = (extra: Record<string, string>) => {
      const r = Bun.spawnSync([process.execPath, probe, u.id], {
        cwd: join(import.meta.dir, ".."),
        env: { ...process.env, NODE_ENV: "production", ALLOW_MOCK_PAYMENTS: "", ...extra },
        stdout: "pipe",
        stderr: "pipe",
      });
      const line = r.stdout.toString().split("\n").find((l) => l.startsWith("PROBE "));
      if (!line) throw new Error(`probe failed: ${r.stdout.toString()}\n${r.stderr.toString()}`);
      return JSON.parse(line.slice(6)) as { mockAllowed: boolean; code: string };
    };
    expect(run({})).toEqual({ mockAllowed: false, code: "GATEWAY" });
    expect(run({ ALLOW_MOCK_PAYMENTS: "true" })).toEqual({ mockAllowed: true, code: "started" });
    expect(await db.subscription.count({ where: { userId: u.id, status: "active" } })).toBe(0); // starting is not paying
    await settings.saveConfig("payments", { provider: "razorpay" });
  }, 60_000);
});

// ------------------------------------------------------------------ the checkout callback (Checkout.js)

describe("razorpay checkout callback", () => {
  const call = (body: unknown) =>
    verifyRoute.POST(
      new NextRequest("http://localhost/api/billing/razorpay/verify", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" } }),
      {} as never,
    );
  const signature = (orderId: string, payId: string, secret = KEY_SECRET) => createHmac("sha256", secret).update(`${orderId}|${payId}`).digest("hex");

  test("a forged or missing signature grants nothing", async () => {
    const { u, paymentId, orderId } = await started("forge");
    asOwner(u);
    for (const body of [
      { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_x", razorpay_signature: "0".repeat(64) },
      { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_x", razorpay_signature: signature(orderId, "pay_other") },
      { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_x", razorpay_signature: signature(orderId, "pay_x", "guessed-secret") },
      { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_x" },
      { paymentId, razorpay_order_id: orderId },
    ]) {
      const res = await call(body);
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe("BAD_SIGNATURE");
    }
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("pending");
    expect(await counts(u.id)).toEqual({ active: 0, invoices: 0 });
  });

  test("someone else's payment, and an order that isn't this payment's, are both 404", async () => {
    const mine = await started("mine");
    const theirs = await started("theirs");
    asOwner(theirs.u);
    const a = await call({ paymentId: mine.paymentId, razorpay_order_id: mine.orderId, razorpay_payment_id: "p", razorpay_signature: signature(mine.orderId, "p") });
    expect(a.status).toBe(404);
    asOwner(mine.u);
    const b = await call({ paymentId: mine.paymentId, razorpay_order_id: theirs.orderId, razorpay_payment_id: "p", razorpay_signature: signature(theirs.orderId, "p") });
    expect(b.status).toBe(404);
    expect(await counts(mine.u.id)).toEqual({ active: 0, invoices: 0 });
  });

  test("a correctly signed callback grants the plan exactly once, however many times it is replayed", async () => {
    const { u, paymentId, orderId } = await started("ok");
    asOwner(u);
    const body = { paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_ok1", razorpay_signature: signature(orderId, "pay_ok1") };
    const first = await call(body);
    expect(first.status).toBe(200);
    expect((await first.json()).invoice).toMatch(INVOICE_NUMBER_RE);
    expect((await call(body)).status).toBe(200);
    expect((await call(body)).status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("succeeded");
    expect(await counts(u.id)).toEqual({ active: 1, invoices: 1 });
  });

  test("the browser reporting a failure never flips a paid payment back", async () => {
    const { u, paymentId, orderId } = await started("flip");
    asOwner(u);
    await call({ paymentId, razorpay_order_id: orderId, razorpay_payment_id: "pay_flip", razorpay_signature: signature(orderId, "pay_flip") });
    const res = await call({ paymentId, razorpay_order_id: orderId, failed: "Your card was declined." });
    expect(res.status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("succeeded");
    expect(await counts(u.id)).toEqual({ active: 1, invoices: 1 });
  });
});

// ------------------------------------------------------------------ the webhook

describe("razorpay webhook signature", () => {
  test("no signature, a wrong one, or one made with another secret is a 400 and changes nothing", async () => {
    const { u, paymentId, orderId } = await started("whsig");
    const ev = orderPaid(orderId);
    const raw = JSON.stringify(ev);
    for (const sig of [null, "", "0".repeat(64), createHmac("sha256", "another-secret").update(raw).digest("hex"), sign(raw + " ")]) {
      const res = await hook.POST(hookReq(raw, sig));
      expect(res.status).toBe(400);
    }
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("pending");
    expect(await counts(u.id)).toEqual({ active: 0, invoices: 0 });
  });

  test("a blank admin field keeps the stored secret; clearing it refuses every webhook", async () => {
    await settings.saveConfig("payments", { razorpay: { webhookSecret: "" } });
    expect((await settings.getConfig("payments")).razorpay.webhookSecret).toBe(WEBHOOK_SECRET);
    await settings.saveConfig("payments", { razorpay: { webhookSecret: null as unknown as string } });
    expect((await settings.getConfig("payments")).razorpay.webhookSecret).toBe("");
    const { u, paymentId, orderId } = await started("whnone");
    const raw = JSON.stringify(orderPaid(orderId));
    for (const sig of [createHmac("sha256", "").update(raw).digest("hex"), sign(raw)]) {
      expect((await hook.POST(hookReq(raw, sig))).status).toBe(400);
    }
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("pending");
    expect(await counts(u.id)).toEqual({ active: 0, invoices: 0 });
    await settings.saveConfig("payments", { razorpay: { webhookSecret: WEBHOOK_SECRET } });
    expect((await settings.getConfig("payments")).razorpay.webhookSecret).toBe(WEBHOOK_SECRET);
  });
});

describe("razorpay webhook: order.paid", () => {
  test("grants the plan once; a duplicate event adds no second subscription, payment or invoice", async () => {
    const { u, paymentId, orderId } = await started("paid");
    expect((await send(orderPaid(orderId))).status).toBe(200);
    expect((await send(orderPaid(orderId))).status).toBe(200);
    expect((await send(orderPaid(orderId, "pay_retry_different_id"))).status).toBe(200);
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe("succeeded");
    expect(await db.payment.count({ where: { userId: u.id } })).toBe(1);
    expect(await counts(u.id)).toEqual({ active: 1, invoices: 1 });
  });

  test("out of order: a failure first, then order.paid, still grants the plan", async () => {
    const { u, paymentId, orderId } = await started("late");
    await send({ event: "payment.failed", payload: { payment: { entity: { order_id: orderId, error_description: "Card declined" } } } });
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("failed");
    await send(orderPaid(orderId));
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe("succeeded");
    expect(p.failureReason).toBeNull();
    expect(await counts(u.id)).toEqual({ active: 1, invoices: 1 });
  });

  test("out of order the other way: a stale payment.failed never takes a paid plan away", async () => {
    const { u, paymentId, orderId } = await started("stale");
    await send(orderPaid(orderId));
    await send({ event: "payment.failed", payload: { payment: { entity: { order_id: orderId, error_description: "Card declined" } } } });
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("succeeded");
    expect(await counts(u.id)).toEqual({ active: 1, invoices: 1 });
  });

  test("an order Outlly never created grants nothing", async () => {
    const u = await mkUser("ghost");
    orders.set("order_ghost", { amount: 49900, currency: "INR", notes: {} });
    expect((await send(orderPaid("order_ghost"))).status).toBe(200);
    expect(await counts(u.id)).toEqual({ active: 0, invoices: 0 });
    expect(await db.payment.count({ where: { userId: u.id } })).toBe(0);
  });

  test("the buyer opened checkout twice: whichever order they paid is honoured, and only one plan is granted", async () => {
    // startCheckout reuses the pending payment but asks Razorpay for a fresh order, so the first order id is no
    // longer on the payment row. Money took that first order: the plan must still arrive.
    const { u, paymentId, orderId: first } = await started("twice");
    const again = await svc.startCheckout(u.id, "creator");
    expect(again.paymentId).toBe(paymentId);
    if (again.kind !== "razorpay") throw new Error("expected razorpay");
    expect(again.orderId).not.toBe(first);
    expect((await send(orderPaid(first))).status).toBe(200);
    const p = await db.payment.findUniqueOrThrow({ where: { id: paymentId } });
    expect(p.status).toBe("succeeded");
    expect(await counts(u.id)).toEqual({ active: 1, invoices: 1 });
    // and the second order being paid too (a real double charge) is flagged for the admin, never silently swallowed
    expect((await send(orderPaid(again.orderId))).status).toBe(200);
    expect(await counts(u.id)).toEqual({ active: 1, invoices: 1 });
    expect(await db.adminEvent.count({ where: { kind: "payment_review", title: { contains: "twice paid" } } })).toBe(1);
  });

  test("an order quoting another account's payment in its notes is refused when the money doesn't match", async () => {
    const { u, paymentId } = await started("notes");
    orders.set("order_forged_notes", { amount: 100, currency: "INR", notes: { paymentId } });
    expect((await send(orderPaid("order_forged_notes"))).status).toBe(200);
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("pending");
    expect(await counts(u.id)).toEqual({ active: 0, invoices: 0 });
  });
});

describe("razorpay webhook: money going back", () => {
  test("a partial refund changes nothing; a full one refunds the payment and ends the plan", async () => {
    const { u, paymentId, orderId } = await started("refund");
    await send(orderPaid(orderId));
    const amount = (await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).amountMinor;
    await send({ event: "refund.processed", payload: { payment: { entity: { order_id: orderId, amount, amount_refunded: 100, refund_status: "partial" } }, refund: { entity: { id: "rfnd_1" } } } });
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("succeeded");
    expect((await counts(u.id)).active).toBe(1);
    await send({ event: "refund.processed", payload: { payment: { entity: { order_id: orderId, amount, amount_refunded: amount, refund_status: "full" } }, refund: { entity: { id: "rfnd_2" } } } });
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("refunded");
    expect((await counts(u.id)).active).toBe(0);
  });

  test("a dispute leaves the payment alone (it can still be won) but is recorded", async () => {
    const { u, paymentId, orderId } = await started("dispute");
    await send(orderPaid(orderId));
    await send({ event: "payment.dispute.created", payload: { payment: { entity: { order_id: orderId } }, dispute: { entity: { reason_code: "fraud" } } } });
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("succeeded");
    expect(await db.adminEvent.count({ where: { kind: "refund", title: { contains: "Chargeback" } } })).toBeGreaterThan(0);
    expect((await counts(u.id)).active).toBe(1);
  });
});

// ------------------------------------------------------------------ who may change billing

describe("billing belongs to the workspace owner", () => {
  const post = (body: unknown) =>
    new NextRequest("http://localhost/api/billing/cancel", { method: "POST", body: JSON.stringify(body), headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost" } });

  test("a teammate acting in the owner's workspace cannot cancel the owner's plan", async () => {
    const { u, orderId } = await started("teamcancel");
    await send(orderPaid(orderId));
    g.__billUser = { ...u, actor: { id: "member-1", name: "Ed", email: "ed@test.dev" }, role: "editor", joinedAt: new Date(), scope: null };
    const res = await cancelRoute.POST(post({ action: "cancel" }), {} as never);
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe("ROLE");
    expect((await db.subscription.findFirstOrThrow({ where: { userId: u.id, status: "active" } })).cancelAtPeriodEnd).toBe(false);
    asOwner(u);
    expect((await cancelRoute.POST(post({ action: "cancel" }), {} as never)).status).toBe(200);
    expect((await db.subscription.findFirstOrThrow({ where: { userId: u.id, status: "active" } })).cancelAtPeriodEnd).toBe(true);
  });

  test("every /api/billing path is owner-only, for reads as well as writes", async () => {
    const { memberBlock } = await import("../lib/team/roles");
    for (const path of ["/api/billing", "/api/billing/checkout", "/api/billing/cancel", "/api/billing/cards", "/api/billing/refund", "/api/billing/topups", "/api/billing/mock", "/api/billing/razorpay/verify"]) {
      for (const role of ["editor", "manager"] as const) {
        for (const method of ["GET", "POST", "PATCH", "DELETE"]) expect(memberBlock(role, method, path)).toBeTruthy();
      }
      expect(memberBlock("owner", "POST", path)).toBeNull();
    }
  });
});

// ------------------------------------------------------------------ entitlements are a server rule

describe("plan limits are enforced on the server", () => {
  test("Free runs out of posts after 3 in a week, and a paid plan lifts it", async () => {
    const u = await mkUser("limit");
    const e = await ent.entitlements(u.id);
    expect(e.planSlug).toBe("free");
    expect(e.postLimit).toBe(3);
    for (let i = 0; i < 3; i++) await ent.spendPost(u.id, `post-${u.id}-${i}`);
    await expect(ent.spendPost(u.id, `post-${u.id}-over`)).rejects.toMatchObject({ status: 402, code: "PLAN_LIMIT" });
    // the same post again inside the period is free, so a retry is never charged twice
    await expect(ent.spendPost(u.id, `post-${u.id}-0`)).resolves.toMatchObject({ fresh: false });
    const start = await svc.startCheckout(u.id, "studio");
    if (start.kind !== "razorpay") throw new Error("expected razorpay");
    await send(orderPaid(start.orderId));
    expect((await ent.entitlements(u.id)).postLimit).toBe(0); // unlimited on Studio
    await expect(ent.spendPost(u.id, `post-${u.id}-after`)).resolves.toBeTruthy();
  });

  test("a plan limit is read from the winning subscription, never from anything the client sends", async () => {
    const u = await mkUser("claim");
    const e = await ent.entitlements(u.id);
    expect(e.source).toBe("free");
    expect(e.burnCaptions).toBe(false);
    await expect(ent.assertBurnCaptions(u.id)).rejects.toMatchObject({ status: 402, code: "PLAN_LIMIT" });
  });
});

// ------------------------------------------------------------------ offers

describe("offers", () => {
  const camp = (over: Record<string, unknown> = {}) => ({
    title: "Audit Flash Sale", kind: "pct", value: 50, currency: "INR", planSlugs: JSON.stringify(["creator"]),
    startsAt: new Date(Date.now() - 3_600_000), endsAt: new Date(Date.now() + 3_600_000), banner: "{}", ctaText: "Claim", ctaHref: "/billing",
    eligibility: "all", active: true, maxRedemptions: 0, ...over,
  });

  test("a claimed offer is re-priced by the server and applies once per person", async () => {
    const c = await db.campaign.create({ data: camp() });
    const u = await mkUser("offer");
    const plan = await db.plan.findUniqueOrThrow({ where: { slug: "creator" } });
    const start = await svc.startCheckout(u.id, "creator", "INR", "month", c.id);
    if (start.kind !== "razorpay") throw new Error("expected razorpay");
    const p = await db.payment.findUniqueOrThrow({ where: { id: start.paymentId } });
    expect(p.amountMinor).toBe(offerPrice({ kind: "pct", value: 50, currency: "INR" }, plan.priceMinor, "INR"));
    expect(p.amountMinor).toBeLessThan(plan.priceMinor);
    await send(orderPaid(start.orderId));
    expect((await db.campaign.findUniqueOrThrow({ where: { id: c.id } })).redemptions).toBe(1);
    // the subscription renews at the regular price, not the offer price
    const sub = await db.subscription.findFirstOrThrow({ where: { userId: u.id, status: "active" } });
    expect(sub.priceMinor).toBe(plan.priceMinor);
    // and the same person cannot take the same offer again
    await db.subscription.updateMany({ where: { userId: u.id }, data: { status: "canceled" } });
    await expect(svc.startCheckout(u.id, "creator", "INR", "month", c.id)).rejects.toMatchObject({ status: 409, code: "OFFER_UNAVAILABLE" });
  });

  test("an ended, switched-off, sold-out or unknown offer is refused at checkout, at the regular price or not at all", async () => {
    const u = await mkUser("offerbad");
    const ended = await db.campaign.create({ data: camp({ endsAt: new Date(Date.now() - 1000) }) });
    const off = await db.campaign.create({ data: camp({ active: false }) });
    const soldOut = await db.campaign.create({ data: camp({ maxRedemptions: 1, redemptions: 1 }) });
    for (const id of [ended.id, off.id, soldOut.id, "no-such-campaign"]) {
      await expect(svc.startCheckout(u.id, "creator", "INR", "month", id)).rejects.toMatchObject({ status: 409, code: "OFFER_UNAVAILABLE" });
    }
    expect(await db.payment.count({ where: { userId: u.id } })).toBe(0);
  });

  test("an offer for another plan cannot be spent on this one", async () => {
    const u = await mkUser("offerplan");
    const c = await db.campaign.create({ data: camp({ planSlugs: JSON.stringify(["studio"]) }) });
    await expect(svc.startCheckout(u.id, "creator", "INR", "month", c.id)).rejects.toMatchObject({ code: "OFFER_UNAVAILABLE" });
  });

  test("discounts can never be negative, free or over 100%, and never stack with founding", () => {
    for (const price of [100, 101, 999, 49900, 149900]) {
      for (const value of [1, 50, 90, 100, 1000, -5, 0]) {
        const pct = offerPrice({ kind: "pct", value, currency: "INR" }, price, "INR");
        if (pct !== null) {
          expect(pct).toBeGreaterThanOrEqual(MIN_CHARGE_MINOR);
          expect(pct).toBeLessThan(price);
        }
        const fixed = offerPrice({ kind: "fixed", value: value * 1000, currency: "INR" }, price, "INR");
        if (fixed !== null) expect(fixed).toBeGreaterThanOrEqual(MIN_CHARGE_MINOR);
      }
    }
    // founding and offer never add up: the single lower price wins
    expect(bestOffer({ kind: "pct", value: 10, currency: "INR" }, 99900, 69900, "INR")).toBeNull();
    expect(foundingPrice(99900, 90)).toBeGreaterThanOrEqual(MIN_CHARGE_MINOR);
    expect(foundingPrice(100, 90)).toBe(100);
  });
});

// ------------------------------------------------------------------ invoices and money

describe("invoices and money", () => {
  test("numbers are unique, sequential and in the published format; one invoice per payment", async () => {
    const seen = new Set<string>();
    for (const tag of ["inv1", "inv2", "inv3"]) {
      const { orderId, paymentId } = await started(tag);
      await send(orderPaid(orderId));
      const inv = await db.invoice.findUniqueOrThrow({ where: { paymentId } });
      expect(inv.number).toMatch(INVOICE_NUMBER_RE);
      expect(seen.has(inv.number)).toBe(false);
      seen.add(inv.number);
      expect(inv.amountMinor).toBe((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).amountMinor);
    }
    const all = (await db.invoice.findMany({ select: { number: true } })).map((i) => i.number);
    expect(new Set(all).size).toBe(all.length);
  });

  test("GST is taken out of a tax-inclusive total and the lines always add back up to it", () => {
    for (const total of [1, 99, 100, 49900, 99900, 149900, 12345]) {
      for (const tax of [0, 5, 12, 18, 28]) {
        const lines = linesFor({ description: "Creator plan, 1 month", amountMinor: total });
        const t = totalsFor(lines, tax, total);
        expect(t.net.reduce((a, x) => a + x, 0) + t.tax).toBe(total);
        expect(Number.isInteger(t.tax)).toBe(true);
        expect(t.tax).toBeGreaterThanOrEqual(0);
        expect(t.tax).toBeLessThan(total + 1);
      }
    }
  });

  test("every stored amount is an integer number of minor units", async () => {
    for (const p of await db.payment.findMany({ select: { amountMinor: true, currency: true } })) {
      expect(Number.isInteger(p.amountMinor)).toBe(true);
      expect(p.amountMinor).toBeGreaterThanOrEqual(0);
      expect(p.currency).toMatch(/^[A-Z]{3}$/);
    }
    for (const s of await db.subscription.findMany({ select: { priceMinor: true } })) expect(Number.isInteger(s.priceMinor)).toBe(true);
    for (const i of await db.invoice.findMany({ select: { amountMinor: true } })) expect(Number.isInteger(i.amountMinor)).toBe(true);
  });
});

// ------------------------------------------------------------------ the 30-day guarantee

describe("30-day guarantee", () => {
  test("one self-serve refund per account, and never a second", async () => {
    const guarantee = await import("../lib/billing/guarantee");
    const { u, orderId, paymentId } = await started("selfrefund");
    await send(orderPaid(orderId));
    expect((await guarantee.refundStatus(u.id)).state).toBe("eligible");
    // the gateway is faked: a refund call must reach Razorpay, so point the fake at a captured payment
    installRzpFake(async (url) => {
      if (url.includes(`/v1/orders/${orderId}/payments`)) return Response.json({ items: [{ id: "pay_cap1", status: "captured" }] });
      if (url.includes("/v1/payments/pay_cap1/refund")) return Response.json({ id: "rfnd_self1" });
      return null;
    });
    const r = await guarantee.selfRefund({ id: u.id, email: u.email, name: u.name }, "not for me");
    expect(r.done).toBe("refunded");
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("refunded");
    expect((await counts(u.id)).active).toBe(0);
    expect((await guarantee.refundStatus(u.id)).state).toBe("used");
    await expect(guarantee.selfRefund({ id: u.id, email: u.email, name: u.name }, "")).rejects.toMatchObject({ status: 409, code: "NOT_REFUNDABLE" });
  });
});


// ------------------------------------------------------------------ 1127: the edge cases the lead asked to close

describe("stripe webhook", () => {
  const STRIPE_SECRET = "whsec-audit-0123456789";
  const stripeSig = (raw: string) => {
    const t = Math.floor(Date.now() / 1000);
    return `t=${t},v1=${createHmac("sha256", STRIPE_SECRET).update(`${t}.${raw}`).digest("hex")}`;
  };
  const sreq = (raw: string, sig: string | null) =>
    new NextRequest("http://localhost/api/billing/webhooks/stripe", { method: "POST", body: raw, headers: { "content-type": "application/json", ...(sig ? { "stripe-signature": sig } : {}) } });
  let shook: typeof import("../app/api/billing/webhooks/stripe/route");

  beforeAll(async () => {
    shook = await import("../app/api/billing/webhooks/stripe/route");
    await settings.saveConfig("payments", { stripe: { webhookSecret: STRIPE_SECRET } });
  });

  test("a signed body that isn't JSON is a 400, never an unhandled 500", async () => {
    for (const raw of ["not json at all", "{", '{"type":', "[1,2", "null{"]) {
      const res = await shook.POST(sreq(raw, stripeSig(raw)));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("bad body");
    }
  });

  test("an unsigned or wrongly signed body is still a 400, and a huge one never reaches the parser", async () => {
    expect((await shook.POST(sreq('{"type":"charge.refunded"}', null))).status).toBe(400);
    expect((await shook.POST(sreq('{"type":"charge.refunded"}', "t=1,v1=deadbeef"))).status).toBe(400);
    const huge = JSON.stringify({ type: "charge.refunded", pad: "x".repeat(300_000) });
    const res = await shook.POST(sreq(huge, stripeSig(huge)));
    expect(res.status).toBe(413);
  });

  test("a valid event naming no payment of ours is received and grants nothing", async () => {
    const u = await mkUser("stripeghost");
    const raw = JSON.stringify({ type: "checkout.session.completed", data: { object: { client_reference_id: "nope", payment_status: "paid" } } });
    const res = await shook.POST(sreq(raw, stripeSig(raw)));
    expect(res.status).toBe(200);
    expect(await counts(u.id)).toEqual({ active: 0, invoices: 0 });
  });
});

describe("razorpay webhook body cap", () => {
  test("a body too big to be a real event is refused before the signature is even checked", async () => {
    const huge = JSON.stringify({ event: "order.paid", pad: "x".repeat(300_000) });
    const res = await hook.POST(hookReq(huge, sign(huge)));
    expect(res.status).toBe(413);
  });
});

describe("the refund can only happen once, however many requests arrive together", () => {
  test("two refunds of the same payment at the same moment: one credit note, one email-worthy event", async () => {
    const guarantee = await import("../lib/billing/guarantee");
    const { u, orderId, paymentId } = await started("race");
    await send(orderPaid(orderId));
    let refundCalls = 0;
    installRzpFake(async (url) => {
      if (url.includes(`/v1/orders/${orderId}/payments`)) return Response.json({ items: [{ id: "pay_cap2", status: "captured" }] });
      if (url.includes("/v1/payments/pay_cap2/refund")) {
        refundCalls++;
        await new Promise((r) => setTimeout(r, 25)); // a slow gateway is what opens the race
        return Response.json({ id: `rfnd_race${refundCalls}` });
      }
      return null;
    });
    const svcMod = await import("../lib/billing/service");
    const both = await Promise.allSettled([svcMod.refundPayment(paymentId, "race A", ""), svcMod.refundPayment(paymentId, "race B", "")]);
    expect(both.filter((r) => r.status === "fulfilled").length).toBeGreaterThan(0);
    const inv = await db.invoice.findUniqueOrThrow({ where: { paymentId } });
    expect(await db.creditNote.count({ where: { invoiceId: inv.id } })).toBe(1);
    expect((await db.payment.findUniqueOrThrow({ where: { id: paymentId } })).status).toBe("refunded");
    expect((await counts(u.id)).active).toBe(0);
    expect(await db.adminEvent.count({ where: { kind: "refund", title: { contains: "Refunded" } , body: { contains: "race" } } })).toBe(1);
    expect((await guarantee.refundStatus(u.id)).state).toBe("used");
  });
});

describe("the plan copy is honest about what the server can enforce", () => {
  const src = (f: string) => readFileSync(new URL(`../${f}`, import.meta.url), "utf8");

  test("burned captions is sold as a paid feature, never as something the server stops", async () => {
    const limits = src("app/api/plan/limits/route.ts");
    expect(limits).toContain("burn-in happens in the browser");
    expect(limits).toMatch(/never as something Outlly stops you doing/);
    // the 402 a Free user actually sees names the alternative they still have today
    const msg = src("lib/billing/entitlements.ts");
    expect(msg).toContain("you can still post with captions in the text");
    // and no plan feature line claims captions are locked, blocked, protected or watermarked
    const copy = [src("lib/billing/pricing-preset.ts"), src("lib/billing/plans.ts")].join("\n");
    for (const line of copy.matchAll(/"[^"]*captions?[^"]*"/gi)) {
      expect(line[0]).not.toMatch(/locked|blocked|watermark|protected|DRM|can't be/i);
    }
  });

  test("everything with a server cost is gated on the action itself, not only in the UI", () => {
    const ents = src("lib/billing/entitlements.ts");
    for (const guard of ["assertCanPost", "assertCaptionVideo", "assertCanReply", "assertUploadSize", "assertStorage", "assertAiCaptions"]) expect(ents).toContain(`export async function ${guard}(`);
  });
});
