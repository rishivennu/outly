import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { razorpay } from "@/lib/billing/providers";
import { completePayment, failPayment, markExternalRefund } from "@/lib/billing/service";

/**
 * Point Razorpay at {APP_URL}/api/billing/webhooks/razorpay with order.paid, payment.failed, refund.processed
 * and payment.dispute.created (the last two end a Refer & Earn month the payment earned).
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const cfg = await getConfig("payments");
  if (!razorpay.verifyWebhook(cfg.razorpay.webhookSecret, raw, req.headers.get("x-razorpay-signature"))) return json({ error: "bad signature" }, { status: 400 });
  const ev = JSON.parse(raw);
  const orderId = ev?.payload?.payment?.entity?.order_id ?? ev?.payload?.order?.entity?.id;
  const p = orderId ? await db.payment.findFirst({ where: { provider: "razorpay", providerRef: orderId } }) : null;
  try {
    if (p && ev.event === "order.paid") await completePayment(p.id);
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
