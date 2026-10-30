/**
 * Payment receipts (1053), client-safe. A receipt is only ever built from the payment row in OUR database,
 * after the gateway was asked server to server; a return URL alone never produces a "Paid" slip.
 */
export type ReceiptState = "paid" | "pending" | "failed" | "cancelled";
export type Receipt = {
  paymentId: string;
  state: ReceiptState;
  amountMinor: number;
  currency: string;
  planName: string;
  interval: "month" | "year";
  provider: string;
  invoice: string | null;
  at: string;
  reason: string | null;
};

/** DB status to what the slip shows. Refunds are not a checkout outcome, so they get no slip. */
export function receiptState(status: string, cancelled = false): ReceiptState | null {
  if (status === "succeeded") return "paid";
  if (status === "pending") return cancelled ? "cancelled" : "pending";
  if (status === "failed") return cancelled ? "cancelled" : "failed";
  return null;
}

/** Final states animate once per payment and outcome; a refresh, back button or second tab shows the quiet version. */
export const receiptKey = (r: Pick<Receipt, "paymentId" | "state">) => `outlly-receipt:${r.paymentId}:${r.state}`;
export const isFinal = (s: ReceiptState) => s !== "pending";
