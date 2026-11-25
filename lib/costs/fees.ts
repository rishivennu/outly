import "server-only";
import { recordCostEvent } from "./ledger";
import { razorpayFeeInput, type FeeKind, type RazorpayFeeSource } from "./fees-core";

/** R1331: books Razorpay's fee for a captured payment into the cost ledger. Idempotent on the payment id; never throws. */
export async function bookRazorpayFee(pay: RazorpayFeeSource | null | undefined, userId: string | null, kind: FeeKind) {
  const input = razorpayFeeInput(pay, userId, kind);
  return input ? recordCostEvent(input) : null;
}
