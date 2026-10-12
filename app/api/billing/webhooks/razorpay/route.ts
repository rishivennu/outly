import { type NextRequest } from "next/server";
import { db } from "@/lib/db";
import { json } from "@/lib/http";
import { getConfig } from "@/lib/settings";
import { razorpay } from "@/lib/billing/providers";
import { completePayment, failPayment } from "@/lib/billing/service";

/** Point Razorpay at {APP_URL}/api/billing/webhooks/razorpay (order.paid, payment.failed). */
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
  } catch (e) {
    console.error("[razorpay webhook]", e);
    return json({ error: "retry" }, { status: 500 });
  }
  return json({ received: true });
}
