/**
 * 1098 Billing & Subscription page: the status pill, the account meter and the payment-method line.
 * Pure and client-safe, so the page, the API and the tests all read the same rules.
 */
import { isMultiAccount, platformName } from "./plan-rules";

export type SubView = {
  planSlug: string;
  planName: string;
  priceMinor: number;
  currency: string;
  interval: string;
  periodEnd: string;
  cancelAtPeriodEnd: boolean;
  pausedUntil: string | null;
  provider: string;
  autoRenew: boolean;
  /** Beta code or referral month: free, nothing to renew or cancel. */
  gift: boolean;
};
export type EndedSub = { planName: string; endedAt: string; autoRenew: boolean };
export type GrantView = { planName: string; endsAt: string };

export type StatusKey = "active" | "cancelled" | "paused" | "expired" | "renewing" | "gift" | "free";
export type StatusTone = "ok" | "warn" | "info" | "bad" | "muted";
export type BillingStatus = { key: StatusKey; label: string; tone: StatusTone; date: string | null; dateLabel: string | null };

/** A renewal charge lands at the period end; the gateway's webhook can trail it. This long, we say "processing". */
export const RENEWAL_GRACE_MS = 3 * 86_400_000;

/**
 * One word for where the subscription stands. Outlly has no trial: a beta code, referral month or admin grant
 * is "Free access". A paid period that ran out (status still active, end in the past) is "Expired".
 */
export function billingStatus(a: { current: SubView | null; grant?: GrantView | null; ended?: EndedSub | null }, now = new Date()): BillingStatus {
  const c = a.current;
  if (c && !c.gift) {
    if (c.pausedUntil && new Date(c.pausedUntil) > now) return { key: "paused", label: "Paused", tone: "warn", date: c.pausedUntil, dateLabel: "Resumes" };
    if (c.cancelAtPeriodEnd) return { key: "cancelled", label: "Cancelled", tone: "warn", date: c.periodEnd, dateLabel: "Ends" };
    return { key: "active", label: "Active", tone: "ok", date: c.periodEnd, dateLabel: c.autoRenew ? "Renews" : "Paid through" };
  }
  if (c) return { key: "gift", label: "Free access", tone: "info", date: c.periodEnd, dateLabel: "Until" };
  if (a.grant) return { key: "gift", label: "Free access", tone: "info", date: a.grant.endsAt, dateLabel: "Until" };
  if (a.ended) {
    const since = now.getTime() - new Date(a.ended.endedAt).getTime();
    if (a.ended.autoRenew && since >= 0 && since < RENEWAL_GRACE_MS) return { key: "renewing", label: "Renewal processing", tone: "info", date: a.ended.endedAt, dateLabel: "Due" };
    return { key: "expired", label: "Expired", tone: "bad", date: a.ended.endedAt, dateLabel: "Ended" };
  }
  return { key: "free", label: "Free", tone: "muted", date: null, dateLabel: null };
}

/** The next automatic charge, or null when nothing will be charged on its own. */
export function nextCharge(c: SubView | null, now = new Date()): string | null {
  if (!c || c.gift || !c.autoRenew || c.cancelAtPeriodEnd) return null;
  if (c.pausedUntil && new Date(c.pausedUntil) > now) return null;
  return c.periodEnd;
}

/** The subscription this page manages: a paid one still in its period beats a gift; a lapsed one is not "current". */
export function pickCurrent<S extends { priceMinor: number; provider: string; sample?: boolean; currentPeriodEnd: Date; pausedUntil?: Date | null }>(subs: S[], isPaid: (s: S) => boolean, now = new Date()): S | null {
  const live = subs.filter((s) => s.currentPeriodEnd > now || (s.pausedUntil && s.pausedUntil > now));
  return live.find(isPaid) ?? live[0] ?? null;
}

export type AccountLimits = { platformLimit: number; brandLimit: number; extraBrands: number; accountLimit: number };
export type AccountMeter = { used: number; limit: number; platforms: string[]; platformLimit: number; perPlatform: number | null; note: string };

/**
 * Connected accounts against the plan, in the same terms the connect flow enforces (lib/accounts.ts):
 * a total cap (accountLimit), or platforms x brands, or one account per platform. limit 0 = no total cap.
 */
export function accountMeter(e: AccountLimits, accounts: { platform: string }[]): AccountMeter {
  const platforms = [...new Set(accounts.map((a) => a.platform))];
  const multi = isMultiAccount(e);
  const perPlatform = e.brandLimit > 0 ? e.brandLimit + e.extraBrands : multi ? null : 1;
  let limit = 0;
  if (multi && e.accountLimit > 0) limit = e.accountLimit;
  else if (e.platformLimit > 0 && perPlatform) limit = e.platformLimit * perPlatform;
  const bits: string[] = [];
  if (e.platformLimit > 0) bits.push(`${platforms.length} of ${e.platformLimit} platforms`);
  else if (platforms.length) bits.push(platforms.map(platformName).join(", "));
  if (perPlatform === 1) bits.push("one account per platform");
  else if (perPlatform) bits.push(`up to ${perPlatform} per platform`);
  return { used: accounts.length, limit, platforms, platformLimit: e.platformLimit, perPlatform, note: bits.join(" · ") || "No accounts connected yet" };
}

export type MethodKind = "card" | "upi" | "netbanking" | "wallet" | "emi" | "paylater" | "other";
export type MethodView = { kind: MethodKind; label: string };

const NETWORK: Record<string, string> = { visa: "Visa", mastercard: "Mastercard", "american express": "Amex", amex: "Amex", rupay: "RuPay", maestro: "Maestro", "diners club": "Diners", dinersclub: "Diners", discover: "Discover", jcb: "JCB", unknown: "Card" };
const GATEWAY: Record<string, string> = { razorpay: "Razorpay", stripe: "Stripe", paypal: "PayPal", youpi: "UPI", mock: "Test checkout" };
export const gatewayName = (p: string) => GATEWAY[p] ?? (p ? p.charAt(0).toUpperCase() + p.slice(1) : "Checkout");

/**
 * A Razorpay payment entity as one line ("Visa •••• 4242", "UPI · you@okhdfc"). Only what Razorpay returns
 * is shown; Outlly never sees or stores a full card number.
 */
export function describeRazorpayMethod(p: { method?: string; card?: { network?: string; last4?: string; type?: string } | null; vpa?: string | null; upi?: { vpa?: string } | null; bank?: string | null; wallet?: string | null } | null): MethodView | null {
  if (!p?.method) return null;
  const m = p.method;
  if (m === "card") {
    const net = NETWORK[(p.card?.network ?? "").toLowerCase()] ?? (p.card?.network || "Card");
    const kind = p.card?.type === "debit" ? " debit" : p.card?.type === "credit" ? " credit" : "";
    return { kind: "card", label: p.card?.last4 ? `${net}${kind} •••• ${p.card.last4}` : `${net}${kind} card` };
  }
  if (m === "upi") {
    const vpa = p.upi?.vpa ?? p.vpa ?? null;
    return { kind: "upi", label: vpa ? `UPI · ${vpa}` : "UPI" };
  }
  if (m === "netbanking") return { kind: "netbanking", label: p.bank ? `Netbanking · ${p.bank}` : "Netbanking" };
  if (m === "wallet") return { kind: "wallet", label: p.wallet ? `Wallet · ${p.wallet.charAt(0).toUpperCase()}${p.wallet.slice(1)}` : "Wallet" };
  if (m === "emi") return { kind: "emi", label: p.card?.last4 ? `Card EMI •••• ${p.card.last4}` : "Card EMI" };
  if (m === "paylater") return { kind: "paylater", label: "Pay later" };
  return { kind: "other", label: m.charAt(0).toUpperCase() + m.slice(1) };
}

export type MandateState = "active" | "pending" | "attention";
/**
 * 1098: a mandate's state from Razorpay's subscription status. created = the customer hasn't approved it;
 * authenticated / active = approved; pending (a charge failed, Razorpay is retrying), halted, paused,
 * cancelled, completed, expired = needs the customer.
 * No answer (lookup failed, test gateway): our own flag, which only turns on after approval.
 */
export function mandateState(status: string | null | undefined, autoRenew: boolean): MandateState {
  if (status === "created") return "pending";
  if (status === "authenticated" || status === "active") return "active";
  if (status) return "attention";
  return autoRenew ? "active" : "pending";
}

/** Razorpay names the mandate's instrument on the subscription entity. */
export function mandateLabel(paymentMethod: string | null | undefined): string {
  if (paymentMethod === "card") return "Card mandate";
  if (paymentMethod === "upi") return "UPI Autopay";
  if (paymentMethod === "emandate" || paymentMethod === "nach") return "Bank mandate";
  return "Autopay mandate";
}

export type HistoryStatus = "paid" | "refunded" | "failed" | "pending";
/**
 * A payment with no invoice is listed only when it tells the customer something: a real failure, or a UPI
 * payment we're still matching with the bank. A checkout someone closed is not a payment and stays out.
 */
export function showUninvoiced(p: { status: string; provider: string; failureReason: string | null; createdAt: Date }, now = new Date()) {
  const age = now.getTime() - p.createdAt.getTime();
  if (p.status === "failed") return age < 60 * 86_400_000 && p.failureReason !== "Customer left checkout";
  if (p.status === "pending") return p.provider === "youpi" && age < 2 * 86_400_000;
  return false;
}

/** One usage tile. limit 0 = unlimited (no bar); `locked` = not on this plan at all. */
export type MeterView = { key: string; label: string; used: number; limit: number; extra?: number; unit: string; display?: string; note?: string | null; locked?: boolean; href?: string };
export type MeterTone = "ok" | "warn" | "bad" | "none";

export const meterPct = (used: number, limit: number, extra = 0) => (limit > 0 ? Math.min(100, Math.round((used / (limit + extra)) * 100)) : 0);
/** Lime under 80%, amber from 80%, red when the allowance (plus any top-up) is used up. */
export function meterTone(used: number, limit: number, extra = 0): MeterTone {
  if (limit <= 0) return "none";
  const cap = limit + extra;
  if (used >= cap) return "bad";
  return used / cap >= 0.8 ? "warn" : "ok";
}
/** "12 of 30 posts", "12 posts · unlimited", or the tile's own wording (storage). */
export function meterText(m: MeterView): string {
  if (m.display) return m.display;
  if (m.locked) return "Not included";
  if (m.limit <= 0) return `${m.used} ${m.unit}${m.key === "scheduled" ? "" : " · unlimited"}`;
  return `${m.used} of ${m.limit}${m.extra ? ` + ${m.extra}` : ""} ${m.unit}`;
}

export type HistoryRow = {
  id: string;
  number: string | null;
  date: string;
  plan: string;
  amountMinor: number;
  currency: string;
  status: HistoryStatus;
  creditNote: string | null;
  note: string | null;
};

type PlanRef = { id: string; name: string };
/** "Creator · Monthly", "Creator renewal", "Top-up": what a payment was for, in words. */
export function paymentFor(p: { planId: string | null; interval: string; purpose: string } | null, plans: PlanRef[], fallback: string): string {
  if (!p) return fallback;
  if (p.purpose === "topup") return "Top-up";
  const name = plans.find((x) => x.id === p.planId)?.name;
  if (!name) return fallback;
  if (p.purpose === "renewal") return `${name} renewal`;
  return `${name} · ${p.interval === "year" ? "Yearly" : "Monthly"}`;
}

/**
 * Billing history: every invoice, plus the payments without one that are worth knowing about (showUninvoiced),
 * newest first. A refunded invoice stays listed with its credit note.
 */
export function historyRows(
  invoices: { number: string; description: string; amountMinor: number; currency: string; issuedAt: Date; creditNote: string | null; payment: { status: string; planId: string | null; interval: string; purpose: string } | null }[],
  payments: { id: string; status: string; provider: string; failureReason: string | null; createdAt: Date; amountMinor: number; currency: string; planId: string | null; interval: string; purpose: string }[],
  plans: PlanRef[],
  now = new Date(),
): HistoryRow[] {
  const rows: HistoryRow[] = invoices.map((i) => ({
    id: i.number, number: i.number, date: i.issuedAt.toISOString(), plan: paymentFor(i.payment, plans, i.description), amountMinor: i.amountMinor, currency: i.currency,
    status: i.payment?.status === "refunded" ? "refunded" : "paid", creditNote: i.creditNote, note: null,
  }));
  for (const p of payments) {
    if (!showUninvoiced(p, now)) continue;
    rows.push({
      id: p.id, number: null, date: p.createdAt.toISOString(), plan: paymentFor(p, plans, "Payment"), amountMinor: p.amountMinor, currency: p.currency,
      status: p.status === "failed" ? "failed" : "pending", creditNote: null,
      note: p.status === "failed" ? (p.failureReason ? `${p.failureReason}. You weren't charged.` : "Didn't go through. You weren't charged.") : "Matching your UPI payment with the bank.",
    });
  }
  return rows.sort((a, b) => b.date.localeCompare(a.date));
}

export const HISTORY_LABEL: Record<HistoryStatus, string> = { paid: "Paid", refunded: "Refunded", failed: "Failed", pending: "Pending" };
export const cycleLabel = (interval: string | null | undefined, priceMinor: number) => (priceMinor <= 0 ? "Free" : interval === "year" ? "Yearly" : "Monthly");
