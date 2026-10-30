import { db } from "@/lib/db";
import { receiptState, type Receipt } from "./receipt-core";

/** The receipt for one of this person's payments, straight from the database (null if it isn't theirs). */
export async function paymentReceipt(userId: string, paymentId: string, opts: { cancelled?: boolean } = {}): Promise<Receipt | null> {
  const p = await db.payment.findFirst({ where: { id: paymentId, userId }, include: { invoice: { select: { number: true } } } });
  if (!p) return null;
  const state = receiptState(p.status, opts.cancelled);
  if (!state) return null;
  const plan = p.planId ? await db.plan.findUnique({ where: { id: p.planId }, select: { name: true } }) : null;
  return {
    paymentId: p.id,
    state,
    amountMinor: p.amountMinor,
    currency: p.currency,
    planName: plan?.name ?? "Outlly plan",
    interval: p.interval === "year" ? "year" : "month",
    provider: p.provider,
    invoice: p.invoice?.number ?? null,
    at: (state === "paid" ? p.updatedAt : p.createdAt).toISOString(),
    reason: state === "failed" ? p.failureReason : null,
  };
}
