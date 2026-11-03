import { getCurrentUser } from "@/lib/auth";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { listPlans } from "@/lib/billing/plans";
import { visitorCurrency } from "@/lib/billing/visitor";
import { chargeCurrency, localPrice } from "@/lib/billing/currency";
import { hasYearly, priceFor, yearlySaving } from "@/lib/billing/cycle";
import { normalizeDisplay } from "@/lib/billing/display";
import { formatMoney } from "@/lib/billing/money";
import { stripe } from "@/lib/billing/providers";
import { activeGateway, capturePaypal, completePayment, confirmYoupi, expireSubscriptions, failPayment } from "@/lib/billing/service";
import { BillingView, type ReturnNotice } from "@/components/billing/BillingView";
import { paymentReceipt } from "@/lib/billing/receipt";
import type { Receipt } from "@/lib/billing/receipt-core";
import { captionUsage, entitlements, postUsage, replyUsage, storageUsage, uploadLimitBytes, xPostUsage } from "@/lib/billing/entitlements";
import { accountMeter, billingStatus, historyRows, nextCharge, pickCurrent, type MeterView, type SubView } from "@/lib/billing/overview-core";
import { accessFor } from "@/lib/billing/access";
import { GIFT_PROVIDERS, isGiftProvider, isPaidSub } from "@/lib/billing/access-core";
import { betaConfig, myBetaCode } from "@/lib/beta";
import { myFounding, foundingPrice } from "@/lib/founding";
import { trustBadges } from "@/lib/badges";
import { refundStatus } from "@/lib/billing/guarantee";
import { experimentPrice } from "@/lib/billing/experiments";
import { aiQuota } from "@/lib/ai-quota";

export const dynamic = "force-dynamic";
export const metadata = { title: "Billing" };

/** Stripe sends the customer back here. The webhook is the source of truth; this just makes the result instant. */
async function handleStripeReturn(userId: string, sessionId: string): Promise<ReturnNotice> {
  const p = await db.payment.findFirst({ where: { provider: "stripe", providerRef: sessionId, userId } });
  if (!p) return { tone: "error", text: "We couldn't match that checkout to your account. If you were charged, contact support." };
  if (p.status === "succeeded") return { tone: "ok", text: "Payment received. Your invoice is below." };
  try {
    const ses = await stripe.session(await getConfig("payments"), sessionId);
    if (ses.payment_status === "paid") {
      const { invoice } = await completePayment(p.id, sessionId);
      return { tone: "ok", text: `Payment received. Invoice ${invoice?.number ?? ""} is below and in your inbox.` };
    }
    return { tone: "info", text: "Your bank is still confirming the payment. This page updates as soon as it does." };
  } catch {
    return { tone: "info", text: "We're confirming your payment with Stripe. Refresh in a minute." };
  }
}

/** PayPal sends the buyer back with ?token={orderId}. The order is captured here (and by the webhook, whichever comes first). */
async function handlePaypalReturn(userId: string, orderId: string): Promise<ReturnNotice> {
  try {
    const r = await capturePaypal(orderId, userId);
    if (r.state === "paid") return { tone: "ok", text: `Payment received. Invoice ${r.invoice?.number ?? ""} is below and in your inbox.` };
    if (r.state === "pending") return { tone: "info", text: "PayPal is still confirming the payment. Your plan switches on as soon as it clears." };
    if (r.state === "failed") return { tone: "error", text: "PayPal declined the payment. You weren't charged. Try again or use another card." };
    return { tone: "error", text: "We couldn't match that checkout to your account. If you were charged, contact support." };
  } catch {
    return { tone: "info", text: "We're confirming your payment with PayPal. Refresh in a minute." };
  }
}

/** YOUPI sends the buyer back with ?p={our payment id}. We ask the gateway ourselves; the URL proves nothing. */
async function handleYoupiReturn(userId: string, paymentId: string): Promise<ReturnNotice> {
  try {
    const r = await confirmYoupi(paymentId, userId);
    if (r.state === "paid") return { tone: "ok", text: `Payment received. Invoice ${r.invoice?.number ?? ""} is below and in your inbox.` };
    if (r.state === "pending") return { tone: "info", text: "We're matching your UPI payment with the bank alert. This usually takes under a minute. Refresh to check." };
    if (r.state === "failed") return { tone: "error", text: "That UPI payment didn't go through or timed out. If money left your account, contact support with the UTR from your UPI app." };
    if (r.state === "mismatch") return { tone: "error", text: "We received a payment we couldn't match to this plan. Our team will check it by hand and get back to you. You don't need to pay again." };
    return { tone: "error", text: "We couldn't match that checkout to your account. If you were charged, contact support." };
  } catch {
    return { tone: "info", text: "We're confirming your UPI payment with the gateway. Refresh in a minute." };
  }
}

type Sp = { checkout?: string; session_id?: string; token?: string; p?: string; plan?: string; paid?: string; cycle?: string; founding?: string };

/** The receipt slip for whatever checkout just came back (1053), read from our own payment row. */
async function receiptFor(userId: string, sp: Sp, cancelledId: string | null): Promise<Receipt | null> {
  if (cancelledId) return paymentReceipt(userId, cancelledId, { cancelled: true });
  let id: string | null = null;
  if (sp.checkout === "return" && sp.session_id) id = (await db.payment.findFirst({ where: { provider: "stripe", providerRef: sp.session_id, userId }, select: { id: true } }))?.id ?? null;
  else if (sp.checkout === "paypal" && sp.token) id = (await db.payment.findFirst({ where: { provider: "paypal", providerRef: sp.token, userId }, select: { id: true } }))?.id ?? null;
  else if (sp.checkout === "youpi" && sp.p) id = sp.p.slice(0, 64);
  else if (sp.paid) id = (await db.invoice.findFirst({ where: { number: sp.paid.slice(0, 40), userId }, select: { paymentId: true } }))?.paymentId ?? null;
  return id ? paymentReceipt(userId, id) : null;
}

export default async function BillingPage(props: { searchParams: Promise<Sp> }) {
  const searchParams = await props.searchParams;
  const user = await getCurrentUser();
  if (!user) redirect("/api/auth/expired?next=/billing");
  if (user.actor) redirect("/home"); // billing belongs to the workspace owner
  await expireSubscriptions(user.id);

  let notice: ReturnNotice | null = null;
  let cancelledId: string | null = null;
  if (searchParams.checkout === "return" && searchParams.session_id) notice = await handleStripeReturn(user.id, searchParams.session_id);
  else if (searchParams.checkout === "paypal" && searchParams.token) notice = await handlePaypalReturn(user.id, searchParams.token);
  else if (searchParams.checkout === "youpi" && searchParams.p) notice = await handleYoupiReturn(user.id, searchParams.p.slice(0, 64));
  else if (searchParams.checkout === "cancelled") {
    // PayPal's cancel URL carries the order id; Stripe's doesn't, so take the latest pending redirect checkout.
    const pending = await db.payment.findFirst({
      where: { userId: user.id, status: "pending", ...(searchParams.token ? { provider: "paypal", providerRef: searchParams.token } : { provider: { in: ["stripe", "paypal"] } }) },
      orderBy: { createdAt: "desc" },
    });
    if (pending) {
      await failPayment(pending.id, "Customer left checkout");
      cancelledId = pending.id;
    }
    notice = { tone: "info", text: "Checkout cancelled. You weren't charged." };
  } else if (searchParams.paid) notice = { tone: "ok", text: `Payment received. Invoice ${searchParams.paid} is below and on its way to ${user.email}.` };

  const receipt = await receiptFor(user.id, searchParams, cancelledId).catch(() => null);
  const now = new Date();
  const aiqP = aiQuota(user.id).catch(() => null); // 1112: runs alongside the batch below
  const [plans, subs, invoices, gw, usage, display, replies, captions, upload, beta, betaCfg, founding, badges, storage, access, refund, ent, x, accounts, scheduled, seatsTaken, loose, lastEnded] = await Promise.all([
    listPlans(),
    db.subscription.findMany({ where: { userId: user.id, status: "active" }, include: { plan: true }, orderBy: { createdAt: "desc" } }),
    db.invoice.findMany({ where: { userId: user.id }, orderBy: { issuedAt: "desc" }, take: 50, include: { payment: { select: { status: true, planId: true, interval: true, purpose: true } }, creditNote: { select: { number: true } } } }),
    activeGateway(),
    postUsage(user.id),
    getConfig("pricing").then(normalizeDisplay),
    replyUsage(user.id),
    captionUsage(user.id),
    uploadLimitBytes(user.id),
    myBetaCode(user.id),
    betaConfig(),
    myFounding(user.id),
    trustBadges(user.id),
    storageUsage(user.id),
    accessFor(user.id),
    refundStatus(user.id).catch(() => null),
    entitlements(user.id),
    xPostUsage(user.id),
    db.socialAccount.findMany({ where: { userId: user.id, status: { not: "disconnected" } }, select: { platform: true } }),
    db.post.count({ where: { userId: user.id, status: "scheduled" } }),
    db.teamMember.count({ where: { ownerId: user.id } }),
    // 1098: the plan that ended most recently, for "Expired"; after 60 days the page just says Free.
    // 1098: failed and UPI-pending payments have no invoice but belong in the history.
    db.payment.findMany({ where: { userId: user.id, status: { in: ["failed", "pending"] }, sample: false, invoice: null, createdAt: { gt: new Date(now.getTime() - 60 * 86_400_000) } }, orderBy: { createdAt: "desc" }, take: 20 }),
    db.subscription.findFirst({ where: { userId: user.id, priceMinor: { gt: 0 }, provider: { notIn: [...GIFT_PROVIDERS] }, currentPeriodEnd: { lte: now, gt: new Date(now.getTime() - 60 * 86_400_000) } }, include: { plan: true }, orderBy: { currentPeriodEnd: "desc" } }),
  ]);
  // The plan card is about money: a paid subscription wins over a gift month running alongside it.
  // 1098: only one still in its period counts; a lapsed one (no cancel, no renewal) shows as Expired instead.
  const sub = pickCurrent(subs, (s) => isPaidSub(s), now);
  const ended = !sub && lastEnded && !isGiftProvider(lastEnded.provider) ? { planName: lastEnded.plan.name, endedAt: lastEnded.currentPeriodEnd.toISOString(), autoRenew: lastEnded.autoRenew && lastEnded.status === "active" } : null;
  // Access granted by our team or earned through a referral, shown so the plan in force is never a mystery.
  const best = access.best;
  const extra = best && (best.source === "admin" || best.source === "referral") && best.endsAt
    ? { planName: best.plan.name, source: best.source, endsAt: best.endsAt.toISOString() }
    : null;
  // Founding members see the price checkout will really charge, with the list price struck through.
  // 1067: so does anyone a payment would seat (a spot is open for them), because checkout charges them that too.
  const fpct = founding && founding.kind !== "full" ? founding.pct : null;
  const off = (minor: number) => foundingPrice(minor, fpct);
  // The redeem box shows to members holding a code, and to everyone while the beta is on (codes made by hand).
  const betaPlanName = (slug: string) => plans.find((p) => p.slug === slug)?.name ?? "Creator";
  const betaOffer = beta.redeemed
    ? null
    : beta.code
      ? { code: { code: beta.code.code, months: beta.code.months, planName: betaPlanName(beta.code.planSlug) }, redeemed: false }
      : betaCfg.enabled
        ? { code: null, redeemed: false }
        : null;

  const visitor = await visitorCurrency((plans.find((p) => p.priceMinor > 0)?.currency as any) ?? "INR");
  // Price each card in what the gateway will actually charge; if that isn't the visitor's currency, show their amount as a hint.
  // 1096: someone in a price test sees the tested price here (this is the exposure), the same number checkout charges.
  const tests = await Promise.all(
    plans.map((p) => {
      const cur = chargeCurrency(gw.provider, visitor.currency, p.currency);
      return p.priceMinor > 0 && cur === p.currency ? experimentPrice(user.id, p.slug, cur).catch(() => null) : null;
    }),
  );
  const priced = plans.map((p0, i) => {
    const t = tests[i];
    // Same scaling as checkout: the monthly list price becomes the test price, yearly keeps its ratio.
    const p = t ? { ...p0, priceMinor: t.priceMinor, yearlyMinor: p0.yearlyMinor ? Math.round((p0.yearlyMinor * t.priceMinor) / p0.priceMinor) : 0 } : p0;
    const lp = localPrice(p, chargeCurrency(gw.provider, visitor.currency, p.currency));
    const approx = lp.currency !== visitor.currency && p.priceMinor > 0 ? localPrice(p, visitor.currency) : null;
    // Yearly: same rules, so the number on the card is exactly what checkout charges.
    let year: { priceMinor: number; currency: string; approx: string | null; save: number; was: number | null } | null = null;
    if (hasYearly(p, display.yearly)) {
      const ly = priceFor(p, lp.currency, "year", display.freeMonths);
      const ay = approx ? priceFor(p, visitor.currency, "year", display.freeMonths) : null;
      year = { priceMinor: off(ly.priceMinor), currency: ly.currency, approx: ay ? `about ${formatMoney(off(ay.priceMinor), ay.currency)}` : null, save: yearlySaving(lp.priceMinor, ly.priceMinor), was: fpct ? ly.priceMinor : null };
    }
    return { ...p, priceMinor: off(lp.priceMinor), currency: lp.currency, approx: approx ? `about ${formatMoney(off(approx.priceMinor), approx.currency)}` : null, year, was: fpct && lp.priceMinor > 0 ? lp.priceMinor : null };
  });

  const currentView: SubView | null = sub
    ? { planSlug: sub.plan.slug, planName: sub.plan.name, priceMinor: sub.priceMinor, currency: sub.currency, interval: sub.interval, periodEnd: sub.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: sub.cancelAtPeriodEnd, pausedUntil: sub.pausedUntil && sub.pausedUntil > now ? sub.pausedUntil.toISOString() : null, provider: sub.provider, autoRenew: sub.autoRenew, gift: !isPaidSub(sub) }
    : null;
  const status = billingStatus({ current: currentView, grant: extra ? { planName: extra.planName, endsAt: extra.endsAt } : null, ended }, now);

  // 1098: the usage grid, in the plan's own terms. Unlimited = no bar; not on the plan = "Not included".
  const acc = accountMeter(ent, accounts);
  const aiq = await aiqP;
  const meters: MeterView[] = [
    { key: "posts", label: usage.postPeriod === "week" ? "Posts this week" : "Posts this month", used: usage.used, limit: usage.postLimit, unit: "posts", href: "/content" },
    { key: "scheduled", label: "Scheduled posts", used: scheduled, limit: 0, unit: "in the queue", note: scheduled ? "Waiting to publish" : "Nothing queued", href: "/calendar" },
    ent.aiCaptions
      ? { key: "ai", label: "AI-captioned videos", used: captions.used, limit: captions.captionVideos, extra: captions.credits || undefined, unit: "videos", note: "This month" }
      : { key: "ai", label: "AI captions", used: 0, limit: 0, unit: "", locked: true, note: `Not on ${ent.planName}` },
    { key: "accounts", label: "Connected accounts", used: acc.used, limit: acc.limit, unit: "accounts", note: acc.note, href: "/accounts" },
    { key: "storage", label: "Storage", used: Math.round(storage.pct), limit: storage.limitBytes > 0 ? 100 : 0, unit: "%", display: storage.label, note: storage.over ? "Over: new uploads are paused" : null },
    ent.seats > 0
      ? { key: "seats", label: "Team seats", used: seatsTaken, limit: ent.seats, unit: "seats", note: ent.extraSeats ? `Includes ${ent.extraSeats} from a top-up` : null, href: "/settings#team" }
      : { key: "seats", label: "Team seats", used: 0, limit: 0, unit: "", locked: true, note: `Not on ${ent.planName}` },
    ...(ent.xPostLimit > 0 ? [{ key: "x", label: "Posts to X", used: x.used, limit: ent.xPostLimit, extra: x.credits || undefined, unit: "posts", note: "This month" }] : []),
    ...(ent.xPostLimit < 0 ? [{ key: "x", label: "Posts to X", used: 0, limit: 0, unit: "", locked: true, note: `Not on ${ent.planName}` }] : []),
    ...(aiq && aiq.monthLimit > 0 ? [{ key: "ai-requests", label: "AI requests", used: aiq.monthUsed, limit: aiq.monthLimit, unit: "requests", note: aiq.limit ? `This month, up to ${aiq.limit} a day` : "This month" }] : []),
    ...(replies.replyLimit > 0 ? [{ key: "replies", label: "Replies this week", used: replies.used, limit: replies.replyLimit, unit: "replies", href: "/inbox" }] : []),
  ];
  const history = historyRows(
    invoices.map((i) => ({ number: i.number, description: i.description, amountMinor: i.amountMinor, currency: i.currency, issuedAt: i.issuedAt, creditNote: i.creditNote?.number ?? null, payment: i.payment })),
    loose,
    plans,
    now,
  );

  return (
    <BillingView
      status={status}
      nextCharge={nextCharge(currentView, now)}
      meters={meters}
      history={history}
      ended={ended}
      email={user.email}
      notice={notice}
      receipt={receipt}
      focusPlan={searchParams.plan ?? null}
      cycle={searchParams.cycle === "year" ? "year" : "month"}
      gateway={gw.provider}
      // Customers never see a test badge on the live site; it only shows on the local dev server.
      testMode={process.env.NODE_ENV !== "production" && (gw.provider === "mock" || gw.cfg.mode === "test")}
      plans={priced}
      currency={visitor.currency}
      currencySource={visitor.source}
      current={sub ? { planSlug: sub.plan.slug, planName: sub.plan.name, priceMinor: sub.priceMinor, currency: sub.currency, interval: sub.interval, periodEnd: sub.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: sub.cancelAtPeriodEnd, pausedUntil: sub.pausedUntil && sub.pausedUntil > new Date() ? sub.pausedUntil.toISOString() : null, provider: sub.provider, autoRenew: sub.autoRenew } : null}
      beta={betaOffer}
      founding={founding}
      foundingStatus={searchParams.founding?.slice(0, 20) ?? null}
      badges={badges}
      access={extra}
      usage={{
        used: usage.used, limit: usage.postLimit, seats: usage.seats, aiCaptions: usage.aiCaptions, period: usage.postPeriod,
        maxUploadMb: upload.planLimited ? upload.mb : 0,
        replies: { limit: replies.replyLimit, used: replies.used },
        captions: { limit: captions.captionVideos, used: captions.used, burn: captions.burnCaptions },
        storage: { usedBytes: storage.usedBytes, limitBytes: storage.limitBytes, pct: storage.pct, over: storage.over, label: storage.label },
      }}
      guarantee={refund ? (refund.state === "eligible" ? { ...refund, until: refund.until.toISOString() } : { state: refund.state }) : undefined}
    />
  );
}
