import "server-only";
import { db } from "../db";
import { HttpError } from "../http";
import { formatMoney } from "./money";
import { refundPayment } from "./service";
import { raiseTicket } from "../support/tickets";
import { adminEvent } from "../admin/route";
import { refundWindow, type RefundWindow } from "./guarantee-core";

/** Where this account stands on the 30-day guarantee (1076). */
export async function refundStatus(userId: string): Promise<RefundWindow> {
  const payments = await db.payment.findMany({
    where: { userId, status: { in: ["succeeded", "refunded"] } },
    select: { id: true, status: true, provider: true, amountMinor: true, currency: true, createdAt: true, sample: true },
  });
  return refundWindow(payments);
}

/**
 * The customer presses "Refund my payment". Card, PayPal and Razorpay money goes back at once through
 * refundPayment (which also ends the plan, issues the credit note, emails them and takes back referral
 * and founding perks). YOUPI has no refund API, so it becomes an urgent ticket for the owner to pay back by UPI.
 */
export async function selfRefund(user: { id: string; email: string; name: string | null }, reason: string): Promise<{ done: "refunded" | "queued"; ticket?: string }> {
  const w = await refundStatus(user.id);
  if (w.state !== "eligible") {
    const why = {
      none: "There's no payment on this account to refund.",
      used: "This account has already had its refund.",
      expired: "The 30 days for a self-serve refund have passed. Ask support and a person will look at it.",
      renewed: "Your plan has renewed or changed since your first payment, so a person needs to look at this. Ask support.",
    } as const;
    throw new HttpError(409, why[w.state], "NOT_REFUNDABLE");
  }
  const note = reason.trim().slice(0, 300);
  if (w.manual) {
    const amount = formatMoney(w.amountMinor, w.currency);
    const { ticket } = await raiseTicket({
      email: user.email,
      name: user.name,
      userId: user.id,
      reason: "form",
      transcript: [{ role: "user", text: `30-day guarantee refund request: ${amount} paid by UPI (payment ${w.paymentId}). Please send it back by UPI and cancel the plan.${note ? ` Reason: ${note}` : ""}` }],
    });
    await adminEvent("refund", `Guarantee refund requested: ${user.name ?? user.email}`, `${amount} by UPI, pay back from your bank app`, `/admin/tickets/${ticket.id}`);
    return { done: "queued", ticket: ticket.ref };
  }
  await refundPayment(w.paymentId, "the customer (30-day guarantee)", note);
  return { done: "refunded" };
}
