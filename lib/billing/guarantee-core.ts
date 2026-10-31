/**
 * The 30-day money-back guarantee (1076). Client-safe rules, no database: the billing page, the refund route
 * and the tests all use these.
 *
 * - Covers the FIRST payment an account makes, for 30 days from when it went through.
 * - One refund per account: any refunded payment (by you, by an admin, or at the gateway) uses it up.
 * - Only while that first payment is the only one: after a renewal or an upgrade, a person looks at it.
 * - UPI payments through YOUPI have no refund API, so those go to the support queue (still guaranteed).
 */
export const GUARANTEE_DAYS = 30;
const DAY = 86_400_000;

export type GuaranteePayment = { id: string; status: string; provider: string; amountMinor: number; currency: string; createdAt: Date; sample?: boolean };

export type RefundWindow =
  | { state: "eligible"; paymentId: string; amountMinor: number; currency: string; until: Date; daysLeft: number; manual: boolean }
  | { state: "none" | "used" | "expired" | "renewed" };

export function refundWindow(payments: readonly GuaranteePayment[], now = new Date()): RefundWindow {
  const real = payments.filter((p) => !p.sample && (p.status === "succeeded" || p.status === "refunded")).sort((a, b) => +a.createdAt - +b.createdAt);
  if (!real.length) return { state: "none" };
  if (real.some((p) => p.status === "refunded")) return { state: "used" };
  if (real.length > 1) return { state: "renewed" };
  const first = real[0];
  const until = new Date(+first.createdAt + GUARANTEE_DAYS * DAY);
  if (+now >= +until) return { state: "expired" };
  return {
    state: "eligible",
    paymentId: first.id,
    amountMinor: first.amountMinor,
    currency: first.currency,
    until,
    daysLeft: Math.max(1, Math.ceil((+until - +now) / DAY)),
    manual: first.provider === "youpi",
  };
}

/** The one line every pricing card, checkout button and billing page shows. */
export const GUARANTEE_LINE = `${GUARANTEE_DAYS}-day money-back guarantee`;
export const GUARANTEE_DETAIL = `Not for you? Refund your first payment yourself from Billing within ${GUARANTEE_DAYS} days. No questions, one per account.`;
