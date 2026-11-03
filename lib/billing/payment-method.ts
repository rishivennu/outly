import "server-only";
import { db } from "../db";
import { getConfig } from "../settings";
import { formatMoney } from "./money";
import { razorpay } from "./providers";
import { GIFT_PROVIDERS } from "./access-core";
import { RENEWAL_GRACE_MS, describeRazorpayMethod, gatewayName, mandateLabel, mandateState, type MandateState, type MethodView } from "./overview-core";

export type PaymentMethodInfo = {
  /** The one payment method Outlly keeps: a Razorpay auto-renew mandate (card or UPI Autopay). */
  mandate: { state: MandateState; label: string; nextCharge: string | null; approveUrl: string | null; ended: boolean } | null;
  /** How the latest payment was made, read from the gateway. Nothing here is stored by Outlly. */
  last: { gateway: string; method: MethodView | null; at: string; amount: string } | null;
  /** Whether "Add" (turn on auto-renew) can work for this plan, and why not when it can't. */
  canAdd: boolean;
  addBlock: string | null;
  /** The gateway lookup failed: the card shows what we know and says the details couldn't load. */
  lookupFailed: boolean;
};

/**
 * 1098: the Billing page's payment method card. Read only. Razorpay is asked for the mandate's instrument and
 * the last payment's card / UPI / bank; any failure there degrades to the gateway's name, never an error page.
 */
export async function paymentMethodInfo(userId: string, now = new Date()): Promise<PaymentMethodInfo> {
  const [s, lastPay] = await Promise.all([
    // 1098: a plan inside the renewal grace still shows its mandate (the charge may be on its way).
    db.subscription.findFirst({
      where: { userId, status: "active", priceMinor: { gt: 0 }, provider: { notIn: [...GIFT_PROVIDERS] }, currentPeriodEnd: { gt: new Date(now.getTime() - RENEWAL_GRACE_MS) } },
      orderBy: { currentPeriodEnd: "desc" },
    }),
    db.payment.findFirst({ where: { userId, status: { in: ["succeeded", "refunded"] }, sample: false }, orderBy: { createdAt: "desc" } }),
  ]);
  const ended = !!s && s.currentPeriodEnd <= now;
  const paused = !!(s?.pausedUntil && s.pausedUntil > now);
  const isMock = !!s && (s.providerSubId?.startsWith("mock_sub_") || s.provider === "mock" || s.sample);
  const wantsSub = !!s?.providerSubId && !isMock;
  const wantsPay = lastPay?.provider === "razorpay" && !!lastPay.providerRef;
  let lookupFailed = false;
  const cfg = wantsSub || wantsPay ? await getConfig("payments").catch(() => null) : null;
  if ((wantsSub || wantsPay) && !cfg) lookupFailed = true;
  const fail = () => ((lookupFailed = true), null);
  const [rs, rp] = await Promise.all([
    wantsSub && cfg ? razorpay.fetchSubscription(cfg, s!.providerSubId!).catch(fail) : null,
    wantsPay && cfg ? razorpay.paymentFor(cfg, lastPay!.providerRef!).catch(fail) : null,
  ]);

  let mandate: PaymentMethodInfo["mandate"] = null;
  if (s?.providerSubId) {
    // Razorpay's own status decides (created = not approved yet, halted = stopped); without it, our flag does.
    const state = mandateState(rs?.status, s.autoRenew);
    mandate = {
      state,
      label: isMock ? "Test autopay" : mandateLabel(rs?.payment_method),
      nextCharge: state === "active" && s.autoRenew && !s.cancelAtPeriodEnd && !paused ? s.currentPeriodEnd.toISOString() : null,
      approveUrl: state === "pending" ? rs?.short_url ?? null : null,
      ended,
    };
  }

  let last: PaymentMethodInfo["last"] = null;
  if (lastPay) {
    const method: MethodView | null = lastPay.provider === "razorpay" ? describeRazorpayMethod(rp) : lastPay.provider === "youpi" ? { kind: "upi", label: "UPI" } : null;
    last = { gateway: gatewayName(lastPay.provider), method, at: lastPay.createdAt.toISOString(), amount: formatMoney(lastPay.amountMinor, lastPay.currency) };
  }

  let addBlock: string | null = null;
  if (!s) addBlock = "A saved payment method is for auto-renew on a paid plan. Choose a plan below first.";
  else if (ended) addBlock = "This plan's period has ended. Choose a plan below to continue.";
  else if (paused) addBlock = "Your plan is paused. Resume it to turn on auto-renew.";
  else if (s.cancelAtPeriodEnd) addBlock = "Your plan is set to end. Keep it to turn on auto-renew.";
  else if (!(s.provider === "razorpay" || s.provider === "mock" || s.sample)) addBlock = `This plan was paid through ${gatewayName(s.provider)}. Auto-renew works with cards and UPI Autopay through Razorpay, so we'll email you before it ends instead.`;
  return { mandate, last, canAdd: !!s && !addBlock && !s.autoRenew, addBlock: s?.autoRenew ? null : addBlock, lookupFailed };
}
