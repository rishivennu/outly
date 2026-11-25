import type { CostInput } from "./ledger";

/**
 * R1331 Costs Phase 4: Razorpay's cut of a payment. The payment entity Razorpay sends with `order.paid` and
 * `subscription.charged` carries `fee` (Razorpay's fee INCLUDING GST, minor units) and `tax` (the GST part of
 * that fee) once the payment is captured. The fee is booked as `reported` (the provider said the number) under
 * the `payments` category, attributed to the payer; the ref `razorpay:fee:<payment id>` makes webhook retries
 * harmless. Refunds never give the fee back, so nothing is reversed later.
 */
export type RazorpayFeeSource = { id?: unknown; fee?: unknown; tax?: unknown; amount?: unknown; currency?: unknown; method?: unknown };
export type FeeKind = "checkout" | "renewal";

export function razorpayFeeInput(pay: RazorpayFeeSource | null | undefined, userId: string | null, kind: FeeKind, at?: Date): CostInput | null {
  if (!pay || typeof pay.id !== "string" || !pay.id) return null;
  const fee = Number(pay.fee);
  if (!Number.isFinite(fee) || fee <= 0) return null; // not captured yet (fee comes with capture) or a free payment
  const tax = Number(pay.tax);
  const amount = Number(pay.amount);
  return {
    provider: "razorpay",
    category: "payments",
    feature: kind,
    userId,
    units: 1,
    unit: "payment",
    amountMinor: Math.round(fee),
    currency: typeof pay.currency === "string" && pay.currency ? pay.currency : "INR",
    source: "reported",
    ref: `razorpay:fee:${pay.id}`,
    at,
    meta: { tax: Number.isFinite(tax) ? Math.round(tax) : 0, amount: Number.isFinite(amount) ? Math.round(amount) : 0, method: typeof pay.method === "string" ? pay.method : "" },
  };
}
