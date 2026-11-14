import "server-only";
import type { Payment, Subscription } from "@prisma/client";
import { db } from "../db";
import { hashKey, ledgerKeysForUser, type LedgerKey } from "./keys";
import { refreshMonth } from "./costs";
import { convertTrial } from "./trial";

/**
 * 1147 payment lifecycle. Called by lib/billing/service.ts and autorenew.ts after the money has moved. Every
 * function here is safe to repeat (webhook retries) and never throws: the plan change has already happened.
 * The ledger is written whether or not the policy is on, so a person who paid before it was enabled is
 * correctly "returning" afterwards. Nothing here changes a price or a plan.
 */
type PaymentLike = Pick<Payment, "id" | "userId" | "subscriptionId" | "purpose" | "sample" | "status" | "meta">;

const safe = async <T>(tag: string, work: () => Promise<T>): Promise<T | null> => {
  try {
    return await work();
  } catch (e) {
    console.error(`[subs lifecycle] ${tag}`, e);
    return null;
  }
};

/** The device ledger hash checkout stored on the payment (never the raw id). */
export function metaLedgerDevice(meta: string | null | undefined): string | null {
  try {
    const d = JSON.parse(meta || "null")?.ledger?.device;
    return typeof d === "string" && /^[\w-]{20,100}$/.test(d) ? d : null;
  } catch {
    return null;
  }
}

/** Marks these keys as having paid: firstPaidAt only the first time, lastPaidUntil moves to `until`. */
async function markPaid(userId: string, keys: LedgerKey[], until: Date | null, now: Date) {
  for (const k of keys) {
    await db.offerLedger.upsert({
      where: { kind_keyHash: { kind: k.kind, keyHash: k.keyHash } },
      create: { kind: k.kind, keyHash: k.keyHash, userId, firstPaidAt: now, lastPaidUntil: until },
      update: { userId, ...(until ? { lastPaidUntil: until } : {}) },
    });
    await db.offerLedger.updateMany({ where: { kind: k.kind, keyHash: k.keyHash, firstPaidAt: null }, data: { firstPaidAt: now } });
  }
}

const keysWithDevice = async (userId: string, meta: string | null | undefined, paymentKey?: string | null) => {
  const keys = await ledgerKeysForUser(userId, { paymentKey });
  const dev = metaLedgerDevice(meta);
  if (dev) keys.push({ kind: "device", keyHash: dev });
  return keys;
};

/** A plan, renewal or pack payment succeeded. `paymentKey` = the raw payment-method key when the gateway sent one. */
export async function onPaymentSucceeded(payment: PaymentLike, extra: { paymentKey?: string | null; now?: Date } = {}) {
  if (payment.sample) return;
  const now = extra.now ?? new Date();
  if (payment.purpose !== "topup") {
    await safe("ledger", async () => {
      const sub = payment.subscriptionId ? await db.subscription.findUnique({ where: { id: payment.subscriptionId }, select: { currentPeriodEnd: true } }) : null;
      await markPaid(payment.userId, await keysWithDevice(payment.userId, payment.meta, extra.paymentKey), sub?.currentPeriodEnd ?? null, now);
    });
    await safe("trial", () => convertTrial(payment.userId, now));
  }
  await safe("month", () => refreshMonth(payment.userId, now));
}

/** The payment-method key arrived after the payment was already settled (a webhook after the client callback). */
export async function notePaymentKey(userId: string, paymentKey: string | null | undefined, now = new Date()) {
  if (!paymentKey) return;
  await safe("payment key", () => markPaid(userId, [{ kind: "payment", keyHash: hashKey("payment", paymentKey) }], null, now));
}

/** A charge failed. Nothing to undo: a lapse is decided by time (graceDays after the period end), not by this. */
export async function onPaymentFailed(_payment: PaymentLike) {
  return;
}

/** Cancel at period end: the ledger remembers when the paid time runs out. */
export async function onSubscriptionCanceled(sub: Pick<Subscription, "userId" | "currentPeriodEnd">) {
  await safe("cancel", () => db.offerLedger.updateMany({ where: { userId: sub.userId }, data: { lastPaidUntil: sub.currentPeriodEnd } }));
}

/** Refunded: the offer still counts as used (firstPaidAt stays). The paid time ends now and the month's revenue drops. */
export async function onRefunded(payment: PaymentLike, now = new Date()) {
  if (payment.sample) return;
  if (payment.purpose !== "topup") await safe("refund", () => db.offerLedger.updateMany({ where: { userId: payment.userId }, data: { lastPaidUntil: now } }));
  await safe("month", () => refreshMonth(payment.userId, now));
}

/** A chargeback: as a refund for the ledger, plus a medium risk flag (verify before any offer). Once per payment. */
export async function onChargeback(payment: PaymentLike, detail = "", now = new Date()) {
  if (payment.sample) return;
  await safe("chargeback", async () => {
    if (await db.riskFlag.findFirst({ where: { userId: payment.userId, reasons: { contains: `"payment":"${payment.id}"` } }, select: { id: true } })) return;
    await db.riskFlag.create({
      data: { userId: payment.userId, score: 50, level: "medium", action: "verify", context: "checkout", reasons: JSON.stringify([{ code: "chargeback", weight: 50, detail: detail.slice(0, 120), payment: payment.id }]) },
    });
  });
  await safe("month", () => refreshMonth(payment.userId, now));
}

/**
 * Cron. (1) Ledger backfill: people who paid before 1147 get their email key marked, a batch per run.
 * (2) Month rollover: every live paid subscriber gets this month's SubscriberMonth row (revenue, budget, fixed cost).
 */
export async function sweepExpired(now = new Date()) {
  let backfilled = 0;
  let months = 0;
  const payers = await db.payment.findMany({
    where: { sample: false, status: { in: ["succeeded", "refunded"] }, purpose: { in: ["plan", "renewal"] } },
    distinct: ["userId"],
    select: { userId: true, createdAt: true, user: { select: { email: true } } },
    orderBy: { userId: "asc" },
    take: 2000,
  });
  for (const p of payers) {
    const keyHash = hashKey("email", p.user.email);
    const row = await db.offerLedger.findUnique({ where: { kind_keyHash: { kind: "email", keyHash } }, select: { firstPaidAt: true } });
    if (row?.firstPaidAt) continue;
    await safe("backfill", () => markPaid(p.userId, [{ kind: "email", keyHash }], null, p.createdAt));
    if (++backfilled >= 200) break;
  }
  const month = now.toISOString().slice(0, 7);
  const subs = await db.subscription.findMany({
    where: { status: "active", currentPeriodEnd: { gt: now }, priceMinor: { gt: 0 }, sample: false, provider: { notIn: ["beta", "referral"] } },
    select: { userId: true },
    distinct: ["userId"],
    take: 2000,
  });
  const have = new Set((await db.subscriberMonth.findMany({ where: { month, userId: { in: subs.map((s) => s.userId) } }, select: { userId: true } })).map((r) => r.userId));
  for (const s of subs) {
    if (have.has(s.userId)) continue;
    if (await safe("rollover", () => refreshMonth(s.userId, now))) months++;
    if (months >= 300) break;
  }
  return { backfilled, months };
}
