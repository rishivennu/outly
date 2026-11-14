import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { clientIp, json } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { razorpay } from "@/lib/billing/providers";
import { completePayment, failPayment, markExternalRefund } from "@/lib/billing/service";
import { onRazorpaySubscription } from "@/lib/billing/autorenew";
import { notePaymentKey } from "@/lib/subscriptions/lifecycle";
import { paymentKeyFromRazorpay } from "@/lib/subscriptions/keys";
import { adminEvent } from "@/lib/admin/route";
import { formatMoney } from "@/lib/billing/money";
import { rateLimit } from "@/lib/rate-limit";

/**
 * Point Razorpay at {APP_URL}/api/billing/webhooks/razorpay with order.paid, payment.failed, refund.processed
 * and payment.dispute.created (the last two end a Refer & Earn month the payment earned).
 * 1096 auto-renew also needs subscription.authenticated, subscription.activated, subscription.charged,
 * subscription.cancelled, subscription.halted and subscription.completed.
 */
export async function POST(req: NextRequest) {
  // Razorpay retries anything it doesn't get a 2xx for, so refusing a flood here loses no event.
  if (!rateLimit(`rzp-hook:${clientIp(req)}`, 300, 60_000).ok) return json({ error: "slow down" }, { status: 429 });
  const raw = await req.text();
  if (raw.length > 256_000) return json({ error: "too large" }, { status: 413 });
  const cfg = await getConfig("payments");
  if (!razorpay.verifyWebhook(cfg.razorpay.webhookSecret, raw, req.headers.get("x-razorpay-signature"))) return json({ error: "bad signature" }, { status: 400 });
  let ev: any;
  try {
    ev = JSON.parse(raw);
  } catch {
    return json({ error: "bad body" }, { status: 400 });
  }
  if (typeof ev?.event === "string" && ev.event.startsWith("subscription.")) {
    try {
      await onRazorpaySubscription(ev);
    } catch (e) {
      console.error("[razorpay webhook] subscription", e);
      return json({ error: "retry" }, { status: 500 });
    }
    return json({ received: true });
  }
  const orderId = ev?.payload?.payment?.entity?.order_id ?? ev?.payload?.order?.entity?.id;
  let p = orderId ? await db.payment.findFirst({ where: { provider: "razorpay", providerRef: orderId } }) : null;
  // startCheckout reuses a pending payment but asks Razorpay for a fresh order, so an order paid in an older tab
  // is no longer the one on the payment row. The order's notes name that payment (Outlly set them when it created
  // the order, and the signature above proves this body is Razorpay's): honour it, but only for the same money.
  if (!p && orderId && ev.event === "order.paid") {
    const o = ev?.payload?.order?.entity ?? {};
    const noted = o?.notes?.paymentId ?? ev?.payload?.payment?.entity?.notes?.paymentId;
    const cand = typeof noted === "string" && noted ? await db.payment.findUnique({ where: { id: noted } }) : null;
    if (cand && cand.provider === "razorpay" && cand.amountMinor === Number(o.amount) && cand.currency === String(o.currency)) {
      // Settled already: a second order for the same payment was paid too, so the buyer was charged twice. Never silent.
      if (cand.status === "succeeded" || cand.status === "refunded") {
        await adminEvent("payment_review", `Refund a twice paid order: ${cand.id}`, `Razorpay order ${orderId} paid ${formatMoney(cand.amountMinor, cand.currency)} for a payment already settled as ${cand.providerRef}. Refund one of the two in Razorpay.`, "/admin/payments");
      } else p = cand;
    }
  }
  try {
    if (p && ev.event === "order.paid") await completePayment(p.id, orderId);
    // 1147: the card / UPI behind the payment joins the offer ledger as a one-way hash (never throws).
    if (p && ev.event === "order.paid") await notePaymentKey(p.userId, paymentKeyFromRazorpay(ev?.payload?.payment?.entity));
    if (p && ev.event === "payment.failed") await failPayment(p.id, ev?.payload?.payment?.entity?.error_description ?? "Payment failed");
    if (p && ev.event === "refund.processed") {
      const pay = ev?.payload?.payment?.entity ?? {};
      // Only a full refund ends the plan; a partial one (a goodwill credit) changes nothing here.
      if (pay.refund_status === "full" || (pay.amount && pay.amount_refunded >= pay.amount)) await markExternalRefund(p.id, "refund", ev?.payload?.refund?.entity?.id ?? "");
    }
    if (p && ev.event === "payment.dispute.created") await markExternalRefund(p.id, "chargeback", ev?.payload?.dispute?.entity?.reason_code ?? "");
  } catch (e) {
    console.error("[razorpay webhook]", e);
    return json({ error: "retry" }, { status: 500 });
  }
  return json({ received: true });
}
