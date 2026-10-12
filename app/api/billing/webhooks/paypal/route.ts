import { type NextRequest } from "next/server";
import { json } from "@/lib/http";
import { db } from "@/lib/db";
import { getConfig } from "@/lib/settings";
import { paypal } from "@/lib/billing/providers";
import { capturePaypal, completePayment, failPayment } from "@/lib/billing/service";

export const dynamic = "force-dynamic";

/**
 * Point PayPal at {APP_URL}/api/billing/webhooks/paypal with CHECKOUT.ORDER.APPROVED,
 * PAYMENT.CAPTURE.COMPLETED and PAYMENT.CAPTURE.DENIED. Covers buyers who close the tab before returning.
 */
export async function POST(req: NextRequest) {
  const raw = await req.text();
  const cfg = await getConfig("payments");
  if (!(await paypal.verifyWebhook(cfg, raw, req.headers).catch(() => false))) return json({ error: "bad signature" }, { status: 400 });
  const ev = JSON.parse(raw);
  const r = ev?.resource ?? {};
  try {
    if (ev.event_type === "CHECKOUT.ORDER.APPROVED" && r.id) await capturePaypal(r.id, null);
    if (ev.event_type === "PAYMENT.CAPTURE.COMPLETED" || ev.event_type === "PAYMENT.CAPTURE.DENIED") {
      const orderId = r.supplementary_data?.related_ids?.order_id;
      const p = await db.payment.findFirst({ where: { provider: "paypal", OR: [...(orderId ? [{ providerRef: orderId }] : []), ...(r.custom_id ? [{ id: r.custom_id }] : [])] } });
      if (p && ev.event_type === "PAYMENT.CAPTURE.COMPLETED") await completePayment(p.id);
      if (p && ev.event_type === "PAYMENT.CAPTURE.DENIED") await failPayment(p.id, "PayPal denied the payment");
    }
  } catch (e) {
    console.error("[paypal webhook]", e);
    return json({ error: "retry" }, { status: 500 }); // PayPal retries for up to 3 days
  }
  return json({ received: true });
}
