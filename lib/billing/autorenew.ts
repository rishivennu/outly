import "server-only";
import { format } from "date-fns";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { getConfig } from "../settings";
import { sendEmail, templates } from "../email";
import { adminEvent } from "../admin/route";
import { formatMoney } from "./money";
import { razorpay } from "./providers";
import { issueInvoice } from "./invoice";
import { GIFT_PROVIDERS } from "./access-core";
import { reminderDue, reminderKey, renewedEnd } from "./renewal-core";

/**
 * 1096 auto-renew. Off by default for everyone; the customer turns it on in Billing.
 * Razorpay: a Subscription (card or UPI Autopay mandate) whose first charge is at the end of the period
 * already paid for. `autoRenew` turns true only when Razorpay says the mandate is approved (webhook).
 * Mock gateway (dev / staging): flips straight away. Other gateways: reminders instead.
 */
const paidSub = (userId: string) =>
  db.subscription.findFirst({ where: { userId, status: "active", priceMinor: { gt: 0 }, provider: { notIn: [...GIFT_PROVIDERS] } }, include: { plan: true }, orderBy: { currentPeriodEnd: "desc" } });

async function razorpayPlanId(amountMinor: number, currency: string, interval: "month" | "year", name: string) {
  const key = `rzp-plan:${amountMinor}:${currency}:${interval}`;
  const hit = await db.setting.findUnique({ where: { key } });
  if (hit) return hit.value;
  const cfg = await getConfig("payments");
  const id = await razorpay.createPlan(cfg, { amountMinor, currency, interval, name });
  await db.setting.upsert({ where: { key }, create: { key, value: id }, update: { value: id } });
  return id;
}

export async function setAutoRenew(userId: string, on: boolean): Promise<{ autoRenew: boolean; url?: string | null; pending?: boolean }> {
  const s = await paidSub(userId);
  if (!s) throw new HttpError(404, "You don't have an active paid plan.", "NO_SUBSCRIPTION");
  if (!on) {
    await dropMandate(s);
    await db.subscription.update({ where: { id: s.id }, data: { autoRenew: false, providerSubId: null } });
    return { autoRenew: false };
  }
  if (s.autoRenew) return { autoRenew: true };
  if (s.provider === "mock" || s.sample) {
    await db.subscription.update({ where: { id: s.id }, data: { autoRenew: true, cancelAtPeriodEnd: false, providerSubId: `mock_sub_${s.id}` } });
    return { autoRenew: true };
  }
  if (s.provider !== "razorpay") throw new HttpError(409, "Auto-renew works with cards and UPI Autopay through Razorpay. We'll email you before your plan ends instead.", "AUTORENEW_UNSUPPORTED");
  const cfg = await getConfig("payments");
  const interval = s.interval === "year" ? "year" : "month";
  const planId = await razorpayPlanId(s.priceMinor, s.currency, interval, s.plan.name);
  if (s.providerSubId) await dropMandate(s); // an earlier mandate that was never approved
  const sub = await razorpay.createSubscription(cfg, { planId, startAt: s.currentPeriodEnd, totalCount: interval === "year" ? 10 : 120, notes: { subscriptionId: s.id, userId } });
  await db.subscription.update({ where: { id: s.id }, data: { providerSubId: sub.id } });
  return { autoRenew: false, pending: true, url: sub.shortUrl };
}

/** Stops a mandate at the gateway. Never throws: the local plan change has to go through either way. */
export async function dropMandate(s: { providerSubId: string | null; provider: string }) {
  if (!s.providerSubId || s.providerSubId.startsWith("mock_sub_") || s.provider !== "razorpay") return;
  const cfg = await getConfig("payments");
  await razorpay.cancelSubscription(cfg, s.providerSubId).catch((e) => console.error("[autorenew] cancel mandate", s.providerSubId, e));
}

/** Ends every mandate on these subscriptions (replaced by a new plan, refunded, cancelled). */
export async function dropMandates(subIds: string[]) {
  if (!subIds.length) return;
  const subs = await db.subscription.findMany({ where: { id: { in: subIds }, providerSubId: { not: null } } });
  for (const s of subs) await dropMandate(s);
  await db.subscription.updateMany({ where: { id: { in: subs.map((s) => s.id) } }, data: { autoRenew: false, providerSubId: null } });
}

/**
 * One automatic charge: a "renewal" payment, the period moved on, an invoice. Idempotent on the gateway's
 * payment id (Payment has a unique provider + providerRef), so a retried webhook changes nothing.
 */
export async function renewFromCharge(providerSubId: string, charge: { id: string; amount: number; currency: string }, now = new Date()) {
  const s = await db.subscription.findUnique({ where: { providerSubId }, include: { plan: true, user: { select: { name: true } } } });
  if (!s || s.status === "canceled") return null;
  if (await db.payment.findFirst({ where: { provider: "razorpay", providerRef: charge.id }, select: { id: true } })) return null;
  const end = renewedEnd(s.currentPeriodEnd, s.interval, now);
  let paymentId: string;
  try {
    paymentId = await db.$transaction(async (tx) => {
      const p = await tx.payment.create({ data: { userId: s.userId, subscriptionId: s.id, planId: s.planId, amountMinor: charge.amount, currency: charge.currency, interval: s.interval, provider: "razorpay", providerRef: charge.id, status: "succeeded", purpose: "renewal" } });
      await tx.subscription.update({ where: { id: s.id }, data: { currentPeriodEnd: end, status: "active", autoRenew: true, cancelAtPeriodEnd: false } });
      return p.id;
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return null; // a racing retry got there first
    throw e;
  }
  await issueInvoice(paymentId).catch((e) => console.error("[autorenew] invoice", paymentId, e));
  await adminEvent("subscription_renewed", `${s.user.name} renewed ${s.plan.name}`, formatMoney(charge.amount, charge.currency), "/admin/payments");
  return { paymentId, currentPeriodEnd: end };
}

/** Razorpay subscription.* webhook events. */
export async function onRazorpaySubscription(ev: { event?: string; payload?: any }) {
  const sub = ev.payload?.subscription?.entity;
  if (!sub?.id) return;
  const kind = ev.event ?? "";
  if (kind === "subscription.authenticated" || kind === "subscription.activated")
    await db.subscription.updateMany({ where: { providerSubId: sub.id, status: "active" }, data: { autoRenew: true, cancelAtPeriodEnd: false } });
  else if (kind === "subscription.charged") {
    const pay = ev.payload?.payment?.entity;
    if (pay?.id) await renewFromCharge(sub.id, { id: pay.id, amount: Number(pay.amount), currency: String(pay.currency ?? "INR") });
  } else if (["subscription.cancelled", "subscription.halted", "subscription.completed", "subscription.paused"].includes(kind)) {
    await db.subscription.updateMany({ where: { providerSubId: sub.id }, data: { autoRenew: false, ...(kind === "subscription.paused" ? {} : { providerSubId: null }) } });
    if (kind === "subscription.halted") await adminEvent("payment_failed", "An auto-renew charge kept failing", `Razorpay halted ${sub.id}. The plan ends at its period end unless they renew.`, "/admin/payments?status=failed");
  }
}

/**
 * Daily (cron/retention): reminder emails before a plan ends or renews. `remindedFor` is set before the email
 * goes out with a conditional update, so two cron runs can't both send it.
 */
export async function sendRenewalReminders(now = new Date()) {
  const soon = new Date(now.getTime() + 7 * 86_400_000 + 3_600_000);
  const subs = await db.subscription.findMany({
    where: { status: "active", priceMinor: { gt: 0 }, sample: false, provider: { notIn: [...GIFT_PROVIDERS] }, currentPeriodEnd: { gt: now, lte: soon }, OR: [{ pausedUntil: null }, { pausedUntil: { lte: now } }] },
    include: { plan: true, user: { select: { name: true, email: true } } },
    take: 500,
  });
  let sent = 0;
  for (const s of subs) {
    const step = reminderDue(s, now);
    if (!step) continue;
    const key = reminderKey(s.currentPeriodEnd, step);
    const won = await db.subscription.updateMany({ where: { id: s.id, OR: [{ remindedFor: null }, { remindedFor: { not: key } }] }, data: { remindedFor: key } });
    if (won.count !== 1) continue;
    await sendEmail({
      to: s.user.email,
      kind: "subscription",
      subject: s.autoRenew ? `${s.plan.name} renews on ${format(s.currentPeriodEnd, "d MMM")}` : `${s.plan.name} ends on ${format(s.currentPeriodEnd, "d MMM")}`,
      html: templates.renewalReminder({ name: s.user.name, plan: s.plan.name, date: format(s.currentPeriodEnd, "d MMM yyyy"), amount: formatMoney(s.priceMinor, s.currency), autoRenew: s.autoRenew, url: `${env.APP_URL}/billing` }),
    }).catch((e) => console.error("[renewal reminder]", s.id, e));
    sent++;
  }
  return { checked: subs.length, sent };
}
