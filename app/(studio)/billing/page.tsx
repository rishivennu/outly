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
import { captionUsage, postUsage, replyUsage, uploadLimitBytes } from "@/lib/billing/entitlements";
import { betaConfig, myBetaCode } from "@/lib/beta";

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

export default async function BillingPage({ searchParams }: { searchParams: { checkout?: string; session_id?: string; token?: string; p?: string; plan?: string; paid?: string; cycle?: string } }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login?next=/billing");
  if (user.actor) redirect("/home"); // billing belongs to the workspace owner
  await expireSubscriptions(user.id);

  let notice: ReturnNotice | null = null;
  if (searchParams.checkout === "return" && searchParams.session_id) notice = await handleStripeReturn(user.id, searchParams.session_id);
  else if (searchParams.checkout === "paypal" && searchParams.token) notice = await handlePaypalReturn(user.id, searchParams.token);
  else if (searchParams.checkout === "youpi" && searchParams.p) notice = await handleYoupiReturn(user.id, searchParams.p.slice(0, 64));
  else if (searchParams.checkout === "cancelled") {
    // PayPal's cancel URL carries the order id; Stripe's doesn't, so take the latest pending redirect checkout.
    const pending = await db.payment.findFirst({
      where: { userId: user.id, status: "pending", ...(searchParams.token ? { provider: "paypal", providerRef: searchParams.token } : { provider: { in: ["stripe", "paypal"] } }) },
      orderBy: { createdAt: "desc" },
    });
    if (pending) await failPayment(pending.id, "Customer left checkout");
    notice = { tone: "info", text: "Checkout cancelled. You weren't charged." };
  } else if (searchParams.paid) notice = { tone: "ok", text: `Payment received. Invoice ${searchParams.paid} is below and on its way to ${user.email}.` };

  const [plans, sub, invoices, gw, usage, display, replies, captions, upload, beta, betaCfg] = await Promise.all([
    listPlans(),
    db.subscription.findFirst({ where: { userId: user.id, status: "active" }, include: { plan: true }, orderBy: { createdAt: "desc" } }),
    db.invoice.findMany({ where: { userId: user.id }, orderBy: { issuedAt: "desc" }, take: 50, include: { payment: { select: { status: true } } } }),
    activeGateway(),
    postUsage(user.id),
    getConfig("pricing").then(normalizeDisplay),
    replyUsage(user.id),
    captionUsage(user.id),
    uploadLimitBytes(user.id),
    myBetaCode(user.id),
    betaConfig(),
  ]);
  // The redeem box shows to members holding a code, and to everyone while the beta is on (codes made by hand).
  const betaPlanName = (slug: string) => plans.find((p) => p.slug === slug)?.name ?? "Creator";
  const betaOffer = beta.redeemed
    ? null
    : beta.code
      ? { code: { code: beta.code.code, months: beta.code.months, planName: betaPlanName(beta.code.planSlug) }, redeemed: false }
      : betaCfg.enabled
        ? { code: null, redeemed: false }
        : null;

  const visitor = visitorCurrency((plans.find((p) => p.priceMinor > 0)?.currency as any) ?? "INR");
  // Price each card in what the gateway will actually charge; if that isn't the visitor's currency, show their amount as a hint.
  const priced = plans.map((p) => {
    const lp = localPrice(p, chargeCurrency(gw.provider, visitor.currency, p.currency));
    const approx = lp.currency !== visitor.currency && p.priceMinor > 0 ? localPrice(p, visitor.currency) : null;
    // Yearly: same rules, so the number on the card is exactly what checkout charges.
    let year: { priceMinor: number; currency: string; approx: string | null; save: number } | null = null;
    if (hasYearly(p, display.yearly)) {
      const ly = priceFor(p, lp.currency, "year", display.freeMonths);
      const ay = approx ? priceFor(p, visitor.currency, "year", display.freeMonths) : null;
      year = { priceMinor: ly.priceMinor, currency: ly.currency, approx: ay ? `about ${formatMoney(ay.priceMinor, ay.currency)}` : null, save: yearlySaving(lp.priceMinor, ly.priceMinor) };
    }
    return { ...p, priceMinor: lp.priceMinor, currency: lp.currency, approx: approx ? `about ${formatMoney(approx.priceMinor, approx.currency)}` : null, year };
  });

  return (
    <BillingView
      email={user.email}
      notice={notice}
      focusPlan={searchParams.plan ?? null}
      cycle={searchParams.cycle === "year" ? "year" : "month"}
      gateway={gw.provider}
      // Customers never see a test badge on the live site; it only shows on the local dev server.
      testMode={process.env.NODE_ENV !== "production" && (gw.provider === "mock" || gw.cfg.mode === "test")}
      plans={priced}
      currency={visitor.currency}
      currencySource={visitor.source}
      canPickCurrency={gw.provider !== "razorpay"}
      current={sub ? { planSlug: sub.plan.slug, planName: sub.plan.name, priceMinor: sub.priceMinor, currency: sub.currency, interval: sub.interval, periodEnd: sub.currentPeriodEnd.toISOString(), cancelAtPeriodEnd: sub.cancelAtPeriodEnd, pausedUntil: sub.pausedUntil && sub.pausedUntil > new Date() ? sub.pausedUntil.toISOString() : null, provider: sub.provider } : null}
      beta={betaOffer}
      usage={{
        used: usage.used, limit: usage.postLimit, seats: usage.seats, aiCaptions: usage.aiCaptions, period: usage.postPeriod,
        maxUploadMb: upload.planLimited ? upload.mb : 0,
        replies: { limit: replies.replyLimit, used: replies.used },
        captions: { limit: captions.captionVideos, used: captions.used, burn: captions.burnCaptions },
      }}
      invoices={invoices.map((i) => ({ number: i.number, description: i.description, amountMinor: i.amountMinor, currency: i.currency, issuedAt: i.issuedAt.toISOString(), refunded: i.payment?.status === "refunded" }))}
    />
  );
}
