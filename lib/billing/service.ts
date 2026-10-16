import "server-only";
import { addMonths, addYears } from "date-fns";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { getConfig } from "../settings";
import { adminEvent } from "../admin/route";
import { formatMoney, type Currency } from "./money";
import { chargeCurrency, isCurrency, localPrice, parsePrices } from "./currency";
import { issueInvoice } from "./invoice";
import { sendEmail, templates } from "../email";
import { mock, paypal, razorpay, stripe, type CheckoutStart } from "./providers";
import { rewardReferrer } from "../referral";
import { isPaused, pausePlan, resumePlan } from "./pause";

/** Which gateway serves checkout right now. Falls back to mock if the chosen one is missing keys, and says so. */
export async function activeGateway() {
  const cfg = await getConfig("payments");
  const ready =
    cfg.provider === "mock" ||
    (cfg.provider === "stripe" && !!cfg.stripe.secretKey) ||
    (cfg.provider === "razorpay" && !!cfg.razorpay.keyId && !!cfg.razorpay.keySecret) ||
    (cfg.provider === "paypal" && !!cfg.paypal.clientId && !!cfg.paypal.clientSecret);
  return { cfg, provider: ready ? cfg.provider : ("mock" as const), misconfigured: !ready };
}

let warnedMock = false;
/**
 * Is checkout being served by the simulated gateway? Shown by /api/health, and on a production deploy
 * it is almost always a mistake, so say so loudly in the logs the first time anything asks.
 */
export async function paymentsMock() {
  const { provider, misconfigured } = await activeGateway();
  const mock = provider === "mock";
  if (mock && env.NODE_ENV === "production" && !warnedMock) {
    warnedMock = true;
    console.warn("[payments] WARNING: the simulated payment gateway is live in production. No real money is being taken. Pick a provider and add its keys in the admin console.");
  }
  return { mock, misconfigured };
}

/**
 * The mock gateway hands out real subscriptions, invoices and referral rewards for a test card.
 * On a live site that is only allowed when the owner opts in on purpose (ALLOW_MOCK_PAYMENTS=true,
 * e.g. a staging deploy); otherwise checkout says payments are being set up instead.
 */
export function mockAllowed() {
  return env.NODE_ENV !== "production" || process.env.ALLOW_MOCK_PAYMENTS === "true";
}

/** `wanted` is the visitor's currency (cookie / IP country). The gateway decides what it can actually charge. */
export async function startCheckout(userId: string, planSlug: string, wanted?: Currency): Promise<CheckoutStart & { paymentId: string }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = await db.plan.findUnique({ where: { slug: planSlug } });
  if (!plan || plan.state !== "available") throw new HttpError(404, "That plan isn't available right now.", "PLAN_UNAVAILABLE");
  if (plan.priceMinor <= 0) throw new HttpError(400, "That plan is free, there's nothing to pay.", "FREE_PLAN");
  const current = await db.subscription.findFirst({ where: { userId, status: "active", planId: plan.id } });
  if (current) throw new HttpError(409, `You're already on ${plan.name}.`, "ALREADY_SUBSCRIBED");

  const { cfg, provider } = await activeGateway();
  if (provider === "mock" && !mockAllowed()) throw new HttpError(503, "Payments are being set up. Paid plans open shortly.", "GATEWAY");
  const charge = localPrice({ ...plan, prices: parsePrices(plan.prices) }, chargeCurrency(provider, wanted ?? (isCurrency(plan.currency) ? plan.currency : "INR"), plan.currency));
  // Reuse a recent pending attempt for the same plan, so double-clicks don't create duplicate payments.
  const recent = await db.payment.findFirst({
    where: { userId, planId: plan.id, status: "pending", provider, createdAt: { gt: new Date(Date.now() - 20 * 60_000) } },
    orderBy: { createdAt: "desc" },
  });
  const payment =
    recent && recent.amountMinor === charge.priceMinor && recent.currency === charge.currency
      ? recent
      : await db.payment.create({ data: { userId, planId: plan.id, amountMinor: charge.priceMinor, currency: charge.currency, provider, status: "pending" } });

  const args = { paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, planName: plan.name, user: { name: user.name, email: user.email }, appUrl: env.APP_URL };
  let start: CheckoutStart;
  try {
    start =
      provider === "stripe" ? await stripe.start(cfg, args)
      : provider === "razorpay" ? await razorpay.start(cfg, args)
      : provider === "paypal" ? await paypal.start(cfg, args)
      : await mock.start(args);
  } catch (e) {
    await failPayment(payment.id, `Gateway error: ${(e as Error).message}`);
    throw new HttpError(502, "The payment gateway didn't respond. You were not charged. Try again in a minute.", "GATEWAY");
  }
  if ("providerRef" in start && start.providerRef) await db.payment.update({ where: { id: payment.id }, data: { providerRef: start.providerRef } }).catch(() => {});
  return { ...start, paymentId: payment.id };
}

/** Idempotent. Safe to call from the return URL, the client callback and the webhook for the same payment. */
export async function completePayment(paymentId: string, providerRef?: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new HttpError(404, "Payment not found", "NOT_FOUND");
  if (p.status === "succeeded") return { payment: p, invoice: await db.invoice.findUnique({ where: { paymentId } }) };
  if (!p.planId) throw new Error("Payment has no plan");
  const plan = await db.plan.findUniqueOrThrow({ where: { id: p.planId } });
  const now = new Date();

  const sub = await db.$transaction(async (tx) => {
    // flip pending -> succeeded only once (a racing webhook sees count 0 and stops)
    const flipped = await tx.payment.updateMany({ where: { id: p.id, status: { in: ["pending", "failed"] } }, data: { status: "succeeded", failureReason: null, ...(providerRef ? { providerRef } : {}) } });
    if (flipped.count === 0) return null;
    await tx.subscription.updateMany({ where: { userId: p.userId, status: { in: ["active", "past_due"] } }, data: { status: "canceled", canceledAt: now } });
    const s = await tx.subscription.create({
      data: {
        userId: p.userId,
        planId: plan.id,
        status: "active",
        priceMinor: p.amountMinor,
        currency: p.currency,
        interval: plan.interval,
        provider: p.provider,
        currentPeriodEnd: plan.interval === "year" ? addYears(now, 1) : addMonths(now, 1),
        sample: p.sample,
      },
    });
    await tx.payment.update({ where: { id: p.id }, data: { subscriptionId: s.id } });
    return s;
  });
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  if (!sub) return { payment: fresh, invoice: await db.invoice.findUnique({ where: { paymentId } }) };
  const invoice = await issueInvoice(p.id, { email: !p.sample });
  if (!p.sample) {
    const u = await db.user.findUnique({ where: { id: p.userId }, select: { name: true } });
    await adminEvent("subscription_new", `${u?.name ?? "A user"} subscribed to ${plan.name}`, formatMoney(p.amountMinor, p.currency), "/admin/payments");
    await rewardReferrer(p.userId, plan.id).catch((e) => console.error("[referral] reward", e));
  }
  return { payment: fresh, invoice };
}

/**
 * PayPal return URL and webhook both land here: capture the approved order, then mark it paid.
 * `userId` limits the lookup to the signed-in buyer on the return URL; the webhook passes null.
 */
export async function capturePaypal(orderId: string, userId: string | null) {
  const p = await db.payment.findFirst({ where: { provider: "paypal", providerRef: orderId, ...(userId ? { userId } : {}) } });
  if (!p) return { state: "unknown" as const };
  if (p.status === "succeeded") return { state: "paid" as const, invoice: await db.invoice.findUnique({ where: { paymentId: p.id } }) };
  const r = await paypal.capture(await getConfig("payments"), orderId);
  if (r.status === "COMPLETED") {
    const { invoice } = await completePayment(p.id);
    return { state: "paid" as const, invoice };
  }
  if (r.status === "PENDING") return { state: "pending" as const };
  await failPayment(p.id, `PayPal: ${r.reason ?? "capture failed"}`);
  return { state: "failed" as const, reason: r.reason };
}

export async function failPayment(paymentId: string, reason: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { user: { select: { name: true } } } });
  if (!p || p.status === "succeeded") return;
  await db.payment.update({ where: { id: paymentId }, data: { status: "failed", failureReason: reason.slice(0, 300) } });
  if (!p.sample) await adminEvent("payment_failed", `Payment failed: ${p.user.name}`, `${formatMoney(p.amountMinor, p.currency)} · ${reason.slice(0, 120)}`, "/admin/payments?status=failed");
}

/** Cancel at period end: access continues until currentPeriodEnd, nothing is refunded automatically. */
export async function cancelSubscription(userId: string) {
  const s = await db.subscription.findFirst({ where: { userId, status: "active" }, include: { plan: true } });
  if (!s) throw new HttpError(404, "You don't have an active paid plan.", "NO_SUBSCRIPTION");
  await db.subscription.update({ where: { id: s.id }, data: { cancelAtPeriodEnd: true } });
  return s;
}
export async function resumeSubscription(userId: string) {
  const s = await db.subscription.findFirst({ where: { userId, status: "active", cancelAtPeriodEnd: true } });
  if (!s) throw new HttpError(404, "Nothing to resume.", "NO_SUBSCRIPTION");
  await db.subscription.update({ where: { id: s.id }, data: { cancelAtPeriodEnd: false } });
}

/** Pause instead of cancel: the plan rests (Free limits apply) and the unused paid days come back after. */
export async function pauseSubscription(userId: string, months: number, now = new Date()) {
  const s = await db.subscription.findFirst({ where: { userId, status: "active", priceMinor: { gt: 0 }, currentPeriodEnd: { gt: now } }, include: { plan: true }, orderBy: { createdAt: "desc" } });
  if (!s) throw new HttpError(404, "You don't have an active paid plan.", "NO_SUBSCRIPTION");
  if (isPaused(s, now)) throw new HttpError(409, "Your plan is already paused.", "ALREADY_PAUSED");
  const p = pausePlan(now, s.currentPeriodEnd, months);
  await db.subscription.update({ where: { id: s.id }, data: { pausedUntil: p.pausedUntil, currentPeriodEnd: p.periodEnd, cancelAtPeriodEnd: false } });
  return { ...s, ...p };
}
export async function unpauseSubscription(userId: string, now = new Date()) {
  const s = await db.subscription.findFirst({ where: { userId, status: "active", pausedUntil: { gt: now } } });
  if (!s) throw new HttpError(404, "Your plan isn't paused.", "NOT_PAUSED");
  await db.subscription.update({ where: { id: s.id }, data: { pausedUntil: null, currentPeriodEnd: resumePlan(now, s.pausedUntil!, s.currentPeriodEnd).periodEnd } });
}

/** Lazy expiry: called when billing is read, so no cron is needed for cancel-at-period-end. */
export async function expireSubscriptions(userId?: string) {
  await db.subscription.updateMany({
    where: { ...(userId ? { userId } : {}), status: "active", cancelAtPeriodEnd: true, currentPeriodEnd: { lt: new Date() } },
    data: { status: "canceled", canceledAt: new Date() },
  });
}

/**
 * Full refund, admin-initiated. Real gateways are called first; only if they accept do we mark the
 * payment refunded and end the subscription immediately. The customer gets an email either way it lands.
 */
export async function refundPayment(paymentId: string, by: string, reason: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { user: true, invoice: true } });
  if (!p) throw new HttpError(404, "Payment not found", "NOT_FOUND");
  if (p.status !== "succeeded") throw new HttpError(409, "Only a paid payment can be refunded.", "NOT_REFUNDABLE");
  let ref = `mock_refund_${Date.now().toString(36)}`;
  if (p.provider !== "mock" && !p.sample) {
    const cfg = await getConfig("payments");
    if (!p.providerRef) throw new HttpError(409, "This payment has no gateway reference. Refund it from the gateway dashboard.", "NO_REF");
    try {
      ref =
        p.provider === "stripe" ? await stripe.refund(cfg, p.providerRef)
        : p.provider === "paypal" ? await paypal.refund(cfg, p.providerRef)
        : await razorpay.refund(cfg, p.providerRef);
    } catch (e) {
      throw new HttpError(502, `The gateway refused the refund: ${(e as Error).message}`, "GATEWAY");
    }
  }
  await db.$transaction([
    db.payment.update({ where: { id: p.id }, data: { status: "refunded", failureReason: `Refunded by ${by}${reason ? `: ${reason}` : ""} (${ref})`.slice(0, 300) } }),
    ...(p.subscriptionId ? [db.subscription.updateMany({ where: { id: p.subscriptionId, status: "active" }, data: { status: "canceled", canceledAt: new Date() } })] : []),
  ]);
  if (!p.sample) await revokeReferralReward(p.userId, p.createdAt).catch((e) => console.error("[refund] referral revoke", e));
  if (!p.sample) {
    await sendEmail({ to: p.user.email, kind: "subscription", subject: `Refund issued: ${formatMoney(p.amountMinor, p.currency)}`, html: templates.refund({ name: p.user.name, amount: formatMoney(p.amountMinor, p.currency), number: p.invoice?.number ?? "-" }) });
    await adminEvent("refund", `Refunded ${p.user.name}`, `${formatMoney(p.amountMinor, p.currency)} by ${by}`, "/admin/payments?status=refunded");
  }
}

/**
 * A refunded FIRST payment must not leave the referrer's free month behind (otherwise: refer yourself,
 * pay, get refunded, keep the month, repeat). Undo exactly what rewardReferrer granted: the gift
 * subscription, or the extra month on the referrer's paid plan.
 */
async function revokeReferralReward(userId: string, paidAt: Date) {
  const me = await db.user.findUnique({ where: { id: userId }, select: { referredById: true } });
  if (!me?.referredById) return;
  const real = await db.payment.count({ where: { userId, status: { in: ["succeeded", "refunded"] }, sample: false } });
  if (real !== 1) return; // the reward is only ever granted for the first real payment
  const now = new Date();
  const gift = await db.subscription.updateMany({
    where: { userId: me.referredById, provider: "referral", status: "active", createdAt: { gte: new Date(paidAt.getTime() - 60_000) } },
    // paidAt is the payment row's createdAt: the gift is always created after it, however slow the reward path.
    data: { status: "canceled", canceledAt: now },
  });
  if (gift.count > 0) return;
  const paid = await db.subscription.findFirst({ where: { userId: me.referredById, status: "active", priceMinor: { gt: 0 } }, orderBy: { currentPeriodEnd: "desc" } });
  if (!paid) return;
  const back = addMonths(paid.currentPeriodEnd, -1);
  await db.subscription.update({ where: { id: paid.id }, data: { currentPeriodEnd: back > now ? back : now } });
}
