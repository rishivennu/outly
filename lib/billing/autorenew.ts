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
// 1098: only a plan still in its period (a lapsed one would get a mandate starting in the past).
const paidSub = (userId: string) =>
  db.subscription.findFirst({ where: { userId, status: "active", priceMinor: { gt: 0 }, provider: { notIn: [...GIFT_PROVIDERS] }, currentPeriodEnd: { gt: new Date() } }, include: { plan: true }, orderBy: { currentPeriodEnd: "desc" } });

async function razorpayPlanId(amountMinor: number, currency: string, interval: "month" | "year", name: string) {
  const key = `rzp-plan:${amountMinor}:${currency}:${interval}`;
  const hit = await db.setting.findUnique({ where: { key } });
  if (hit) return hit.value;
  const cfg = await getConfig("payments");
  const id = await razorpay.createPlan(cfg, { amountMinor, currency, interval, name });
  await db.setting.upsert({ where: { key }, create: { key, value: id }, update: { value: id } });
  return id;
}

/** Setting key that links a replacement mandate (not yet approved) to the local subscription it is for. */
export const replaceKey = (newProviderSubId: string) => `rzp-replace:${newProviderSubId}`;
/** Setting key that remembers which subscription a stopped mandate belonged to, so a late charge on it is never lost. */
export const retiredKey = (providerSubId: string) => `rzp-retired:${providerSubId}`;

async function cancelAtGateway(providerSubId: string) {
  const cfg = await getConfig("payments").catch(() => null);
  if (!cfg) return console.error("[autorenew] no payments config to cancel", providerSubId);
  await razorpay.cancelSubscription(cfg, providerSubId).catch((e) => console.error("[autorenew] cancel mandate", providerSubId, e));
}

/** Stops every replacement mandate still waiting for approval on this subscription (cancel, pause, off, a new Update). */
export async function clearReplacements(subscriptionId: string) {
  const links = await db.setting.findMany({ where: { key: { startsWith: "rzp-replace:" }, value: { startsWith: `${subscriptionId}|` } } });
  if (!links.length) return;
  await db.setting.deleteMany({ where: { key: { in: links.map((l) => l.key) } } });
  for (const l of links) await cancelAtGateway(l.key.slice("rzp-replace:".length));
}

/** Cancels a mandate at Razorpay and remembers whose it was. */
async function retire(subscriptionId: string, providerSubId: string) {
  await db.setting.upsert({ where: { key: retiredKey(providerSubId) }, create: { key: retiredKey(providerSubId), value: subscriptionId }, update: { value: subscriptionId } }).catch(() => null);
  await cancelAtGateway(providerSubId);
}

export async function setAutoRenew(userId: string, on: boolean, opts: { replace?: boolean } = {}): Promise<{ autoRenew: boolean; url?: string | null; pending?: boolean }> {
  const s = await paidSub(userId);
  if (!s) throw new HttpError(404, "You don't have an active paid plan.", "NO_SUBSCRIPTION");
  if (on && opts.replace && s.autoRenew) return replaceMandate(s, userId);
  if (!on) {
    await dropMandate(s);
    await db.subscription.update({ where: { id: s.id }, data: { autoRenew: false, providerSubId: null } });
    return { autoRenew: false };
  }
  if (s.autoRenew) return { autoRenew: true };
  if (s.pausedUntil && s.pausedUntil > new Date()) throw new HttpError(409, "Your plan is paused. Resume it to turn on auto-renew.", "PAUSED");
  if (s.cancelAtPeriodEnd) throw new HttpError(409, "Your plan is set to end. Keep it first to turn on auto-renew.", "CANCELLING");
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

/**
 * 1098 "Update payment method": a new mandate is created alongside the live one. The old one keeps auto-renew
 * working until Razorpay says the new one is approved (webhook), then it is cancelled. Abandoning the approval
 * page changes nothing.
 */
async function replaceMandate(s: NonNullable<Awaited<ReturnType<typeof paidSub>>>, userId: string) {
  if (s.provider === "mock" || s.sample) {
    await db.subscription.update({ where: { id: s.id }, data: { providerSubId: `mock_sub_${s.id}_${Date.now().toString(36)}` } });
    return { autoRenew: true };
  }
  if (s.provider !== "razorpay") throw new HttpError(409, "Only Razorpay mandates can be changed here.", "AUTORENEW_UNSUPPORTED");
  await clearReplacements(s.id); // a second "Update" replaces the first unapproved one, never piles up
  const cfg = await getConfig("payments");
  const interval = s.interval === "year" ? "year" : "month";
  const planId = await razorpayPlanId(s.priceMinor, s.currency, interval, s.plan.name);
  const sub = await razorpay.createSubscription(cfg, { planId, startAt: s.currentPeriodEnd, totalCount: interval === "year" ? 10 : 120, notes: { subscriptionId: s.id, userId, replaces: s.providerSubId ?? "" } });
  // The period end rides along: if the old mandate renews the plan before this one is approved, the new one is dropped (no double charge).
  const link = `${s.id}|${s.currentPeriodEnd.toISOString()}`;
  await db.setting.upsert({ where: { key: replaceKey(sub.id) }, create: { key: replaceKey(sub.id), value: link }, update: { value: link } });
  return { autoRenew: true, pending: true, url: sub.shortUrl };
}

/**
 * A replacement mandate was approved: point the plan at it and stop the old one. True when it was one.
 * Not needed any more (plan cancelled, paused, auto-renew turned off, ended, or already renewed by the old
 * mandate while the page was open): the new one is cancelled and the plan is left exactly as it is.
 */
async function adoptReplacement(newProviderSubId: string, now = new Date()): Promise<boolean> {
  const link = await db.setting.findUnique({ where: { key: replaceKey(newProviderSubId) } });
  if (!link) return false;
  const [subId, at] = link.value.split("|");
  const s = await db.subscription.findUnique({ where: { id: subId } });
  const moved = !!s && !!at && s.currentPeriodEnd.getTime() !== new Date(at).getTime();
  const paused = !!(s?.pausedUntil && s.pausedUntil > now);
  if (!s || s.status !== "active" || !s.autoRenew || !s.providerSubId || s.cancelAtPeriodEnd || paused || moved) {
    await db.setting.delete({ where: { key: link.key } }).catch(() => null);
    await retire(subId, newProviderSubId);
    return true;
  }
  const old = s.providerSubId;
  // The link goes in the same write as the switch: a failed write leaves it for Razorpay's retry.
  await db.$transaction([
    db.subscription.update({ where: { id: s.id }, data: { providerSubId: newProviderSubId, autoRenew: true, cancelAtPeriodEnd: false } }),
    db.setting.delete({ where: { key: link.key } }),
  ]);
  if (old !== newProviderSubId) await retire(s.id, old);
  return true;
}

/** Stops a mandate at the gateway. Never throws: the local plan change has to go through either way. */
export async function dropMandate(s: { id: string; providerSubId: string | null; provider: string }) {
  await clearReplacements(s.id).catch((e) => console.error("[autorenew] clear replacements", s.id, e));
  if (!s.providerSubId || s.providerSubId.startsWith("mock_sub_") || s.provider !== "razorpay") return;
  await retire(s.id, s.providerSubId);
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
 * 1098: a charge on a mandate that is no longer the plan's (stopped, replaced, a cancel that didn't reach
 * Razorpay) is still money taken: it is recorded and invoiced, never extends the plan or turns auto-renew
 * back on, and is flagged for a refund. `hint` = the subscription id we put in the mandate's notes.
 */
export async function renewFromCharge(providerSubId: string, charge: { id: string; amount: number; currency: string }, now = new Date(), hint?: string | null) {
  const inc = { plan: true, user: { select: { name: true } } } as const;
  let s = await db.subscription.findUnique({ where: { providerSubId }, include: inc });
  let stray = false;
  if (!s) {
    const r = await db.setting.findUnique({ where: { key: retiredKey(providerSubId) } });
    const id = r?.value ?? hint ?? null;
    s = id ? await db.subscription.findUnique({ where: { id }, include: inc }) : null;
    stray = true;
  }
  if (!s) {
    await adminEvent("payment_review", "Razorpay charged a mandate Outlly doesn't know", `${formatMoney(charge.amount, charge.currency)} on ${providerSubId} (payment ${charge.id}). Refund it in Razorpay.`, "/admin/payments");
    return null;
  }
  if (s.status === "canceled") stray = true;
  if (await db.payment.findFirst({ where: { provider: "razorpay", providerRef: charge.id }, select: { id: true } })) return null;
  const end = stray ? s.currentPeriodEnd : renewedEnd(s.currentPeriodEnd, s.interval, now);
  const sub = s;
  let paymentId: string;
  try {
    paymentId = await db.$transaction(async (tx) => {
      const p = await tx.payment.create({ data: { userId: sub.userId, subscriptionId: sub.id, planId: sub.planId, amountMinor: charge.amount, currency: charge.currency, interval: sub.interval, provider: "razorpay", providerRef: charge.id, status: "succeeded", purpose: "renewal" } });
      if (!stray) await tx.subscription.update({ where: { id: sub.id }, data: { currentPeriodEnd: end, status: "active", autoRenew: true, cancelAtPeriodEnd: false } });
      return p.id;
    });
  } catch (e) {
    if ((e as { code?: string })?.code === "P2002") return null; // a racing retry got there first
    throw e;
  }
  await issueInvoice(paymentId).catch((e) => console.error("[autorenew] invoice", paymentId, e));
  if (stray) {
    await adminEvent("payment_review", `Refund ${s.user.name}: charged on a stopped mandate`, `${formatMoney(charge.amount, charge.currency)} on ${providerSubId}. Their plan was not extended. Refund this payment.`, "/admin/payments");
    return { paymentId, currentPeriodEnd: end, stray: true };
  }
  await adminEvent("subscription_renewed", `${s.user.name} renewed ${s.plan.name}`, formatMoney(charge.amount, charge.currency), "/admin/payments");
  return { paymentId, currentPeriodEnd: end, stray: false };
}

/** Razorpay subscription.* webhook events. */
export async function onRazorpaySubscription(ev: { event?: string; payload?: any }) {
  const sub = ev.payload?.subscription?.entity;
  if (!sub?.id) return;
  const kind = ev.event ?? "";
  if ((kind === "subscription.authenticated" || kind === "subscription.activated") && (await adoptReplacement(sub.id))) return;
  if (kind === "subscription.authenticated" || kind === "subscription.activated")
    await db.subscription.updateMany({ where: { providerSubId: sub.id, status: "active" }, data: { autoRenew: true, cancelAtPeriodEnd: false } });
  else if (kind === "subscription.charged") {
    const pay = ev.payload?.payment?.entity;
    if (pay?.id) await renewFromCharge(sub.id, { id: pay.id, amount: Number(pay.amount), currency: String(pay.currency ?? "INR") }, new Date(), typeof sub.notes?.subscriptionId === "string" ? sub.notes.subscriptionId : null);
  } else if (["subscription.cancelled", "subscription.halted", "subscription.completed", "subscription.paused"].includes(kind)) {
    await db.setting.deleteMany({ where: { key: replaceKey(sub.id) } }); // a replacement that never got approved
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
