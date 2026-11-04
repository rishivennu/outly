import "server-only";
import { creditNotePdf, issueCreditNote } from "./credit-note";
import { addMonths, addYears } from "date-fns";
import { db } from "../db";
import { env } from "../env";
import { HttpError } from "../http";
import { getConfig } from "../settings";
import { adminEvent } from "../admin/route";
import { formatMoney, type Currency } from "./money";
import { noticePaymentFailed, noticePaymentOk } from "../notify-events";
import { chargeCurrency } from "./currency";
import { hasYearly, type Cycle } from "./cycle";
import { onPaidFounding, releaseUnpaidFounding } from "../founding";
import { normalizeDisplay } from "./display";
import { issueInvoice } from "./invoice";
import { sendEmail, templates } from "../email";
import { mock, paypal, razorpay, stripe, youpi, type CheckoutStart } from "./providers";
import { youpiReady, youpiVerdict, type YoupiVerdict } from "./youpi";
import { revokeReferralForPayment, rewardReferredFriend } from "../referral";
import { accessFor, expireGrants, restackReferralGrants } from "./access";
import { GIFT_PROVIDERS, isPaidSub } from "./access-core";
import { isPaused, pausePlan, resumePlan } from "./pause";
import { parseVariantTag, recordExperiment, variantTag } from "./experiments";
import { normalizeTopups, packBlock, packExpiry, packPrice } from "./topups-core";
import { refundTopUp } from "./topups";
import { dropMandate, dropMandates } from "./autorenew";
import { ensureRzpCustomer } from "./saved-cards";
import { buyerPrice } from "./buyer-price";
import { checkoutOffer, convertCampaign, OFFER_HOLD_MS, releaseCampaign } from "../campaign";
import { discountLabel } from "../campaign-core";

/** Which gateway serves checkout right now. Falls back to mock if the chosen one is missing keys, and says so. */
export async function activeGateway() {
  const cfg = await getConfig("payments");
  const ready =
    cfg.provider === "mock" ||
    (cfg.provider === "stripe" && !!cfg.stripe.secretKey) ||
    (cfg.provider === "razorpay" && !!cfg.razorpay.keyId && !!cfg.razorpay.keySecret) ||
    (cfg.provider === "paypal" && !!cfg.paypal.clientId && !!cfg.paypal.clientSecret) ||
    (cfg.provider === "youpi" && youpiReady(cfg.youpi, cfg.mode));
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

/**
 * 1121: what the invoice prints as the price breakdown: the price before discounts and each discount taken off.
 * A price test is the price this buyer was shown, so it is the starting price, never a "discount".
 */
export function priceMeta(beforeMinor: number, chargedMinor: number, foundingPct: number | null | undefined, offer?: { id: string; label: string; renewMinor: number; until?: string } | null) {
  const off = beforeMinor - chargedMinor;
  // 1122: an offer replaces the founding discount for this payment (the lower price wins, they don't stack).
  // renewMinor is what the subscription renews at afterwards: the offer is for the first payment only.
  if (offer && off > 0) return JSON.stringify({ price: { listMinor: beforeMinor, discounts: [{ label: offer.label, minor: off }] }, campaign: { id: offer.id, ...(offer.until ? { until: offer.until } : {}) }, renewMinor: offer.renewMinor });
  if (!foundingPct || off <= 0) return null;
  return JSON.stringify({ price: { listMinor: beforeMinor, discounts: [{ label: `Founding member discount (${foundingPct}%)`, minor: off }] } });
}

/** 1122: what a subscription bought with an offer renews at (the price without the offer). */
export function renewPriceOf(meta: string | null | undefined, paidMinor: number) {
  try {
    const m = JSON.parse(meta || "null");
    return m?.campaign?.id && Number.isInteger(m.renewMinor) && m.renewMinor >= paidMinor ? (m.renewMinor as number) : paidMinor;
  } catch {
    return paidMinor;
  }
}

/** `wanted` is the visitor's currency (cookie / IP country). The gateway decides what it can actually charge. */
/** `cycle` is the Monthly / Yearly switch the buyer picked; yearly falls back to monthly if it is switched off. */
/** 1122: `campaignId` is an offer the buyer claimed; it is re-checked here and checkout stops if it no longer applies. */
export async function startCheckout(userId: string, planSlug: string, wanted?: Currency, cycle: Cycle = "month", campaignId?: string | null): Promise<CheckoutStart & { paymentId: string }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const plan = await db.plan.findUnique({ where: { slug: planSlug } });
  if (!plan || plan.state !== "available") throw new HttpError(404, "That plan isn't available right now.", "PLAN_UNAVAILABLE");
  if (plan.priceMinor <= 0) throw new HttpError(400, "That plan is free, there's nothing to pay.", "FREE_PLAN");
  const display = normalizeDisplay(await getConfig("pricing"));
  const want: Cycle = cycle === "year" && (plan.interval === "year" || hasYearly(plan, display.yearly)) ? "year" : plan.interval === "year" ? "year" : "month";
  // Same plan on the other cycle (monthly -> yearly) is a real change, so only the exact same plan + cycle is refused.
  // A gift month (beta code, referral) of the same plan doesn't stop anyone from paying for it.
  const current = await db.subscription.findFirst({ where: { userId, status: "active", planId: plan.id, interval: want, provider: { notIn: [...GIFT_PROVIDERS] } } });
  if (current) throw new HttpError(409, `You're already on ${plan.name}${want === "year" ? " yearly" : ""}.`, "ALREADY_SUBSCRIBED");

  const { cfg, provider } = await activeGateway();
  if (provider === "mock" && !mockAllowed()) throw new HttpError(503, "Payments are being set up. Paid plans open shortly.", "GATEWAY");
  // Founding members (1036): the discount they claimed with, on every paid plan and cycle, for life.
  // 1067: someone this payment would seat (a founding spot is open for them) pays the founding price too.
  // 1096: a price test in this currency replaces the list price for the people in it (same yearly ratio).
  // 1122: the same steps live in buyerPrice, which the offer popup and billing page use too.
  const { test, tested, fpct, foundingMinor } = await buyerPrice(user.id, plan, provider, wanted, want, display.freeMonths);
  // 1122: a claimed offer, validated again now (live, this person, this plan, beats founding). Never a surprise price.
  const offer = campaignId ? await checkoutOffer(user.id, campaignId, plan, want, provider, wanted) : null;
  const charge = { ...tested, priceMinor: offer ? offer.finalMinor : foundingMinor };
  const meta = priceMeta(tested.priceMinor, charge.priceMinor, offer ? null : fpct, offer ? { id: offer.campaign.id, label: discountLabel(offer.campaign), renewMinor: foundingMinor, until: offer.campaign.endsAt.toISOString() } : null);
  // Reuse a recent pending attempt for the same plan, so double-clicks don't create duplicate payments.
  const recent = await db.payment.findFirst({
    where: { userId, planId: plan.id, status: "pending", provider, interval: charge.interval, createdAt: { gt: new Date(Date.now() - OFFER_HOLD_MS) } },
    orderBy: { createdAt: "desc" },
  });
  const payment =
    recent && recent.amountMinor === charge.priceMinor && recent.currency === charge.currency && (recent.meta ?? null) === meta
      ? recent
      : await db.payment.create({ data: { userId, planId: plan.id, amountMinor: charge.priceMinor, currency: charge.currency, interval: charge.interval, provider, status: "pending", meta, ...(test ? { variant: variantTag(test) } : {}) } });
  if (test) await recordExperiment({ experiment: test.experiment, variant: test.variant, userId, kind: "checkout", amountMinor: charge.priceMinor, currency: charge.currency });

  const args = { paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, planName: charge.interval === "year" && plan.interval !== "year" ? `${plan.name} (yearly)` : plan.name, user: { name: user.name, email: user.email }, appUrl: env.APP_URL,
    // 1118: Checkout shows the user's saved cards and can save a new one (Razorpay tokenises it, with its own consent).
    customerId: provider === "razorpay" ? await ensureRzpCustomer(cfg, user) : undefined };
  let start: CheckoutStart;
  try {
    start =
      provider === "stripe" ? await stripe.start(cfg, args)
      : provider === "razorpay" ? await razorpay.start(cfg, args)
      : provider === "paypal" ? await paypal.start(cfg, args)
      : provider === "youpi" ? await youpi.start(cfg, args)
      : await mock.start(args);
  } catch (e) {
    await failPayment(payment.id, `Gateway error: ${(e as Error).message}`);
    throw new HttpError(502, "The payment gateway didn't respond. You were not charged. Try again in a minute.", "GATEWAY");
  }
  if ("providerRef" in start && start.providerRef) await db.payment.update({ where: { id: payment.id }, data: { providerRef: start.providerRef } }).catch(() => {});
  return { ...start, paymentId: payment.id };
}

/** 1096: the packs on sale, and whether this person may buy them. */
export async function topUpOffer(userId: string) {
  const cfg = normalizeTopups(await getConfig("topups"));
  const { best } = await accessFor(userId);
  const planSlug = best?.plan.slug ?? "free";
  const paid = !!best && best.plan.priceMinor > 0;
  const limits = best ? { xPostLimit: best.plan.xPostLimit ?? 0, captionVideos: best.plan.captionVideos, aiCaptions: best.plan.aiCaptions, brandLimit: best.plan.brandLimit ?? 0 } : undefined;
  return { cfg, planSlug, paid, limits, packs: cfg.packs.map((p) => ({ ...p, block: packBlock(cfg, p, planSlug, paid, limits) })) };
}

/** 1096: one usage pack, paid like a plan but it never touches the subscription. */
export async function startTopUp(userId: string, packId: string, wanted?: Currency): Promise<CheckoutStart & { paymentId: string }> {
  const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
  const offer = await topUpOffer(userId);
  const pack = offer.cfg.packs.find((p) => p.id === packId);
  const block = packBlock(offer.cfg, pack, offer.planSlug, offer.paid, offer.limits);
  if (block || !pack) throw new HttpError(409, block ?? "That pack isn't on sale.", "TOPUP_UNAVAILABLE");
  const { cfg, provider } = await activeGateway();
  if (provider === "mock" && !mockAllowed()) throw new HttpError(503, "Payments are being set up. Top-ups open shortly.", "GATEWAY");
  const price = packPrice(pack, chargeCurrency(provider, wanted ?? "INR", "INR"));
  const meta = JSON.stringify({ pack: pack.id, kind: pack.kind, units: pack.units, days: pack.days, label: pack.label });
  const recent = await db.payment.findFirst({ where: { userId, purpose: "topup", meta, status: "pending", provider, createdAt: { gt: new Date(Date.now() - 20 * 60_000) } }, orderBy: { createdAt: "desc" } });
  const payment =
    recent && recent.amountMinor === price.priceMinor && recent.currency === price.currency
      ? recent
      : await db.payment.create({ data: { userId, amountMinor: price.priceMinor, currency: price.currency, interval: "month", provider, status: "pending", purpose: "topup", meta } });
  const args = { paymentId: payment.id, amountMinor: payment.amountMinor, currency: payment.currency, planName: `Top-up: ${pack.label}`, user: { name: user.name, email: user.email }, appUrl: env.APP_URL,
    customerId: provider === "razorpay" ? await ensureRzpCustomer(cfg, user) : undefined };
  let start: CheckoutStart;
  try {
    start =
      provider === "stripe" ? await stripe.start(cfg, args)
      : provider === "razorpay" ? await razorpay.start(cfg, args)
      : provider === "paypal" ? await paypal.start(cfg, args)
      : provider === "youpi" ? await youpi.start(cfg, args)
      : await mock.start(args);
  } catch (e) {
    await failPayment(payment.id, `Gateway error: ${(e as Error).message}`);
    throw new HttpError(502, "The payment gateway didn't respond. You were not charged. Try again in a minute.", "GATEWAY");
  }
  if ("providerRef" in start && start.providerRef) await db.payment.update({ where: { id: payment.id }, data: { providerRef: start.providerRef } }).catch(() => {});
  return { ...start, paymentId: payment.id };
}

/** Paid top-up: flip the payment once, then exactly one pack (paymentId is unique, so a retry finds it). */
async function completeTopUp(p: { id: string; userId: string; meta: string | null; amountMinor: number; currency: string; sample: boolean }, providerRef?: string) {
  let m: { pack?: string; kind?: string; units?: number; days?: number; label?: string } = {};
  try { m = JSON.parse(p.meta ?? "{}"); } catch { /* checked below */ }
  if (!m.pack || !m.kind || !m.units) throw new Error("Top-up payment has no pack");
  const pack = { kind: m.kind, pack: m.pack, units: m.units, days: m.days ?? 90 };
  // Flip and pack in one transaction: the money is never marked in without the pack (and a racing webhook sees count 0).
  const flipped = await db.$transaction(async (tx) => {
    const r = await tx.payment.updateMany({ where: { id: p.id, status: { in: ["pending", "failed"] } }, data: { status: "succeeded", failureReason: null, ...(providerRef ? { providerRef } : {}) } });
    if (r.count === 1) await tx.topUp.create({ data: { userId: p.userId, kind: pack.kind, pack: pack.pack, units: pack.units, remaining: pack.units, paymentId: p.id, expiresAt: packExpiry({ days: pack.days }) } });
    return r;
  });
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  const invoice = flipped.count === 1 ? await invoiceFor(fresh) : await db.invoice.findUnique({ where: { paymentId: p.id } });
  if (flipped.count === 1 && !p.sample) await adminEvent("topup", `Top-up bought: ${m.label ?? m.pack}`, formatMoney(p.amountMinor, p.currency), "/admin/payments");
  if (flipped.count === 1) await noticePaymentOk(p.id); // 1118 (sample payments stay quiet inside)
  return { payment: fresh, invoice };
}

/**
 * Paid time left on the plan being replaced, converted into time on the new one (1027: an upgrade used to
 * start a fresh period and throw the rest away). Same currency only, never more than the time actually left
 * (a downgrade keeps its days, it doesn't multiply them), nothing for free or sample periods.
 */
export function carryOverMs(
  old: { priceMinor: number; currency: string; interval: string; currentPeriodEnd: Date; sample: boolean } | null,
  next: { priceMinor: number; currency: string; interval: string; sample: boolean },
  now: Date,
) {
  if (!old || old.sample !== next.sample || old.currency !== next.currency || old.priceMinor <= 0 || next.priceMinor <= 0) return 0;
  const left = old.currentPeriodEnd.getTime() - now.getTime();
  if (left <= 0) return 0;
  const span = (interval: string) => (interval === "year" ? addYears(now, 1) : addMonths(now, 1)).getTime() - now.getTime();
  const oldRate = old.priceMinor / span(old.interval);
  const newRate = next.priceMinor / span(next.interval);
  return Math.floor(left * Math.min(1, oldRate / newRate));
}

/** Invoice for a paid payment. A failure is logged, never thrown: the money is in, the plan must be on. */
async function invoiceFor(p: { id: string; sample: boolean }) {
  return issueInvoice(p.id, { email: !p.sample }).catch((e) => {
    console.error("[billing] invoice failed for payment", p.id, e);
    return null;
  });
}

/** Idempotent. Safe to call from the return URL, the client callback and the webhook for the same payment. */
export async function completePayment(paymentId: string, providerRef?: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId } });
  if (!p) throw new HttpError(404, "Payment not found", "NOT_FOUND");
  // Already paid. If its invoice failed last time, this repeat (webhook retry, return URL) issues it now.
  if (p.status === "succeeded") return { payment: p, invoice: (await db.invoice.findUnique({ where: { paymentId } })) ?? (p.subscriptionId || p.purpose === "topup" ? await invoiceFor(p) : null) };
  if (p.purpose === "topup") return completeTopUp(p, providerRef);
  if (!p.planId) throw new Error("Payment has no plan");
  const plan = await db.plan.findUniqueOrThrow({ where: { id: p.planId } });
  const now = new Date();

  let replaced: string[] = []; // 1096: a replaced plan's auto-renew mandate must stop, or it would charge again
  const sub = await db.$transaction(async (tx) => {
    // flip pending -> succeeded only once (a racing webhook sees count 0 and stops)
    const flipped = await tx.payment.updateMany({ where: { id: p.id, status: { in: ["pending", "failed"] } }, data: { status: "succeeded", failureReason: null, ...(providerRef ? { providerRef } : {}) } });
    if (flipped.count === 0) return null;
    const interval = p.interval === "year" || plan.interval === "year" ? "year" : "month";
    // 1052: only the plan being paid for is replaced. Gift subscriptions, admin grants and referral months
    // keep their own clocks (lib/billing/access.ts picks the best live one), so nothing is lost on overlap.
    const open = await tx.subscription.findMany({ where: { userId: p.userId, status: { in: ["active", "past_due"] } } });
    const paid = open.filter(isPaidSub);
    const previous = paid.filter((s) => s.status === "active" && s.currentPeriodEnd > now).sort((a, b) => b.currentPeriodEnd.getTime() - a.currentPeriodEnd.getTime())[0] ?? null;
    // 1122: an offer is for this payment only; the subscription renews (and values carried-over time) at the regular price.
    const renew = renewPriceOf(p.meta, p.amountMinor);
    const carry = carryOverMs(previous, { priceMinor: renew, currency: p.currency, interval, sample: p.sample }, now);
    if (paid.length) await tx.subscription.updateMany({ where: { id: { in: paid.map((s) => s.id) } }, data: { status: "canceled", canceledAt: now } });
    replaced = paid.filter((s) => s.providerSubId).map((s) => s.id);
    const s = await tx.subscription.create({
      data: {
        userId: p.userId,
        planId: plan.id,
        status: "active",
        priceMinor: renew,
        currency: p.currency,
        interval,
        provider: p.provider,
        currentPeriodEnd: new Date((interval === "year" ? addYears(now, 1) : addMonths(now, 1)).getTime() + carry),
        sample: p.sample,
      },
    });
    await tx.payment.update({ where: { id: p.id }, data: { subscriptionId: s.id } });
    return s;
  });
  const fresh = await db.payment.findUniqueOrThrow({ where: { id: p.id } });
  if (!sub) return { payment: fresh, invoice: await db.invoice.findUnique({ where: { paymentId } }) };
  await dropMandates(replaced);
  const invoice = await invoiceFor(p);
  // A referral month that hasn't started yet moves to after the new paid period.
  await restackReferralGrants(p.userId, sub.currentPeriodEnd, now).catch((e) => console.error("[referral] restack", e));
  if (!p.sample) {
    const u = await db.user.findUnique({ where: { id: p.userId }, select: { name: true } });
    await adminEvent("subscription_new", `${u?.name ?? "A user"} subscribed to ${plan.name}`, formatMoney(p.amountMinor, p.currency), "/admin/payments");
    await rewardReferredFriend(p.id); // Refer & Earn: the sharer's month, when this is the friend's first qualifying payment
    await onPaidFounding(p.userId); // 1067: a paid plan is what earns a founding seat (never throws)
    await noticePaymentOk(p.id); // 1118: never throws
  }
  const tag = parseVariantTag(p.variant);
  if (tag) await recordExperiment({ ...tag, userId: p.userId, kind: "paid", amountMinor: p.amountMinor, currency: p.currency });
  await convertCampaign(p); // 1122: an offer that was paid for counts once (never throws)
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

/**
 * YOUPI return URL and webhook both land here. Neither is trusted on its own: we ask the gateway
 * for the payment ourselves and only grant the plan when it is SUCCESS for this order, at exactly
 * our stored amount, in INR, at the admin's verification level. `userId` scopes the return URL.
 * `session` is the YOUPI session a webhook named. It differs from providerRef when the buyer restarted
 * the payment on YOUPI; we read that session from the gateway too (never trusting the webhook body).
 */
export async function confirmYoupi(paymentId: string, userId: string | null, session?: string) {
  const p = await db.payment.findFirst({ where: { id: paymentId, provider: "youpi", ...(userId ? { userId } : {}) } });
  if (!p) return { state: "unknown" as const };
  if (p.status === "succeeded") return { state: "paid" as const, invoice: await db.invoice.findUnique({ where: { paymentId: p.id } }) };
  if (!p.providerRef) return { state: "unknown" as const };
  const cfg = await getConfig("payments");
  const want = { id: p.id, amountMinor: p.amountMinor, currency: p.currency };
  const min = cfg.youpi.minVerification === 2 ? 2 : 1;
  const refs = [p.providerRef, ...(session && session !== p.providerRef ? [session] : [])];
  let v: Exclude<YoupiVerdict, { state: "paid" | "pending" }> | null = null;
  let pending = false;
  for (const ref of refs) {
    const r = youpiVerdict(await youpi.status(cfg, ref), want, min);
    if (r.state === "paid") {
      const { invoice } = await completePayment(p.id, ref);
      return { state: "paid" as const, invoice };
    }
    if (r.state === "pending") pending = true;
    else v ??= r;
  }
  if (pending || !v) return { state: "pending" as const };
  if (p.status === "pending") await failPayment(p.id, v.state === "mismatch" ? `YOUPI mismatch, check by hand before granting: ${v.reason}` : `YOUPI: ${v.reason}`);
  return { state: v.state, reason: v.reason };
}

export async function failPayment(paymentId: string, reason: string) {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { user: { select: { name: true } } } });
  if (!p || p.status === "succeeded") return;
  await db.payment.update({ where: { id: paymentId }, data: { status: "failed", failureReason: reason.slice(0, 300) } });
  if (!p.sample) await adminEvent("payment_failed", `Payment failed: ${p.user.name}`, `${formatMoney(p.amountMinor, p.currency)} · ${reason.slice(0, 120)}`, "/admin/payments?status=failed");
  if (p.status !== "failed") await noticePaymentFailed(p.id); // 1118: once per payment, never throws
}

/** Cancel at period end: access continues until currentPeriodEnd, nothing is refunded automatically. */
export async function cancelSubscription(userId: string) {
  const s = await db.subscription.findFirst({ where: { userId, status: "active", provider: { notIn: [...GIFT_PROVIDERS] } }, include: { plan: true }, orderBy: { currentPeriodEnd: "desc" } });
  if (!s) throw new HttpError(404, "You don't have an active paid plan.", "NO_SUBSCRIPTION");
  // 1096: cancelling also stops an auto-renew mandate, so nothing is charged at the period end.
  await dropMandate(s); // 1098: also stops a replacement still waiting for approval
  await db.subscription.update({ where: { id: s.id }, data: { cancelAtPeriodEnd: true, autoRenew: false, providerSubId: null } });
  return s;
}
export async function resumeSubscription(userId: string) {
  const s = await db.subscription.findFirst({ where: { userId, status: "active", cancelAtPeriodEnd: true, provider: { notIn: [...GIFT_PROVIDERS] } } });
  if (!s) throw new HttpError(404, "Nothing to resume.", "NO_SUBSCRIPTION");
  await db.subscription.update({ where: { id: s.id }, data: { cancelAtPeriodEnd: false } });
}

/** Pause instead of cancel: the plan rests (Free limits apply) and the unused paid days come back after. */
export async function pauseSubscription(userId: string, months: number, now = new Date()) {
  const s = await db.subscription.findFirst({ where: { userId, status: "active", priceMinor: { gt: 0 }, currentPeriodEnd: { gt: now }, provider: { notIn: [...GIFT_PROVIDERS] } }, include: { plan: true }, orderBy: { createdAt: "desc" } });
  if (!s) throw new HttpError(404, "You don't have an active paid plan.", "NO_SUBSCRIPTION");
  if (isPaused(s, now)) throw new HttpError(409, "Your plan is already paused.", "ALREADY_PAUSED");
  const p = pausePlan(now, s.currentPeriodEnd, months);
  // 1096: a mandate would still charge on the old date, so pausing stops auto-renew (they can switch it back on after).
  await dropMandate(s); // 1098: also stops a replacement still waiting for approval
  await db.subscription.update({ where: { id: s.id }, data: { pausedUntil: p.pausedUntil, currentPeriodEnd: p.periodEnd, cancelAtPeriodEnd: false, autoRenew: false, providerSubId: null } });
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
  await expireGrants(userId ? { userId } : {});
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
    if (p.provider === "youpi") throw new HttpError(409, "UPI payments through YOUPI have no refund API. Send the money back by UPI from your bank app, then cancel the plan from the user's page.", "NO_REFUND_API");
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
  // succeeded -> refunded exactly once, however many requests arrive together (two tabs on "Refund my payment",
  // or an admin refunding while the customer does). The loser stops here: no second credit note, email or revoke.
  const [flip] = await db.$transaction([
    db.payment.updateMany({ where: { id: p.id, status: "succeeded" }, data: { status: "refunded", failureReason: `Refunded by ${by}${reason ? `: ${reason}` : ""} (${ref})`.slice(0, 300) } }),
    ...(p.subscriptionId ? [db.subscription.updateMany({ where: { id: p.subscriptionId, status: "active" }, data: { status: "canceled", canceledAt: new Date() } })] : []),
  ]);
  if (flip.count === 0) return;
  if (p.purpose === "topup") await refundTopUp(p.id); // 1096: what's left in the pack is gone
  if (p.subscriptionId) await dropMandates([p.subscriptionId]);
  await releaseCampaign(p.id); // 1122: a refunded offer payment is no longer a conversion, and its spot frees up
  // 1052: a refunded qualifying payment ends the friend's Refer & Earn month and disqualifies the referral.
  if (!p.sample && !(await revokeReferralForPayment(p.id, by))) await revokeReferralReward(p.userId, p.createdAt).catch((e) => console.error("[refund] referral revoke", e));
  // 1067: refunding the last real payment gives the founding seat back (never throws).
  if (!p.sample) await releaseUnpaidFounding(p.userId);
  // 1049: the refunded invoice gets its credit note straight away (the daily cron catches any that fail here).
  const credit = p.invoice ? await issueCreditNote(p.invoice.id, reason || null).catch((e) => (console.error("[refund] credit note", e), null)) : null;
  if (!p.sample) {
    const pdf = credit ? await creditNotePdf(credit.id).catch(() => null) : null;
    await sendEmail({
      to: p.user.email,
      kind: "subscription",
      subject: `Refund issued: ${formatMoney(p.amountMinor, p.currency)}`,
      html: templates.refund({ name: p.user.name, amount: formatMoney(p.amountMinor, p.currency), number: p.invoice?.number ?? "-", creditNote: credit?.number }),
      ...(credit && pdf ? { attachments: [{ filename: `${credit.number}.pdf`, content: pdf }] } : {}),
    });
    await adminEvent("refund", `Refunded ${p.user.name}`, `${formatMoney(p.amountMinor, p.currency)} by ${by}`, "/admin/payments?status=refunded");
  }
}

/**
 * 1052: the gateway reports money going back without us asking: a refund made in its dashboard, or a
 * chargeback/dispute. Either way the friend's Refer & Earn month ends and the referral is disqualified.
 * A full refund also marks the payment refunded and ends the plan it paid for, like refundPayment (the
 * daily credit-note cron issues the note). A dispute leaves the payment alone (it can still be won).
 * Safe to repeat: webhooks retry, and an admin refund from here triggers the same event afterwards.
 */
export async function markExternalRefund(paymentId: string, kind: "refund" | "chargeback", detail = "") {
  const p = await db.payment.findUnique({ where: { id: paymentId }, include: { user: { select: { name: true } } } });
  if (!p || p.sample) return false;
  let refunded = false;
  if (kind === "refund" && p.status === "succeeded") {
    const won = await db.payment.updateMany({ where: { id: p.id, status: "succeeded" }, data: { status: "refunded", failureReason: `Refunded at ${p.provider}${detail ? `: ${detail}` : ""}`.slice(0, 300) } });
    refunded = won.count === 1;
    if (refunded && p.subscriptionId) await db.subscription.updateMany({ where: { id: p.subscriptionId, status: "active" }, data: { status: "canceled", canceledAt: new Date() } });
    if (refunded && p.purpose === "topup") await refundTopUp(p.id);
    if (refunded && p.subscriptionId) await dropMandates([p.subscriptionId]);
  }
  // 1122: a refund or an open dispute is not a confirmed payment: the conversion and the offer spot come back off.
  if (refunded || kind === "chargeback") await releaseCampaign(p.id);
  const revoked = await revokeReferralForPayment(p.id, "system", kind);
  if (refunded && !revoked) await revokeReferralReward(p.userId, p.createdAt).catch((e) => console.error("[refund] referral revoke", e));
  if (refunded) await releaseUnpaidFounding(p.userId);
  if (refunded || kind === "chargeback") {
    const amount = formatMoney(p.amountMinor, p.currency);
    await adminEvent("refund", kind === "chargeback" ? `Chargeback opened: ${p.user.name}` : `Refunded at ${p.provider}: ${p.user.name}`, `${amount}${revoked ? ", Refer & Earn month ended" : ""}`, "/admin/payments?status=refunded").catch(() => {});
  }
  return refunded || revoked;
}

/**
 * Before 1052 the SHARER earned the month. A refunded first payment of a friend who joined then still takes
 * that month back (only when there is no Refer & Earn row for them, so new referrals never reach this).
 * A refunded FIRST payment must not leave the referrer's free month behind (otherwise: refer yourself,
 * pay, get refunded, keep the month, repeat). Undo exactly what rewardReferrer granted: the gift
 * subscription, or the extra month on the referrer's paid plan.
 */
async function revokeReferralReward(userId: string, paidAt: Date) {
  const me = await db.user.findUnique({ where: { id: userId }, select: { referredById: true } });
  if (!me?.referredById) return;
  if (await db.referral.findUnique({ where: { referredId: userId }, select: { id: true } })) return; // a 1052 referral: the sharer earned nothing
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
